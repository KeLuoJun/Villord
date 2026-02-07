/**
 * EventSystem - 事件系统
 * 管理经济事件、村民事件、天气联动事件
 * 定时检测触发条件，弹出事件面板
 */
import { MAX_MOOD } from '../config/villagers.js';

const MOOD_LOW_THRESHOLD = Math.max(3, Math.round(MAX_MOOD * 0.3));   // 20 -> 6
const MOOD_REBEL_THRESHOLD = Math.round(MAX_MOOD * 0.4);              // 20 -> 8
const MOOD_HAPPY_THRESHOLD = Math.round(MAX_MOOD * 0.8);              // 20 -> 16
const HOLIDAY_HOURS = 4;
const HOLIDAY_END_HOUR = 22;

export class EventSystem {
    constructor(gameState, eventBus, uiManager) {
        this.state = gameState;
        this.bus = eventBus;
        this.ui = uiManager;
        this.cooldowns = {};    // eventType -> lastTriggerDay
        this.checkedToday = false;
        this.lowMoodDays = {};  // villagerId -> 连续低心情天数

        this.bus.on('newDay', () => this.onNewDay());
        this.bus.on('tick', (data) => {
            if (data.hour === 8 && !this.checkedToday) {
                this.checkEvents();
                this.checkedToday = true;
            }
            if (data.hour === 0) {
                this.checkedToday = false;
            }
        });
    }

    /** 每日事件检测 */
    checkEvents() {
        this.checkEconomicEvents();
        this.checkVillagerEvents();
        this.checkResourceAlerts();
        this.checkPolicyEvents();
    }

    /** 每日处理 */
    onNewDay() {
        // 更新连续低心情天数追踪
        this.state.villagers.forEach(v => {
            if (v.mood < MOOD_LOW_THRESHOLD) {
                this.lowMoodDays[v.id] = (this.lowMoodDays[v.id] || 0) + 1;
            } else {
                this.lowMoodDays[v.id] = 0;
            }
        });
    }

    // ===== 经济事件 =====
    checkEconomicEvents() {
        const prices = this.state.market.prices;
        const items = window.MARKET_ITEMS;
        if (!items) return;

        for (const [id, config] of Object.entries(items)) {
            if (config.category === 'seed') continue;
            const price = prices[id];
            if (!price) continue;

            // 价格波动不再弹窗提示，交由市场分析师的早晚报统一分析
        }

        // F1: 粮价季节波动事件（春播/秋收季节性提醒）
        if (this.state.season === 'spring' && this.state.time.day === 5
            && !this.isOnCooldown('grain_spring')) {
            this.triggerEvent({
                type: 'economic',
                title: '🌾 春耕播种季',
                description: '春天来了，种子需求增加，种子价格可能上涨。现在囤些种子也许是个好主意！',
                options: [
                    { text: '去市场看看', id: 'market', effect: () => this.bus.emit('switchTab', { tab: 'market' }) },
                    { text: '知道了', id: 'ok', effect: () => {} },
                ],
            });
            this.setCooldown('grain_spring', 30);
        }

        // F1: 丰收庆典事件（直接生效，无需弹窗选择）
        if (this.state.season === 'autumn' && this.state.time.day === 15
            && !this.isOnCooldown('harvest_festival')) {
            const foodBonus = Math.min(20, Math.floor(this.state.plots.length * 3));
            // 直接应用效果
            this.state.modifyResource('food', foodBonus);
            this.state.villagers.forEach(v => {
                v.mood = Math.min(MAX_MOOD, v.mood + 2);
            });
            this.triggerEvent({
                type: 'economic',
                title: '🎉 丰收庆典！',
                description: `秋天是丰收的季节！全村举办庆典，村民心情大涨！额外获得${foodBonus}🌾粮食。`,
                options: [],
            });
            this.setCooldown('harvest_festival', 30);
        }

        // F1: 村民失误交易事件（直接生效，无需弹窗选择）
        if (!this.isOnCooldown('bad_trade')) {
            const stupidVillager = this.state.villagers.find(v =>
                v.traits.includes('愚笨') && v.currentTask?.action === 'trade'
            );
            if (stupidVillager && Math.random() < 0.15) {
                const goldLoss = Math.floor(Math.random() * 10) + 5;
                // 直接应用金币损失
                this.state.resources.gold = Math.max(0, this.state.resources.gold - goldLoss);
                this.triggerEvent({
                    type: 'economic',
                    title: `💸 ${stupidVillager.name}做了笔亏本买卖`,
                    description: `${stupidVillager.name}在市场上搞混了价格，"${stupidVillager.quirk}"... 损失了${goldLoss}💰。`,
                    options: [],
                });
                this.setCooldown('bad_trade', 7);
            }
        }
    }

