/**
 * VillagerScheduler - 村民调度系统（模式A：自动计划生成）
 * 每隔1天清晨4:00，AI 为每个村民生成次日全天行动计划
 * 每 Tick 驱动村民按计划执行行动
 */
import { VALID_ACTIONS, ACTION_DURATIONS, ACTION_NAMES, ACTION_ICONS, STAMINA_COSTS } from '../config/villagers.js';

export class VillagerScheduler {
    constructor(gameState, eventBus, aiService, villagerSystem, farmSystem) {
        this.state = gameState;
        this.bus = eventBus;
        this.ai = aiService;
        this.villagerSys = villagerSystem;
        this.farmSys = farmSystem;
        this.isScheduling = false;
        this.lastScheduleDay = -2; // B1: 上次调度日（初始值确保第1天可触发）

        // 监听事件
        this.bus.on('tick', (data) => this.onTick(data));
    }

    /** 每 Tick 处理 */
    onTick(data) {
        // B1: 每隔1天清晨4:00触发调度（而非每天）
        if (data.hour === 4) {
            const today = this.state.totalDays;
            if (today - this.lastScheduleDay >= 2) {
                this.generateSchedules();
                this.lastScheduleDay = today;
            }
        }

        // 2. 驱动村民执行当前计划
        this.state.villagers.forEach(v => this.executeSchedule(v, data.hour));
    }

    /** 为所有村民生成调度计划（串行，避免并发） */
    async generateSchedules() {
        if (this.isScheduling) return;
        this.isScheduling = true;

        console.log('[Scheduler] 开始生成村民调度计划...');

        for (const villager of this.state.villagers) {
            // B4: 如果玩家已通过对话取消了该村民的系统调度，跳过
            if (villager._cancelledByPlayer) {
                villager._cancelledByPlayer = false;
                console.log(`[Scheduler] ${villager.name} 的调度已被玩家对话覆盖，跳过`);
                continue;
            }

            try {
                const schedule = await this.generateScheduleForVillager(villager);
                villager.schedule = schedule;
                console.log(`[Scheduler] ${villager.name} 计划生成完成:`, schedule.length, '个行动');
            } catch (e) {
                console.warn(`[Scheduler] ${villager.name} 计划生成失败，使用默认`, e.message);
                villager.schedule = this.getDefaultSchedule(villager);
            }
        }

        this.isScheduling = false;
        this.state.addLog('📋', '村民行动计划已安排', 'info');
        this.bus.emit('schedulesGenerated', {});
        this.bus.emit('autoPause', { reason: '[调度] 村民行动计划已安排完毕' });
    }

    /**
     * 为单个村民生成调度计划
     * @param {object} villager
     * @returns {Array} [{ startHour, action, target?, duration, note? }]
     */
    async generateScheduleForVillager(villager) {
        const prompt = this.buildSchedulePrompt(villager);

        // AI LOGIC - 调用 AI 生成计划
        const result = await this.ai.chat(prompt, { temperature: 0.7, maxTokens: 600 });

        if (result && result.schedule && Array.isArray(result.schedule)) {
            const validated = this.validateSchedule(result.schedule, villager);
            if (validated.length > 0) return validated;
        }

        // 降级
        return this.getDefaultSchedule(villager);
    }

    /** 构建调度 Prompt（B3: 使用策划文档格式） */
    buildSchedulePrompt(villager) {
        const pendingTasks = [];
        this.state.plots.forEach(p => {
            if (p.stage === 'empty') pendingTasks.push(`${p.name}需要种植`);
            if (p.crop && !p.watered) pendingTasks.push(`${p.name}需要浇水`);
            if (p.stage === 'ready') pendingTasks.push(`${p.name}的${p.cropName}可收获`);
        });

        return `# 任务：为村民制定今日行动计划
## 村民信息
- 姓名：${villager.name}
- 性格：${villager.traits.join('、')}
- 特长：${villager.specialty}
- 当前体力：${villager.stamina}/${villager.maxStamina}
- 心情：${villager.mood}/100
- 准确率：${Math.round(villager.accuracy * 100)}%
- 工作速度：${Math.round(villager.workSpeed * 100)}%

## 村庄状态
- 季节：${this.state.seasonName}
- 天气：${this.getCurrentWeatherInfo()}
- 粮食库存：${this.state.resources.food}
- 农田待处理：${pendingTasks.join('；') || '无'}

## 合法行动列表
${VALID_ACTIONS.map(a => `- ${a}: ${ACTION_NAMES[a]}（${ACTION_DURATIONS[a]}小时，消耗${STAMINA_COSTS[a]}体力）`).join('\n')}

## 规则
1. 工作时间 6:00-22:00
2. 每个行动持续固定时长，startHour + duration 不得超过下个行动的 startHour
3. 体力不够时安排 rest 或 eat
4. 低心情时安排 idle 或 chat
5. 行动必须在合法行动列表中
6. ${villager.traits.includes('勤劳') ? '勤劳村民排满工作' : ''}
7. ${villager.traits.includes('懒惰') ? '懒惰村民多安排闲逛/休息' : ''}

# 输出格式（严格JSON）
\`\`\`json
{
  "schedule": [
    { "startHour": 6, "action": "eat", "duration": 1, "target": null, "note": "先吃早饭" },
    { "startHour": 7, "action": "water", "duration": 1, "target": "农田A", "note": "给A田浇水" }
  ],
  "staminaEstimate": 25,
  "thought": "今天活挺多的..."
}
\`\`\``;
    }

