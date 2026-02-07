/**
 * VillagerScheduler - 村民调度系统
 * 每日 7:00 AI 为每个村民并行生成当日行动计划（在市场早报5:00之后）
 * 每 Tick 驱动村民按计划执行行动（含现实检查）
 * 村民 7:00 起床，8:00 开始执行计划，22:00 睡觉
 */
import { VALID_ACTIONS, ACTION_DURATIONS, ACTION_NAMES, ACTION_ICONS, STAMINA_COSTS, MAX_MOOD } from '../config/villagers.js';
import { MARKET_OPEN_HOUR, MARKET_CLOSE_HOUR } from '../market/MarketEngine.js';

const WAKE_HOUR = 7;            // 起床 & 计划生成触发时间
const SCHEDULE_START_HOUR = 8;  // 计划执行起始时间（8:00开始安排行动）
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

        // 监听事件
        this.bus.on('tick', (data) => this.onTick(data));
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

    /** 构建调度 Prompt（含市场早报/昨日晚报上下文 + 市场时间引导） */
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

【市场消息】
今日早报：${morningReport}
昨日晚报：${eveningReport}
${eveningComment ? `分析师说：${eveningComment}` : ''}

【村庄资源】${this.state.seasonName}，${this.getCurrentWeatherInfo()}
金币${this.state.resources.gold}💰，粮食${this.state.resources.food}🌾，木材${this.state.resources.wood}🪵，石料${this.state.resources.stone}🪨
农田：${pendingTasks.join('；') || '无待处理'}

【村长近期指令（含时间，最高优先级）】
${directiveSummary}

${otherPlans ? `【其他人的计划】（避免重复）\n${otherPlans}` : ''}

【可用行动】
${VALID_ACTIONS.map(a => `${a}=${ACTION_NAMES[a]}（${ACTION_DURATIONS[a]}h,${STAMINA_COSTS[a]}体力）`).join('，')}

【硬性规则】
• 作息：${WAKE_HOUR}:00起床，${SLEEP_HOUR}:00睡觉，计划从${SCHEDULE_START_HOUR}:00开始安排行动（${WAKE_HOUR}:00-${SCHEDULE_START_HOUR}:00为起床准备时间）
• ⚠️ 必须安排从${SCHEDULE_START_HOUR}:00到${SLEEP_HOUR - 1}:00的完整计划，包括晚间活动（晚饭后安排idle/rest/chat等）
${directiveRule}
• 吃饭：一天3餐（早8点/午12点/晚18点左右），用eat行动
• 市场：只有${MARKET_OPEN_HOUR}:00-${MARKET_CLOSE_HOUR}:00可以trade，价格实时变，选时机要慎重
• 收获：harvest只在作物成熟时有效，无成熟作物不要安排
${buildingRestrictions.length > 0 ? `• 建筑限制：${buildingRestrictions.join('；')}` : ''}
• 体力不够时安排rest(+4)或eat(+3)

