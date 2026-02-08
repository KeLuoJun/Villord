/**
 * VillagerScheduler - 村民调度系统
 * 每日 7:00 AI 为每个村民并行生成当日行动计划（在市场早报5:00之后）
 * 每 Tick 驱动村民按计划执行行动（含现实检查）
 * 村民 7:00 起床，8:00 开始执行计划，22:00 睡觉
 *
 * 政策系统集成：工时制度影响作息时间，休假制度影响是否执行计划，
 *              分配制度影响产出入库比例，奖惩机制通过 PersonalitySystem 生效
 */
import { VALID_ACTIONS, ACTION_DURATIONS, ACTION_NAMES, ACTION_ICONS, STAMINA_COSTS, MAX_MOOD } from '../config/villagers.js';
import { MARKET_OPEN_HOUR, MARKET_CLOSE_HOUR } from '../market/MarketEngine.js';
import {
    WORK_HOURS_POLICIES,
    HOLIDAY_POLICIES,
    DISTRIBUTION_POLICIES,
    REWARD_POLICIES,
    isRestDay,
} from '../config/policies.js';

const WAKE_HOUR = 7;            // 起床 & 计划生成触发时间
const DEFAULT_SCHEDULE_START = 8;  // 默认计划执行起始时间
const SLEEP_HOUR = 22;

export class VillagerScheduler {
    constructor(gameState, eventBus, aiService, villagerSystem, farmSystem) {
        this.state = gameState;
        this.bus = eventBus;
        this.ai = aiService;
        this.villagerSys = villagerSystem;
        this.farmSys = farmSystem;
        this.isScheduling = false;
        this.lastScheduleDay = -1;
        /** @type {import('./MeetingSystem.js').MeetingSystem|null} */
        this.meetingSystem = null;

        // 监听事件
        this.bus.on('tick', (data) => this.onTick(data));
    }

    /** 注入村会系统引用 */
    setMeetingSystem(meetingSystem) {
        this.meetingSystem = meetingSystem;
    }

    /** 每 Tick 处理 */
    onTick(data) {
        // 每日 7:00 触发调度（在市场早报5:00之后）
        if (data.hour === WAKE_HOUR) {
            const today = this.state.totalDays;
            if (today !== this.lastScheduleDay) {
                this.generateSchedules();
                this.lastScheduleDay = today;
            }
        }

        // Deadline 检查：如果 8:00 了还在生成中，暂停游戏等待完成
        if (data.hour === WAKE_HOUR + 1 && this.isScheduling) {
            this.bus.emit('aiPauseGame', { reason: '村民行动计划仍在生成中，等待完成...' });
            this.bus.emit('showToast', { message: '⏳ 村民计划尚未生成完毕，暂停等待...', type: 'warning' });
        }

        // 驱动村民执行当前计划
        this.state.villagers.forEach(v => this.executeSchedule(v, data.hour));
    }

    // ===== 计划生成 =====

    /** 为所有村民并行生成调度计划（关键任务：超时暂停） */
    async generateSchedules() {
        if (this.isScheduling) return;
        this.isScheduling = true;

        console.log('[Scheduler] 开始并行生成村民调度计划...');
        const startTime = Date.now();

        // 并行调用 AI 为每个村民生成计划
        const promises = this.state.villagers.map(async (villager) => {
            if (villager._cancelledByPlayer) {
                villager._cancelledByPlayer = false;
                console.log(`[Scheduler] ${villager.name} 的调度已被玩家覆盖，跳过`);
                return;
            }

            try {
                const schedule = await this.generateScheduleForVillager(villager);
                this._applySchedule(villager, schedule);
                console.log(`[Scheduler] ${villager.name} 计划完成: ${schedule.length} 个行动`);
            } catch (e) {
                console.warn(`[Scheduler] ${villager.name} 计划失败，使用默认`, e.message);
                this._applySchedule(villager, this.getDefaultSchedule(villager));
            }
        });

        await Promise.all(promises);

        const elapsed = Date.now() - startTime;
        console.log(`[Scheduler] 全部计划生成完毕，耗时 ${elapsed}ms`);

        this.isScheduling = false;
        this.state.addLog('📋', '所有村民今日行动计划已生成', 'info');
        this.bus.emit('schedulesGenerated', {});

        // 如果游戏因等待计划生成而暂停，自动恢复
        if (this.state.time.isPaused) {
            this.bus.emit('aiResumeGame', {});
            this.bus.emit('showToast', { message: '✅ 村民计划已生成，游戏继续', type: 'success' });
        }
    }

    /**
     * 应用新计划到村民（保留已过去的任务执行状态）
     * 解决异步生成期间已执行的任务状态被清除的问题
     */
    _applySchedule(villager, schedule) {
        const currentHour = this.state.time.hour;
        const oldStatus = { ...(villager._scheduleStatus || {}) };

        villager.schedule = schedule;

        // 构建新的执行状态：保留已过去时间段的旧状态，避免刷掉已完成的记录
        const newStatus = {};
        schedule.forEach(task => {
            const key = `${task.startHour}_${task.action}`;
            if (task.startHour < currentHour) {
                // 该任务的时间窗口已过去
                // 如果旧状态中有记录（说明旧计划的同时间/同行动已执行），保留它
                // 否则标记为 'past'（计划生成完毕时该时间点已错过，未执行）
                newStatus[key] = oldStatus[key] || 'past';
            }
            // startHour >= currentHour 的任务不设初始状态，允许正常触发执行
        });
        villager._scheduleStatus = newStatus;

        console.log(`[Scheduler] ${villager.name} 计划已应用（当前${currentHour}:00，` +
            `保留${Object.keys(newStatus).length}条历史状态）`);
    }