    /** 验证计划合法性 */
    validateSchedule(schedule, villager) {
        const validated = [];
        let cumulativeStamina = 0;

        for (const item of schedule) {
            // 兼容 startHour 和 hour 两种格式
            const startHour = item.startHour ?? item.hour;
            if (startHour === undefined) continue;

            // 行动白名单检查
            if (!VALID_ACTIONS.includes(item.action)) continue;

            // 时间范围检查
            if (startHour < 4 || startHour > 23) continue;

            // 行动持续时长
            const duration = item.duration || ACTION_DURATIONS[item.action] || 1;

            // 体力预估
            const cost = STAMINA_COSTS[item.action] || 0;
            if (cumulativeStamina + cost > villager.maxStamina) {
                validated.push({
                    startHour,
                    action: 'rest',
                    target: null,
                    duration: 2,
                    note: '体力不足，自动休息',
                });
                continue;
            }
            cumulativeStamina += cost;

            validated.push({
                startHour,
                action: item.action,
                target: item.target || null,
                duration,
                note: item.note || '',
            });
        }

        return validated;
    }

    /** 默认计划（降级方案） */
    getDefaultSchedule(villager) {
        const isLazy = villager.traits.includes('懒惰');
        const schedule = [
            { startHour: 6, action: 'eat', target: null, duration: 1, note: '早饭' },
        ];

        if (isLazy) {
            schedule.push(
                { startHour: 7, action: 'idle', target: null, duration: 1, note: '' },
                { startHour: 8, action: 'water', target: null, duration: 1, note: '' },
                { startHour: 9, action: 'idle', target: null, duration: 1, note: '' },
                { startHour: 10, action: 'rest', target: null, duration: 2, note: '' },
                { startHour: 12, action: 'eat', target: null, duration: 1, note: '午饭' },
                { startHour: 13, action: 'idle', target: null, duration: 1, note: '' },
                { startHour: 14, action: 'water', target: null, duration: 1, note: '' },
                { startHour: 15, action: 'rest', target: null, duration: 2, note: '' },
                { startHour: 17, action: 'idle', target: null, duration: 1, note: '' },
                { startHour: 18, action: 'eat', target: null, duration: 1, note: '晚饭' },
                { startHour: 19, action: 'rest', target: null, duration: 2, note: '' },
            );
        } else {
            const plots = this.state.plots;
            const hasPlots = plots.length > 0;

            schedule.push(
                { startHour: 7, action: hasPlots ? 'water' : 'chop', target: hasPlots ? plots[0]?.name : null, duration: 1, note: '' },
                { startHour: 8, action: hasPlots ? 'plant' : 'mine', target: null, duration: 2, note: '' },
                { startHour: 10, action: 'harvest', target: null, duration: 2, note: '' },
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

    /** B2: 驱动村民执行当前小时的行动（使用持续时间范围匹配） */
    executeSchedule(villager, currentHour) {
        if (!villager.schedule) return;

        // 找到当前正在进行的行动（startHour <= currentHour < startHour + duration）
        const task = villager.schedule.find(s =>
            currentHour >= s.startHour && currentHour < s.startHour + (s.duration || 1)
        );

        if (!task) {
            // 没有安排 → 空闲
            if (currentHour >= 6 && currentHour <= 22) {
                villager.currentAction = '🚶 空闲';
                villager.currentTask = null;
            }
            return;
        }

        const actionName = ACTION_NAMES[task.action] || task.action;
        const actionIcon = ACTION_ICONS[task.action] || '📋';
        villager.currentAction = `${actionIcon} ${actionName}`;
        villager.currentTask = task;

        // B2: 只在行动的第一个小时触发效果（消耗体力+执行行动）
        const isFirstHour = currentHour === task.startHour;
        if (!isFirstHour) return;

        // 消耗体力
        const success = this.villagerSys.consumeStamina(villager.id, task.action);

        if (!success) {
            villager.currentAction = '💤 强制休息（体力不足）';
            villager.stamina = Math.min(villager.maxStamina, villager.stamina + 5);
            return;
        }

        // 执行行动效果
        this.executeAction(villager, task);
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
                this.state.addLog('🪓', `${villager.name}伐木获得${bonus}🪵`, 'info');
                break;
            }
            case 'mine': {
                const bonus = this.state.buildings.some(b => b.type === 'quarry') ? 2 : 1;
                this.state.modifyResource('stone', bonus);
                this.state.addLog('⛏️', `${villager.name}采石获得${bonus}🪨`, 'info');
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

        // 技能成长
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

    /**
     * B4: 检测是否接近调度时间（0:00-4:00）
     * 用于 VillagerAI 调用，决定对话是否应包含"规划明天"信息
     */
    isNearScheduleTime() {
        return this.state.time.hour >= 0 && this.state.time.hour < 4;
    }

    /**
     * B4: 标记某村民的下次系统调度被玩家对话取消
     * @param {string} villagerId
     */
    cancelNextSchedule(villagerId) {
        const villager = this.state.villagers.find(v => v.id === villagerId);
        if (villager) {
            villager._cancelledByPlayer = true;
            console.log(`[Scheduler] ${villager.name} 的下次系统调度已被取消`);
        }
    }
}