    // ===== 村民事件 =====
    checkVillagerEvents() {
        this.state.villagers.forEach(villager => {
            // F3: 心情过低触发抱怨
            if (villager.mood < MOOD_LOW_THRESHOLD && !this.isOnCooldown(`mood_low_${villager.id}`)) {
                this.triggerEvent({
                    type: 'villager',
                    title: `😟 ${villager.name}心情不佳`,
                    description: `${villager.name}看起来有点闷闷不乐（心情${villager.mood}）。${villager.traits.includes('悲观') ? '唉...又要抱怨了...' : '也许给点休息时间？'}`,
                    options: [
                        { text: '安慰一下（心情+2）', id: 'comfort', effect: () => { villager.mood = Math.min(MAX_MOOD, villager.mood + 2); } },
                        { text: '放半天假（心情+3）', id: 'holiday', effect: () => {
                            villager.mood = Math.min(MAX_MOOD, villager.mood + 3);
                            this.applyHalfDayHoliday(villager);
                        }},
                        { text: '不管', id: 'ignore', effect: () => { villager.mood = Math.max(0, villager.mood - 1); } },
                    ],
                });
                this.setCooldown(`mood_low_${villager.id}`, 3);
            }

            // 体力过低 -> 生病（体弱村民更容易）
            if (villager.stamina <= 4 && villager.traits.includes('体弱')
                && !this.isOnCooldown(`sick_${villager.id}`)) {
                if (Math.random() < 0.3) {
                    this.triggerEvent({
                        type: 'villager',
                        title: `🤒 ${villager.name}生病了`,
                        description: `${villager.name}体力耗尽又体弱，不幸生病了！需要休息2天。`,
                        options: [
                            { text: '安排休息（-10💰药费）', id: 'heal', effect: () => {
                                if (this.state.resources.gold >= 10) {
                                    this.state.resources.gold -= 10;
                                    villager.stamina = Math.min(villager.maxStamina, villager.stamina + 6);
                                    villager.currentAction = '💊 养病中';
                                }
                            }},
                            { text: '硬撑着干活', id: 'work', effect: () => {
                                villager.mood = Math.max(0, villager.mood - 3);
                            }},
                        ],
                    });
                    this.setCooldown(`sick_${villager.id}`, 7);
                }
            }

            // 叛逆村民可能拒绝工作
            if (villager.traits.includes('叛逆') && villager.mood < MOOD_REBEL_THRESHOLD
                && !this.isOnCooldown(`rebel_${villager.id}`)) {
                if (Math.random() < 0.2) {
                    this.triggerEvent({
                        type: 'villager',
                        title: `😤 ${villager.name}闹脾气了`,
                        description: `${villager.name}觉得工作太多，表示不想干活了！"${villager.quirk}"`,
                        options: [
                            { text: '耐心劝说', id: 'persuade', effect: () => { villager.mood = Math.min(MAX_MOOD, villager.mood + 1); } },
                            { text: '加薪鼓励（-15💰）', id: 'bonus', effect: () => {
                                if (this.state.resources.gold >= 15) {
                                    this.state.resources.gold -= 15;
                                    villager.mood = Math.min(MAX_MOOD, villager.mood + 3);
                                }
                            }},
                            { text: '不理会', id: 'ignore', effect: () => { villager.mood = Math.max(0, villager.mood - 2); } },
                        ],
                    });
                    this.setCooldown(`rebel_${villager.id}`, 5);
                }
            }

            // 乐观村民的惊喜
            if (villager.traits.includes('乐观') && villager.mood >= MOOD_HAPPY_THRESHOLD
                && !this.isOnCooldown(`happy_${villager.id}`)) {
                if (Math.random() < 0.1) {
                    const bonus = Math.floor(Math.random() * 3) + 1;
                    this.state.modifyResource('food', bonus);
                    this.state.addLog('🎉', `${villager.name}心情大好，额外收获了${bonus}🌾！`, 'success');
                    this.setCooldown(`happy_${villager.id}`, 7);
                }
            }

            // F2: 村民间争吵（2个以上低心情村民）
            if (!this.isOnCooldown('villager_argument')) {
                const unhappy = this.state.villagers.filter(v => v.mood < MOOD_LOW_THRESHOLD);
                if (unhappy.length >= 2 && Math.random() < 0.25) {
                    const v1 = unhappy[0], v2 = unhappy[1];
                    this.triggerEvent({
                        type: 'villager',
                        title: `😡 ${v1.name}和${v2.name}吵起来了！`,
                        description: `两人心情都不好，因为琐事发生了争吵。如果不处理，双方心情会继续下降。`,
                        options: [
                            { text: '调解纠纷（心情各+2）', id: 'mediate', effect: () => {
                                v1.mood = Math.min(MAX_MOOD, v1.mood + 2);
                                v2.mood = Math.min(MAX_MOOD, v2.mood + 2);
                            }},
                            { text: '各打五十大板', id: 'punish', effect: () => {
                                v1.mood = Math.max(0, v1.mood - 1);
                                v2.mood = Math.max(0, v2.mood - 1);
                            }},
                            { text: '不管', id: 'ignore', effect: () => {
                                v1.mood = Math.max(0, v1.mood - 2);
                                v2.mood = Math.max(0, v2.mood - 2);
                            }},
                        ],
                    });
                    this.setCooldown('villager_argument', 5);
                }
            }

            // F2: 请求离开（连续多天低心情）
            const consecutiveLowDays = this.lowMoodDays[villager.id] || 0;
            if (consecutiveLowDays >= 5 && !this.isOnCooldown(`leave_request_${villager.id}`)) {
                this.triggerEvent({
                    type: 'villager',
                    title: `💔 ${villager.name}想要离开`,
                    description: `${villager.name}已经连续${consecutiveLowDays}天心情低落，表示想离开村庄。"${villager.quirk}"`,
                    options: [
                        { text: '挽留（心情+3，-20💰）', id: 'retain', effect: () => {
                            if (this.state.resources.gold >= 20) {
                                this.state.resources.gold -= 20;
                                villager.mood = Math.min(MAX_MOOD, villager.mood + 3);
                                this.lowMoodDays[villager.id] = 0;
                            }
                        }},
                        { text: '同意离开', id: 'agree', effect: () => {
                            this.bus.emit('dismissRequest', { villagerId: villager.id });
                        }},
                    ],
                });
                this.setCooldown(`leave_request_${villager.id}`, 10);
            }

            // F2: 愚笨特质失误事件（执行任务时出错）
            if (villager.traits.includes('愚笨') && villager.currentTask
                && !this.isOnCooldown(`stupid_mistake_${villager.id}`)) {
                if (Math.random() < 0.08) {
                    const action = villager.currentTask.action;
                    let mistakeDesc = '';
                    let mistakeEffect = () => {};

                    if (action === 'water') {
                        mistakeDesc = `给隔壁田浇了水，该浇的田却忘了`;
                    } else if (action === 'plant') {
                        mistakeDesc = `种子种反了方向...虽然最后还是长出来了`;
                    } else if (action === 'harvest') {
                        mistakeDesc = `不小心踩坏了一些作物`;
                        mistakeEffect = () => this.state.modifyResource('food', -1);
                    } else {
                        mistakeDesc = `搞砸了手里的活，浪费了点材料`;
                    }

                    this.state.addLog('😅', `${villager.name}犯了个小错：${mistakeDesc}`, 'warning');
                    mistakeEffect();
                    this.setCooldown(`stupid_mistake_${villager.id}`, 5);
                }
            }
        });
    }