    /** 为单个村民生成调度计划（关键调用：失败暂停+重试） */
    async generateScheduleForVillager(villager) {
        const directiveInfo = this.getRecentPlayerDirectives(villager);
        // 保存近期指令影响（供交易执行阶段使用）
        villager._tradePolicy = directiveInfo.tradePolicy;
        const prompt = this.buildSchedulePrompt(villager, directiveInfo);
        const result = await this.ai.criticalChat(prompt, { temperature: 0.7, maxTokens: 600 }, {
            label: `📋 ${villager.name}的行动计划`,
        });

        if (result && result.schedule && Array.isArray(result.schedule)) {
            const validated = this.validateSchedule(result.schedule, villager, directiveInfo.tradePolicy);
            if (validated.length > 0) return validated;
        }

        return this.fillScheduleGaps(this.getDefaultSchedule(villager));
    }

    /** 获取当前政策下的工作起始小时 */
    getScheduleStartHour() {
        const effects = this.state.getPolicyEffects();
        return effects.workStart || DEFAULT_SCHEDULE_START;
    }

    /** 获取当前政策下的工作结束小时（之后安排轻松活动直到 SLEEP_HOUR） */
    getWorkEndHour() {
        const effects = this.state.getPolicyEffects();
        return Math.min(effects.workEnd || 18, SLEEP_HOUR);
    }

    /** 构建政策上下文提示词（注入到调度 Prompt 中） */
    buildPolicyContext() {
        const policies = this.state.policies;
        const effects = this.state.getPolicyEffects();
        const today = this.state.time.day;
        const restDay = isRestDay(today, policies);

        const whPolicy = WORK_HOURS_POLICIES[policies.workHours];
        const distPolicy = DISTRIBUTION_POLICIES[policies.distribution];
        const rwdPolicy = REWARD_POLICIES[policies.reward];
        const holPolicy = HOLIDAY_POLICIES[policies.holiday];

        const lines = [
            `【当前村庄政策】`,
            `工时制度：${whPolicy.name}（工作时间 ${effects.workStart}:00-${effects.workEnd}:00）`,
            `分配制度：${distPolicy.name}（${Math.round(effects.storageRate * 100)}%归公）`,
            `奖惩机制：${rwdPolicy.name}`,
            `休假制度：${holPolicy.name}（休息日：${holPolicy.restDays.length > 0 ? '每季第' + holPolicy.restDays.join(',') + '天' : '无'}）`,
            `今天是第${today}天，${restDay ? '🏖️ 今天是休息日' : '📋 今天是工作日'}`,
            '',
        ];

        if (restDay) {
            lines.push('• ⚠️ 今天是休息日！请安排轻松活动（rest/idle/chat/eat），不安排繁重工作');
        } else {
            lines.push(`• 今天工作时间为 ${effects.workStart}:00-${effects.workEnd}:00，工作时段内安排劳动，之后安排轻松活动`);
        }

        return lines.join('\n');
    }

