/**
 * DailySummary - AI 每日总结系统
 * 在每天结束时（22:00）生成当日游戏状态和村民活动总结
 * 在事件标签页中以垂直时间线形式展示
 */
import { ACTION_NAMES, ACTION_ICONS, MAX_MOOD } from '../config/villagers.js';
import {
    WORK_HOURS_POLICIES,
    DISTRIBUTION_POLICIES,
    REWARD_POLICIES,
    HOLIDAY_POLICIES,
    isRestDay,
} from '../config/policies.js';

export class DailySummary {
    constructor(aiService, gameState, eventBus) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;
        this.summaries = []; // 历史每日总结（最多保留7天）
        this.todayActivities = []; // 今日活动记录
        this.isGenerating = false;
        /** @type {import('./MeetingSystem.js').MeetingSystem|null} */
        this.meetingSystem = null;

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

    /** 注入村会系统引用 */
    setMeetingSystem(meetingSystem) {
        this.meetingSystem = meetingSystem;
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
                avatar: v.avatar || '👤',
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

        // AI 生成总结（带重试）
        let aiSummary = '';
        if (this.ai.enabled) {
            const prompt = this.buildSummaryPrompt(villagerSummaries, keyEvents, resourceChanges);
            try {
                const result = await this.ai.chatRaw(prompt, { temperature: 0.8, maxTokens: 500 });
                // 质量检查：AI 返回的总结至少要有 20 个字才算有效
                if (result && result.trim().length >= 20) {
                    aiSummary = result.trim();
                } else {
                    console.log('[DailySummary] AI返回内容过短，使用智能降级');
                }
            } catch (e) {
                console.log('[DailySummary] AI调用失败:', e.message);
            }
        }

        // 降级总结（如果 AI 不可用或返回内容质量不够）
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

        console.log(`[DailySummary] 第${dayNum}天总结生成完成（${aiSummary.length}字）`);
    }

    /** 构建AI总结Prompt */
    buildSummaryPrompt(villagerSummaries, keyEvents, resourceChanges) {
        const villagersText = villagerSummaries.map(v => {
            const actionCount = v.actions.length;
            const actionSample = v.actions.slice(0, 6).join(' → ');
            const moodHigh = Math.round(MAX_MOOD * 0.8);
            const moodMid = Math.round(MAX_MOOD * 0.6);
            const moodLow = Math.round(MAX_MOOD * 0.4);
            const moodVeryLow = Math.max(1, Math.round(MAX_MOOD * 0.2));
            const moodDesc = v.mood >= moodHigh ? '心情很好'
                : v.mood >= moodMid ? '心情不错'
                : v.mood >= moodLow ? '心情一般'
                : v.mood >= moodVeryLow ? '心情低落' : '情绪很差';
            const staminaRatio = v.maxStamina ? (v.stamina / v.maxStamina) : 0;
            const staminaDesc = staminaRatio >= 0.7 ? '精力充沛'
                : staminaRatio >= 0.5 ? '还有体力'
                : staminaRatio >= 0.2 ? '有些疲惫' : '筋疲力尽';
            return `- ${v.name}（性格：${v.traits}）：${moodDesc}，${staminaDesc}。做了${actionCount}件事${actionCount > 0 ? '：' + actionSample : ''}`;
        }).join('\n');

        const weatherName = this.getCurrentWeatherName();
        const eventText = keyEvents.length > 0 ? keyEvents.join('\n') : '今天没有特殊事件发生';
        const resText = resourceChanges.length > 0 ? resourceChanges.join('，') : '无明显变化';

        // 构建政策上下文
        const policyText = this.buildPolicySummaryContext();

        // 构建村会指示上下文
        const meetingText = this.meetingSystem
            ? this.meetingSystem.getDirectiveBrief()
            : '';

        return `你是一位村庄编年史官，请为桃源村的今天写一段**生动有趣的日记总结**。

【今日档案】
日期：第${this.state.time.year}年·${this.state.seasonName}季 第${this.state.time.day}天
天气：${weatherName}
村庄金币：${this.state.resources.gold}，粮食：${this.state.resources.food}，木材：${this.state.resources.wood}，石料：${this.state.resources.stone}
今日资源变动：${resText}

${policyText}

${meetingText ? `【村长指示】\n${meetingText}` : ''}

【村民表现】
${villagersText}

【今日大事】
${eventText}

【写作要求】
1. 写4-6句话，总计60-120字
2. 用生动的叙事语言描述今天发生了什么，像在讲故事
3. 提到至少1位村民的名字和他/她今天做了什么
4. 如果有特殊天气或重要事件，要突出描述
5. 如果村庄政策对今天产生了明显影响（比如996导致村民疲惫、休息日大家轻松等），可以提到
6. 如果村长最近下达了工作指示，可以提到村民们是否在响应执行
7. 评价今天是好的一天还是困难的一天
7. 语气是温暖的村庄编年史风格，可以带一点幽默
8. 不要罗列数据，不要用列表格式
9. 直接输出纯文本，不要JSON、不要标题、不要markdown格式`;
    }

