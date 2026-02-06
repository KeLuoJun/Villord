/**
 * EventSystem - 事件系统
 * 管理经济事件、村民事件、天气联动事件
 * 定时检测触发条件，弹出事件面板
 */

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
    }

    /** 每日处理 */
    onNewDay() {
        // 更新连续低心情天数追踪
        this.state.villagers.forEach(v => {
            if (v.mood < 30) {
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

            const deviation = (price - config.basePrice) / config.basePrice;

            // 市场异动：偏离基准 > 30%
            if (deviation > 0.3 && !this.isOnCooldown(`market_high_${id}`)) {
                this.triggerEvent({
                    type: 'economic',
                    title: `📈 ${config.name}价格飙升！`,
                    description: `${config.icon}${config.name}的价格已超过基准的130%，当前${Math.round(price)}💰。这是卖出的好时机！`,
                    options: [
                        { text: '卖出5个', id: 'sell5', effect: () => this.trySell(id, 5) },
                        { text: '继续观望', id: 'wait', effect: () => {} },
                    ],
                });
                this.setCooldown(`market_high_${id}`, 5);
            }

            if (deviation < -0.3 && !this.isOnCooldown(`market_low_${id}`)) {
                this.triggerEvent({
                    type: 'economic',
                    title: `📉 ${config.name}价格暴跌！`,
                    description: `${config.icon}${config.name}的价格已低于基准的70%，当前${Math.round(price)}💰。可能是买入的机会？`,
                    options: [
                        { text: '买入5个', id: 'buy5', effect: () => this.tryBuy(id, 5) },
                        { text: '不理会', id: 'ignore', effect: () => {} },
                    ],
                });
                this.setCooldown(`market_low_${id}`, 5);
            }
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

        // F1: 丰收庆典事件
        if (this.state.season === 'autumn' && this.state.time.day === 15
            && !this.isOnCooldown('harvest_festival')) {
            const foodBonus = Math.min(20, Math.floor(this.state.plots.length * 3));
            this.triggerEvent({
                type: 'economic',
                title: '🎉 丰收庆典！',
                description: `秋天是丰收的季节！全村举办庆典，村民心情大涨！额外获得${foodBonus}🌾粮食。`,
                options: [
                    { text: '太棒了！', id: 'celebrate', effect: () => {
                        this.state.modifyResource('food', foodBonus);
                        this.state.villagers.forEach(v => {
                            v.mood = Math.min(100, v.mood + 15);
                        });
                        this.state.addLog('🎉', `丰收庆典：获得${foodBonus}🌾，全员心情+15`, 'success');
                    }},
                ],
            });
            this.setCooldown('harvest_festival', 30);
        }

        // F1: 村民失误交易事件
        if (!this.isOnCooldown('bad_trade')) {
            const stupidVillager = this.state.villagers.find(v =>
                v.traits.includes('愚笨') && v.currentTask?.action === 'trade'
            );
            if (stupidVillager && Math.random() < 0.15) {
                const goldLoss = Math.floor(Math.random() * 10) + 5;
                this.triggerEvent({
                    type: 'economic',
                    title: `💸 ${stupidVillager.name}做了笔亏本买卖`,
                    description: `${stupidVillager.name}在市场上搞混了价格，"${stupidVillager.quirk}"... 损失了${goldLoss}💰。`,
                    options: [
                        { text: '算了...', id: 'forgive', effect: () => {
                            this.state.resources.gold = Math.max(0, this.state.resources.gold - goldLoss);
                        }},
                        { text: '严厉批评（心情-10）', id: 'scold', effect: () => {
                            this.state.resources.gold = Math.max(0, this.state.resources.gold - goldLoss);
                            stupidVillager.mood = Math.max(0, stupidVillager.mood - 10);
                        }},
                    ],
                });
                this.setCooldown('bad_trade', 7);
            }
        }
    }

    // ===== 村民事件 =====
    checkVillagerEvents() {
        this.state.villagers.forEach(villager => {
            // F3: 心情 < 30 触发抱怨（策划文档要求）
            if (villager.mood < 30 && !this.isOnCooldown(`mood_low_${villager.id}`)) {
                this.triggerEvent({
                    type: 'villager',
                    title: `😟 ${villager.name}心情很差`,
                    description: `${villager.name}看起来很不开心（心情${villager.mood}）。${villager.traits.includes('悲观') ? '唉...又要抱怨了...' : '也许给点休息时间？'}`,
                    options: [
                        { text: '安慰一下（心情+10）', id: 'comfort', effect: () => { villager.mood = Math.min(100, villager.mood + 10); } },
                        { text: '放半天假（心情+15）', id: 'holiday', effect: () => { villager.mood = Math.min(100, villager.mood + 15); villager.currentAction = '🎉 放假中'; } },
                        { text: '不管', id: 'ignore', effect: () => { villager.mood = Math.max(0, villager.mood - 5); } },
                    ],
                });
                this.setCooldown(`mood_low_${villager.id}`, 3);
            }

            // 体力过低 -> 生病（体弱村民更容易）
            if (villager.stamina <= 10 && villager.traits.includes('体弱')
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
                                    villager.stamina = Math.min(villager.maxStamina, villager.stamina + 30);
                                    villager.currentAction = '💊 养病中';
                                }
                            }},
                            { text: '硬撑着干活', id: 'work', effect: () => {
                                villager.mood = Math.max(0, villager.mood - 20);
                            }},
                        ],
                    });
                    this.setCooldown(`sick_${villager.id}`, 7);
                }
            }

            // 叛逆村民可能拒绝工作
            if (villager.traits.includes('叛逆') && villager.mood < 40
                && !this.isOnCooldown(`rebel_${villager.id}`)) {
                if (Math.random() < 0.2) {
                    this.triggerEvent({
                        type: 'villager',
                        title: `😤 ${villager.name}闹脾气了`,
                        description: `${villager.name}觉得工作太多，表示不想干活了！"${villager.quirk}"`,
                        options: [
                            { text: '耐心劝说', id: 'persuade', effect: () => { villager.mood = Math.min(100, villager.mood + 5); } },
                            { text: '加薪鼓励（-15💰）', id: 'bonus', effect: () => {
                                if (this.state.resources.gold >= 15) {
                                    this.state.resources.gold -= 15;
                                    villager.mood = Math.min(100, villager.mood + 20);
                                }
                            }},
                            { text: '不理会', id: 'ignore', effect: () => { villager.mood = Math.max(0, villager.mood - 10); } },
                        ],
                    });
                    this.setCooldown(`rebel_${villager.id}`, 5);
                }
            }

            // 乐观村民的惊喜
            if (villager.traits.includes('乐观') && villager.mood >= 80
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
                const unhappy = this.state.villagers.filter(v => v.mood < 30);
                if (unhappy.length >= 2 && Math.random() < 0.25) {
                    const v1 = unhappy[0], v2 = unhappy[1];
                    this.triggerEvent({
                        type: 'villager',
                        title: `😡 ${v1.name}和${v2.name}吵起来了！`,
                        description: `两人心情都不好，因为琐事发生了争吵。如果不处理，双方心情会继续下降。`,
                        options: [
                            { text: '调解纠纷（心情各+10）', id: 'mediate', effect: () => {
                                v1.mood = Math.min(100, v1.mood + 10);
                                v2.mood = Math.min(100, v2.mood + 10);
                            }},
                            { text: '各打五十大板', id: 'punish', effect: () => {
                                v1.mood = Math.max(0, v1.mood - 5);
                                v2.mood = Math.max(0, v2.mood - 5);
                            }},
                            { text: '不管', id: 'ignore', effect: () => {
                                v1.mood = Math.max(0, v1.mood - 10);
                                v2.mood = Math.max(0, v2.mood - 10);
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
                        { text: '挽留（心情+20，-20💰）', id: 'retain', effect: () => {
                            if (this.state.resources.gold >= 20) {
                                this.state.resources.gold -= 20;
                                villager.mood = Math.min(100, villager.mood + 20);
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

    // ===== 事件触发 =====
    triggerEvent(event) {
        this.state.addLog(event.type === 'economic' ? '📊' : event.type === 'villager' ? '👤' : '⚠️',
            event.title, event.type === 'crisis' ? 'danger' : 'warning');

        const tagMap = { economic: '[经济事件]', villager: '[村民事件]', crisis: '[危机]' };
        const tag = tagMap[event.type] || '[事件]';
        this.bus.emit('autoPause', { reason: `${tag} ${event.title}` });

        // 弹窗显示
        this.showEventPopup(event);
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