    /** 构建调度 Prompt（含市场早报/昨日晚报上下文 + 市场时间引导 + 政策上下文） */
    buildSchedulePrompt(villager, directiveInfo = { summary: '无', tradePolicy: {} }) {
        // 农田状态
        const pendingTasks = [];
        this.state.plots.forEach(p => {
            if (p.stage === 'empty') pendingTasks.push(`${p.name}空闲可种植`);
            if (p.crop && !p.watered) pendingTasks.push(`${p.name}需要浇水`);
            if (p.stage === 'ready') pendingTasks.push(`${p.name}的${p.cropName}已成熟可收获`);
            if (p.crop && p.stage !== 'ready') pendingTasks.push(`${p.name}种了${p.cropName}(进度${Math.round(p.progress*100)}%，未成熟)`);
        });

        // 市场报告上下文
        const morningReport = this.state.market.morningReport?.broadcast || '暂无早报';
        const eveningReport = this.state.market.eveningReport?.broadcast || '暂无昨日晚报';
        const eveningComment = this.state.market.eveningReport?.playerComment || '';

        // 库存和市场价格（供交易决策参考）
        const marketRef = window.game?.market;
        const inventoryLines = [];
        const invItems = [
            { id: 'radish', name: '萝卜', icon: '🥕' }, { id: 'wheat', name: '小麦', icon: '🌾' },
            { id: 'potato', name: '土豆', icon: '🥔' }, { id: 'flour', name: '面粉', icon: '🫘' },
            { id: 'bread', name: '面包', icon: '🍞' },
        ];
        for (const item of invItems) {
            const qty = this.state.inventory[item.id] || 0;
            if (qty > 0 && marketRef) {
                const price = Math.round(marketRef.getPrice(item.id));
                const basePrice = marketRef.prices?.[item.id]
                    ? Math.round(window.MARKET_ITEMS?.[item.id]?.basePrice || price)
                    : price;
                const diff = price - basePrice;
                const trend = diff > 0 ? `↑高于基准${diff}💰` : diff < 0 ? `↓低于基准${Math.abs(diff)}💰` : '→持平';
                inventoryLines.push(`${item.icon}${item.name}×${qty}（现价${price}💰，${trend}）`);
            }
        }
        const inventoryInfo = inventoryLines.length > 0
            ? inventoryLines.join('，')
            : '无可交易库存';

        // 其他村民的计划（避免重复）
        const otherPlans = this.state.villagers
            .filter(v => v.id !== villager.id && v.schedule)
            .map(v => `${v.avatar||'👤'}${v.name}: ${v.schedule.slice(0,5).map(s => `${s.startHour}:00${ACTION_ICONS[s.action]||''}`).join('→')}`)
            .join('\n');

        // 构建建筑限制提示
        const hasLumber = this.state.buildings.some(b => b.type === 'lumberYard');
        const hasQuarry = this.state.buildings.some(b => b.type === 'quarry');
        const buildingRestrictions = [];
        if (!hasLumber) buildingRestrictions.push('❌ 没有伐木场，禁止安排 chop');
        if (!hasQuarry) buildingRestrictions.push('❌ 没有采石场，禁止安排 mine');

        // 性格影响
        const traitHint = villager.traits.includes('勤劳') ? '你很勤劳，尽量排满工作' :
                         villager.traits.includes('懒惰') ? '你比较懒，多安排休息和闲逛' : '';

        const scheduleStart = this.getScheduleStartHour();
        const workEnd = this.getWorkEndHour();
        const restDay = this.state.isRestDay;
        const policyContext = this.buildPolicyContext();

        // 村会指示上下文（影响行动计划）
        const meetingContext = this.meetingSystem
            ? this.meetingSystem.buildMeetingContext(villager)
            : '';

        const timeInfo = `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天 ${String(this.state.time.hour).padStart(2, '0')}:00`;
        const directiveSummary = directiveInfo.summary || '无';
        const directiveRule = directiveInfo.tradePolicy?.disallowTrade
            ? '• 村长指令：禁止安排交易(trade)'
            : '• 村长近期指令优先级最高，必须严格遵守';

        return `为村民${villager.name}${villager.avatar || '👤'}制定今日计划。

【当前时间】
${timeInfo}（正在为“今天”生成计划）

【村民】${villager.traits.join('、')}，特长${villager.specialty}
体力${villager.stamina}/${villager.maxStamina}，心情${villager.mood}/${MAX_MOOD}
${traitHint}

${policyContext}

${meetingContext}

【市场消息】
今日早报：${morningReport}
昨日晚报：${eveningReport}
${eveningComment ? `分析师说：${eveningComment}` : ''}

【村庄资源】${this.state.seasonName}，${this.getCurrentWeatherInfo()}
金币${this.state.resources.gold}💰，小麦${this.state.inventory.wheat || 0}🌾，木材${this.state.resources.wood}🪵，石料${this.state.resources.stone}🪨
农田：${pendingTasks.join('；') || '无待处理'}
仓库可交易品：${inventoryInfo}

【村长近期指令（含时间，最高优先级）】
${directiveSummary}

${otherPlans ? `【其他人的计划】（避免重复）\n${otherPlans}` : ''}

【可用行动】
${VALID_ACTIONS.map(a => `${a}=${ACTION_NAMES[a]}（${ACTION_DURATIONS[a]}h,${STAMINA_COSTS[a]}体力）`).join('，')}

【硬性规则】
• 作息：${WAKE_HOUR}:00起床，${SLEEP_HOUR}:00睡觉，计划从${scheduleStart}:00开始安排行动（${WAKE_HOUR}:00-${scheduleStart}:00为起床准备时间）
• ⚠️ 必须安排从${scheduleStart}:00到${SLEEP_HOUR - 1}:00的完整计划，包括晚间活动（晚饭后安排idle/rest/chat等）
${restDay ? '• 🏖️ 今天是休息日，只安排休闲活动（rest/idle/chat/eat），不安排劳动' : `• 工作时间 ${scheduleStart}:00-${workEnd}:00，工作结束后安排轻松活动`}
${directiveRule}
• 吃饭：一天3餐（早${scheduleStart}点/午12点/晚18点左右），用eat行动
• 市场：只有${MARKET_OPEN_HOUR}:00-${MARKET_CLOSE_HOUR}:00可以trade，价格实时波动（类似股市）
• 交易策略：你可以低价买入商品囤货，等价格上涨后再卖出赚取差价（但有亏损风险！价格也可能下跌）。参考早报/晚报的价格趋势分析来决策。在note中写明具体买/卖什么商品，如"买木材"、"卖萝卜"
• 收获：harvest只在作物成熟时有效，无成熟作物不要安排
${buildingRestrictions.length > 0 ? `• 建筑限制：${buildingRestrictions.join('；')}` : ''}
• 体力不够时安排rest(+4)或eat(+3)

输出JSON（必须覆盖${scheduleStart}:00-${SLEEP_HOUR - 1}:00的完整时间段）：
{
  "schedule": [
    {"startHour": ${scheduleStart}, "action": "eat", "duration": 1, "target": null, "note": "早饭"},
    {"startHour": ${scheduleStart + 1}, "action": "${restDay ? 'idle' : 'water'}", "duration": 1, "target": null, "note": "${restDay ? '散步' : '浇水'}"},
    {"startHour": 18, "action": "eat", "duration": 1, "target": null, "note": "晚饭"},
    {"startHour": 19, "action": "idle", "duration": 1, "target": null, "note": "散步"},
    {"startHour": 20, "action": "rest", "duration": 2, "target": null, "note": "睡前休息"}
  ],
  "thought": "今天的想法..."
}`;
    }

    /**
     * 提取近期玩家指令（从对话中获取）
     * - 支持“今天/明天/后天”时间指向
     * - 仅纳入与当前计划日期匹配的指令
     */
    getRecentPlayerDirectives(villager) {
        const nowDay = this.state.time.day;
        const recent = Array.isArray(villager.dialogueHistory)
            ? villager.dialogueHistory.slice(-6)
            : [];

        const included = [];
        recent.forEach(d => {
            const msg = (d.player || '').trim();
            if (!msg) return;
            const dayMatch = (d.time || d.dateLabel || '').match(/第(\d+)天/);
            const msgDay = dayMatch ? parseInt(dayMatch[1], 10) : nowDay;
            let targetDay = null;
            if (msg.includes('后天')) targetDay = msgDay + 2;
            else if (msg.includes('明天')) targetDay = msgDay + 1;
            else if (msg.includes('今天')) targetDay = msgDay;

            if (targetDay !== null && targetDay !== nowDay) return;
            if (targetDay === null && msgDay < nowDay - 1) return;
            included.push({ time: d.time || '', text: msg });
        });

        const textAll = included.map(i => i.text).join(' ');
        const tradePolicy = {
            disallowTrade: /不要交易|别交易|暂停交易|不\s*交易|不要去.*市场|别去.*市场/.test(textAll),
            avoidBuy: /不要买|别买|暂停购买|不再购买|先别买|存钱|攒钱|省钱|别花钱|不要花钱/.test(textAll),
            preferSell: /卖出|清仓|卖掉|抛售|尽快卖/.test(textAll),
        };

        const summary = included.length
            ? included.map(i => `- ${i.time ? `${i.time}：` : ''}${i.text}`).join('\n')
            : '无';

        return { summary, tradePolicy };
    }

