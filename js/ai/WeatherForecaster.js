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
        this.lastPredictionDay = 0;

        // 监听事件
        this.bus.on('tick', (data) => this.onTick(data));
        this.bus.on('seasonChange', () => this.onSeasonStart());
    }

    /** 每 Tick 处理 */
    onTick(data) {
        // 每日 5:00 天气播报
        if (data.hour === 5) {
            this.dailyBroadcast();
        }

        // 每14天或距上次预测>=14天时生成新预测
        if (data.hour === 3) {
            const daysSincePred = this.state.totalDays - this.lastPredictionDay;
            if (daysSincePred >= 14) {
                this.generatePrediction();
            }
        }
    }

    /** 季初预测 */
    onSeasonStart() {
        this.generatePrediction();
    }

    /** AI 生成天气预测 */
    async generatePrediction() {
        console.log('[WeatherForecaster] 开始生成天气预测...');
        this.lastPredictionDay = this.state.totalDays;

        const seasonEvents = getSeasonEvents(this.state.season);
        if (seasonEvents.length === 0) {
            console.log('[WeatherForecaster] 当前季节无特殊天气事件');
            return;
        }

        const prompt = this.buildPredictionPrompt(seasonEvents);

        // AI LOGIC - 生成预测
        const result = await this.ai.chat(prompt, { temperature: 0.7, maxTokens: 400 });

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

        return `# 任务：预测未来14天天气
你是村庄经营游戏中的天气预报AI。

## 当前信息
- 季节：${this.state.seasonName}
- 当前日期：第${this.state.time.day}天
- 上次特殊天气距今：${this.state.totalDays - this.state.weather.lastEventEndDay}天

## 本季可触发的特殊天气（只能从这里选）
${evtList}

## 硬约束（必须遵守）
1. 从中最多选择2个事件
2. 两个事件间隔至少5天
3. 距上次特殊天气结束至少5天
4. dayOffset 范围：1-14

# 输出格式（严格JSON）
\`\`\`json
{
  "predictions": [
    { "eventId": "事件ID", "dayOffset": 7, "reason": "理由" }
  ],
  "reasoning": "预测总体理由"
}
\`\`\``;
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

                    <h4 style="margin:0 0 8px;font-size:14px;">📅 未来14天天气预报</h4>
                    ${this.state.weather.predictionReason ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;font-style:italic;">AI预测说明：${this.state.weather.predictionReason}</div>` : ''}
                    <div style="max-height:300px;overflow-y:auto;">
                        ${forecastHTML || '<div style="color:var(--text-muted);font-size:13px;">暂无天气预报数据，AI预报员将在下次预测时更新。</div>'}
                    </div>

                    ${seasonEventsHTML}
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary weather-close">关闭</button>
                </div>
            </div>
        `;

        overlay.querySelector('.weather-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }
}