    // ===== 资源告警 =====
    checkResourceAlerts() {
        if (this.state.resources.food <= 0 && !this.isOnCooldown('famine')) {
            this.triggerEvent({
                type: 'crisis',
                title: '⚠️ 粮食危机！',
                description: '村庄粮食已经耗尽！村民将挨饿，心情大幅下降。请立即想办法获取粮食！',
                options: [
                    { text: '去市场买粮', id: 'buy', effect: () => this.bus.emit('switchTab', { tab: 'market' }) },
                    { text: '知道了', id: 'ok', effect: () => {} },
                ],
            });
            this.setCooldown('famine', 3);
        }
    }

    // ===== 政策相关事件 =====
    checkPolicyEvents() {
        const policies = this.state.policies;
        if (!policies) return;

        const effects = this.state.getPolicyEffects();

        // ─── 996 过劳事件：当996工时 + 连续工作多天时触发 ───
        if (policies.workHours === '996' && !this.isOnCooldown('policy_overwork')) {
            const consecutiveWork = this.state._consecutiveWorkDays || 0;
            if (consecutiveWork >= 3) {
                const exhausted = this.state.villagers.filter(v => v.stamina < v.maxStamina * 0.3);
                if (exhausted.length > 0 && Math.random() < 0.3) {
                    const victim = exhausted[Math.floor(Math.random() * exhausted.length)];
                    this.triggerEvent({
                        type: 'villager',
                        title: `🔥 ${victim.name}过劳倒下了！`,
                        description: `996高强度工作让${victim.name}体力透支，需要紧急休息！连续工作${consecutiveWork}天的高压终于爆发了。`,
                        options: [
                            { text: '强制休息1天（-10💰医疗费）', id: 'rest', effect: () => {
                                if (this.state.resources.gold >= 10) {
                                    this.state.resources.gold -= 10;
                                    victim.stamina = victim.maxStamina;
                                    victim.mood = Math.min(MAX_MOOD, victim.mood + 2);
                                    this.applyHalfDayHoliday(victim);
                                }
                            }},
                            { text: '让他硬撑', id: 'ignore', effect: () => {
                                victim.mood = Math.max(0, victim.mood - 3);
                                victim.stamina = Math.max(0, victim.stamina - 2);
                            }},
                        ],
                    });
                    this.setCooldown('policy_overwork', 5);
                }
            }
        }

        // ─── 自由市场 "倒爷" 事件 ───
        if (policies.distribution === 'freeMarket' && !this.isOnCooldown('policy_scalper')) {
            if (Math.random() < (effects.scalperChance || 0)) {
                const goldLoss = Math.floor(Math.random() * 15) + 5;
                const foodLoss = Math.floor(Math.random() * 3) + 1;
                this.triggerEvent({
                    type: 'villager',
                    title: '🤑 村里出了个"倒爷"！',
                    description: `自由市场制度下，有村民偷偷囤货倒卖，村庄损失了${goldLoss}💰和${foodLoss}🌾！自由的代价...`,
                    options: [
                        { text: '严厉警告（止损，心情-1）', id: 'warn', effect: () => {
                            this.state.resources.gold = Math.max(0, this.state.resources.gold - Math.floor(goldLoss / 2));
                            this.state.villagers.forEach(v => v.mood = Math.max(0, v.mood - 1));
                        }},
                        { text: '睁一只眼闭一只眼', id: 'ignore', effect: () => {
                            this.state.resources.gold = Math.max(0, this.state.resources.gold - goldLoss);
                            this.state.modifyResource('food', -foodLoss);
                        }},
                        { text: '切换分配制度', id: 'switch', effect: () => {
                            this.bus.emit('switchTab', { tab: 'policy' });
                        }},
                    ],
                });
                this.setCooldown('policy_scalper', 7);
            }
        }

        // ─── 连续无休息崩溃事件 ───
        if (policies.holiday === 'none' && !this.isOnCooldown('policy_no_rest')) {
            const consecutiveWork = this.state._consecutiveWorkDays || 0;
            if (consecutiveWork >= 5) {
                const lowMorale = this.state.villagers.filter(v => v.mood < Math.round(MAX_MOOD * 0.3));
                if (lowMorale.length >= 2 && Math.random() < 0.4) {
                    this.triggerEvent({
                        type: 'crisis',
                        title: '😵 村民集体抗议！',
                        description: `连续${consecutiveWork}天无休息日，村民们忍无可忍！要求立刻安排休假，否则全体罢工！`,
                        options: [
                            { text: '紧急放假1天（全员心情+3）', id: 'holiday', effect: () => {
                                this.state.villagers.forEach(v => {
                                    v.mood = Math.min(MAX_MOOD, v.mood + 3);
                                    v.stamina = v.maxStamina;
                                    this.applyHalfDayHoliday(v);
                                });
                                this.state._consecutiveWorkDays = 0;
                            }},
                            { text: '强硬拒绝（全员心情-3）', id: 'refuse', effect: () => {
                                this.state.villagers.forEach(v => {
                                    v.mood = Math.max(0, v.mood - 3);
                                });
                            }},
                        ],
                    });
                    this.setCooldown('policy_no_rest', 10);
                }
            }
        }

        // ─── 偷懒处罚引发叛逆事件 ───
        if (policies.reward === 'punish' && !this.isOnCooldown('policy_punish_rebel')) {
            const rebels = this.state.villagers.filter(v =>
                v.traits.includes('叛逆') && v.mood < Math.round(MAX_MOOD * 0.3)
            );
            if (rebels.length > 0 && Math.random() < 0.2) {
                const rebel = rebels[Math.floor(Math.random() * rebels.length)];
                this.triggerEvent({
                    type: 'villager',
                    title: `⚡ ${rebel.name}公开抗命！`,
                    description: `严厉的处罚制度让叛逆的${rebel.name}忍无可忍：「${rebel.quirk}」，当众拒绝工作并鼓动他人！`,
                    options: [
                        { text: '私下沟通（心情+2）', id: 'talk', effect: () => {
                            rebel.mood = Math.min(MAX_MOOD, rebel.mood + 2);
                        }},
                        { text: '加倍处罚（心情-3）', id: 'punish_more', effect: () => {
                            rebel.mood = Math.max(0, rebel.mood - 3);
                            // 其他村民也受影响
                            this.state.villagers.forEach(v => {
                                if (v.id !== rebel.id) v.mood = Math.max(0, v.mood - 1);
                            });
                        }},
                    ],
                });
                this.setCooldown('policy_punish_rebel', 7);
            }
        }
    }