    /** 验证计划合法性 */
    validateSchedule(schedule, villager, tradePolicy = {}) {
        const validated = [];
        let cumulativeStamina = 0;

        for (const item of schedule) {
            const startHour = item.startHour ?? item.hour;
            if (startHour === undefined) continue;

            if (!VALID_ACTIONS.includes(item.action)) continue;
            if (startHour < this.getScheduleStartHour() || startHour >= SLEEP_HOUR) continue;

            // 市场交易时间检查
            if (item.action === 'trade' && (startHour < MARKET_OPEN_HOUR || startHour >= MARKET_CLOSE_HOUR)) {
                continue; // 跳过非营业时间的交易
            }
            if (item.action === 'trade' && tradePolicy.disallowTrade) {
                continue; // 近期指令禁止交易
            }

            const duration = item.duration || ACTION_DURATIONS[item.action] || 1;
            const cost = STAMINA_COSTS[item.action] || 0;

            if (cumulativeStamina + cost > villager.maxStamina) {
                validated.push({
                    startHour, action: 'rest', target: null,
                    duration: 2, note: '体力不足自动休息',
                });
                continue;
            }
            cumulativeStamina += cost;

            validated.push({
                startHour, action: item.action,
                target: item.target || null, duration,
                note: item.note || '',
            });
        }

        return this.fillScheduleGaps(validated);
    }

    /** 填充缺失时段，确保 8:00-21:00 全覆盖 */
    fillScheduleGaps(schedule) {
        const filled = [...schedule];
        const occupied = new Set();

        schedule.forEach(s => {
            const sh = s.startHour ?? s.hour;
            const dur = s.duration || 1;
            for (let h = sh; h < Math.min(sh + dur, SLEEP_HOUR); h++) {
                occupied.add(h);
            }
        });

        for (let h = this.getScheduleStartHour(); h < SLEEP_HOUR; h++) {
            if (!occupied.has(h)) {
                filled.push({
                    startHour: h,
                    action: 'idle',
                    target: null,
                    duration: 1,
                    note: '自动补齐',
                });
            }
        }

        return filled.sort((a, b) => (a.startHour ?? 0) - (b.startHour ?? 0));
    }

    /** 默认计划（降级方案，政策感知） */
    getDefaultSchedule(villager) {
        const isLazy = villager.traits.includes('懒惰');
        const startH = this.getScheduleStartHour();
        const restDay = this.state.isRestDay;
        const schedule = [
            { startHour: startH, action: 'eat', target: null, duration: 1, note: '早饭' },
        ];

        // 休息日：全天安排轻松活动
        if (restDay) {
            schedule.push(
                { startHour: startH + 1, action: 'idle', target: null, duration: 2, note: '散步' },
                { startHour: 12, action: 'eat', target: null, duration: 1, note: '午饭' },
                { startHour: 13, action: 'rest', target: null, duration: 2, note: '午休' },
                { startHour: 15, action: 'idle', target: null, duration: 1, note: '闲逛' },
                { startHour: 16, action: 'chat', target: null, duration: 2, note: '聊天' },
                { startHour: 18, action: 'eat', target: null, duration: 1, note: '晚饭' },
                { startHour: 19, action: 'idle', target: null, duration: 1, note: '散步' },
                { startHour: 20, action: 'rest', target: null, duration: 2, note: '休息' },
            );
            return schedule;
        }

        if (isLazy) {
            schedule.push(
                { startHour: 9, action: 'idle', target: null, duration: 1, note: '' },
                { startHour: 10, action: 'water', target: null, duration: 1, note: '' },
                { startHour: 11, action: 'rest', target: null, duration: 1, note: '' },
                { startHour: 12, action: 'eat', target: null, duration: 1, note: '午饭' },
                { startHour: 13, action: 'idle', target: null, duration: 2, note: '' },
                { startHour: 15, action: 'water', target: null, duration: 1, note: '' },
                { startHour: 16, action: 'rest', target: null, duration: 2, note: '' },
                { startHour: 18, action: 'eat', target: null, duration: 1, note: '晚饭' },
                { startHour: 19, action: 'idle', target: null, duration: 2, note: '' },
            );
        } else {
            const plots = this.state.plots;
            const hasPlots = plots.length > 0;
            schedule.push(
                { startHour: 9, action: hasPlots ? 'water' : 'chop', target: hasPlots ? plots[0]?.name : null, duration: 1, note: '' },
                { startHour: 10, action: hasPlots ? 'plant' : 'mine', target: null, duration: 2, note: '' },
                { startHour: 12, action: 'eat', target: null, duration: 1, note: '午饭' },
                { startHour: 13, action: 'harvest', target: null, duration: 1, note: '' },
                { startHour: 14, action: 'rest', target: null, duration: 1, note: '' },
                { startHour: 15, action: hasPlots ? 'water' : 'chop', target: null, duration: 1, note: '' },
                { startHour: 16, action: 'chop', target: null, duration: 2, note: '' },
                { startHour: 18, action: 'eat', target: null, duration: 1, note: '晚饭' },
                { startHour: 19, action: 'idle', target: null, duration: 1, note: '' },
                { startHour: 20, action: 'rest', target: null, duration: 2, note: '' },
            );
        }
        return schedule;
    }

    // ===== 计划执行（含现实检查） =====

