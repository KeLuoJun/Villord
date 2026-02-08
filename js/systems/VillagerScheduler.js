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

    /** 为所有村民顺序生成调度计划（确保后续村民能看到前面村民的计划，避免任务冲突） */
    async generateSchedules() {
        if (this.isScheduling) return;
        this.isScheduling = true;

        console.log('[Scheduler] 开始顺序生成村民调度计划...');
        const startTime = Date.now();

        // 顺序调用 AI（每个村民生成后立即应用，后续村民可见前面的计划）
        for (const villager of this.state.villagers) {
            if (villager._cancelledByPlayer) {
                villager._cancelledByPlayer = false;
                console.log(`[Scheduler] ${villager.name} 的调度已被玩家覆盖，跳过`);
                continue;
            }

            try {
                const schedule = await this.generateScheduleForVillager(villager);
                this._applySchedule(villager, schedule);
                console.log(`[Scheduler] ${villager.name} 计划完成: ${schedule.length} 个行动`);
            } catch (e) {
                console.warn(`[Scheduler] ${villager.name} 计划失败，使用默认`, e.message);
                this._applySchedule(villager, this.getDefaultSchedule(villager));
            }
        }

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

    /**
     * 构建调度 Prompt
     * 含农田精确容量约束、其他村民已分配任务统计、市场/政策上下文
     */
    buildSchedulePrompt(villager, directiveInfo = { summary: '无', tradePolicy: {} }) {
        // ===== 1. 农田精确状态 =====
        const plots = this.state.plots;
        const totalPlots = plots.length;
        const emptyPlots = plots.filter(p => p.stage === 'empty');
        const needWaterPlots = plots.filter(p => p.crop && !p.watered);
        const needFertPlots = plots.filter(p => p.crop && !p.fertilized && p.stage !== 'ready');
        const readyPlots = plots.filter(p => p.stage === 'ready');

        const plotDetails = [];
        plots.forEach(p => {
            if (p.stage === 'empty') {
                plotDetails.push(`${p.name}：空闲可种植`);
            } else if (p.stage === 'ready') {
                plotDetails.push(`${p.name}：${p.cropName}已成熟可收获`);
            } else if (p.crop) {
                const waterStatus = p.watered ? '已浇水✅' : '需要浇水❌';
                const fertStatus = p.fertilized ? '已施肥✅' : '未施肥（施肥可+30%产量）';
                plotDetails.push(`${p.name}：种了${p.cropName}(${Math.round(p.progress*100)}%)，${waterStatus}，${fertStatus}`);
            }
        });

        // ===== 2. 其他村民已分配的农活统计（精确计算剩余配额） =====
        const otherVillagers = this.state.villagers.filter(v => v.id !== villager.id);
        let otherPlantCount = 0, otherWaterCount = 0, otherHarvestCount = 0, otherFertCount = 0;
        const otherTaskSummaries = [];

        otherVillagers.forEach(v => {
            if (!v.schedule) return;
            const taskCounts = {};
            v.schedule.forEach(s => {
                const a = s.action;
                taskCounts[a] = (taskCounts[a] || 0) + 1;
                if (a === 'plant') otherPlantCount++;
                if (a === 'water') otherWaterCount++;
                if (a === 'harvest') otherHarvestCount++;
                if (a === 'fertilize') otherFertCount++;
            });
            const taskDesc = Object.entries(taskCounts)
                .filter(([, c]) => c > 0)
                .map(([a, c]) => `${ACTION_ICONS[a] || ''}${ACTION_NAMES[a] || a}×${c}`)
                .join('、');
            otherTaskSummaries.push(`${v.avatar||'👤'}${v.name}：${taskDesc || '暂无计划'}`);
        });

        // 计算你的可用配额
        const remainPlant = Math.max(0, emptyPlots.length - otherPlantCount);
        const remainWater = Math.max(0, needWaterPlots.length - otherWaterCount);
        const remainFert = Math.max(0, needFertPlots.length - otherFertCount);
        const remainHarvest = Math.max(0, readyPlots.length - otherHarvestCount);

        // ===== 3. 种子和小麦 =====
        const seeds = this.state.resources.seeds;
        const seedMap = { radish: '萝卜', wheat: '小麦', potato: '土豆', pumpkin: '南瓜', cotton: '棉花', grape: '葡萄' };
        const seedLines = [];
        for (const [cropId, count] of Object.entries(seeds)) {
            if (count > 0) seedLines.push(`${seedMap[cropId] || cropId}种子×${count}`);
        }
        const seedInfo = seedLines.length > 0
            ? `可用种子：${seedLines.join('、')}`
            : '⚠️ 没有任何种子！需要先去市场购买';
        const wheatStock = this.state.inventory.wheat || 0;
        const wheatUrgency = wheatStock <= 5
            ? `⚠️ 小麦仅剩${wheatStock}🌾，是村民每日消耗的粮食，优先种植小麦！如果没有小麦种子，先安排trade去买小麦种子`
            : wheatStock <= 15
            ? `小麦库存${wheatStock}🌾偏低，建议优先种植小麦保障粮食供应`
            : '';

        // ===== 4. 市场报告和库存 =====
        const morningReport = this.state.market.morningReport?.broadcast || '暂无早报';
        const eveningReport = this.state.market.eveningReport?.broadcast || '暂无昨日晚报';
        const eveningComment = this.state.market.eveningReport?.playerComment || '';

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

        // ===== 5. 建筑状态与可用行动 =====
        const hasLumber = this.state.buildings.some(b => b.type === 'lumberYard');
        const hasQuarry = this.state.buildings.some(b => b.type === 'quarry');
        const hasMill = this.state.buildings.some(b => b.type === 'mill');
        const hasBakery = this.state.buildings.some(b => b.type === 'bakery');
        
        // 根据建筑情况构建可用行动列表（注意：钓鱼是玩家专属，村民不能钓鱼）
        const availableActions = VALID_ACTIONS.filter(a => {
            if (a === 'chop' && !hasLumber) return false;
            if (a === 'mine' && !hasQuarry) return false;
            if (a === 'process' && !hasMill && !hasBakery) return false;
            return true;
        });
        
        // 建筑状态汇总（只显示与村民行动相关的建筑）
        const buildingStatus = [];
        buildingStatus.push(hasLumber ? '✅ 伐木场（可 chop 伐木）' : '❌ 无伐木场（不可 chop）');
        buildingStatus.push(hasQuarry ? '✅ 采石场（可 mine 采石）' : '❌ 无采石场（不可 mine）');
        buildingStatus.push(hasMill ? '✅ 磨坊（可 process 加工面粉）' : '❌ 无磨坊');
        buildingStatus.push(hasBakery ? '✅ 面包店（可 process 加工面包）' : '❌ 无面包店');
        
        const buildingRestrictions = [];
        if (!hasLumber) buildingRestrictions.push('🚫 chop（伐木）— 没有伐木场，此行动不可用');
        if (!hasQuarry) buildingRestrictions.push('🚫 mine（采石）— 没有采石场，此行动不可用');
        if (!hasMill && !hasBakery) buildingRestrictions.push('🚫 process（加工）— 没有磨坊/面包店，此行动不可用');

        // ===== 6. 性格/政策/会议 =====
        const traitHint = villager.traits.includes('勤劳') ? '你很勤劳，尽量排满工作' :
                         villager.traits.includes('懒惰') ? '你比较懒，多安排休息和闲逛' : '';

        const scheduleStart = this.getScheduleStartHour();
        const workEnd = this.getWorkEndHour();
        const restDay = this.state.isRestDay;
        const policyContext = this.buildPolicyContext();
        const meetingContext = this.meetingSystem
            ? this.meetingSystem.buildMeetingContext(villager)
            : '';

        const timeInfo = `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天 ${String(this.state.time.hour).padStart(2, '0')}:00`;
        const directiveSummary = directiveInfo.summary || '无';
        const directiveRule = directiveInfo.tradePolicy?.disallowTrade
            ? '• 村长指令：禁止安排交易(trade)'
            : '• 村长近期指令优先级最高，必须严格遵守';

        // ===== 7. 构建协作上下文 =====
        const villagerCount = this.state.villagers.length;
        let coordinationBlock = '';

        if (villagerCount > 1) {
            coordinationBlock = [
                '',
                '【其他村民今日计划】（已确定，你的计划必须与他们协调分工）',
                otherTaskSummaries.join('\n') || '暂无（你是今天第一个排计划的）',
                '',
                '【⚠️ 农活剩余配额（已扣除其他村民的安排）】',
                `• 可种植(plant)：最多${remainPlant}次（空田${emptyPlots.length}块${otherPlantCount > 0 ? `，其他人已安排${otherPlantCount}次` : ''}）`,
                `• 可浇水(water)：最多${remainWater}次（需水${needWaterPlots.length}块${otherWaterCount > 0 ? `，其他人已安排${otherWaterCount}次` : ''}）`,
                `• 可施肥(fertilize)：最多${remainFert}次（未施肥${needFertPlots.length}块${otherFertCount > 0 ? `，其他人已安排${otherFertCount}次` : ''}）— 施肥可+30%产量`,
                `• 可收获(harvest)：最多${remainHarvest}次（成熟${readyPlots.length}块${otherHarvestCount > 0 ? `，其他人已安排${otherHarvestCount}次` : ''}）`,
                '⚠️ 你安排的 plant/water/fertilize/harvest 次数绝对不能超过上面的配额！超出的活没有田可做，会白费时间。',
                '⚠️ 配额为0就不要安排该行动，改为其他工作（chop/mine/trade/rest/idle等）。',
                '💡 多位村民要合理分工：农活不够分时，可以安排伐木、采石、交易等其他工作，不要和别人抢同一块田。',
            ].join('\n');
        }

        return `为村民${villager.name}${villager.avatar || '👤'}制定今日计划。

【当前时间】
${timeInfo}（正在为“今天”生成计划）

【村民】${villager.traits.join('、')}，特长${villager.specialty}
体力${villager.stamina}/${villager.maxStamina}，心情${villager.mood}/${MAX_MOOD}
${traitHint}

${policyContext}

${meetingContext}

【🏗️ 村庄建筑状态（重要！决定哪些行动可用）】
${buildingStatus.join('\n')}
${buildingRestrictions.length > 0 ? `\n⛔ 不可用的行动（绝对禁止安排）：\n${buildingRestrictions.join('\n')}` : ''}

【市场消息】
今日早报：${morningReport}
昨日晚报：${eveningReport}
${eveningComment ? `分析师说：${eveningComment}` : ''}

【村庄资源】${this.state.seasonName}，${this.getCurrentWeatherInfo()}
金币${this.state.resources.gold}💰，小麦${wheatStock}🌾，木材${this.state.resources.wood}🪵，石料${this.state.resources.stone}🪨
${seedInfo}
${wheatUrgency}
仓库可交易品：${inventoryInfo}

【🌾 农田详情（共${totalPlots}块）】
${plotDetails.length > 0 ? plotDetails.join('\n') : '无农田'}
${villagerCount <= 1 ? `→ 你最多安排 plant ${emptyPlots.length}次、water ${needWaterPlots.length}次、fertilize ${needFertPlots.length}次、harvest ${readyPlots.length}次` : ''}

${coordinationBlock}

【村长近期指令（含时间，最高优先级）】
${directiveSummary}

【✅ 可用行动（只能从这里选择，不在列表中的行动禁止安排）】
${availableActions.map(a => `${a}=${ACTION_NAMES[a]}（${ACTION_DURATIONS[a]}h,${STAMINA_COSTS[a]}体力）`).join('，')}

【硬性规则】
• 作息：${WAKE_HOUR}:00起床，${SLEEP_HOUR}:00睡觉，计划从${scheduleStart}:00开始安排行动（${WAKE_HOUR}:00-${scheduleStart}:00为起床准备时间）
• ⚠️ 必须安排从${scheduleStart}:00到${SLEEP_HOUR - 1}:00的完整计划，包括晚间活动（晚饭后安排idle/rest/chat等）
${restDay ? '• 🏖️ 今天是休息日，只安排休闲活动（rest/idle/chat/eat），不安排劳动' : `• 工作时间 ${scheduleStart}:00-${workEnd}:00，工作结束后安排轻松活动`}
${directiveRule}
• 吃饭：一天3餐（早${scheduleStart}点/午12点/晚18点左右），用eat行动
• 市场：只有${MARKET_OPEN_HOUR}:00-${MARKET_CLOSE_HOUR}:00可以trade，价格实时波动（类似股市）
• 交易策略：你可以低价买入商品囤货，等价格上涨后再卖出赚取差价（但有亏损风险！价格也可能下跌）。参考早报/晚报的价格趋势分析来决策。在note中写明具体买/卖什么商品，如"买木材"、"卖萝卜"
• 种植：plant时在note中写明要种什么，如"种小麦"、"种萝卜"。小麦是村民每日消耗的粮食，优先保障！没有种子时应先安排trade买种子再plant
• 施肥：fertilize可让作物产量+30%，对已种植且未施肥的田使用，每块田只能施一次。有未施肥的田时建议安排！
• 收获：harvest只在作物成熟时有效，无成熟作物不要安排
• ⚠️ 农田数量限制：全村共${totalPlots}块农田，plant/water/fertilize/harvest的次数不能超过实际可操作的田地数，多了也做不了！
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
  "thought": "今天的想法（说说你对分工的看法、哪些活留给别人干等）..."
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

    /** 验证计划合法性（含农田任务数量硬性校验 + 建筑检查） */
    validateSchedule(schedule, villager, tradePolicy = {}) {
        const validated = [];
        let cumulativeStamina = 0;

        // ===== 建筑可用性检查 =====
        const hasLumber = this.state.buildings.some(b => b.type === 'lumberYard');
        const hasQuarry = this.state.buildings.some(b => b.type === 'quarry');
        const hasMill = this.state.buildings.some(b => b.type === 'mill');
        const hasBakery = this.state.buildings.some(b => b.type === 'bakery');

        // 计算农田任务的实际上限（扣除其他村民已分配的）
        const otherVillagers = this.state.villagers.filter(v => v.id !== villager.id);
        let otherPlant = 0, otherWater = 0, otherHarvest = 0, otherFert = 0;
        otherVillagers.forEach(v => {
            if (!v.schedule) return;
            v.schedule.forEach(s => {
                if (s.action === 'plant') otherPlant++;
                if (s.action === 'water') otherWater++;
                if (s.action === 'harvest') otherHarvest++;
                if (s.action === 'fertilize') otherFert++;
            });
        });

        const maxPlant = Math.max(0, this.state.plots.filter(p => p.stage === 'empty').length - otherPlant);
        const maxWater = Math.max(0, this.state.plots.filter(p => p.crop && !p.watered).length - otherWater);
        const maxFert = Math.max(0, this.state.plots.filter(p => p.crop && !p.fertilized && p.stage !== 'ready').length - otherFert);
        const maxHarvest = Math.max(0, this.state.plots.filter(p => p.stage === 'ready').length - otherHarvest);
        let plantCount = 0, waterCount = 0, harvestCount = 0, fertCount = 0;

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

            // ===== 建筑限制硬性校验 =====
            if (item.action === 'chop' && !hasLumber) {
                validated.push({ startHour, action: 'idle', target: null, duration: item.duration || 1, note: '没有伐木场' });
                continue;
            }
            if (item.action === 'mine' && !hasQuarry) {
                validated.push({ startHour, action: 'idle', target: null, duration: item.duration || 1, note: '没有采石场' });
                continue;
            }
            if (item.action === 'process') {
                // process 需要磨坊或面包店
                if (!hasMill && !hasBakery) {
                    validated.push({ startHour, action: 'idle', target: null, duration: item.duration || 1, note: '没有加工建筑' });
                    continue;
                }
            }

            // ===== 农田任务数量硬性校验 =====
            if (item.action === 'plant' && plantCount >= maxPlant) {
                // 超出种植配额，替换为闲逛
                validated.push({ startHour, action: 'idle', target: null, duration: item.duration || 1, note: '无空田可种' });
                continue;
            }
            if (item.action === 'water' && waterCount >= maxWater) {
                validated.push({ startHour, action: 'idle', target: null, duration: item.duration || 1, note: '无田需浇水' });
                continue;
            }
            if (item.action === 'fertilize' && fertCount >= maxFert) {
                validated.push({ startHour, action: 'idle', target: null, duration: item.duration || 1, note: '无田需施肥' });
                continue;
            }
            if (item.action === 'harvest' && harvestCount >= maxHarvest) {
                validated.push({ startHour, action: 'idle', target: null, duration: item.duration || 1, note: '无成熟作物' });
                continue;
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

            // 农田任务计数
            if (item.action === 'plant') plantCount++;
            if (item.action === 'water') waterCount++;
            if (item.action === 'fertilize') fertCount++;
            if (item.action === 'harvest') harvestCount++;

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
            const hasLumber = this.state.buildings.some(b => b.type === 'lumberYard');
            const hasQuarry = this.state.buildings.some(b => b.type === 'quarry');
            
            // 根据建筑和农田情况选择合适的行动
            const altAction = hasLumber ? 'chop' : hasQuarry ? 'mine' : 'idle';
            const altAction2 = hasQuarry ? 'mine' : hasLumber ? 'chop' : 'idle';
            
            schedule.push(
                { startHour: 9, action: hasPlots ? 'water' : altAction, target: hasPlots ? plots[0]?.name : null, duration: 1, note: '' },
                { startHour: 10, action: hasPlots ? 'plant' : altAction2, target: null, duration: 2, note: '' },
                { startHour: 12, action: 'eat', target: null, duration: 1, note: '午饭' },
                { startHour: 13, action: hasPlots ? 'harvest' : 'idle', target: null, duration: 1, note: '' },
                { startHour: 14, action: 'rest', target: null, duration: 1, note: '' },
                { startHour: 15, action: hasPlots ? 'water' : altAction, target: null, duration: 1, note: '' },
                { startHour: 16, action: hasLumber ? 'chop' : 'idle', target: null, duration: 2, note: '' },
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
                    const plantHint = (task.note || '') + ' ' + (task.target || '');

                    // 解析 note 中指定的作物
                    const cropKeywords = {
                        wheat: ['小麦', '麦'],
                        radish: ['萝卜'],
                        potato: ['土豆'],
                        pumpkin: ['南瓜'],
                        cotton: ['棉花'],
                        grape: ['葡萄'],
                    };
                    let preferredCrop = null;
                    for (const [cropId, keywords] of Object.entries(cropKeywords)) {
                        if (keywords.some(kw => plantHint.includes(kw))) {
                            preferredCrop = cropId;
                            break;
                        }
                    }

                    // 优先种指定的作物
                    if (preferredCrop && (seeds[preferredCrop] || 0) > 0) {
                        const result = this.farmSys.plant(emptyPlot.id, preferredCrop);
                        if (result.success) planted = true;
                    }

                    // 没有指定或指定的没种子 → 优先种小麦（粮食保障），再按库存选
                    if (!planted) {
                        // 小麦优先（如果有种子）
                        if ((seeds.wheat || 0) > 0) {
                            const result = this.farmSys.plant(emptyPlot.id, 'wheat');
                            if (result.success) planted = true;
                        }
                        // 否则按有种子的顺序种
                        if (!planted) {
                            for (const [cropId, count] of Object.entries(seeds)) {
                                if (count > 0) {
                                    const result = this.farmSys.plant(emptyPlot.id, cropId);
                                    if (result.success) { planted = true; break; }
                                }
                            }
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