    // ===== 事件触发 =====
    triggerEvent(event) {
        this.state.addLog(event.type === 'economic' ? '📊' : event.type === 'villager' ? '👤' : '⚠️',
            event.title, event.type === 'crisis' ? 'danger' : 'warning');

        // 经济事件只记录日志和Toast提示，不弹窗、不暂停
        if (event.type === 'economic') {
            this.bus.emit('showToast', { message: `📊 ${event.title}`, type: 'info' });
            return;
        }

        const tagMap = { villager: '[村民事件]', crisis: '[危机]' };
        const tag = tagMap[event.type] || '[事件]';
        this.bus.emit('autoPause', { reason: `${tag} ${event.title}` });

        // 弹窗显示（仅非经济事件）
        this.showEventPopup(event);
    }

    /** 让村民放半天假（未来4小时内不执行计划） */
    applyHalfDayHoliday(villager) {
        const currentHour = this.state.time.hour;
        const startHour = Math.max(currentHour, 8);
        const endHour = Math.min(startHour + HOLIDAY_HOURS, HOLIDAY_END_HOUR);
        if (startHour >= endHour) return;

        // 标记放假时间窗口
        villager._holidayUntilHour = Math.max(villager._holidayUntilHour || 0, endHour);
        villager.currentAction = '🎉 放假中';

        // 将放假时间段内的计划标记为跳过
        if (!villager._scheduleStatus) villager._scheduleStatus = {};
        if (villager.schedule) {
            villager.schedule.forEach(task => {
                const sh = task.startHour ?? task.hour;
                if (sh >= startHour && sh < endHour) {
                    villager._scheduleStatus[`${sh}_${task.action}`] = 'skipped';
                }
            });
        }

        this.state.addLog('🎉', `${villager.name}获得半天假期（${startHour}:00-${endHour}:00）`, 'info');
    }