    /** 驱动村民执行当前小时的行动 */
    executeSchedule(villager, currentHour) {
        // 睡觉时间
        if (currentHour >= SLEEP_HOUR || currentHour < WAKE_HOUR) {
            villager.currentAction = '💤 睡觉';
            villager.currentTask = null;
            return;
        }

        // 起床准备时间（7:00-8:00）
        if (currentHour >= WAKE_HOUR && currentHour < this.getScheduleStartHour()) {
            villager.currentAction = '🌅 起床准备中';
            villager.currentTask = null;
            return;
        }

        // 政策休息日：全天休闲（不安排繁重工作，但允许eat/idle/rest/chat）
        if (this.state.isRestDay && villager.schedule) {
            const task = villager.schedule.find(s =>
                currentHour >= s.startHour && currentHour < s.startHour + (s.duration || 1)
            );
            if (task) {
                const restDayAllowed = ['eat', 'rest', 'idle', 'chat'];
                if (!restDayAllowed.includes(task.action)) {
                    villager.currentAction = '🏖️ 休息日，不干活';
                    villager.currentTask = null;
                    if (!villager._scheduleStatus) villager._scheduleStatus = {};
                    villager._scheduleStatus[`${task.startHour}_${task.action}`] = 'skipped';
                    return;
                }
            }
        }

        // 放假时间：跳过计划执行（事件系统半天假）
        if (villager._holidayUntilHour !== undefined) {
            if (currentHour < villager._holidayUntilHour) {
                villager.currentAction = '🎉 放假中';
                villager.currentTask = null;
                if (!villager._scheduleStatus) villager._scheduleStatus = {};
                if (villager.schedule) {
                    const task = villager.schedule.find(s => s.startHour === currentHour);
                    if (task) {
                        villager._scheduleStatus[`${task.startHour}_${task.action}`] = 'skipped';
                    }
                }
                return;
            }
            // 放假结束
            delete villager._holidayUntilHour;
        }

        if (!villager.schedule) {
            villager.currentAction = '🚶 空闲';
            villager.currentTask = null;
            return;
        }

        // 初始化执行状态追踪
        if (!villager._scheduleStatus) villager._scheduleStatus = {};

        // 体力恢复中断：如果正在强制休息，先恢复
        if (villager._forceResting) {
            villager.stamina = Math.min(villager.maxStamina, villager.stamina + 2);
            if (villager.stamina >= 4) {
                villager._forceResting = false;
                // 恢复后继续当前时间点的计划
            } else {
                villager.currentAction = '💤 休息恢复体力中';
                return;
            }
        }

        // 找到当前时间点的计划
        const task = villager.schedule.find(s =>
            currentHour >= s.startHour && currentHour < s.startHour + (s.duration || 1)
        );

        if (!task) {
            villager.currentAction = '🚶 空闲';
            villager.currentTask = null;
            return;
        }

        const taskKey = `${task.startHour}_${task.action}`;
        const actionName = ACTION_NAMES[task.action] || task.action;
        const actionIcon = ACTION_ICONS[task.action] || '📋';

        // 设置当前显示状态
        villager.currentAction = `${actionIcon} ${actionName}`;
        villager.currentTask = task;

        // 只在行动的第一个小时触发效果
        if (currentHour !== task.startHour) return;
        if (villager._scheduleStatus[taskKey]) return; // 已执行过

        // 如果玩家近期指令禁止交易，则直接跳过
        if (task.action === 'trade' && villager._tradePolicy?.disallowTrade) {
            villager.currentAction = '⚠️ 已遵从指令，取消交易';
            villager._scheduleStatus[taskKey] = 'skipped';
            return;
        }

        // ===== 现实检查 =====
        const checkResult = this.realityCheck(villager, task);
        if (!checkResult.canExecute) {
            villager.currentAction = `⚠️ ${checkResult.reason}`;
            villager._scheduleStatus[taskKey] = 'skipped';
            // 跳过但不中断后续计划
            return;
        }

        // 体力检查
        const success = this.villagerSys.consumeStamina(villager.id, task.action);
        if (!success) {
            // 体力不足 → 进入强制恢复模式
            villager._forceResting = true;
            villager.currentAction = '💤 体力不足，休息中...';
            villager.stamina = Math.min(villager.maxStamina, villager.stamina + 1);
            villager._scheduleStatus[taskKey] = 'deferred';
            return;
        }

        // 执行行动（根据实际结果设置状态）
        const actionSuccess = this.executeAction(villager, task);
        villager._scheduleStatus[taskKey] = actionSuccess ? 'done' : 'failed';
        if (!actionSuccess) {
            villager.currentAction = `❌ ${actionName}失败`;
        }
    }

    /** 现实检查：行动是否实际可执行 */
    realityCheck(villager, task) {
        switch (task.action) {
            case 'harvest': {
                const readyPlot = this.state.plots.find(p => p.stage === 'ready');
                if (!readyPlot) return { canExecute: false, reason: '无成熟作物可收获' };
                break;
            }
            case 'water': {
                const needWater = this.state.plots.find(p => p.crop && !p.watered);
                if (!needWater) return { canExecute: false, reason: '无需浇水的农田' };
                break;
            }
            case 'plant': {
                const emptyPlot = this.state.plots.find(p => p.stage === 'empty');
                const hasSeeds = Object.values(this.state.resources.seeds).some(c => c > 0);
                if (!emptyPlot) return { canExecute: false, reason: '无空闲农田' };
                if (!hasSeeds) return { canExecute: false, reason: '没有种子' };
                break;
            }
            case 'fertilize': {
                const fertPlot = this.state.plots.find(p => p.crop && !p.fertilized && p.stage !== 'ready');
                if (!fertPlot) return { canExecute: false, reason: '无可施肥的农田' };
                break;
            }
            case 'trade': {
                const hour = this.state.time.hour;
                if (hour < MARKET_OPEN_HOUR || hour >= MARKET_CLOSE_HOUR) {
                    return { canExecute: false, reason: `市场未开放(${MARKET_OPEN_HOUR}:00-${MARKET_CLOSE_HOUR}:00)` };
                }
                break;
            }
            case 'eat': {
                if ((this.state.inventory.wheat || 0) < 1) {
                    return { canExecute: false, reason: '小麦不足' };
                }
                break;
            }
            case 'chop': {
                const hasLumber = this.state.buildings.some(b => b.type === 'lumberYard');
                if (!hasLumber) return { canExecute: false, reason: '没有伐木场，无法伐木' };
                break;
            }
            case 'mine': {
                const hasQuarry = this.state.buildings.some(b => b.type === 'quarry');
                if (!hasQuarry) return { canExecute: false, reason: '没有采石场，无法采石' };
                break;
            }
        }
        return { canExecute: true, reason: '' };
    }