    /** 构建政策摘要上下文（注入到每日总结 Prompt 中） */
    buildPolicySummaryContext() {
        const policies = this.state.policies;
        if (!policies) return '';

        const lines = ['【当前村庄政策】'];

        const wh = WORK_HOURS_POLICIES[policies.workHours];
        if (wh) lines.push(`工时制度：${wh.name}（${wh.workStart}:00-${wh.workEnd}:00）`);

        const dist = DISTRIBUTION_POLICIES[policies.distribution];
        if (dist) lines.push(`分配制度：${dist.name}`);

        const rwd = REWARD_POLICIES[policies.reward];
        if (rwd) lines.push(`奖惩机制：${rwd.name}`);

        const hol = HOLIDAY_POLICIES[policies.holiday];
        if (hol) lines.push(`休假制度：${hol.name}`);

        if (isRestDay(this.state.time.day, policies)) {
            lines.push('📌 今天是休息日');
        }

        return lines.join('\n');
    }

    /** 降级总结（AI 不可用时生成有可读性的总结） */
    buildFallbackSummary(villagerSummaries, keyEvents, resourceChanges) {
        const day = this.state.time.day;
        const season = this.state.seasonName;
        const weather = this.getCurrentWeatherName();

        // 开场：天气氛围
        const weatherOpeners = {
            '和风': [`${season}的微风轻轻吹过桃源村`, `${season}的暖风让人心旷神怡`],
            '烈日': ['烈日当空，但村民们的干劲丝毫不减', '骄阳似火的一天'],
            '爽朗': ['秋高气爽，收获的气息弥漫在村庄', '凉爽的秋风让劳作变得轻松'],
            '寒冷': ['寒风凛冽，村民们裹紧了衣裳', '冬日的严寒考验着每一个人'],
        };
        const weatherKey = Object.keys(weatherOpeners).find(k => weather.includes(k));
        const openers = weatherOpeners[weatherKey] || [`${season}季第${day}天，桃源村的一天开始了`];
        const opener = openers[Math.floor(Math.random() * openers.length)];

        const parts = [opener];

        // 村民活动描述
        villagerSummaries.forEach(v => {
            const actionCount = v.actions.length;
            const moodText = v.mood >= Math.round(MAX_MOOD * 0.7) ? '精神不错'
                : v.mood >= Math.round(MAX_MOOD * 0.4) ? '状态尚可' : '有些萎靡';
            if (actionCount >= 5) {
                parts.push(`${v.name}今天格外忙碌，完成了${actionCount}项工作，${moodText}`);
            } else if (actionCount > 0) {
                parts.push(`${v.name}做了${actionCount}项工作，${moodText}`);
            } else {
                parts.push(`${v.name}今天比较清闲，在村里休息了一天`);
            }
        });

        // 事件亮点
        if (keyEvents.length > 0) {
            parts.push(`今日的重要事件包括${keyEvents.length}件大事`);
        }

        // 资源总结
        if (resourceChanges.length > 0) {
            parts.push(`资源方面：${resourceChanges.join('，')}`);
        }

        // 收尾
        const totalMood = villagerSummaries.reduce((s, v) => s + v.mood, 0) / Math.max(villagerSummaries.length, 1);
        if (totalMood >= Math.round(MAX_MOOD * 0.7)) {
            parts.push('总体来看，是充实而愉快的一天。');
        } else if (totalMood >= Math.round(MAX_MOOD * 0.4)) {
            parts.push('平淡而踏实的一天。');
        } else {
            parts.push('日子虽不轻松，但村庄仍在坚持。');
        }

        return parts.join('。');
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

    /** 更新事件标签页内容（垂直中轴线时间线，交叉分布） */
    updateEventsTab() {
        const container = document.getElementById('events-full-log');
        if (!container) return;

        if (this.summaries.length === 0) {
            container.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">每日总结将在每天 22:00 自动生成</div>';
            return;
        }

        let html = '<div class="center-timeline">';

        this.summaries.forEach((summary, index) => {
            const isLatest = index === 0;
            const side = index % 2 === 0 ? 'left' : 'right';

            // 日期节点（中轴上的圆点 + 日期标签）
            html += `
                <div class="ct-node">
                    <div class="ct-node-dot ${isLatest ? 'ct-node-active' : ''}"></div>
                    <div class="ct-node-label">${summary.dateLabel} ${summary.weather}${isLatest ? ' <span class="ct-badge-today">今日</span>' : ''}</div>
                </div>
            `;

            // AI 总结卡片
            html += `
                <div class="ct-item ct-${side}">
                    <div class="ct-connector"></div>
                    <div class="ct-card ${isLatest ? 'ct-card-latest' : ''}">
                        <div class="ct-card-header">
                            <span class="ct-card-icon">✨</span>
                            <span class="ct-card-title">每日总结</span>
                        </div>
                        <div class="ct-card-body">${summary.aiSummary}</div>
                        <div class="ct-card-resources">
                            <span>💰 ${summary.resources.gold}</span>
                            <span>🌾 ${summary.resources.food}</span>
                            <span>🪵 ${summary.resources.wood}</span>
                            <span>🪨 ${summary.resources.stone}</span>
                            ${summary.resourceChanges.length > 0 ? `<span class="ct-res-change">${summary.resourceChanges.join(' ')}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;

            // 村民活动卡片（交叉到另一侧）
            const villagerSide = side === 'left' ? 'right' : 'left';
            if (summary.villagers && summary.villagers.length > 0) {
                html += `
                    <div class="ct-item ct-${villagerSide}">
                        <div class="ct-connector"></div>
                        <div class="ct-card">
                            <div class="ct-card-header">
                                <span class="ct-card-icon">👥</span>
                                <span class="ct-card-title">村民活动</span>
                            </div>
                            <div class="ct-card-body ct-villager-list">
                                ${this.renderVillagerCards(summary.villagers)}
                            </div>
                        </div>
                    </div>
                `;
            }

            // 重要事件卡片（如果有）
            if (summary.keyEvents.length > 0) {
                html += `
                    <div class="ct-item ct-${side}">
                        <div class="ct-connector"></div>
                        <div class="ct-card">
                            <div class="ct-card-header">
                                <span class="ct-card-icon">📌</span>
                                <span class="ct-card-title">重要事件</span>
                            </div>
                            <div class="ct-card-body">
                                ${summary.keyEvents.map(e => `<div class="ct-event-row">${e}</div>`).join('')}
                            </div>
                        </div>
                    </div>
                `;
            }
        });

        html += '</div>';
        container.innerHTML = html;
    }

    /** 渲染村民活动卡片内容 */
    renderVillagerCards(villagers) {
        if (!villagers || villagers.length === 0) return '';

        return villagers.map(v => {
            const moodIcon = v.mood >= Math.round(MAX_MOOD * 0.7) ? '😊'
                : v.mood >= Math.round(MAX_MOOD * 0.4) ? '😐' : '😟';
            const staminaPercent = Math.round(v.stamina / v.maxStamina * 100);

            let actionsHtml = '';
            if (v.actions.length > 0) {
                const simplified = this.simplifyActions(v.actions);
                actionsHtml = simplified.map(a =>
                    `<span class="ct-action-tag">${a.time} ${a.text}</span>`
                ).join('');
            } else {
                actionsHtml = '<span class="ct-action-tag ct-idle">今日无活动</span>';
            }

            return `
                <div class="ct-villager-row">
                    <div class="ct-villager-info">
                        <span class="ct-villager-name">👤 ${v.name}</span>
                        <span class="ct-villager-trait">${v.traits}</span>
                        <span class="ct-villager-stats">${moodIcon}${v.mood} ⚡${staminaPercent}%</span>
                    </div>
                    <div class="ct-action-tags">${actionsHtml}</div>
                </div>
            `;
        }).join('');
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
