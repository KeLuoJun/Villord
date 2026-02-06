/**
 * WeatherForecaster - AI 天气预报员
 * 每14天/季初由 AI 预测未来天气
 * 每日 5:00 进行天气播报
 */
import { getSeasonEvents, SEASON_DEFAULT, SPECIAL_WEATHER_EVENTS } from '../config/weather.js';

export class WeatherForecaster {
    constructor(aiService, gameState, eventBus, weatherSystem) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;
        this.weatherSys = weatherSystem;
        this.lastPredictionDay = -100; // 确保游戏启动后首次检查立即触发预测
        this._initialPredictionDone = false;

        // 监听事件
        this.bus.on('tick', (data) => this.onTick(data));
        this.bus.on('seasonChange', () => this.onSeasonStart());
    }

    /** 每 Tick 处理 */
    onTick(data) {
        // 首次 tick 时立即生成初始天气预测（确保第一季就有天气变化）
        if (!this._initialPredictionDone) {
            this._initialPredictionDone = true;
            this.generatePrediction();
        }

        // 每日 5:00 天气播报
        if (data.hour === 5) {
            this.dailyBroadcast();
        }

        // 每7天检查是否需要生成新预测（9天/季，7天间隔确保每季至少预测1次）
        if (data.hour === 3) {
            const daysSincePred = this.state.totalDays - this.lastPredictionDay;
            if (daysSincePred >= 7) {
                this.generatePrediction();
            }
        }
    }

    /** 季初预测 */
    onSeasonStart() {
        this.generatePrediction();
    }

    /** AI 生成天气预测（关键调用：天气预测影响全局决策） */
    async generatePrediction() {
        console.log('[WeatherForecaster] 开始生成天气预测...');
        this.lastPredictionDay = this.state.totalDays;

        const seasonEvents = getSeasonEvents(this.state.season);
        if (seasonEvents.length === 0) {
            console.log('[WeatherForecaster] 当前季节无特殊天气事件');
            return;
        }

        const prompt = this.buildPredictionPrompt(seasonEvents);

        // 关键调用：失败暂停+重试
        const result = await this.ai.criticalChat(prompt, { temperature: 0.7, maxTokens: 400 }, {
            label: '🌤️ 天气预测',
        });

        if (result && result.predictions && Array.isArray(result.predictions)) {
            this.weatherSys.setSchedule(result.predictions.map(p => ({
                eventId: p.eventId,
                triggerDay: this.state.totalDays + p.dayOffset,
                reason: p.reason || '',
            })));
            this.state.weather.predictionReason = result.reasoning || '';
            console.log('[WeatherForecaster] 预测成功:', result.predictions.length, '个事件');
        } else {
            // 降级
            this.weatherSys.fallbackPrediction();
            console.log('[WeatherForecaster] 使用降级预测');
        }
    }

    /** 构建预测 Prompt */
    buildPredictionPrompt(seasonEvents) {
        const evtList = seasonEvents.map(e =>
            `- ${e.id}: ${e.name}（${e.icon}），持续${e.duration}天，效果：${e.effectSummary}`
        ).join('\n');

        // 计算当季剩余天数
        const daysLeftInSeason = 9 - this.state.time.day + 1;
        const daysSinceLastEvent = this.state.totalDays - this.state.weather.lastEventEndDay;

        return `你是村庄经营游戏的天气预测AI。为当前季节安排特殊天气事件。

【当前状态】
季节：${this.state.seasonName}，当季第${this.state.time.day}天（每季共9天）
距上次特殊天气已过${daysSinceLastEvent}天

【本季可用的特殊天气】
${evtList}

【规则】
• 从上面选1-2个事件安排到未来几天
• dayOffset范围：2~${Math.min(daysLeftInSeason, 8)}（当季剩余${daysLeftInSeason}天内）
• 两个事件间隔至少3天
• 距上次特殊天气至少间隔3天（当前已过${daysSinceLastEvent}天，${daysSinceLastEvent >= 3 ? '可以安排' : '需等待'}）
• 为每个事件提供一个简短的理由（为什么会在这天出现这种天气）

输出JSON：
{
  "predictions": [
    {"eventId": "事件ID", "dayOffset": 3, "reason": "简短理由"}
  ],
  "reasoning": "整体预测思路（2-3句话）"
}`;
    }

    /** 每日天气播报 */
    async dailyBroadcast() {
        const effects = this.weatherSys.getCurrentEffects();
        const weatherName = this.weatherSys.getCurrentWeatherName();

        // 检查明天/后天是否有预定的特殊天气
        const upcoming = this.state.weather.schedule.filter(s =>
            s.triggerDay > this.state.totalDays && s.triggerDay <= this.state.totalDays + 3
        );

        let warning = '';
        if (upcoming.length > 0) {
            const next = upcoming[0];
            const evt = SPECIAL_WEATHER_EVENTS[next.eventId];
            if (evt) {
                const daysUntil = next.triggerDay - this.state.totalDays;
                warning = `⚠️ 预警：${daysUntil}天后可能出现${evt.icon}${evt.name}`;
            }
        }

        // AI 生成简短播报
        let broadcastText = `今日天气：${weatherName}`;

        if (this.ai.enabled) {
            const rawText = await this.ai.chatRaw(
                `请用一句话（20字以内）口语化描述今天的天气：${weatherName}。要求活泼可爱，像小村庄广播员。直接输出一句话，不要任何格式。`,
                { temperature: 1.0, maxTokens: 60 }
            );
            if (rawText) {
                broadcastText = rawText;
            }
        }

        // 更新天气面板UI
        this.updateWeatherPanel(weatherName, effects, warning);

        // 天气播报日志
        this.state.addLog('🌤️', `${broadcastText}${warning ? ' ' + warning : ''}`, 'info');

        // 天气预警不再自动暂停，仅作为日志通知
        // （只有玩家主动发起对话时才暂停游戏）
    }

    /** 更新天气面板 */
    updateWeatherPanel(weatherName, effects, warning) {
        const panel = document.getElementById('weather-panel');
        if (!panel) return;

        // 效果列表
        const effectsList = [];
        if (effects.cropGrowth !== undefined && effects.cropGrowth !== 1.0) {
            const mod = Math.round((effects.cropGrowth - 1) * 100);
            effectsList.push(`作物: ${mod >= 0 ? '+' : ''}${mod}%`);
        }
        if (effects.staminaMod !== undefined && effects.staminaMod !== 1.0) {
            const mod = Math.round((effects.staminaMod - 1) * 100);
            effectsList.push(`体力消耗: ${mod >= 0 ? '+' : ''}${mod}%`);
        }
        if (effects.canGoOut === false) {
            effectsList.push('🚫 不可外出');
        }

        // 即将到来的特殊天气数量
        const schedule = this.state.weather.schedule || [];
        const futureEvents = schedule.filter(s => {
            const daysUntil = s.triggerDay - this.state.totalDays;
            return daysUntil >= 0;
        });

        let html = `
            <div class="weather-current" style="cursor:pointer;" title="点击查看详细天气预报">
                <span class="weather-icon" style="font-size:24px;">${weatherName.match(/^.{1,2}/)?.[0] || '🌤️'}</span>
                <span>${weatherName}</span>
            </div>
        `;

        if (effectsList.length > 0) {
            html += `<div style="font-size:12px;color:var(--text-secondary);">效果：${effectsList.join('，')}</div>`;
        }
        if (warning) {
            html += `<div class="weather-alert">${warning}</div>`;
        }

        // 简要预报
        if (futureEvents.length > 0) {
            html += `<div style="margin-top:6px;font-size:11px;color:var(--text-muted);">📅 ${futureEvents.length}个天气事件预报</div>`;
        }

        html += `<div style="margin-top:6px;text-align:center;">
            <span style="font-size:11px;color:var(--accent);cursor:pointer;text-decoration:underline;" id="weather-detail-link">🔍 点击查看详细预报</span>
        </div>`;

        panel.innerHTML = html;

        // 绑定点击事件（面板和链接都可点击）
        const showDetail = () => this.showWeatherDetailModal(weatherName, effects, warning);
        panel.style.cursor = 'pointer';
        panel.onclick = showDetail;
    }

    /** 显示详细天气预报弹窗 */
    showWeatherDetailModal(weatherName, effects, warning) {
        // 移除已有弹窗
        const existing = document.querySelector('.weather-detail-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay weather-detail-overlay';

        // 当前天气详情
        const effectsList = [];
        if (effects.cropGrowth !== undefined && effects.cropGrowth !== 1.0) {
            const mod = Math.round((effects.cropGrowth - 1) * 100);
            effectsList.push(`🌱 作物生长速度: ${mod >= 0 ? '+' : ''}${mod}%`);
        }
        if (effects.staminaMod !== undefined && effects.staminaMod !== 1.0) {
            const mod = Math.round((effects.staminaMod - 1) * 100);
            effectsList.push(`⚡ 体力消耗: ${mod >= 0 ? '+' : ''}${mod}%`);
        }
        if (effects.marketMod !== undefined && effects.marketMod !== 1.0) {
            const mod = Math.round((effects.marketMod - 1) * 100);
            effectsList.push(`💰 市场价格: ${mod >= 0 ? '+' : ''}${mod}%`);
        }
        if (effects.canGoOut === false) {
            effectsList.push('🚫 禁止外出作业');
        }
        if (effects.autoWater) {
            effectsList.push('💧 自动浇水');
        }

        // 14天预报
        const schedule = this.state.weather.schedule || [];
        const futureEvents = schedule.filter(s => s.triggerDay > this.state.totalDays).sort((a, b) => a.triggerDay - b.triggerDay);

        // 构建14天日历
        let forecastHTML = '';
        for (let i = 1; i <= 14; i++) {
            const targetDay = this.state.totalDays + i;
            const scheduled = futureEvents.find(s => {
                const evt = SPECIAL_WEATHER_EVENTS[s.eventId];
                if (!evt) return false;
                return targetDay >= s.triggerDay && targetDay < s.triggerDay + evt.duration;
            });

            let dayWeather, dayIcon, dayClass;
            if (scheduled) {
                const evt = SPECIAL_WEATHER_EVENTS[scheduled.eventId];
                dayWeather = evt.name;
                dayIcon = evt.icon;
                dayClass = 'weather-day-special';
            } else {
                const def = SEASON_DEFAULT[this.state.season];
                dayWeather = def ? def.name : '正常';
                dayIcon = def ? def.icon : '🌤️';
                dayClass = 'weather-day-normal';
            }

            forecastHTML += `
                <div class="weather-forecast-day ${dayClass}" style="
                    display:flex;align-items:center;gap:8px;padding:6px 10px;
                    border-radius:6px;margin-bottom:4px;
                    background:${scheduled ? 'rgba(231,76,60,0.08)' : 'var(--surface)'};
                    border-left:3px solid ${scheduled ? 'var(--danger, #e74c3c)' : 'var(--border)'};
                ">
                    <span style="min-width:50px;font-size:12px;color:var(--text-muted);">+${i}天</span>
                    <span style="font-size:16px;">${dayIcon}</span>
                    <span style="flex:1;font-size:13px;">${dayWeather}</span>
                    ${scheduled ? `<span style="font-size:11px;color:var(--danger, #e74c3c);">⚠</span>` : ''}
                </div>
            `;
        }

        // 本季可能出现的特殊天气说明
        const seasonEvents = Object.values(SPECIAL_WEATHER_EVENTS).filter(e => e.season === this.state.season);
        let seasonEventsHTML = '';
        if (seasonEvents.length > 0) {
            seasonEventsHTML = `
                <div style="margin-top:16px;">
                    <h4 style="margin:0 0 8px;font-size:13px;color:var(--text-secondary);">📋 本季可能出现的特殊天气</h4>
                    ${seasonEvents.map(e => `
                        <div style="display:flex;gap:8px;padding:4px 0;font-size:12px;align-items:flex-start;">
                            <span style="font-size:16px;">${e.icon}</span>
                            <div>
                                <div style="font-weight:600;">${e.name}（${e.duration}天）</div>
                                <div style="color:var(--text-secondary);">${e.effectSummary}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // 构建付费查看 AI 思考的按钮
        const hasReasoning = !!this.state.weather.predictionReason;
        const hasEventReasons = futureEvents.some(s => s.reason);
        const gold = this.state.resources.gold;

        let insightHTML = `
            <div style="margin-top:16px;padding:12px;background:var(--surface);border-radius:8px;border:1px dashed var(--border);">
                <h4 style="margin:0 0 8px;font-size:13px;color:var(--accent);">🧠 AI 预报员的思考</h4>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
                    花费少量金币查看AI预报员的预测思路，帮助你做出更好的决策。
                </div>
                <div id="weather-insight-overall" style="margin-bottom:8px;">
                    <button class="btn btn-sm" id="btn-reveal-reasoning" style="font-size:12px;" ${gold < 5 ? 'disabled title="金币不足"' : ''}>
                        🔮 查看整体预测思路（5💰）
                    </button>
                </div>
                ${futureEvents.length > 0 ? `
                <div id="weather-insight-events">
                    ${futureEvents.map((s, i) => {
                        const evt = SPECIAL_WEATHER_EVENTS[s.eventId];
                        if (!evt) return '';
                        const daysUntil = s.triggerDay - this.state.totalDays;
                        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                            <span style="font-size:12px;">${evt.icon} +${daysUntil}天 ${evt.name}</span>
                            <button class="btn btn-sm btn-event-reason" data-idx="${i}" style="font-size:11px;padding:2px 8px;" ${gold < 3 ? 'disabled title="金币不足"' : ''}>
                                查看原因（3💰）
                            </button>
                            <span class="event-reason-text" data-idx="${i}" style="font-size:12px;color:var(--text-secondary);display:none;"></span>
                        </div>`;
                    }).join('')}
                </div>` : ''}
            </div>
        `;

        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:520px;max-height:80vh;overflow-y:auto;">
                <div class="modal-title">🌤️ 天气预报详情</div>
                <div class="modal-body" style="text-align:left;">
                    <div style="background:var(--surface);padding:12px;border-radius:8px;margin-bottom:16px;">
                        <div style="font-size:18px;font-weight:700;margin-bottom:6px;">
                            ${weatherName.match(/^.{1,2}/)?.[0] || '🌤️'} 今日天气：${weatherName}
                        </div>
                        ${effectsList.length > 0 ? `<div style="font-size:13px;">${effectsList.join('<br>')}</div>` : '<div style="font-size:13px;color:var(--text-muted);">无特殊效果</div>'}
                        ${warning ? `<div style="margin-top:8px;padding:6px 10px;background:rgba(231,76,60,0.1);border-radius:6px;font-size:13px;color:var(--danger, #e74c3c);">${warning}</div>` : ''}
                    </div>

                    <h4 style="margin:0 0 8px;font-size:14px;">📅 未来天气预报</h4>
                    <div style="max-height:300px;overflow-y:auto;">
                        ${forecastHTML || '<div style="color:var(--text-muted);font-size:13px;">暂无天气预报数据，AI预报员将在下次预测时更新。</div>'}
                    </div>

                    ${insightHTML}
                    ${seasonEventsHTML}
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary weather-close">关闭</button>
                </div>
            </div>
        `;

        // 绑定关闭事件
        overlay.querySelector('.weather-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // 绑定「查看整体预测思路」按钮
        const btnReasoning = overlay.querySelector('#btn-reveal-reasoning');
        if (btnReasoning) {
            btnReasoning.addEventListener('click', () => {
                if (this.state.resources.gold < 5) {
                    this.state.addLog('⚠️', '金币不足，无法查看', 'warning');
                    return;
                }
                this.state.resources.gold -= 5;
                this.bus.emit('uiUpdate', {});
                const reason = this.state.weather.predictionReason || '预报员还没有给出分析（等待下次AI预测生成）';
                btnReasoning.replaceWith(Object.assign(document.createElement('div'), {
                    style: 'font-size:12px;color:var(--text-primary);padding:8px;background:rgba(52,152,219,0.08);border-radius:6px;border-left:3px solid var(--accent);',
                    innerHTML: `<strong>🔮 预报员说：</strong>${reason}`,
                }));
                this.state.addLog('🧠', `花费5💰查看了天气预测思路`, 'info');
            });
        }

        // 绑定「查看单个事件原因」按钮
        overlay.querySelectorAll('.btn-event-reason').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.state.resources.gold < 3) {
                    this.state.addLog('⚠️', '金币不足，无法查看', 'warning');
                    return;
                }
                this.state.resources.gold -= 3;
                this.bus.emit('uiUpdate', {});
                const idx = parseInt(btn.dataset.idx);
                const evt = futureEvents[idx];
                const reason = evt?.reason || '暂无具体分析';
                btn.style.display = 'none';
                const reasonEl = overlay.querySelector(`.event-reason-text[data-idx="${idx}"]`);
                if (reasonEl) {
                    reasonEl.style.display = 'inline';
                    reasonEl.textContent = `💡 ${reason}`;
                }
                this.state.addLog('🧠', `花费3💰查看了天气事件原因`, 'info');
            });
        });

        document.body.appendChild(overlay);
    }
}