    /**
     * 执行具体行动
     * @returns {boolean} 行动是否实际成功执行
     */
    executeAction(villager, task) {
        let success = true;
        const moodCostMap = {
            plant: -1,
            water: -1,
            fertilize: -1,
            harvest: -1,
            pest_control: -1,
            chop: -1,
            mine: -1,
            process: -1,
        };

        switch (task.action) {
            case 'water': {
                const plot = this.state.plots.find(p => p.crop && !p.watered);
                if (plot) {
                    const result = this.farmSys.water(plot.id);
                    success = result?.success !== false;
                } else {
                    console.warn(`[Scheduler] ${villager.name} 浇水失败：未找到需浇水的农田（现实检查后状态变化）`);
                    success = false;
                }
                break;
            }
            case 'harvest': {
                const plot = this.state.plots.find(p => p.stage === 'ready');
                if (plot) {
                    const result = this.farmSys.harvest(plot.id);
                    success = result?.success !== false;
                } else {
                    console.warn(`[Scheduler] ${villager.name} 收获失败：未找到成熟作物`);
                    success = false;
                }
                break;
            }
            case 'plant': {
                const emptyPlot = this.state.plots.find(p => p.stage === 'empty');
                if (emptyPlot) {
                    let planted = false;
                    const seeds = this.state.resources.seeds;
                    for (const [cropId, count] of Object.entries(seeds)) {
                        if (count > 0) {
                            const result = this.farmSys.plant(emptyPlot.id, cropId);
                            if (result.success) { planted = true; break; }
                        }
                    }
                    success = planted;
                } else {
                    success = false;
                }
                break;
            }
            case 'chop': {
                const pEffects = this.state.getPolicyEffects();
                const baseBonus = this.state.buildings.some(b => b.type === 'lumberYard') ? 2 : 1;
                const chopYield = Math.max(1, Math.round(baseBonus * pEffects.productionMult));
                const chopStored = Math.max(1, Math.round(chopYield * pEffects.storageRate));
                this.state.modifyResource('wood', chopStored);
                this.state.addLog('🪓', `${villager.avatar||'👤'}${villager.name}伐木获得${chopStored}🪵${pEffects.storageRate < 1 ? '（部分归个人）' : ''}`, 'info');
                break;
            }
            case 'mine': {
                const pEffects2 = this.state.getPolicyEffects();
                const baseBonus2 = this.state.buildings.some(b => b.type === 'quarry') ? 2 : 1;
                const mineYield = Math.max(1, Math.round(baseBonus2 * pEffects2.productionMult));
                const mineStored = Math.max(1, Math.round(mineYield * pEffects2.storageRate));
                this.state.modifyResource('stone', mineStored);
                this.state.addLog('⛏️', `${villager.avatar||'👤'}${villager.name}采石获得${mineStored}🪨${pEffects2.storageRate < 1 ? '（部分归个人）' : ''}`, 'info');
                break;
            }
            case 'rest': {
                const restMult = this.state.getPolicyEffects().staminaRecoveryMult;
                const restAmount = Math.round(3 * restMult);
                villager.stamina = Math.min(villager.maxStamina, villager.stamina + restAmount);
                villager.mood = Math.min(MAX_MOOD, villager.mood + 1);
                break;
            }
            case 'eat': {
                if ((this.state.inventory.wheat || 0) >= 1) {
                    this.state.inventory.wheat--;
                    const eatMult = this.state.getPolicyEffects().staminaRecoveryMult;
                    const eatAmount = Math.round(2 * eatMult);
                    villager.stamina = Math.min(villager.maxStamina, villager.stamina + eatAmount);
                    villager.mood = Math.min(MAX_MOOD, villager.mood + 1);
                } else {
                    success = false;
                }
                break;
            }
            case 'idle': {
                villager.mood = Math.min(MAX_MOOD, villager.mood + 1);
                break;
            }
            case 'fertilize': {
                const plot = this.state.plots.find(p => p.crop && !p.fertilized && p.stage !== 'ready');
                if (plot) {
                    const result = this.farmSys.fertilize(plot.id);
                    success = result?.success !== false;
                } else {
                    console.warn(`[Scheduler] ${villager.name} 施肥失败：未找到可施肥的农田`);
                    success = false;
                }
                break;
            }
            case 'trade': {
                success = this._executeNPCTrade(villager, task);
                break;
            }
            case 'chat':
            case 'pest_control':
            default:
                break;
        }

        // 劳动消耗心情（仅成功执行时）
        const moodDelta = moodCostMap[task.action] || 0;
        if (success && moodDelta !== 0) {
            villager.mood = Math.max(0, Math.min(MAX_MOOD, villager.mood + moodDelta));
        }

        if (success) {
            this.growSkill(villager, task.action);
        }
        return success;
    }

    /** 技能成长（受分配制度技能成长倍率影响） */
    growSkill(villager, action) {
        const skillMult = this.state.getPolicyEffects().skillGrowthMult;
        const baseGrowth = 0.02 * skillMult;
        if (['plant', 'water', 'fertilize', 'harvest', 'pest_control'].includes(action)) {
            villager.skills.farming = Math.min(10, (villager.skills.farming || 1) + baseGrowth);
        }
        if (['chop', 'mine'].includes(action)) {
            villager.skills.gathering = Math.min(10, (villager.skills.gathering || 1) + baseGrowth);
        }
        if (action === 'process') {
            villager.skills.processing = Math.min(10, (villager.skills.processing || 1) + baseGrowth);
        }
    }