    /** 显示事件弹窗 */
    showEventPopup(event) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const optionsHTML = event.options.map(o =>
            `<div class="event-option" data-option="${o.id}">
                <div>${o.text}</div>
            </div>`
        ).join('');

        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:440px;">
                <div class="event-popup">
                    <div class="event-title">${event.title}</div>
                    <div class="event-desc">${event.description}</div>
                    <div class="event-options">${optionsHTML}</div>
                </div>
            </div>
        `;

        event.options.forEach(o => {
            const el = overlay.querySelector(`[data-option="${o.id}"]`);
            if (el) {
                el.addEventListener('click', () => {
                    o.effect();
                    overlay.remove();
                    this.bus.emit('uiUpdate', {});
                });
            }
        });

        document.body.appendChild(overlay);
    }

    // ===== 工具 =====
    isOnCooldown(key) {
        const last = this.cooldowns[key];
        if (!last) return false;
        return (this.state.totalDays - last) < 3;
    }

    setCooldown(key, days = 3) {
        this.cooldowns[key] = this.state.totalDays;
    }

    trySell(itemId, qty) {
        if (window.game?.market) {
            if (!window.game.market.isMarketOpen()) {
                this.state.addLog('🚫', '市场已关闭，无法交易', 'warning');
                return;
            }
            window.game.market.executeTrade(itemId, qty, false);
        }
    }

    tryBuy(itemId, qty) {
        if (window.game?.market) {
            if (!window.game.market.isMarketOpen()) {
                this.state.addLog('🚫', '市场已关闭，无法交易', 'warning');
                return;
            }
            window.game.market.executeTrade(itemId, qty, true);
        }
    }
}