输出JSON（必须覆盖8:00-21:00的完整时间段）：
{
  "schedule": [
    {"startHour": 8, "action": "eat", "duration": 1, "target": null, "note": "早饭"},
    {"startHour": 9, "action": "water", "duration": 1, "target": null, "note": "浇水"},
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
            if (startHour < SCHEDULE_START_HOUR || startHour >= SLEEP_HOUR) continue;

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

        for (let h = SCHEDULE_START_HOUR; h < SLEEP_HOUR; h++) {
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

    /** 默认计划（降级方案） */
    getDefaultSchedule(villager) {
        const isLazy = villager.traits.includes('懒惰');
        const schedule = [
            { startHour: 8, action: 'eat', target: null, duration: 1, note: '早饭' },
        ];

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
        if (currentHour >= WAKE_HOUR && currentHour < SCHEDULE_START_HOUR) {
            villager.currentAction = '🌅 起床准备中';
            villager.currentTask = null;
            return;
        }

        // 放假时间：跳过计划执行
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
            if (villager.stamina >= 6) {
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
            villager.stamina = Math.min(villager.maxStamina, villager.stamina + 2);
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
                if (this.state.resources.food < 1) {
                    return { canExecute: false, reason: '粮食不足' };
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
                const bonus = this.state.buildings.some(b => b.type === 'lumberYard') ? 2 : 1;
                this.state.modifyResource('wood', bonus);
                this.state.addLog('🪓', `${villager.avatar||'👤'}${villager.name}伐木获得${bonus}🪵`, 'info');
                break;
            }
            case 'mine': {
                const bonus = this.state.buildings.some(b => b.type === 'quarry') ? 2 : 1;
                this.state.modifyResource('stone', bonus);
                this.state.addLog('⛏️', `${villager.avatar||'👤'}${villager.name}采石获得${bonus}🪨`, 'info');
                break;
            }
            case 'rest': {
                villager.stamina = Math.min(villager.maxStamina, villager.stamina + 4);
                villager.mood = Math.min(MAX_MOOD, villager.mood + 1);
                break;
            }
            case 'eat': {
                if (this.state.resources.food >= 1) {
                    this.state.modifyResource('food', -1);
                    villager.stamina = Math.min(villager.maxStamina, villager.stamina + 3);
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

    /** 技能成长 */
    growSkill(villager, action) {
        if (['plant', 'water', 'fertilize', 'harvest', 'pest_control'].includes(action)) {
            villager.skills.farming = Math.min(10, (villager.skills.farming || 1) + 0.02);
        }
        if (['chop', 'mine'].includes(action)) {
            villager.skills.gathering = Math.min(10, (villager.skills.gathering || 1) + 0.02);
        }
        if (action === 'process') {
            villager.skills.processing = Math.min(10, (villager.skills.processing || 1) + 0.02);
        }
    }

    /**
     * NPC 自动交易逻辑：
     * 根据库存和资源情况，智能决定买/卖什么，并在近期事件中记录详情
     */
    _executeNPCTrade(villager, task) {
        const market = window.game?.market;
        if (!market) {
            console.warn(`[Scheduler] ${villager.name} 交易失败：市场引擎不可用`);
            return false;
        }

        // 解析 task.note / task.target 中的交易意图（AI 可能指定如 "卖萝卜" "买种子"）
        const hint = ((task.note || '') + ' ' + (task.target || '')).toLowerCase();
        const policy = villager._tradePolicy || {};
        const wantBuy = (hint.includes('买') || hint.includes('buy') || hint.includes('种子') || hint.includes('seed')) && !policy.avoidBuy;
        const wantSell = hint.includes('卖') || hint.includes('sell') || policy.preferSell;
        if (policy.disallowTrade) return false;

        // 可卖出的商品（农产品/加工品，不卖建材避免影响建设）
        const sellableItems = [
            { id: 'radish',  name: '萝卜', icon: '🥕' },
            { id: 'wheat',   name: '小麦', icon: '🌾' },
            { id: 'potato',  name: '土豆', icon: '🥔' },
            { id: 'pumpkin', name: '南瓜', icon: '🎃' },
            { id: 'cotton',  name: '棉花', icon: '🧵' },
            { id: 'grape',   name: '葡萄', icon: '🍇' },
            { id: 'flour',   name: '面粉', icon: '🫘' },
            { id: 'bread',   name: '面包', icon: '🍞' },
        ];

        // 可买入的种子
        const buyableSeeds = [
            { id: 'seed_r',  name: '萝卜种子', icon: '🌱' },
            { id: 'seed_w',  name: '小麦种子', icon: '🌱' },
            { id: 'seed_p',  name: '土豆种子', icon: '🌱' },
        ];

        let tradeResult = null;

        // ─── 卖出逻辑 ───
        if (!tradeResult && (wantSell || !wantBuy)) {
            const available = sellableItems
                .map(item => ({
                    ...item,
                    qty: this.state.inventory[item.id] || 0,
                }))
                .filter(item => item.qty > 0)
                .sort((a, b) => b.qty - a.qty);

            if (available.length > 0) {
                const chosen = available[0];
                const sellQty = Math.min(chosen.qty, Math.max(1, Math.ceil(chosen.qty * 0.3)));
                const result = market.executeTrade(chosen.id, sellQty, false);
                if (result.success) {
                    const actualQty = result.quantity ?? sellQty;
                    tradeResult = { isBuy: false, item: chosen, qty: actualQty, totalPrice: result.totalPrice };
                }
            }
        }

        // ─── 买入逻辑（没卖成或明确想买时） ───
        if (!tradeResult && (wantBuy || !wantSell)) {
            const gold = this.state.resources.gold;
            if (gold >= 10) {
                const affordable = buyableSeeds
                    .map(s => ({ ...s, price: Math.round(market.getPrice(s.id)) }))
                    .filter(s => s.price > 0 && s.price <= gold)
                    .sort((a, b) => a.price - b.price);

                if (affordable.length > 0) {
                    const chosen = affordable[0];
                    const maxBudget = Math.floor(gold * 0.3);
                    const buyQty = Math.min(3, Math.max(1, Math.floor(maxBudget / chosen.price)));
                    if (buyQty > 0) {
                        const result = market.executeTrade(chosen.id, buyQty, true);
                        if (result.success) {
                            const actualQty = result.quantity ?? buyQty;
                            tradeResult = { isBuy: true, item: chosen, qty: actualQty, totalPrice: result.totalPrice };
                        }
                    }
                }
            }
        }

        if (tradeResult) {
            const { isBuy, item, qty, totalPrice } = tradeResult;
            const action = isBuy ? '买入' : '卖出';
            const priceText = isBuy ? `花费${totalPrice}💰` : `获得${totalPrice}💰`;
            // 带村民名字的详细交易日志（executeTrade 内已记录通用日志，此处补充NPC归属）
            const npcLog = `${villager.avatar || '👤'}${villager.name} ${action}了${qty}个${item.icon}${item.name}（${priceText}）`;
            this.state.addLog('🛒', npcLog, 'info');
            this.bus.emit('showToast', { message: `🛒 ${villager.name} ${action}${qty}个${item.icon}${item.name}`, type: 'info' });
            console.log(`[Scheduler] NPC交易: ${npcLog}`);
            return true;
        }

        console.log(`[Scheduler] ${villager.name} 交易失败：无可交易商品或金币不足`);
        return false;
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