    /**
     * NPC 自动交易逻辑：
     * 1. 优先解析 AI 计划中 note/target 指定的具体商品和买卖方向
     * 2. 若有村长指令（村会/对话），严格执行指令中的交易要求
     * 3. 若无明确指定，NPC 自行决定买卖什么
     */
    _executeNPCTrade(villager, task) {
        const market = window.game?.market;
        if (!market) {
            console.warn(`[Scheduler] ${villager.name} 交易失败：市场引擎不可用`);
            return false;
        }

        const policy = villager._tradePolicy || {};
        if (policy.disallowTrade) return false;

        // === 所有可交易商品（完整列表） ===
        const ALL_TRADABLE = {
            // 农产品
            radish:  { id: 'radish',  name: '萝卜',     icon: '🥕', keywords: ['萝卜'] },
            wheat:   { id: 'wheat',   name: '小麦',     icon: '🌾', keywords: ['小麦'] },
            potato:  { id: 'potato',  name: '土豆',     icon: '🥔', keywords: ['土豆'] },
            pumpkin: { id: 'pumpkin', name: '南瓜',     icon: '🎃', keywords: ['南瓜'] },
            cotton:  { id: 'cotton',  name: '棉花',     icon: '🧵', keywords: ['棉花'] },
            grape:   { id: 'grape',   name: '葡萄',     icon: '🍇', keywords: ['葡萄'] },
            flour:   { id: 'flour',   name: '面粉',     icon: '🫘', keywords: ['面粉'] },
            bread:   { id: 'bread',   name: '面包',     icon: '🍞', keywords: ['面包'] },
            // 建材
            wood:    { id: 'wood',    name: '木材',     icon: '🪵', keywords: ['木材', '木头', '木'] },
            stone:   { id: 'stone',   name: '石料',     icon: '🪨', keywords: ['石料', '石头', '石材', '石'] },
            // 种子
            seed_r:  { id: 'seed_r',  name: '萝卜种子', icon: '🌱', keywords: ['萝卜种子', '萝卜种'] },
            seed_w:  { id: 'seed_w',  name: '小麦种子', icon: '🌱', keywords: ['小麦种子', '小麦种'] },
            seed_p:  { id: 'seed_p',  name: '土豆种子', icon: '🌱', keywords: ['土豆种子', '土豆种'] },
            seed_pk: { id: 'seed_pk', name: '南瓜种子', icon: '🌱', keywords: ['南瓜种子'] },
            seed_c:  { id: 'seed_c',  name: '棉花种子', icon: '🌱', keywords: ['棉花种子'] },
            seed_g:  { id: 'seed_g',  name: '葡萄种子', icon: '🌱', keywords: ['葡萄种子'] },
            // 鱼类
            crucianCarp: { id: 'crucianCarp', name: '鲫鱼',   icon: '🐟', keywords: ['鲫鱼'] },
            grassCarp:   { id: 'grassCarp',   name: '草鱼',   icon: '🐟', keywords: ['草鱼'] },
            commonCarp:  { id: 'commonCarp',  name: '鲤鱼',   icon: '🐠', keywords: ['鲤鱼'] },
            silverCarp:  { id: 'silverCarp',  name: '鲢鱼',   icon: '🐠', keywords: ['鲢鱼'] },
            mandarin:    { id: 'mandarin',    name: '鳜鱼',   icon: '🐡', keywords: ['鳜鱼'] },
            snakehead:   { id: 'snakehead',   name: '黑鱼',   icon: '🐡', keywords: ['黑鱼'] },
            koi:         { id: 'koi',         name: '锦鲤',   icon: '🎏', keywords: ['锦鲤'] },
            goldenDragon:{ id: 'goldenDragon',name: '金龙鱼', icon: '🐉', keywords: ['金龙鱼'] },
        };

        // === 解析 AI 计划中的交易意图 ===
        const hint = (task.note || '') + ' ' + (task.target || '');
        const parsed = this._parseTradeIntent(hint, ALL_TRADABLE);

        // 如果 AI 计划没写具体意图，再看村会指令
        if (!parsed.direction && !parsed.itemId) {
            const directive = this.meetingSystem?.getActiveDirective();
            if (directive) {
                const dirParsed = this._parseTradeIntent(directive.directive + ' ' + directive.topic, ALL_TRADABLE);
                if (dirParsed.direction || dirParsed.itemId) {
                    Object.assign(parsed, dirParsed);
                }
            }
        }

        console.log(`[Scheduler] ${villager.name} 交易意图解析:`, parsed);

        let tradeResult = null;

        // === 有明确指定商品时：严格执行 ===
        if (parsed.itemId) {
            const item = ALL_TRADABLE[parsed.itemId];
            if (item) {
                if (parsed.direction === 'buy' || (!parsed.direction && !policy.avoidBuy)) {
                    tradeResult = this._tryBuy(market, villager, item, parsed.qty);
                }
                if (!tradeResult && (parsed.direction === 'sell' || !parsed.direction)) {
                    tradeResult = this._trySell(market, villager, item, parsed.qty);
                }
            }
        }

        // === 有方向但无具体商品时：NPC 自行选择最合适的 ===
        if (!tradeResult && parsed.direction === 'buy' && !policy.avoidBuy) {
            // 优先买种子（通用"买种子"请求），然后尝试建材
            const seedItems = ['seed_r', 'seed_w', 'seed_p'].map(id => ALL_TRADABLE[id]);
            const materialItems = [ALL_TRADABLE.wood, ALL_TRADABLE.stone];
            const candidates = [...seedItems, ...materialItems];
            for (const item of candidates) {
                tradeResult = this._tryBuy(market, villager, item);
                if (tradeResult) break;
            }
        }

        if (!tradeResult && parsed.direction === 'sell') {
            tradeResult = this._trySellBestItem(market, villager, ALL_TRADABLE);
        }

        // === 完全无指定时：NPC 自主决策 ===
        if (!tradeResult && !parsed.direction && !parsed.itemId) {
            // 先尝试卖库存最多的农产品/鱼类
            if (!policy.avoidBuy) {
                tradeResult = this._trySellBestItem(market, villager, ALL_TRADABLE);
            }
            // 卖不了就尝试买种子
            if (!tradeResult && !policy.avoidBuy) {
                const seedItems = ['seed_r', 'seed_w', 'seed_p'].map(id => ALL_TRADABLE[id]);
                for (const item of seedItems) {
                    tradeResult = this._tryBuy(market, villager, item);
                    if (tradeResult) break;
                }
            }
        }

        // === 记录结果 ===
        if (tradeResult) {
            const { isBuy, item, qty, totalPrice } = tradeResult;
            const action = isBuy ? '买入' : '卖出';
            const priceText = isBuy ? `花费${totalPrice}💰` : `获得${totalPrice}💰`;
            const npcLog = `${villager.avatar || '👤'}${villager.name} ${action}了${qty}个${item.icon}${item.name}（${priceText}）`;
            this.state.addLog('🛒', npcLog, 'info');
            this.bus.emit('showToast', { message: `🛒 ${villager.name} ${action}${qty}个${item.icon}${item.name}`, type: 'info' });
            this.bus.emit('uiUpdate');
            console.log(`[Scheduler] NPC交易: ${npcLog}`);
            return true;
        }

        console.log(`[Scheduler] ${villager.name} 交易失败：无可交易商品或金币不足`);
        return false;
    }

