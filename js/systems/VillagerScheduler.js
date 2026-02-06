/**
 * VillagerScheduler - 村民调度系统
 * 每日 7:00 AI 为每个村民并行生成当日行动计划（在市场早报6:00之后）
 * 每 Tick 驱动村民按计划执行行动（含现实检查）
 * 村民 7:00 起床，22:00 睡觉
 */
import { VALID_ACTIONS, ACTION_DURATIONS, ACTION_NAMES, ACTION_ICONS, STAMINA_COSTS } from '../config/villagers.js';
import { MARKET_OPEN_HOUR, MARKET_CLOSE_HOUR } from '../market/MarketEngine.js';

const WAKE_HOUR = 7;
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
        // 每日 7:00 触发调度（在市场早报6:00之后）
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
                villager.schedule = schedule;
                villager._scheduleStatus = {}; // 重置执行状态追踪
                console.log(`[Scheduler] ${villager.name} 计划完成: ${schedule.length} 个行动`);
            } catch (e) {
                console.warn(`[Scheduler] ${villager.name} 计划失败，使用默认`, e.message);
                villager.schedule = this.getDefaultSchedule(villager);
                villager._scheduleStatus = {};
            }
        });

        await Promise.all(promises);

        const elapsed = Date.now() - startTime;
        console.log(`[Scheduler] 全部计划生成完毕，耗时 ${elapsed}ms`);

        this.isScheduling = false;
        this.state.addLog('📋', '所有村民今日行动计划已生成', 'info');
        this.bus.emit('schedulesGenerated', {});
    }

    /** 为单个村民生成调度计划（关键调用：失败暂停+重试） */
    async generateScheduleForVillager(villager) {
        const prompt = this.buildSchedulePrompt(villager);
        const result = await this.ai.criticalChat(prompt, { temperature: 0.7, maxTokens: 600 }, {
            label: `📋 ${villager.name}的行动计划`,
        });

        if (result && result.schedule && Array.isArray(result.schedule)) {
            const validated = this.validateSchedule(result.schedule, villager);
            if (validated.length > 0) return validated;
        }

        return this.getDefaultSchedule(villager);
    }

    /** 构建调度 Prompt（含市场早报/昨日晚报上下文 + 市场时间引导） */
    buildSchedulePrompt(villager) {
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

        return `为村民${villager.name}${villager.avatar || '👤'}制定今日计划。

【村民】${villager.traits.join('、')}，特长${villager.specialty}
体力${villager.stamina}/${villager.maxStamina}，心情${villager.mood}/100
${traitHint}

【市场消息】
今日早报：${morningReport}
昨日晚报：${eveningReport}
${eveningComment ? `分析师说：${eveningComment}` : ''}

【村庄资源】${this.state.seasonName}，${this.getCurrentWeatherInfo()}
金币${this.state.resources.gold}💰，粮食${this.state.resources.food}🌾，木材${this.state.resources.wood}🪵，石料${this.state.resources.stone}🪨
农田：${pendingTasks.join('；') || '无待处理'}

${otherPlans ? `【其他人的计划】（避免重复）\n${otherPlans}` : ''}

【可用行动】
${VALID_ACTIONS.map(a => `${a}=${ACTION_NAMES[a]}（${ACTION_DURATIONS[a]}h,${STAMINA_COSTS[a]}体力）`).join('，')}

【硬性规则】
• 作息：${WAKE_HOUR}:00起床，${SLEEP_HOUR}:00睡觉，计划安排在${WAKE_HOUR}-${SLEEP_HOUR - 1}点
• 吃饭：一天3餐（早7点/午12点/晚18点左右），用eat行动
• 市场：只有${MARKET_OPEN_HOUR}:00-${MARKET_CLOSE_HOUR}:00可以trade，价格实时变，选时机要慎重
• 收获：harvest只在作物成熟时有效，无成熟作物不要安排
${buildingRestrictions.length > 0 ? `• 建筑限制：${buildingRestrictions.join('；')}` : ''}
• 体力不够时安排rest(+15)或eat(+10)

输出JSON：
{
  "schedule": [
    {"startHour": 7, "action": "eat", "duration": 1, "target": null, "note": "早饭"},
    {"startHour": 8, "action": "water", "duration": 1, "target": null, "note": "浇水"}
  ],
  "thought": "今天的想法..."
}`;
    }

    /** 验证计划合法性 */
    validateSchedule(schedule, villager) {
        const validated = [];
        let cumulativeStamina = 0;

        for (const item of schedule) {
            const startHour = item.startHour ?? item.hour;
            if (startHour === undefined) continue;

            if (!VALID_ACTIONS.includes(item.action)) continue;
            if (startHour < WAKE_HOUR || startHour >= SLEEP_HOUR) continue;

            // 市场交易时间检查
            if (item.action === 'trade' && (startHour < MARKET_OPEN_HOUR || startHour >= MARKET_CLOSE_HOUR)) {
                continue; // 跳过非营业时间的交易
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

        return validated;
    }

    /** 默认计划（降级方案） */
    getDefaultSchedule(villager) {
        const isLazy = villager.traits.includes('懒惰');
        const schedule = [
            { startHour: 7, action: 'eat', target: null, duration: 1, note: '早饭' },
        ];

        if (isLazy) {
            schedule.push(
                { startHour: 8, action: 'idle', target: null, duration: 1, note: '' },
                { startHour: 9, action: 'water', target: null, duration: 1, note: '' },
                { startHour: 10, action: 'rest', target: null, duration: 2, note: '' },
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
                { startHour: 8, action: hasPlots ? 'water' : 'chop', target: hasPlots ? plots[0]?.name : null, duration: 1, note: '' },
                { startHour: 9, action: hasPlots ? 'plant' : 'mine', target: null, duration: 2, note: '' },
                { startHour: 11, action: 'harvest', target: null, duration: 1, note: '' },
                { startHour: 12, action: 'eat', target: null, duration: 1, note: '午饭' },
                { startHour: 13, action: 'rest', target: null, duration: 2, note: '' },
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

        if (!villager.schedule) {
            villager.currentAction = '🚶 空闲';
            villager.currentTask = null;
            return;
        }

        // 初始化执行状态追踪
        if (!villager._scheduleStatus) villager._scheduleStatus = {};

        // 体力恢复中断：如果正在强制休息，先恢复
        if (villager._forceResting) {
            villager.stamina = Math.min(villager.maxStamina, villager.stamina + 10);
            if (villager.stamina >= 20) {
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
            villager.stamina = Math.min(villager.maxStamina, villager.stamina + 5);
            villager._scheduleStatus[taskKey] = 'deferred';
            return;
        }

        // 执行行动
        this.executeAction(villager, task);
        villager._scheduleStatus[taskKey] = 'done';
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
                    return { canExecute: false, reason: '市场未开放(9:00-15:00)' };
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

    /** 执行具体行动 */
    executeAction(villager, task) {
        switch (task.action) {
            case 'water': {
                const plot = this.state.plots.find(p => p.crop && !p.watered);
                if (plot) this.farmSys.water(plot.id);
                break;
            }
            case 'harvest': {
                const plot = this.state.plots.find(p => p.stage === 'ready');
                if (plot) this.farmSys.harvest(plot.id);
                break;
            }
            case 'plant': {
                const emptyPlot = this.state.plots.find(p => p.stage === 'empty');
                if (emptyPlot) {
                    const seeds = this.state.resources.seeds;
                    for (const [cropId, count] of Object.entries(seeds)) {
                        if (count > 0) {
                            const result = this.farmSys.plant(emptyPlot.id, cropId);
                            if (result.success) break;
                        }
                    }
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
                villager.stamina = Math.min(villager.maxStamina, villager.stamina + 15);
                villager.mood = Math.min(100, villager.mood + 3);
                break;
            }
            case 'eat': {
                if (this.state.resources.food >= 1) {
                    this.state.modifyResource('food', -1);
                    villager.stamina = Math.min(villager.maxStamina, villager.stamina + 10);
                    villager.mood = Math.min(100, villager.mood + 2);
                }
                break;
            }
            case 'idle': {
                villager.mood = Math.min(100, villager.mood + 1);
                break;
            }
            case 'fertilize': {
                const plot = this.state.plots.find(p => p.crop && !p.fertilized && p.stage !== 'ready');
                if (plot) this.farmSys.fertilize(plot.id);
                break;
            }
            case 'trade':
            case 'chat':
            case 'pest_control':
            default:
                break;
        }

        this.growSkill(villager, task.action);
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
