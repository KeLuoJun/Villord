/**
 * DailySummary - AI 每日总结系统
 * 在每天结束时（22:00）生成当日游戏状态和村民活动总结
 * 在事件标签页中以垂直时间线形式展示
 */
import { ACTION_NAMES, ACTION_ICONS } from '../config/villagers.js';

export class DailySummary {
    constructor(aiService, gameState, eventBus) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;
        this.summaries = []; // 历史每日总结（最多保留7天）
        this.todayActivities = []; // 今日活动记录
        this.isGenerating = false;

        // 监听事件
        this.bus.on('tick', (data) => this.onTick(data));
        this.bus.on('newDay', () => this.onNewDay());

        // 记录关键活动
        this.bus.on('buildingBuilt', (data) => this.recordActivity('🏗️', `建造了${data.config?.icon || ''} ${data.config?.name || '建筑'}`));
        this.bus.on('cropMature', (data) => this.recordActivity('✨', `${data.plot?.name || '农田'}的作物成熟了`));
        this.bus.on('cropHarvested', (data) => this.recordActivity('🌾', `收获了作物`));
        this.bus.on('villagerRecruited', (data) => this.recordActivity('👤', `招募了新村民`));
        this.bus.on('weatherEventStart', (data) => this.recordActivity(data.event?.icon || '🌤️', `${data.event?.name || '特殊天气'}来袭`));
        this.bus.on('schedulesGenerated', () => this.recordActivity('📋', '村民行动计划已安排'));
    }

    /** 记录今日活动 */
    recordActivity(icon, text) {
        this.todayActivities.push({
            hour: this.state.time.hour,
            icon,
            text,
            timestamp: Date.now(),
        });
    }

    /** 每 Tick 检查 */
    onTick(data) {
        // 每小时记录各村民的当前行动
        if (data.hour >= 6 && data.hour <= 22) {
            this.state.villagers.forEach(v => {
                if (v.currentAction && !v.currentAction.includes('空闲')) {
                    // 不重复记录同一动作
                    const lastAct = this.todayActivities.find(a =>
                        a.villagerId === v.id && a.hour === data.hour
                    );
                    if (!lastAct) {
                        this.todayActivities.push({
                            hour: data.hour,
                            icon: '👤',
                            text: `${v.name}：${v.currentAction}`,
                            villagerId: v.id,
                            timestamp: Date.now(),
                        });
                    }
                }
            });
        }

        // 每天 22:00 生成每日总结
        if (data.hour === 22 && !this.isGenerating) {
            this.generateDailySummary();
        }
    }

    /** 新的一天开始 */
    onNewDay() {
        this.todayActivities = [];
    }

    /** 生成每日总结 */
    async generateDailySummary() {
        this.isGenerating = true;

        const dayNum = this.state.time.day;
        const season = this.state.seasonName;
        const year = this.state.time.year;

        // 收集今日信息
        const villagerSummaries = this.state.villagers.map(v => {
            const activities = this.todayActivities
                .filter(a => a.villagerId === v.id)
                .sort((a, b) => a.hour - b.hour);

            const actionList = activities.map(a => `${String(a.hour).padStart(2, '0')}:00 ${a.text.replace(v.name + '：', '')}`);

            return {
                name: v.name,
                traits: v.traits.join('、'),
                stamina: v.stamina,
                maxStamina: v.maxStamina,
                mood: v.mood,
                actions: actionList,
                currentAction: v.currentAction || '休息',
            };
        });

        const keyEvents = this.todayActivities
            .filter(a => !a.villagerId)
            .map(a => `${String(a.hour).padStart(2, '0')}:00 ${a.icon} ${a.text}`);

        // 资源变化
        const changes = this.state.dailyChanges;
        const resourceChanges = [];
        if (changes.gold !== 0) resourceChanges.push(`金币${changes.gold >= 0 ? '+' : ''}${changes.gold}`);
        if (changes.food !== 0) resourceChanges.push(`粮食${changes.food >= 0 ? '+' : ''}${changes.food}`);
        if (changes.wood !== 0) resourceChanges.push(`木材${changes.wood >= 0 ? '+' : ''}${changes.wood}`);
        if (changes.stone !== 0) resourceChanges.push(`石料${changes.stone >= 0 ? '+' : ''}${changes.stone}`);

        // AI 生成总结
        let aiSummary = '';
        if (this.ai.enabled) {
            const prompt = this.buildSummaryPrompt(villagerSummaries, keyEvents, resourceChanges);
            const result = await this.ai.chatRaw(prompt, { temperature: 0.7, maxTokens: 300 });
            if (result) {
                aiSummary = result;
            }
        }

        // 降级总结
        if (!aiSummary) {
            aiSummary = this.buildFallbackSummary(villagerSummaries, keyEvents, resourceChanges);
        }

        // 构建总结数据
        const summary = {
            day: dayNum,
            season,
            year,
            dateLabel: `第${year}年·${season} 第${dayNum}天`,
            aiSummary,
            villagers: villagerSummaries,
            keyEvents,
            resourceChanges,
            resources: {
                gold: this.state.resources.gold,
                food: this.state.resources.food,
                wood: this.state.resources.wood,
                stone: this.state.resources.stone,
            },
            weather: this.getCurrentWeatherName(),
            timestamp: Date.now(),
        };

        this.summaries.unshift(summary);

        // 最多保留7天
        if (this.summaries.length > 7) {
            this.summaries.pop();
        }

        this.isGenerating = false;

        // 更新事件标签页
        this.updateEventsTab();

        console.log(`[DailySummary] 第${dayNum}天总结生成完成`);
    }

    /** 构建AI总结Prompt */
    buildSummaryPrompt(villagerSummaries, keyEvents, resourceChanges) {
        const villagersText = villagerSummaries.map(v => {
            const actions = v.actions.length > 0 ? v.actions.join('、') : '空闲一天';
            return `${v.name}（${v.traits}）：体力${v.stamina}/${v.maxStamina}，心情${v.mood}。今日活动：${actions}`;
        }).join('\n');

        return `请用2-4句话总结以下村庄今日情况，语气像村庄日志/编年史，简洁生动。

## 今日信息
- 日期：第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天
- 天气：${this.getCurrentWeatherName()}
- 资源变化：${resourceChanges.join('，') || '无明显变化'}
- 当前资源：金币${this.state.resources.gold}，粮食${this.state.resources.food}，木材${this.state.resources.wood}，石料${this.state.resources.stone}

## 村民情况
${villagersText}

## 重要事件
${keyEvents.join('\n') || '无特殊事件'}

## 要求
- 2-4句话，简洁生动
- 突出重点事件和村民表现
- 不要罗列数据
- 直接输出文本，不要JSON格式`;
    }

    /** 降级总结 */
    buildFallbackSummary(villagerSummaries, keyEvents, resourceChanges) {
        const parts = [];
        const day = this.state.time.day;
        const season = this.state.seasonName;

        parts.push(`${season}第${day}天`);

        if (keyEvents.length > 0) {
            parts.push(`今日有${keyEvents.length}件事发生`);
        } else {
            parts.push('今日风平浪静');
        }

        if (resourceChanges.length > 0) {
            parts.push(`资源变化：${resourceChanges.join('，')}`);
        }

        villagerSummaries.forEach(v => {
            const actionCount = v.actions.length;
            if (actionCount > 0) {
                parts.push(`${v.name}完成了${actionCount}项工作`);
            } else {
                parts.push(`${v.name}今天比较悠闲`);
            }
        });

        return parts.join('。') + '。';
    }

    /** 获取天气名称 */
    getCurrentWeatherName() {
        const w = this.state.weather;
        if (w.activeEvent) {
            const evt = window.SPECIAL_WEATHER_EVENTS?.[w.activeEvent];
            return evt ? `${evt.icon} ${evt.name}` : '特殊天气';
        }
        const def = window.SEASON_DEFAULT?.[this.state.season];
        return def ? `${def.icon} ${def.name}` : '正常';
    }

    // ===== UI: 事件标签页渲染 =====

    /** 更新事件标签页内容（垂直时间线） */
    updateEventsTab() {
        const container = document.getElementById('events-full-log');
        if (!container) return;

        if (this.summaries.length === 0) {
            container.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">每日总结将在每天 22:00 自动生成</div>';
            return;
        }

        let html = '<div class="daily-timeline">';

        this.summaries.forEach((summary, index) => {
            const isLatest = index === 0;

            html += `
                <div class="timeline-day ${isLatest ? 'timeline-day-latest' : ''}" ${!isLatest ? 'style="opacity:0.85;"' : ''}>
                    <!-- 日期头 -->
                    <div class="timeline-date-header" style="
                        display:flex;align-items:center;gap:8px;margin-bottom:12px;
                        padding-bottom:8px;border-bottom:2px solid ${isLatest ? 'var(--accent)' : 'var(--border)'};
                    ">
                        <span style="font-size:16px;">${isLatest ? '📅' : '📋'}</span>
                        <span style="font-weight:700;font-size:14px;">${summary.dateLabel}</span>
                        <span style="font-size:12px;color:var(--text-muted);">${summary.weather}</span>
                        ${isLatest ? '<span style="font-size:11px;background:var(--accent);color:white;padding:2px 8px;border-radius:10px;">今日</span>' : ''}
                    </div>

                    <!-- AI 总结 -->
                    <div style="background:var(--surface);padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:13px;line-height:1.7;border-left:3px solid var(--accent);">
                        ✨ ${summary.aiSummary}
                    </div>

                    <!-- 资源状态条 -->
                    <div style="display:flex;gap:12px;margin-bottom:12px;font-size:12px;flex-wrap:wrap;">
                        <span>💰 ${summary.resources.gold}</span>
                        <span>🌾 ${summary.resources.food}</span>
                        <span>🪵 ${summary.resources.wood}</span>
                        <span>🪨 ${summary.resources.stone}</span>
                        ${summary.resourceChanges.length > 0 ? `<span style="color:var(--text-muted);">（${summary.resourceChanges.join('，')}）</span>` : ''}
                    </div>

                    <!-- 村民时间线 -->
                    ${this.renderVillagerTimelines(summary.villagers)}

                    <!-- 重要事件 -->
                    ${summary.keyEvents.length > 0 ? `
                        <div style="margin-top:8px;">
                            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">📌 重要事件</div>
                            ${summary.keyEvents.map(e => `
                                <div style="font-size:12px;padding:3px 0;color:var(--text-secondary);">${e}</div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;

            // 日之间的分隔
            if (index < this.summaries.length - 1) {
                html += '<div style="border-top:1px dashed var(--border);margin:16px 0;"></div>';
            }
        });

        html += '</div>';
        container.innerHTML = html;
    }

    /** 渲染村民时间线（垂直） */
    renderVillagerTimelines(villagers) {
        if (!villagers || villagers.length === 0) return '';

        let html = '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">👥 村民活动</div>';

        villagers.forEach(v => {
            const moodIcon = v.mood >= 70 ? '😊' : v.mood >= 40 ? '😐' : '😟';
            const staminaPercent = Math.round(v.stamina / v.maxStamina * 100);
            const staminaColor = staminaPercent >= 60 ? 'var(--accent)' : staminaPercent >= 30 ? '#e67e22' : 'var(--color-danger, #e74c3c)';

            html += `
                <div style="margin-bottom:10px;padding:8px 10px;background:var(--surface);border-radius:8px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <span style="font-weight:600;font-size:13px;">👤 ${v.name}</span>
                        <span style="font-size:11px;color:var(--text-muted);">${v.traits}</span>
                        <span style="margin-left:auto;font-size:11px;">${moodIcon} ${v.mood}</span>
                        <span style="font-size:11px;color:${staminaColor};">⚡${staminaPercent}%</span>
                    </div>
            `;

            // 垂直时间线
            if (v.actions.length > 0) {
                html += '<div class="villager-timeline" style="padding-left:12px;border-left:2px solid var(--border);margin-left:6px;">';
                // 精简：合并连续相同动作，只显示关键时间节点
                const simplified = this.simplifyActions(v.actions);
                simplified.forEach((action, i) => {
                    const isLast = i === simplified.length - 1;
                    html += `
                        <div style="position:relative;padding:3px 0 3px 12px;font-size:12px;${isLast ? '' : ''}">
                            <span style="position:absolute;left:-5px;top:6px;width:8px;height:8px;
                                border-radius:50%;background:var(--accent);border:2px solid var(--bg-main, white);"></span>
                            <span style="color:var(--text-muted);min-width:40px;display:inline-block;">${action.time}</span>
                            <span>${action.text}</span>
                        </div>
                    `;
                });
                html += '</div>';
            } else {
                html += '<div style="font-size:11px;color:var(--text-muted);padding-left:20px;">今日无活动记录</div>';
            }

            html += '</div>';
        });

        return html;
    }

    /** 精简时间线：合并连续相同动作 */
    simplifyActions(actions) {
        if (actions.length === 0) return [];

        const result = [];
        let prevAction = '';

        actions.forEach(actionStr => {
            // actionStr 格式："07:00 💧 浇水" 或 "07:00 xxxx"
            const match = actionStr.match(/^(\d{2}:\d{2})\s+(.+)$/);
            if (!match) return;

            const [, time, text] = match;

            // 跳过与上一个完全相同的动作描述
            if (text === prevAction) return;
            prevAction = text;

            result.push({ time, text });
        });

        // 最多显示10条
        if (result.length > 10) {
            const kept = result.slice(0, 8);
            kept.push({ time: '...', text: `还有${result.length - 8}项活动` });
            return kept;
        }

        return result;
    }

    // 注册为事件面板
    onActivate() { this.updateEventsTab(); }
    update() { this.updateEventsTab(); }
}