    /**
     * 解析交易意图文本，提取方向（买/卖）和具体商品
     * @returns {{ direction: 'buy'|'sell'|null, itemId: string|null, qty: number|null }}
     */
    _parseTradeIntent(text, tradableMap) {
        if (!text) return { direction: null, itemId: null, qty: null };
        const t = text;

        // 判断买/卖方向
        let direction = null;
        if (/买|购买|buy|采购|进货|补充|多买|去买/.test(t)) direction = 'buy';
        if (/卖|出售|sell|清仓|抛售|卖出|去卖/.test(t)) direction = 'sell';

        // 匹配具体商品（按关键词长度降序匹配，避免"小麦"匹配到"小麦种子"之前）
        let itemId = null;
        const allItems = Object.values(tradableMap);
        // 按 keywords 长度降序排列，优先匹配更长的词
        const sortedItems = allItems.flatMap(item =>
            item.keywords.map(kw => ({ kw, id: item.id }))
        ).sort((a, b) => b.kw.length - a.kw.length);

        for (const { kw, id } of sortedItems) {
            if (t.includes(kw)) {
                itemId = id;
                break;
            }
        }

        // 提取数量（如"买3个木材"、"买点木材"）
        let qty = null;
        const qtyMatch = t.match(/(\d+)\s*(?:个|份|块|根|条|捆)/);
        if (qtyMatch) qty = parseInt(qtyMatch[1], 10);

        return { direction, itemId, qty };
    }

    /** 尝试买入指定商品 */
    _tryBuy(market, villager, item, qty = null) {
        const gold = this.state.resources.gold;
        const price = Math.round(market.getPrice(item.id));
        if (price <= 0 || price > gold) return null;

        const maxBudget = Math.floor(gold * 0.3);
        const buyQty = qty || Math.min(5, Math.max(1, Math.floor(maxBudget / price)));
        if (buyQty <= 0) return null;

        const result = market.executeTrade(item.id, buyQty, true);
        if (result.success) {
            return { isBuy: true, item, qty: result.quantity ?? buyQty, totalPrice: result.totalPrice };
        }
        return null;
    }

    /** 尝试卖出指定商品 */
    _trySell(market, villager, item, qty = null) {
        const inv = market.getInventoryCount(item.id);
        if (inv <= 0) return null;

        const sellQty = qty || Math.min(inv, Math.max(1, Math.ceil(inv * 0.3)));
        const result = market.executeTrade(item.id, sellQty, false);
        if (result.success) {
            return { isBuy: false, item, qty: result.quantity ?? sellQty, totalPrice: result.totalPrice };
        }
        return null;
    }

    /** 自动选择库存最多的非建材商品卖出 */
    _trySellBestItem(market, villager, tradableMap) {
        // 可自动卖出的（不卖建材和种子，避免影响建设和种植）
        const autoSellIds = [
            'radish', 'wheat', 'potato', 'pumpkin', 'cotton', 'grape', 'flour', 'bread',
            'crucianCarp', 'grassCarp', 'commonCarp', 'silverCarp', 'mandarin', 'snakehead', 'koi', 'goldenDragon',
        ];
        const available = autoSellIds
            .map(id => ({ ...tradableMap[id], qty: market.getInventoryCount(id) }))
            .filter(item => item && item.qty > 0)
            .sort((a, b) => b.qty - a.qty);

        for (const item of available) {
            const result = this._trySell(market, { id: item.id }, item);
            if (result) return result;
        }
        return null;
    }

    /** 获取天气信息 */
    getCurrentWeatherInfo() {
        const w = this.state.weather;
        if (w.activeEvent) {
            const evt = window.SPECIAL_WEATHER_EVENTS?.[w.activeEvent];
            return evt ? `${evt.icon} ${evt.name}` : '特殊天气';
        }
        const def = window.SEASON_DEFAULT?.[this.state.season];
        return def ? `${def.icon} ${def.name}` : '正常';
    }

    /** 检测是否接近调度时间 */
    isNearScheduleTime() {
        return this.state.time.hour >= 0 && this.state.time.hour < WAKE_HOUR;
    }

    /** 标记村民的下次系统调度被玩家取消 */
    cancelNextSchedule(villagerId) {
        const villager = this.state.villagers.find(v => v.id === villagerId);
        if (villager) {
            villager._cancelledByPlayer = true;
            console.log(`[Scheduler] ${villager.name} 的下次系统调度已被取消`);
        }
    }
}
