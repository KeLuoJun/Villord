/**
 * NeighborSystem - 邻村往来系统
 * 管理与 3 个邻村的好感度、贸易、互助、来访事件、声望
 *
 * 每日流程：
 * - 6:00 重置贸易次数、检查延迟回报
 * - 9:00 检查邻村事件（来访/请求/援助）
 * - 每 5 天结算政策对好感度的影响
 * - 每季变化邻村繁荣状态
 */
import {
    NEIGHBOR_VILLAGES,
    REPUTATION_LEVELS,
    NEIGHBOR_STATUS,
    NEIGHBOR_EVENTS,
    NEIGHBOR_AID,
    POLICY_FAVOR_EFFECTS,
    TRADE_CONSTANTS,
    GIFT_OPTIONS,
    STEAL_LOOT_POOLS,
    STEAL_CONSTANTS,
} from '../config/neighbors.js';

export class NeighborSystem {
    constructor(gameState, eventBus, uiManager, aiService) {
        this.state = gameState;
        this.bus = eventBus;
        this.ui = uiManager;
        this.ai = aiService || null;
        this._chatSending = false;  // 防止重复发送

        // 确保 neighbors 状态存在（兼容旧存档）
        if (!this.state.neighbors || !this.state.neighbors.favor) {
            this.state.neighbors = {
                favor: { fenggu: 25, tieling: 20, yunshui: 15 },
                status: { fenggu: 'stable', tieling: 'stable', yunshui: 'stable' },
                reputation: 0,
                todayTrades: {},
                delayedRewards: [],
                eventCooldowns: {},
                aidCooldowns: {},
                log: [],
                todayGifts: {},
                _specialRecruit: false,
                _policyFavorAccum: 0,
            };
        }

        this.bus.on('tick', (data) => this.onTick(data));
        this.bus.on('newDay', () => this.onNewDay());
        this.bus.on('seasonChange', () => this.onSeasonChange());
    }

    // ===== 生命周期 =====

    onTick(data) {
        // 6:00 重置每日贸易和赠礼次数
        if (data.hour === 6) {
            this.state.neighbors.todayTrades = {};
            this.state.neighbors.todayGifts = {};
        }
        // 9:00 检查邻村事件
        if (data.hour === 9) {
            this.checkNeighborEvents();
            this.checkNeighborAid();
        }
    }

    onNewDay() {
        // 处理延迟回报
        this.processDelayedRewards();

        // 政策影响累积（每 5 天结算）
        this.state.neighbors._policyFavorAccum =
            (this.state.neighbors._policyFavorAccum || 0) + 1;
        if (this.state.neighbors._policyFavorAccum >= 5) {
            this.state.neighbors._policyFavorAccum = 0;
            this.applyPolicyFavorEffects();
        }

        // 长期无往来好感度衰减（每天检查）
        this._checkInactivityDecay();
    }

    /** 记录与某邻村的最近互动日 */
    _recordInteraction(villageId) {
        if (!this.state.neighbors._lastInteraction) this.state.neighbors._lastInteraction = {};
        this.state.neighbors._lastInteraction[villageId] = this.state.totalDays;
    }

    /** 检查无互动衰减：超过 5 天无往来，每天 -1 好感度 */
    _checkInactivityDecay() {
        if (!this.state.neighbors._lastInteraction) this.state.neighbors._lastInteraction = {};
        const today = this.state.totalDays;

        for (const vid of Object.keys(NEIGHBOR_VILLAGES)) {
            const lastDay = this.state.neighbors._lastInteraction[vid] || 0;
            const idle = today - lastDay;
            const favor = this.getFavor(vid);

            // 超过 5 天无往来且好感度 > 5 时开始衰减
            if (idle > 5 && favor > 5) {
                // 每天 -1，最低不低于 5（不会因为不理就降到 0）
                this.state.neighbors.favor[vid] = Math.max(5, favor - 1);
                // 每 5 天提示一次（避免日志刷屏）
                if (idle % 5 === 1) {
                    const village = NEIGHBOR_VILLAGES[vid];
                    this.addLog(village.icon,
                        `${village.name}好感度因长期无往来而下降（已${idle}天无互动）`);
                }
            }
        }
    }

    onSeasonChange() {
        // 季节变化：随机更新邻村繁荣状态
        const statuses = ['thriving', 'stable', 'difficult'];
        for (const vid of Object.keys(NEIGHBOR_VILLAGES)) {
            const weights = [0.25, 0.50, 0.25]; // 兴旺25% 平稳50% 困难25%
            const r = Math.random();
            if (r < weights[0]) this.state.neighbors.status[vid] = 'thriving';
            else if (r < weights[0] + weights[1]) this.state.neighbors.status[vid] = 'stable';
            else this.state.neighbors.status[vid] = 'difficult';
        }

        // 刷新可偷资源
        this._refreshStealLoot();
        // 重置偷窃记录
        this.state.neighbors._seasonStealCount = {};

        this.addLog('🔄', '季节变更，邻村形势发生了变化');
        this.bus.emit('neighborUpdate');
    }

    // ===== 好感度管理 =====

    modifyFavor(villageId, delta, reason) {
        const n = this.state.neighbors;
        if (n.favor[villageId] === undefined) return;
        const old = n.favor[villageId];
        n.favor[villageId] = Math.max(0, Math.min(100, old + delta));
        const village = NEIGHBOR_VILLAGES[villageId];
        if (village && delta !== 0) {
            const arrow = delta > 0 ? '↑' : '↓';
            this.addLog(village.icon,
                `${village.name} 好感度 ${arrow}${Math.abs(delta)}（${reason || ''}）→ ${n.favor[villageId]}`);
        }
        // 正向互动刷新最近交互时间（防止无往来衰减）
        if (delta > 0) {
            this._recordInteraction(villageId);
        }
        this.bus.emit('neighborUpdate');
    }

    getFavor(villageId) {
        return this.state.neighbors.favor[villageId] || 0;
    }

    // ===== 声望管理 =====

    addReputation(amount, reason) {
        const old = this.state.neighbors.reputation;
        const oldLevel = this.getReputationLevel();
        this.state.neighbors.reputation = Math.max(0, old + amount);
        const newLevel = this.getReputationLevel();

        if (amount > 0) {
            this.addLog('⭐', `声望 +${amount}（${reason}）→ ${this.state.neighbors.reputation}`);
        }

        // 声望升级奖励
        if (newLevel.level > oldLevel.level) {
            this.addLog('🏅', `声望提升为「${newLevel.name}」！繁荣度 +5`);
            this.bus.emit('neighborReputationUp', { level: newLevel });
            // 繁荣度加成
            if (this.state.prosperityData) {
                this.state.prosperityData.total += 5;
                this.state.prosperity = this.state.prosperityData.total;
            }
        }
        this.bus.emit('neighborUpdate');
    }

    getReputationLevel() {
        const rep = this.state.neighbors.reputation || 0;
        let current = REPUTATION_LEVELS[0];
        for (const lv of REPUTATION_LEVELS) {
            if (rep >= lv.threshold) current = lv;
        }
        return current;
    }

    // ===== 邻村贸易 =====

    /**
     * 获取某邻村的可贸易物品及价格
     * @param {string} villageId
     * @returns {Array<{itemId, name, price, direction}>}
     */
    getTradeOffers(villageId) {
        const village = NEIGHBOR_VILLAGES[villageId];
        if (!village) return [];
        const favor = this.getFavor(villageId);
        if (favor < TRADE_CONSTANTS.baseFavorForTrade) return [];

        // 好感度折扣：30→100 映射到 1.0→0.85
        const discountRange = TRADE_CONSTANTS.maxDiscountFavor - TRADE_CONSTANTS.baseFavorForTrade;
        const favorProgress = Math.min(1, (favor - TRADE_CONSTANTS.baseFavorForTrade) / discountRange);
        const discount = 1 - favorProgress * (1 - TRADE_CONSTANTS.maxDiscount);

        const season = this.state.season;
        const need = village.seasonalNeeds[season];

        const offers = [];
        // 他们卖给你的（他们擅长的 → 你便宜买）
        if (need && need.offer !== 'gold') {
            const pricing = village.tradePricing[need.offer] || 1;
            const marketRef = window.game?.market;
            const basePrice = marketRef ? Math.round(marketRef.getPrice(need.offer)) : 10;
            offers.push({
                itemId: need.offer,
                direction: 'buy',
                price: Math.round(basePrice * pricing * discount),
                quantity: TRADE_CONSTANTS.tradeQuantityPerSlot,
            });
        }

        // 他们想从你买的（他们缺的 → 你高价卖）
        if (need && need.need !== 'gold') {
            const pricing = village.tradePricing[need.need] || 1;
            const marketRef = window.game?.market;
            const basePrice = marketRef ? Math.round(marketRef.getPrice(need.need)) : 10;
            offers.push({
                itemId: need.need,
                direction: 'sell',
                price: Math.round(basePrice * pricing),
                quantity: TRADE_CONSTANTS.tradeQuantityPerSlot,
            });
        }

        // 云水乡额外：金币直接资助换好感
        if (villageId === 'yunshui' && need && need.offer === 'gold') {
            offers.push({
                itemId: 'gold_gift',
                direction: 'special',
                price: 15,
                quantity: 1,
                description: '赠送15金币，好感度+5',
            });
        }

        return offers;
    }

    /**
     * 获取某邻村今日可用贸易次数
     */
    getRemainingTrades(villageId) {
        const statusKey = this.state.neighbors.status[villageId] || 'stable';
        const statusConfig = NEIGHBOR_STATUS[statusKey];
        const repLevel = this.getReputationLevel();
        const maxTrades = (statusConfig?.tradeSlots || 1) + (repLevel.tradeBonus || 0);

        // 自由市场政策额外 +1
        const policyBonus = this.state.policies.distribution === 'freeMarket' ? 1 : 0;
        const total = maxTrades + policyBonus;

        const used = this.state.neighbors.todayTrades[villageId] || 0;
        return Math.max(0, total - used);
    }

    /**
     * 执行邻村贸易
     */
    executeTrade(villageId, offer) {
        if (this.getRemainingTrades(villageId) <= 0) {
            return { success: false, reason: '今日贸易次数已用完' };
        }

        const village = NEIGHBOR_VILLAGES[villageId];
        if (!village) return { success: false, reason: '未知邻村' };

        if (offer.direction === 'buy') {
            // 从邻村买入：花金币，得物品
            if (this.state.resources.gold < offer.price * offer.quantity) {
                return { success: false, reason: '金币不足' };
            }
            this.state.resources.gold -= offer.price * offer.quantity;
            // 加到对应库存
            if (this.state.resources[offer.itemId] !== undefined) {
                this.state.resources[offer.itemId] += offer.quantity;
            } else if (this.state.inventory[offer.itemId] !== undefined) {
                this.state.inventory[offer.itemId] += offer.quantity;
            }
            this.addLog(village.icon,
                `从${village.name}买入 ${offer.quantity} ${offer.itemId}，花费 ${offer.price * offer.quantity} 金币`);
        } else if (offer.direction === 'sell') {
            // 卖给邻村：失去物品，得金币
            let current = 0;
            if (this.state.resources[offer.itemId] !== undefined) {
                current = this.state.resources[offer.itemId];
            } else if (this.state.inventory[offer.itemId] !== undefined) {
                current = this.state.inventory[offer.itemId];
            }
            if (current < offer.quantity) {
                return { success: false, reason: '库存不足' };
            }
            if (this.state.resources[offer.itemId] !== undefined) {
                this.state.resources[offer.itemId] -= offer.quantity;
            } else {
                this.state.inventory[offer.itemId] -= offer.quantity;
            }
            this.state.resources.gold += offer.price * offer.quantity;
            this.addLog(village.icon,
                `向${village.name}卖出 ${offer.quantity} ${offer.itemId}，获得 ${offer.price * offer.quantity} 金币`);
        } else if (offer.direction === 'special') {
            // 特殊交易（金币换好感）
            if (this.state.resources.gold < offer.price) {
                return { success: false, reason: '金币不足' };
            }
            this.state.resources.gold -= offer.price;
            this.modifyFavor(villageId, 5, '赠礼');
        }

        // 记录贸易次数
        this.state.neighbors.todayTrades[villageId] =
            (this.state.neighbors.todayTrades[villageId] || 0) + 1;

        // 贸易增加少量好感和声望
        this.modifyFavor(villageId, 1, '贸易往来');
        this.addReputation(1, `与${village.name}贸易`);

        this.bus.emit('uiUpdate');
        this.bus.emit('neighborUpdate');
        this.bus.emit('marketTrade');  // 播放金币音效
        return { success: true };
    }

    // ===== 邻村事件 =====

    /** 获取当前季度标识（用于季度限制） */
    _getSeasonKey() {
        return `y${this.state.time.year}s${this.state.time.month}`;
    }

    checkNeighborEvents() {
        const today = this.state.totalDays;
        const cooldowns = this.state.neighbors.eventCooldowns;
        const seasonKey = this._getSeasonKey();

        // 季度求援计数（所有村长共享，每季最多 2 次）
        if (!this.state.neighbors._seasonRequestCount) this.state.neighbors._seasonRequestCount = {};
        const requestCount = this.state.neighbors._seasonRequestCount[seasonKey] || 0;

        // 每天最多触发 1 个邻村事件，基础触发概率 20%
        if (Math.random() > 0.20) return;

        // 筛选可触发的事件
        const eligible = NEIGHBOR_EVENTS.filter(evt => {
            if (cooldowns[evt.id] && (today - cooldowns[evt.id]) < evt.cooldown) return false;
            // 求援类事件：检查季度限额
            if (evt.type === 'request' && requestCount >= 2) return false;
            const vid = evt.village || this.getRandomVillageId();
            const favor = this.getFavor(vid);
            if (favor < (evt.minFavor || 0)) return false;
            return true;
        });

        if (eligible.length === 0) return;

        // 随机选一个
        const evt = eligible[Math.floor(Math.random() * eligible.length)];
        cooldowns[evt.id] = today;

        // 如果是求援事件，增加季度计数
        if (evt.type === 'request') {
            this.state.neighbors._seasonRequestCount[seasonKey] = requestCount + 1;
        }

        const vid = evt.village || this.getRandomVillageId();
        const village = NEIGHBOR_VILLAGES[vid];

        if (evt.type === 'request') {
            this.triggerRequestEvent(evt, vid, village);
        } else {
            this.triggerSimpleEvent(evt, vid, village);
        }
    }

    triggerSimpleEvent(evt, vid, village) {
        // 正面/负面/中性事件：直接执行 effect
        let resultText = '';
        if (evt.effect) {
            resultText = evt.effect(this.state);
        }

        const fullDesc = `${evt.description}\n${resultText}`;
        this.addLog(evt.icon, `【${village?.name || '邻村'}】${evt.name}：${resultText}`);
        this.state.addLog(evt.icon, `${evt.name}：${resultText}`, 'info');

        // 弹窗通知
        if (this.ui) {
            this.ui.showToast(`${evt.icon} ${evt.name}：${resultText}`, 'info');
        }

        this.bus.emit('uiUpdate');
        this.bus.emit('neighborUpdate');
    }

    triggerRequestEvent(evt, vid, village) {
        // 互助请求事件：弹窗让玩家选择
        this.addLog(evt.icon, `【${village.name}】${evt.name}：${evt.description}`);

        // 检查是否有足够资源
        let canHelp = true;
        if (evt.cost) {
            for (const [res, amount] of Object.entries(evt.cost)) {
                if (res === 'gold' && this.state.resources.gold < amount) canHelp = false;
                else if (res === 'wood' && this.state.resources.wood < amount) canHelp = false;
                else if (res === 'stone' && this.state.resources.stone < amount) canHelp = false;
                else if (this.state.inventory[res] !== undefined && this.state.inventory[res] < amount) canHelp = false;
            }
        }

        const RN = NeighborSystem.RES_NAMES;
        const RI = NeighborSystem.RES_ICONS;
        const costDesc = evt.cost
            ? Object.entries(evt.cost).map(([k, v]) => `${v} ${RI[k] || ''}${RN[k] || k}`).join(' + ')
            : '';

        if (this.ui) {
            this.ui.showModal(
                `${evt.icon} ${village.name}：${evt.name}`,
                `<div style="line-height:1.8;">${evt.description}<br><br>` +
                `需要支援：<b>${costDesc}</b><br>` +
                `回报：好感度 +${evt.reward.favor}，声望 +${evt.reward.reputation}` +
                (evt.delayedReward ? `<br>🎁 ${evt.delayedReward.day}天后会有回赠` : '') +
                `</div>`,
                canHelp ? [
                    {
                        id: 'help', text: '🤝 伸出援手',
                        class: 'btn-primary',
                        onClick: () => {
                            // 扣除资源
                            if (evt.cost) {
                                for (const [res, amount] of Object.entries(evt.cost)) {
                                    if (res === 'gold') this.state.resources.gold -= amount;
                                    else if (res === 'wood') this.state.resources.wood -= amount;
                                    else if (res === 'stone') this.state.resources.stone -= amount;
                                    else if (this.state.inventory[res] !== undefined) this.state.inventory[res] -= amount;
                                }
                            }
                            this.modifyFavor(vid, evt.reward.favor, `援助：${evt.name}`);
                            this.addReputation(evt.reward.reputation, `援助${village.name}`);

                            // 延迟回报
                            if (evt.delayedReward) {
                                this.state.neighbors.delayedRewards.push({
                                    dueDay: this.state.totalDays + evt.delayedReward.day,
                                    village: vid,
                                    reward: evt.delayedReward,
                                    eventName: evt.name,
                                });
                            }
                            this.bus.emit('uiUpdate');
                            this.bus.emit('neighborUpdate');
                        },
                    },
                    {
                        id: 'refuse', text: '🙅 婉言拒绝', class: 'btn-secondary',
                        onClick: () => {
                            if (evt.refusePenalty) {
                                this.modifyFavor(vid, evt.refusePenalty.favor, `拒绝援助`);
                            }
                            this.bus.emit('neighborUpdate');
                        },
                    },
                ] : [
                    {
                        id: 'cant', text: '❌ 资源不足，无法援助', class: 'btn-secondary',
                        onClick: () => {
                            if (evt.refusePenalty) {
                                this.modifyFavor(vid, evt.refusePenalty.favor, `无力援助`);
                            }
                            this.bus.emit('neighborUpdate');
                        },
                    },
                ]
            );
        }
    }

    // ===== 邻村主动赠送（AI 驱动，好感度越高越频繁） =====

    checkNeighborAid() {
        const seasonKey = this._getSeasonKey();

        // 初始化本季赠送记录（每村每季最多 1 次）
        if (!this.state.neighbors._seasonGiftReceived) {
            this.state.neighbors._seasonGiftReceived = {};
        }

        // 遍历每个邻村，看是否触发主动赠送
        for (const [vid, config] of Object.entries(NEIGHBOR_VILLAGES)) {
            const giftKey = `${vid}_${seasonKey}`;
            if (this.state.neighbors._seasonGiftReceived[giftKey]) continue; // 本季已送过

            const favor = this.getFavor(vid);
            if (favor < 35) continue; // 好感度太低不会送

            // 触发概率随好感度递增：好感25→5%, 50→12%, 75→20%, 100→28%
            const chance = 0.02 + (favor / 100) * 0.26;
            if (Math.random() > chance) continue;

            // 标记本季已送
            this.state.neighbors._seasonGiftReceived[giftKey] = true;

            // 用 AI 决定送什么
            this._generateAidGift(vid, config, favor);
            break; // 每天最多处理 1 个赠送
        }
    }

    /** AI 决定邻村赠送的资源 */
    async _generateAidGift(villageId, config, favor) {
        const leaderName = this._getLeaderName(villageId);
        const village = config;
        const RN = NeighborSystem.RES_NAMES;
        const RI = NeighborSystem.RES_ICONS;

        let giftResource = null;
        let giftAmount = 0;
        let giftReason = '';

        if (this.ai) {
            // 用 AI 生成赠送内容
            const prompt = `你是${village.name}的${leaderName}村长，性格：${village.personality}。
你的村庄擅长${village.strength}，缺少${village.weakness}。
与桃源村的好感度：${favor}/100。

你决定主动给桃源村送一份礼物。根据你的村庄特色，从以下资源中选一个送出：
gold(金币)、wheat(小麦)、wood(木材)、stone(石料)、radish(萝卜)、potato(土豆)

规则：
• 只送你擅长/充裕的资源，不送你缺的
• 数量 = 好感度越高送越多（好感25-40送3-5个，41-60送5-8个，61-80送8-12个，81+送10-15个）
• 写一句送礼时说的话（15-30字，体现性格）

输出JSON：{"resource":"wheat","amount":5,"message":"最近收成不错，给你们送点粮食过来~"}`;

            try {
                const result = await this.ai.chat(prompt, { temperature: 0.8, maxTokens: 100 });
                if (result && result.resource && result.amount > 0) {
                    giftResource = result.resource;
                    giftAmount = result.amount;
                    giftReason = result.message || `${leaderName}村长送来了一些${RN[giftResource] || giftResource}`;
                }
            } catch (e) {
                console.warn('[NeighborAid] AI生成失败，使用降级', e);
            }
        }

        // AI 失败时使用降级逻辑
        if (!giftResource) {
            const fallbackMap = {
                fenggu: { resource: 'wheat', base: 5 },
                tieling: { resource: 'wood', base: 4 },
                yunshui: { resource: 'gold', base: 8 },
            };
            const fb = fallbackMap[villageId] || { resource: 'wheat', base: 3 };
            giftResource = fb.resource;
            const scale = favor >= 80 ? 2.5 : favor >= 60 ? 2 : favor >= 40 ? 1.5 : 1;
            giftAmount = Math.round(fb.base * scale);
            giftReason = `${leaderName}村长派人送来了一些${RN[giftResource] || giftResource}，说是感谢你们一直以来的友好往来。`;
        }

        const resName = RN[giftResource] || giftResource;
        const resIcon = RI[giftResource] || '📦';

        this.addLog('🎁', `【${village.name}】${leaderName}村长主动送来 ${giftAmount} ${resIcon}${resName}`);

        // 弹窗让玩家选择接受或拒绝
        if (this.ui) {
            this.ui.showModal(
                `🎁 ${village.name} · ${leaderName}村长送来礼物`,
                `<div style="line-height:1.8;text-align:center;">
                    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">
                        「${giftReason}」
                    </div>
                    <div style="font-size:28px;margin:12px 0;">${resIcon} ${giftAmount} ${resName}</div>
                    <div style="font-size:12px;color:var(--text-muted);">
                        当前好感度：${favor}/100
                    </div>
                </div>`,
                [
                    {
                        id: 'accept', text: '😊 收下礼物', class: 'btn-primary',
                        onClick: () => {
                            this._addResource(giftResource, giftAmount);
                            this.modifyFavor(villageId, 2, '收下赠礼');
                            this.state.addLog('🎁', `收下了${village.name}送来的 ${giftAmount} ${resIcon}${resName}`, 'success');
                            this.bus.emit('uiUpdate');
                            this.bus.emit('neighborUpdate');
                        },
                    },
                    {
                        id: 'decline', text: '🙏 婉拒好意', class: 'btn-secondary',
                        onClick: () => {
                            this.modifyFavor(villageId, -1, '婉拒赠礼');
                            this.state.addLog('🎁', `婉拒了${village.name}的赠礼`, 'info');
                            this.bus.emit('neighborUpdate');
                        },
                    },
                ]
            );
        }
    }

    // ===== 延迟回报 =====

    processDelayedRewards() {
        const today = this.state.totalDays;
        const pending = this.state.neighbors.delayedRewards;
        const due = pending.filter(r => today >= r.dueDay);

        for (const reward of due) {
            const village = NEIGHBOR_VILLAGES[reward.village];
            const r = reward.reward;
            const gains = [];

            if (r.seeds) {
                for (const [seed, count] of Object.entries(r.seeds)) {
                    this.state.resources.seeds[seed] = (this.state.resources.seeds[seed] || 0) + count;
                    gains.push(`${count}种子(${seed})`);
                }
            }
            if (r.resources) {
                for (const [res, amount] of Object.entries(r.resources)) {
                    if (res === 'gold') this.state.resources.gold += amount;
                    else if (res === 'wood') this.state.resources.wood += amount;
                    else if (res === 'stone') this.state.resources.stone += amount;
                    else if (this.state.inventory[res] !== undefined) this.state.inventory[res] += amount;
                    gains.push(`${amount} ${res}`);
                }
            }

            const gainText = gains.join(' + ') || '感谢';
            this.addLog('🎁',
                `${village?.name || '邻村'}回赠：${gainText}（感谢之前的${reward.eventName}援助）`);
            this.state.addLog('🎁',
                `${village?.name || '邻村'}回赠到达：${gainText}`, 'success');
        }

        this.state.neighbors.delayedRewards = pending.filter(r => today < r.dueDay);

        if (due.length > 0) {
            this.bus.emit('uiUpdate');
            this.bus.emit('neighborUpdate');
        }
    }

    // ===== 政策影响 =====

    applyPolicyFavorEffects() {
        const policies = this.state.policies;
        let totalDelta = 0;
        const messages = [];

        // 工时政策
        const whEffect = POLICY_FAVOR_EFFECTS.workHours[policies.workHours];
        if (whEffect && whEffect.favorDelta !== 0) {
            totalDelta += whEffect.favorDelta;
            if (whEffect.message) messages.push(whEffect.message);
        }

        // 休假政策
        const holEffect = POLICY_FAVOR_EFFECTS.holiday[policies.holiday];
        if (holEffect && holEffect.favorDelta !== 0) {
            totalDelta += holEffect.favorDelta;
            if (holEffect.message) messages.push(holEffect.message);
        }

        if (totalDelta !== 0) {
            for (const vid of Object.keys(NEIGHBOR_VILLAGES)) {
                this.modifyFavor(vid, totalDelta,
                    `政策影响：${messages.join('、') || '政策评价'}`);
            }
        }
    }

    /** 渲染偷窃区域 */
    _renderStealSection(villageId, villageName) {
        const loot = this.getStealLoot(villageId);
        const canDo = this.canSteal(villageId);

        if (loot.length === 0 && !canDo) {
            return `<div style="margin-top:6px;font-size:11px;color:var(--text-muted);">🤫 本季已无可偷资源</div>`;
        }

        let html = `<div style="margin-top:8px;font-size:12px;">
            <div style="color:var(--text-muted);margin-bottom:4px;">🤫 可偷资源${!canDo ? '（本季已偷过）' : ''}：</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">`;

        for (let i = 0; i < loot.length; i++) {
            const item = loot[i];
            html += `<button class="btn btn-sm" style="font-size:11px;padding:2px 8px;
                background:rgba(198,40,40,0.08);border:1px solid rgba(198,40,40,0.25);color:#c62828;"
                ${!canDo ? 'disabled' : ''}
                data-steal-village="${villageId}" data-steal-index="${i}"
                title="偷走 ${item.amount} ${item.name}（好感度 ${STEAL_CONSTANTS.favorPenalty}）">
                ${item.icon} ${item.amount}${item.name}
            </button>`;
        }

        html += `</div></div>`;
        return html;
    }

    // ===== 偷窃系统 =====

    /** 刷新每个邻村本季可偷的资源（从池中随机选 2 个） */
    _refreshStealLoot() {
        if (!this.state.neighbors._stealLoot) this.state.neighbors._stealLoot = {};
        const RN = NeighborSystem.RES_NAMES;
        const RI = NeighborSystem.RES_ICONS;

        for (const vid of Object.keys(NEIGHBOR_VILLAGES)) {
            const pool = STEAL_LOOT_POOLS[vid] || [];

            // 池子≤2项时全部展示（如铁岭镇的木材+石料），>2项时随机选2项
            const available = [...pool];
            const pickCount = available.length <= 2 ? available.length : 2;
            const selected = [];

            // 先打乱顺序再取前 pickCount 个（保证随机性）
            for (let i = available.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [available[i], available[j]] = [available[j], available[i]];
            }

            for (let i = 0; i < pickCount; i++) {
                const item = available[i];
                const amount = item.min + Math.floor(Math.random() * (item.max - item.min + 1));
                selected.push({
                    resource: item.resource,
                    amount,
                    name: RN[item.resource] || item.resource,
                    icon: RI[item.resource] || '📦',
                });
            }

            this.state.neighbors._stealLoot[vid] = selected;
        }
    }

    /** 获取某邻村本季可偷的资源 */
    getStealLoot(villageId) {
        if (!this.state.neighbors._stealLoot) this._refreshStealLoot();
        return this.state.neighbors._stealLoot[villageId] || [];
    }

    /** 本季是否还能偷某邻村 */
    canSteal(villageId) {
        const seasonKey = this._getSeasonKey();
        if (!this.state.neighbors._seasonStealCount) this.state.neighbors._seasonStealCount = {};
        const count = this.state.neighbors._seasonStealCount[`${villageId}_${seasonKey}`] || 0;
        return count < STEAL_CONSTANTS.maxPerSeason;
    }

    /** 执行偷窃 */
    stealFrom(villageId, lootIndex) {
        const village = NEIGHBOR_VILLAGES[villageId];
        if (!village) return { success: false, reason: '未知邻村' };

        const seasonKey = this._getSeasonKey();
        if (!this.state.neighbors._seasonStealCount) this.state.neighbors._seasonStealCount = {};
        const stealKey = `${villageId}_${seasonKey}`;
        const count = this.state.neighbors._seasonStealCount[stealKey] || 0;
        if (count >= STEAL_CONSTANTS.maxPerSeason) {
            return { success: false, reason: '本季已偷过该村庄' };
        }

        const loot = this.getStealLoot(villageId);
        if (!loot[lootIndex]) return { success: false, reason: '无可偷资源' };

        const item = loot[lootIndex];

        // 获得资源
        this._addResource(item.resource, item.amount);

        // 记录偷窃次数
        this.state.neighbors._seasonStealCount[stealKey] = count + 1;

        // 好感度惩罚（固定惩罚）
        this.modifyFavor(villageId, STEAL_CONSTANTS.favorPenalty, '偷窃行为');

        // 是否被发现（额外惩罚）
        const detected = Math.random() < STEAL_CONSTANTS.detectChance;
        if (detected) {
            this.modifyFavor(villageId, STEAL_CONSTANTS.detectFavorExtra, '偷窃被发现');
            this.addReputation(-3, `在${village.name}偷窃被发现`);
        }

        // 记录到邻村对话上下文（村长会记住）
        this._ensureChatStorage(villageId);
        if (!this.state.neighbors._stealRecords) this.state.neighbors._stealRecords = {};
        if (!this.state.neighbors._stealRecords[villageId]) this.state.neighbors._stealRecords[villageId] = [];
        this.state.neighbors._stealRecords[villageId].push({
            resource: item.resource,
            amount: item.amount,
            detected,
            season: this.state.seasonName,
            day: this.state.totalDays,
        });

        // 日志
        const detectText = detected
            ? `⚠️ 被${village.name}发现了！好感度大幅下降！`
            : `未被发现。`;
        this.addLog('🤫',
            `从${village.name}偷走了 ${item.amount} ${item.icon}${item.name}。${detectText}`);
        this.state.addLog('🤫',
            `偷窃${village.name}：获得 ${item.amount} ${item.icon}${item.name}${detected ? '（被发现！）' : ''}`,
            detected ? 'danger' : 'warning');

        this.bus.emit('uiUpdate');
        this.bus.emit('neighborUpdate');
        return { success: true, detected, item };
    }

    // ===== 赠礼系统 =====

    /**
     * 获取某邻村今日剩余赠礼次数
     */
    getRemainingGifts(villageId) {
        const used = (this.state.neighbors.todayGifts || {})[villageId] || 0;
        return Math.max(0, (TRADE_CONSTANTS.maxGiftsPerDay || 2) - used);
    }

    /**
     * 向邻村赠礼
     * @param {string} villageId - 邻村ID
     * @param {string} giftId - 礼物ID (gift_gold / gift_wheat / ...)
     * @returns {{ success: boolean, reason?: string }}
     */
    sendGift(villageId, giftId) {
        const village = NEIGHBOR_VILLAGES[villageId];
        if (!village) return { success: false, reason: '未知邻村' };

        if (this.getRemainingGifts(villageId) <= 0) {
            return { success: false, reason: '今日赠礼次数已用完（每村每天2次）' };
        }

        const gift = GIFT_OPTIONS.find(g => g.id === giftId);
        if (!gift) return { success: false, reason: '未知礼物' };

        // 检查资源
        for (const [res, amount] of Object.entries(gift.cost)) {
            if (res === 'gold' && this.state.resources.gold < amount) {
                return { success: false, reason: '金币不足' };
            }
            if (res === 'wood' && this.state.resources.wood < amount) {
                return { success: false, reason: '木材不足' };
            }
            if (res === 'stone' && this.state.resources.stone < amount) {
                return { success: false, reason: '石料不足' };
            }
            if (this.state.inventory[res] !== undefined && this.state.inventory[res] < amount) {
                return { success: false, reason: `${res}不足` };
            }
        }

        // 扣除资源
        for (const [res, amount] of Object.entries(gift.cost)) {
            if (res === 'gold') this.state.resources.gold -= amount;
            else if (res === 'wood') this.state.resources.wood -= amount;
            else if (res === 'stone') this.state.resources.stone -= amount;
            else if (this.state.inventory[res] !== undefined) this.state.inventory[res] -= amount;
        }

        // 增加好感和声望
        this.modifyFavor(villageId, gift.favorGain, `赠礼：${gift.name}`);
        this.addReputation(gift.reputationGain, `向${village.name}赠礼`);

        // 记录次数
        if (!this.state.neighbors.todayGifts) this.state.neighbors.todayGifts = {};
        this.state.neighbors.todayGifts[villageId] =
            (this.state.neighbors.todayGifts[villageId] || 0) + 1;

        this.bus.emit('uiUpdate');
        this.bus.emit('neighborUpdate');
        this.bus.emit('marketTrade');  // 播放金币音效
        return { success: true };
    }

    // ===== 辅助方法 =====

    getRandomVillageId() {
        const ids = Object.keys(NEIGHBOR_VILLAGES);
        return ids[Math.floor(Math.random() * ids.length)];
    }

    addLog(icon, text) {
        const log = this.state.neighbors.log;
        log.unshift({
            icon,
            text,
            day: this.state.totalDays,
            time: `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天`,
            timestamp: Date.now(),
        });
        // 保留最近 30 条
        if (log.length > 30) log.length = 30;
    }

    /** 获取所有邻村概览数据（供 UI 使用） */
    getOverview() {
        const result = [];
        for (const [vid, config] of Object.entries(NEIGHBOR_VILLAGES)) {
            const statusKey = this.state.neighbors.status[vid] || 'stable';
            const statusConfig = NEIGHBOR_STATUS[statusKey];
            result.push({
                ...config,
                favor: this.getFavor(vid),
                status: statusKey,
                statusName: statusConfig.name,
                statusIcon: statusConfig.icon,
                tradeUnlocked: this.getFavor(vid) >= TRADE_CONSTANTS.baseFavorForTrade,
                remainingTrades: this.getRemainingTrades(vid),
            });
        }
        return result;
    }

    // ===== UI 面板生命周期 =====

    onActivate() { this.render(); }

    render() {
        const container = document.getElementById('neighbor-panel-root');
        if (!container) return;

        const overview = this.getOverview();
        const repLevel = this.getReputationLevel();
        const log = this.state.neighbors.log.slice(0, 15);

        // 物品名映射
        const itemNames = {
            wheat: '小麦🌾', radish: '萝卜🥕', potato: '土豆🥔', pumpkin: '南瓜🎃',
            wood: '木材🪵', stone: '石料🪨', gold: '金币💰',
            cotton: '棉花', grape: '葡萄🍇', flour: '面粉', bread: '面包🍞',
            crucianCarp: '鲫鱼🐟', grassCarp: '草鱼', commonCarp: '鲤鱼',
            koi: '锦鲤🎏', gold_gift: '金币赠礼',
        };

        let html = `
            <h3 style="margin-bottom:var(--spacing-sm);">🏘️ 邻村往来</h3>
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <div class="card" style="flex:1;min-width:120px;padding:8px 12px;font-size:13px;">
                    <b>${repLevel.icon} 声望</b>：${repLevel.name}（${this.state.neighbors.reputation}）
                </div>
            </div>
        `;

        // 邻村卡片
        html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">`;
        for (const v of overview) {
            const favorColor = v.favor >= 60 ? 'var(--color-success,#43a047)' :
                              v.favor >= 30 ? 'var(--accent,#8d6e63)' : 'var(--color-danger,#e74c3c)';

            // === 赠礼按钮（始终可用） ===
            const remainGifts = this.getRemainingGifts(v.id);
            let giftHTML = `<div style="margin-top:8px;font-size:12px;">
                <div style="color:var(--text-secondary);margin-bottom:4px;">🎁 赠礼（今日剩余${remainGifts}次）：</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;">`;
            for (const gift of GIFT_OPTIONS) {
                const costText = Object.entries(gift.cost).map(([k, amt]) => `${amt}${itemNames[k] || k}`).join('+');
                giftHTML += `<button class="btn btn-sm btn-secondary" style="font-size:11px;padding:2px 8px;"
                    ${remainGifts <= 0 ? 'disabled' : ''}
                    data-gift-village="${v.id}" data-gift-id="${gift.id}"
                    title="${gift.description}（好感+${gift.favorGain}）">
                    ${gift.icon} ${costText}
                </button>`;
            }
            giftHTML += `</div></div>`;

            // === 贸易按钮 ===
            const tradeOffers = this.getTradeOffers(v.id);
            let tradeHTML = '';
            if (v.tradeUnlocked && tradeOffers.length > 0) {
                tradeHTML = `<div style="margin-top:8px;font-size:12px;">
                    <div style="color:var(--text-secondary);margin-bottom:4px;">📦 贸易（剩余${v.remainingTrades}次）：</div>`;
                for (const offer of tradeOffers) {
                    const label = offer.direction === 'buy'
                        ? `买入 ${offer.quantity} ${itemNames[offer.itemId] || offer.itemId}（${offer.price * offer.quantity}💰）`
                        : offer.direction === 'sell'
                        ? `卖出 ${offer.quantity} ${itemNames[offer.itemId] || offer.itemId}（${offer.price * offer.quantity}💰）`
                        : offer.description || '特殊交易';
                    const btnClass = v.remainingTrades > 0 ? 'btn-primary' : 'btn-secondary';
                    tradeHTML += `<button class="btn btn-sm ${btnClass}" style="margin:2px 0;width:100%;font-size:11px;"
                        ${v.remainingTrades <= 0 ? 'disabled' : ''}
                        data-trade-village="${v.id}"
                        data-trade-item="${offer.itemId}"
                        data-trade-dir="${offer.direction}"
                        data-trade-price="${offer.price}"
                        data-trade-qty="${offer.quantity}">
                        ${offer.direction === 'buy' ? '🛒' : offer.direction === 'sell' ? '💰' : '🎁'} ${label}
                    </button>`;
                }
                tradeHTML += `</div>`;
            } else if (!v.tradeUnlocked) {
                tradeHTML = `<div style="margin-top:6px;font-size:11px;color:var(--text-muted);">🔒 好感度≥${TRADE_CONSTANTS.baseFavorForTrade}解锁贸易</div>`;
            }

            html += `
            <div class="card" style="flex:1;min-width:200px;padding:12px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="font-size:24px;">${v.icon}</span>
                    <div>
                        <div style="font-weight:600;">${v.name} <span style="font-size:11px;color:var(--text-secondary);">${v.statusIcon} ${v.statusName}</span></div>
                        <div style="font-size:11px;color:var(--text-secondary);">${v.description}</div>
                    </div>
                </div>
                <div style="margin-bottom:4px;font-size:12px;">
                    好感度：<span style="color:${favorColor};font-weight:600;">${v.favor}</span>/100
                </div>
                <div style="background:var(--panel-border,#e0dcd4);border-radius:4px;height:6px;overflow:hidden;">
                    <div style="height:100%;width:${v.favor}%;background:${favorColor};border-radius:4px;transition:width 0.3s;"></div>
                </div>
                ${giftHTML}
                ${tradeHTML}
                <button class="btn btn-sm btn-gold" style="margin-top:8px;width:100%;"
                    data-chat-village="${v.id}">
                    💬 拜访${v.name}村长
                </button>
                ${this._renderStealSection(v.id, v.name)}
            </div>`;
        }
        html += `</div>`;

        // 动态日志
        html += `<div class="card" style="padding:10px;">
            <div style="font-weight:600;font-size:13px;margin-bottom:8px;">📜 往来记录</div>
            <div style="max-height:200px;overflow-y:auto;font-size:12px;line-height:1.8;">`;
        if (log.length === 0) {
            html += `<div style="color:var(--text-muted);">暂无往来记录</div>`;
        } else {
            for (const entry of log) {
                html += `<div style="border-bottom:1px solid var(--panel-border,#eee);padding:3px 0;">
                    <span style="color:var(--text-muted);font-size:11px;">${entry.time}</span>
                    ${entry.icon} ${entry.text}
                </div>`;
            }
        }
        html += `</div></div>`;

        container.innerHTML = html;

        // 绑定赠礼按钮事件
        container.querySelectorAll('[data-gift-village]').forEach(btn => {
            btn.addEventListener('click', () => {
                const vid = btn.dataset.giftVillage;
                const giftId = btn.dataset.giftId;
                const result = this.sendGift(vid, giftId);
                if (result.success) {
                    this.render();
                } else {
                    this.ui?.showToast(`❌ ${result.reason}`, 'warning');
                }
            });
        });

        // 绑定偷窃按钮事件
        container.querySelectorAll('[data-steal-village]').forEach(btn => {
            btn.addEventListener('click', () => {
                const vid = btn.dataset.stealVillage;
                const idx = parseInt(btn.dataset.stealIndex);
                const village = NEIGHBOR_VILLAGES[vid];
                const loot = this.getStealLoot(vid);
                const item = loot[idx];
                if (!item) return;

                // 确认弹窗
                if (this.ui) {
                    this.ui.showModal(
                        `🤫 偷窃 ${village.name}`,
                        `<div style="text-align:center;line-height:1.8;">
                            <p>确定要偷走 ${village.name} 的资源吗？</p>
                            <div style="font-size:24px;margin:12px 0;">${item.icon} ${item.amount} ${item.name}</div>
                            <p style="color:var(--color-danger,#e74c3c);font-size:13px;">
                                ⚠️ 好感度 ${STEAL_CONSTANTS.favorPenalty}<br>
                                ${Math.round(STEAL_CONSTANTS.detectChance * 100)}% 概率被发现（额外 ${STEAL_CONSTANTS.detectFavorExtra} 好感度）<br>
                                村长会记住你的行为！
                            </p>
                        </div>`,
                        [
                            { id: 'steal', text: '🤫 动手', class: 'btn-danger', onClick: () => {
                                const result = this.stealFrom(vid, idx);
                                if (result.success) {
                                    const msg = result.detected
                                        ? `偷到了 ${result.item.amount} ${result.item.icon}${result.item.name}，但被发现了！`
                                        : `成功偷到 ${result.item.amount} ${result.item.icon}${result.item.name}，未被察觉。`;
                                    this.ui.showToast(result.detected ? `😱 ${msg}` : `🤫 ${msg}`,
                                        result.detected ? 'danger' : 'warning');
                                    this.render();
                                } else {
                                    this.ui.showToast(`❌ ${result.reason}`, 'warning');
                                }
                            }},
                            { id: 'cancel', text: '算了', class: 'btn-secondary', onClick: () => {} },
                        ]
                    );
                }
            });
        });

        // 绑定对话按钮事件
        container.querySelectorAll('[data-chat-village]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openChat(btn.dataset.chatVillage);
            });
        });

        // 绑定贸易按钮事件
        container.querySelectorAll('[data-trade-village]').forEach(btn => {
            btn.addEventListener('click', () => {
                const vid = btn.dataset.tradeVillage;
                const offer = {
                    itemId: btn.dataset.tradeItem,
                    direction: btn.dataset.tradeDir,
                    price: parseInt(btn.dataset.tradePrice),
                    quantity: parseInt(btn.dataset.tradeQty),
                };
                const result = this.executeTrade(vid, offer);
                if (result.success) {
                    this.render();
                } else {
                    this.ui?.showToast(`❌ ${result.reason}`, 'warning');
                }
            });
        });
    }

    // ================================================================
    //  邻村村长对话系统
    // ================================================================

    /** 资源名称映射 */
    static RES_NAMES = {
        gold: '金币', wheat: '小麦', wood: '木材', stone: '石料',
        radish: '萝卜', potato: '土豆', pumpkin: '南瓜', cotton: '棉花', grape: '葡萄',
        flour: '面粉', bread: '面包',
    };
    static RES_ICONS = {
        gold: '💰', wheat: '🌾', wood: '🪵', stone: '🪨',
        radish: '🥕', potato: '🥔', pumpkin: '🎃', flour: '🫘', bread: '🍞',
    };

    /** 确保聊天记录存储结构存在 */
    _ensureChatStorage(villageId) {
        const n = this.state.neighbors;
        if (!n.chatHistory) n.chatHistory = {};
        if (!n.chatHistory[villageId]) n.chatHistory[villageId] = [];
        if (!n.chatMemory) n.chatMemory = {};
        if (!n.chatMemory[villageId]) n.chatMemory[villageId] = [];
    }

    /** 保存一条对话记录 */
    _saveChatMessage(villageId, playerText, leaderText) {
        this._ensureChatStorage(villageId);
        const history = this.state.neighbors.chatHistory[villageId];
        history.push({
            player: playerText,
            leader: leaderText,
            time: `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天 ${String(this.state.time.hour).padStart(2, '0')}:00`,
            day: this.state.totalDays,
        });
        // 保留最近 20 条
        if (history.length > 20) history.shift();
        this.bus.emit('dialogueSaved', { type: 'neighbor', villageId });
    }

    /** 获取近期对话文本（供 AI Prompt） */
    _getRecentChatText(villageId, maxCount = 5) {
        this._ensureChatStorage(villageId);
        const history = this.state.neighbors.chatHistory[villageId];
        const leaderName = this._getLeaderName(villageId);
        const recent = history.slice(-maxCount);
        if (recent.length === 0) return '';
        return recent.map(d =>
            `桃源村村长: "${d.player}" → ${leaderName}: "${d.leader}"`
        ).join('\n');
    }

    /** 获取往季记忆摘要（压缩后的） */
    _getPreviousMemory(villageId) {
        this._ensureChatStorage(villageId);
        const memories = this.state.neighbors.chatMemory[villageId];
        if (!memories || memories.length === 0) return '';
        return memories.map(m => m.summary || '').filter(Boolean).join('；');
    }

    /** 打开与邻村村长的对话窗口 */
    openChat(villageId) {
        const village = NEIGHBOR_VILLAGES[villageId];
        if (!village) return;
        this._ensureChatStorage(villageId);

        const favor = this.getFavor(villageId);
        const leaderName = this._getLeaderName(villageId);
        const chatHistory = this.state.neighbors.chatHistory[villageId];

        // 创建 modal 遮罩
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
        <div class="modal fade-in" style="max-width:520px;max-height:85vh;display:flex;flex-direction:column;">
            <div class="modal-title" style="display:flex;justify-content:space-between;align-items:center;">
                <span>${village.icon} 拜访${village.name} · ${leaderName}村长</span>
                <span style="font-size:12px;color:var(--text-secondary);">好感度 ${favor}/100</span>
            </div>
            <div id="nb-chat-messages" style="flex:1;overflow-y:auto;min-height:200px;max-height:400px;
                padding:10px;border:1px solid var(--panel-border,#e2ddd4);border-radius:8px;
                margin-bottom:10px;background:var(--bg-card,#faf8f4);">
            </div>
            <div id="nb-chat-exchange" style="display:none;margin-bottom:10px;"></div>
            <div id="nb-chat-suggestions" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>
            <div style="display:flex;gap:8px;">
                <input type="text" id="nb-chat-input" placeholder="跟${leaderName}村长说点什么..."
                    maxlength="200" style="flex:1;padding:8px 12px;border:1px solid var(--panel-border,#d5cfc5);
                    border-radius:8px;font-size:13px;background:var(--bg-card,#fff);">
                <button class="btn btn-primary send-btn" id="nb-chat-send">📨 发送</button>
            </div>
            <div style="margin-top:8px;text-align:right;">
                <button class="btn btn-secondary btn-sm nb-chat-close">离开</button>
            </div>
        </div>`;

        overlay.querySelector('.nb-chat-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const messagesArea = overlay.querySelector('#nb-chat-messages');
        const inputField = overlay.querySelector('#nb-chat-input');
        const sendBtn = overlay.querySelector('#nb-chat-send');
        const exchangeArea = overlay.querySelector('#nb-chat-exchange');
        const suggestionsArea = overlay.querySelector('#nb-chat-suggestions');

        // ===== 加载历史对话记录 =====
        if (chatHistory.length > 0) {
            // 显示分隔线 + 历史记录（最近 8 条）
            const historyToShow = chatHistory.slice(-8);
            this._addChatBubble(messagesArea, '', '', '', 'divider',
                `— 以往对话记录（${chatHistory.length}条） —`);
            for (const entry of historyToShow) {
                this._addChatBubble(messagesArea, '你', '👤', entry.player, 'player-history');
                this._addChatBubble(messagesArea, leaderName, village.icon, entry.leader, 'npc-history');
            }
            this._addChatBubble(messagesArea, '', '', '', 'divider',
                `— 今日拜访 —`);
        } else {
            this._addChatBubble(messagesArea, '', '', '', 'divider',
                `— 你来到了${village.name}，${leaderName}村长接待了你 —`);
        }

        // AI 生成初始开场白
        (async () => {
            sendBtn.disabled = true;
            inputField.disabled = true;
            inputField.placeholder = `${leaderName}村长正在打招呼...`;

            let greetText = this._getGreeting(villageId, favor); // 静态降级

            if (this.ai) {
                try {
                    const greetPrompt = this._buildGreetingPrompt(villageId);
                    const result = await this.ai.chat(greetPrompt, { temperature: 0.9, maxTokens: 120 });
                    if (result?.text) greetText = result.text;
                } catch (e) {
                    console.warn('[NeighborChat] 开场白AI生成失败，使用降级', e);
                }
            }

            if (!greetText) greetText = '……（点头示意）';
            this._addChatBubble(messagesArea, leaderName, village.icon, greetText, 'npc');

            sendBtn.disabled = false;
            inputField.disabled = false;
            inputField.placeholder = `跟${leaderName}村长说点什么...`;
            inputField.focus();

            // 生成建议回复
            this._generateSuggestions(villageId, greetText, suggestionsArea, inputField);
        })();

        // 发送逻辑
        const doSend = async () => {
            const text = inputField.value.trim();
            if (!text || this._chatSending) return;

            inputField.value = '';
            this._chatSending = true;
            sendBtn.disabled = true;
            sendBtn.textContent = '⏳ ...';

            // 显示玩家消息
            this._addChatBubble(messagesArea, '你', '👤', text, 'player');

            // 检测玩家是否在主动赠送/给予资源
            const playerOffer = this._parseResourceOffer(text);
            if (playerOffer) {
                this._handlePlayerOffer(playerOffer, villageId, village, messagesArea, exchangeArea);
                this._chatSending = false;
                sendBtn.disabled = false;
                sendBtn.textContent = '📨 发送';
                return;
            }

            // 调用 AI 生成回复
            let replyText = '';
            try {
                const reply = await this._generateLeaderReply(villageId, text);
                if (reply) {
                    replyText = reply.text;
                    this._addChatBubble(messagesArea, leaderName, village.icon, reply.text, 'npc');

                    // 好感度变化
                    if (reply.favorDelta && reply.favorDelta !== 0) {
                        this.modifyFavor(villageId, reply.favorDelta,
                            reply.favorDelta > 0 ? '愉快交谈' : '言语不当');
                    }

                    // 检测村长是否在请求资源
                    if (reply.request) {
                        this._showExchangeUI(exchangeArea, messagesArea, villageId,
                            reply.request, 'theyRequest', leaderName, village);
                    }
                    // 检测村长是否主动赠送资源
                    if (reply.offer) {
                        this._showExchangeUI(exchangeArea, messagesArea, villageId,
                            reply.offer, 'theyOffer', leaderName, village);
                    }
                } else {
                    replyText = this._getFallbackReply(villageId, favor);
                    this._addChatBubble(messagesArea, leaderName, village.icon, replyText, 'npc');
                }
            } catch (e) {
                console.warn('[NeighborChat] AI回复失败:', e);
                replyText = this._getFallbackReply(villageId, favor);
                this._addChatBubble(messagesArea, leaderName, village.icon, replyText, 'npc');
            }

            // 保存对话记录 + 刷新互动时间
            if (replyText) {
                this._saveChatMessage(villageId, text, replyText);
                this._recordInteraction(villageId);
                // 生成新的建议回复
                this._generateSuggestions(villageId, replyText, suggestionsArea, inputField);
            }

            this._chatSending = false;
            sendBtn.disabled = false;
            sendBtn.textContent = '📨 发送';
        };

        sendBtn.addEventListener('click', doSend);
        inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSend(); }
        });

        document.body.appendChild(overlay);
        inputField.focus();
    }

    /** 构建邻村村长 AI Prompt */
    _buildLeaderPrompt(villageId, playerMessage) {
        const village = NEIGHBOR_VILLAGES[villageId];
        const favor = this.getFavor(villageId);
        const leaderName = this._getLeaderName(villageId);
        const statusKey = this.state.neighbors.status[villageId] || 'stable';
        const statusConfig = NEIGHBOR_STATUS[statusKey];
        const season = this.state.seasonName;
        const need = village.seasonalNeeds[this.state.season];

        const favorDesc = favor >= 80 ? '你们是亲密挚友' :
                         favor >= 60 ? '关系很好，互相信任' :
                         favor >= 40 ? '关系还可以，比较友善' :
                         favor >= 20 ? '关系一般，还在建立信任' :
                         '关系冷淡，不太信任';

        // 玩家当前资源概况
        const playerRes = `金币${this.state.resources.gold}、小麦${this.state.inventory.wheat || 0}、木材${this.state.resources.wood}、石料${this.state.resources.stone}`;

        // 近期对话历史（上下文连贯）
        const recentChat = this._getRecentChatText(villageId, 4);
        const chatContext = recentChat
            ? `\n【近期对话记录】\n${recentChat}`
            : '';

        // 往季记忆摘要
        const prevMemory = this._getPreviousMemory(villageId);
        const memoryContext = prevMemory
            ? `\n【往季交往摘要】${prevMemory}`
            : '';

        // 资源丢失记录（村长不确定是谁偷的，但可能有怀疑）
        let stealContext = '';
        const stealRecords = this.state.neighbors._stealRecords?.[villageId];
        if (stealRecords && stealRecords.length > 0) {
            const RN = NeighborSystem.RES_NAMES;
            const recent = stealRecords.slice(-3);
            const totalTimes = stealRecords.length;
            const detectedCount = stealRecords.filter(r => r.detected).length;
            const stealDesc = recent.map(r =>
                `${r.season}少了${r.amount}${RN[r.resource] || r.resource}${r.detected ? '（有人看到桃源村方向来的人影）' : ''}`
            ).join('；');

            if (detectedCount >= 2) {
                // 多次被发现 → 高度怀疑
                stealContext = `\n【近期困扰】你的村庄多次丢东西：${stealDesc}。有村民多次看到桃源村方向来的可疑人影。你心里高度怀疑是桃源村干的，但没有确凿证据。你可能会在对话中旁敲侧击试探，比如"最近我们丢了不少东西，不知道你有没有听说什么？"。如果对方矢口否认或转移话题，你会更加怀疑。如果对方主动承认或道歉，你可能愿意原谅但还是有些不满。不要直接指控，而是暗示和试探。`;
            } else if (detectedCount === 1) {
                // 被发现1次 → 有些怀疑
                stealContext = `\n【近期困扰】你的村庄丢了东西：${stealDesc}。有人说看到了桃源村方向的可疑人影，你有些怀疑桃源村，但也不敢确定。你可能会含蓄地在聊天中提起"最近村里不太平"，观察对方反应。如果对方表现得心虚或回避，你的怀疑会加深。`;
            } else {
                // 没被发现 → 只是烦恼，不特别怀疑桃源村
                stealContext = `\n【近期困扰】你的村庄丢了一些东西：${stealDesc}。你不太清楚是谁干的，可能是流民也可能是附近的人。你有些烦恼，偶尔会在聊天中叹气提到这件事。`;
            }
        }

        return `你是${village.name}的${leaderName}村长${village.icon}。性格：${village.personality}。
你的村庄特点：${village.description}。擅长${village.strength}，缺少${village.weakness}。
当前状态：${statusConfig.name}。当前季节：${season}。
你现在需要：${need?.need || '无'}，可以提供：${need?.offer || '无'}。

【与桃源村的关系】好感度${favor}/100（${favorDesc}）

【桃源村资源参考】${playerRes}
${memoryContext}
${chatContext}
${stealContext}

【规则】
• 用20-60字自然对话，体现你的性格（${village.personality}）
• 好感度高时更友善慷慨，低时更谨慎客气
• 参考上面的对话记录保持连贯，不要重复说过的话
• 你可以在对话中自然地提出资源请求（用request字段），例如你缺小麦时可以说"最近粮食不够吃，能不能支援我们5个小麦？"
• 如果玩家向你索要资源，根据好感度和你的库存决定是否答应（用offer字段）
  - 好感度>=60时比较大方，可以给一些你擅长的资源
  - 好感度<30时会拒绝或只给很少
  - 你缺少的东西（${village.weakness}）绝对不给
  - 你擅长的东西（${village.strength}）可以适当给
• request/offer的resource必须是以下之一：gold/wheat/wood/stone/radish/potato
• 不是每次都要请求或赠送！大部分时候就是正常聊天
• 不要用括号解释你的行为

玩家（桃源村村长）说：「${playerMessage}」

输出JSON：
{
  "text": "你的回复（自然对话）",
  "favorDelta": 0到2之间的整数（正常聊天0，愉快交流1-2，不愉快-1）,
  "request": null 或 {"resource":"wheat","amount":5}（你想向玩家要的东西）,
  "offer": null 或 {"resource":"wood","amount":3}（你愿意给玩家的东西）
}`;
    }

    /** 调用 AI 生成村长回复 */
    async _generateLeaderReply(villageId, playerMessage) {
        if (!this.ai) return null;

        const prompt = this._buildLeaderPrompt(villageId, playerMessage);
        const result = await this.ai.chat(prompt, { temperature: 0.85, maxTokens: 200 });

        if (result && result.text) {
            return {
                text: result.text,
                favorDelta: result.favorDelta || 0,
                request: result.request || null,
                offer: result.offer || null,
            };
        }
        return null;
    }

    /** 检测玩家消息中的资源赠送意图 */
    _parseResourceOffer(text) {
        // 匹配"给你X个Y"、"送你X个Y"、"这是X个Y"等
        const patterns = [
            /(?:给你|送你|支援你?|赠送|这是|拿去)\s*(\d+)\s*(?:个|块|颗)?\s*(金币|小麦|木材|石料|萝卜|土豆)/,
            /(\d+)\s*(?:个|块|颗)?\s*(金币|小麦|木材|石料|萝卜|土豆)\s*(?:给你|送你|拿去)/,
        ];
        const nameToId = { '金币': 'gold', '小麦': 'wheat', '木材': 'wood', '石料': 'stone', '萝卜': 'radish', '土豆': 'potato' };

        for (const p of patterns) {
            const m = text.match(p);
            if (m) {
                const amount = parseInt(m[1]);
                const resId = nameToId[m[2]];
                if (resId && amount > 0) return { resource: resId, amount };
            }
        }
        return null;
    }

    /** 处理玩家主动赠送（不需要 AI，直接弹确认） */
    _handlePlayerOffer(offer, villageId, village, messagesArea, exchangeArea) {
        const resName = NeighborSystem.RES_NAMES[offer.resource] || offer.resource;
        const resIcon = NeighborSystem.RES_ICONS[offer.resource] || '';
        const leaderName = this._getLeaderName(villageId);

        // 检查玩家是否有足够资源
        let current = 0;
        if (offer.resource === 'gold') current = this.state.resources.gold;
        else if (offer.resource === 'wood') current = this.state.resources.wood;
        else if (offer.resource === 'stone') current = this.state.resources.stone;
        else if (this.state.inventory[offer.resource] !== undefined) current = this.state.inventory[offer.resource];

        if (current < offer.amount) {
            this._addChatBubble(messagesArea, '系统', '⚠️',
                `你没有足够的${resName}（当前${current}）`, 'system');
            return;
        }

        // 显示确认
        this._showExchangeUI(exchangeArea, messagesArea, villageId,
            { resource: offer.resource, amount: offer.amount },
            'playerGive', leaderName, village);
    }

    /** 显示资源交换 UI 模块 */
    _showExchangeUI(exchangeArea, messagesArea, villageId, exchange, type, leaderName, village) {
        const resName = NeighborSystem.RES_NAMES[exchange.resource] || exchange.resource;
        const resIcon = NeighborSystem.RES_ICONS[exchange.resource] || '';

        let titleText = '';
        let descText = '';

        if (type === 'theyRequest') {
            titleText = `${leaderName}村长请求`;
            descText = `想要 ${exchange.amount} ${resIcon}${resName}`;
        } else if (type === 'theyOffer') {
            titleText = `${leaderName}村长赠送`;
            descText = `愿意给你 ${exchange.amount} ${resIcon}${resName}`;
        } else if (type === 'playerGive') {
            titleText = '确认赠送';
            descText = `赠送 ${exchange.amount} ${resIcon}${resName} 给${village.name}`;
        }

        exchangeArea.style.display = 'block';
        exchangeArea.innerHTML = `
        <div style="background:var(--bg-warm,#fef9f0);border:2px solid var(--accent,#8d6e63);
            border-radius:10px;padding:12px;text-align:center;">
            <div style="font-weight:600;font-size:14px;margin-bottom:6px;">${titleText}</div>
            <div style="font-size:20px;margin:8px 0;">${resIcon} ${exchange.amount} ${resName}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;">${descText}</div>
            <div style="display:flex;gap:8px;justify-content:center;">
                <button class="btn btn-primary btn-sm" id="nb-exchange-accept">✅ 接受</button>
                <button class="btn btn-secondary btn-sm" id="nb-exchange-reject">❌ 拒绝</button>
            </div>
        </div>`;

        const acceptBtn = exchangeArea.querySelector('#nb-exchange-accept');
        const rejectBtn = exchangeArea.querySelector('#nb-exchange-reject');

        acceptBtn.addEventListener('click', () => {
            exchangeArea.style.display = 'none';
            if (type === 'theyRequest' || type === 'playerGive') {
                // 玩家给出资源
                this._deductResource(exchange.resource, exchange.amount);
                const favorGain = Math.min(10, Math.ceil(exchange.amount * 1.2));
                this.modifyFavor(villageId, favorGain, `赠送${resName}`);
                this.addReputation(Math.ceil(exchange.amount * 0.5), `赠送${village.name}`);
                this._addChatBubble(messagesArea, leaderName, village.icon,
                    `太感谢了！这对我们${village.name}帮助很大！`, 'npc');
                this._addChatBubble(messagesArea, '系统', '📦',
                    `你赠送了 ${exchange.amount} ${resIcon}${resName}，好感度 +${favorGain}`, 'system');
            } else if (type === 'theyOffer') {
                // 玩家接收资源
                this._addResource(exchange.resource, exchange.amount);
                this._addChatBubble(messagesArea, '系统', '📦',
                    `你收到了 ${exchange.amount} ${resIcon}${resName}`, 'system');
                this.modifyFavor(villageId, 1, '接受赠礼');
            }
            this.bus.emit('uiUpdate');
            this.bus.emit('neighborUpdate');
        });

        rejectBtn.addEventListener('click', () => {
            exchangeArea.style.display = 'none';
            if (type === 'theyRequest') {
                this._addChatBubble(messagesArea, leaderName, village.icon,
                    '没关系，我理解你们也不容易。', 'npc');
                this.modifyFavor(villageId, -2, '拒绝请求');
            } else if (type === 'theyOffer') {
                this._addChatBubble(messagesArea, leaderName, village.icon,
                    '好吧，那就改天再说。', 'npc');
            } else if (type === 'playerGive') {
                this._addChatBubble(messagesArea, '系统', '💬', '你取消了赠送。', 'system');
            }
        });
    }

    /** 添加聊天气泡 */
    _addChatBubble(container, name, icon, text, type, dividerText) {
        // 分隔线类型
        if (type === 'divider') {
            const div = document.createElement('div');
            div.style.cssText = 'text-align:center;font-size:11px;color:var(--text-muted,#999);margin:8px 0;';
            div.textContent = dividerText || text;
            container.appendChild(div);
            return;
        }

        const isHistory = type.endsWith('-history');
        const baseType = isHistory ? type.replace('-history', '') : type;

        const div = document.createElement('div');
        div.style.cssText = `margin-bottom:${isHistory ? '4' : '8'}px;display:flex;gap:6px;
            ${baseType === 'player' ? 'flex-direction:row-reverse;' : ''}
            ${isHistory ? 'opacity:0.6;' : ''}`;

        const alignStyle = baseType === 'player' ? 'text-align:right;' : '';
        const bubbleColor = baseType === 'player' ? 'var(--accent,#8d6e63)' :
                           baseType === 'system' ? 'var(--text-muted,#999)' :
                           'var(--color-success,#43a047)';
        const bgColor = baseType === 'player' ? 'var(--bg-warm,#f5efe7)' :
                        baseType === 'system' ? 'var(--bg-card,#f9f9f9)' :
                        '#f0f7f0';

        div.innerHTML = `
            <div style="font-size:${isHistory ? '16' : '20'}px;flex-shrink:0;margin-top:2px;">${icon}</div>
            <div style="max-width:80%;${alignStyle}">
                <div style="font-size:${isHistory ? '10' : '11'}px;color:${bubbleColor};font-weight:600;margin-bottom:2px;">${name}</div>
                <div style="background:${bgColor};padding:${isHistory ? '5px 10px' : '8px 12px'};border-radius:10px;
                    font-size:${isHistory ? '12' : '13'}px;line-height:1.5;border:1px solid var(--panel-border,#e5e0d8);">
                    ${text}
                </div>
            </div>`;

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    /** 资源扣除辅助 */
    _deductResource(resId, amount) {
        if (resId === 'gold') this.state.resources.gold = Math.max(0, this.state.resources.gold - amount);
        else if (resId === 'wood') this.state.resources.wood = Math.max(0, this.state.resources.wood - amount);
        else if (resId === 'stone') this.state.resources.stone = Math.max(0, this.state.resources.stone - amount);
        else if (this.state.inventory[resId] !== undefined) {
            this.state.inventory[resId] = Math.max(0, this.state.inventory[resId] - amount);
        }
    }

    /** 资源增加辅助 */
    _addResource(resId, amount) {
        if (resId === 'gold') this.state.resources.gold += amount;
        else if (resId === 'wood') this.state.resources.wood += amount;
        else if (resId === 'stone') this.state.resources.stone += amount;
        else if (this.state.inventory[resId] !== undefined) {
            this.state.inventory[resId] += amount;
        }
    }

    /** 获取村长名字 */
    _getLeaderName(villageId) {
        const names = { fenggu: '田丰', tieling: '铁柱', yunshui: '云飞' };
        return names[villageId] || '村长';
    }

    /** 生成建议回复按钮（异步，不阻塞对话） */
    async _generateSuggestions(villageId, lastLeaderText, suggestionsArea, inputField) {
        suggestionsArea.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">💭 生成建议回复...</span>';

        const village = NEIGHBOR_VILLAGES[villageId];
        const favor = this.getFavor(villageId);
        let suggestions = [];

        if (this.ai) {
            try {
                const prompt = this._buildSuggestionsPrompt(villageId, lastLeaderText);
                const result = await this.ai.chat(prompt, { temperature: 0.95, maxTokens: 150 });
                if (result?.suggestions && Array.isArray(result.suggestions)) {
                    suggestions = result.suggestions.slice(0, 3);
                }
            } catch (e) {
                console.warn('[NeighborChat] 建议生成失败，使用降级', e);
            }
        }

        // 降级：静态建议
        if (suggestions.length === 0) {
            const need = village.seasonalNeeds[this.state.season];
            suggestions = [
                '最近过得怎么样？',
                favor < 30 ? '我们能合作些什么吗？' : '有什么需要帮忙的吗？',
            ];
            if (need?.need && this.state.resources[need.need] > 5) {
                const RN = NeighborSystem.RES_NAMES;
                suggestions.push(`要不要我支援你们一些${RN[need.need] || need.need}？`);
            }
        }

        // 渲染建议按钮
        suggestionsArea.innerHTML = '';
        for (const text of suggestions) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-secondary';
            btn.style.cssText = 'font-size:12px;padding:4px 10px;border-radius:12px;white-space:nowrap;';
            btn.textContent = text;
            btn.addEventListener('click', () => {
                inputField.value = text;
                inputField.focus();
                suggestionsArea.innerHTML = '';  // 点击后清空建议
            });
            suggestionsArea.appendChild(btn);
        }
    }

    /** 构建建议回复 Prompt */
    _buildSuggestionsPrompt(villageId, lastLeaderText) {
        const village = NEIGHBOR_VILLAGES[villageId];
        const favor = this.getFavor(villageId);
        const season = this.state.seasonName;
        const need = village.seasonalNeeds[this.state.season];
        const playerRes = `金币${this.state.resources.gold}、小麦${this.state.inventory.wheat || 0}、木材${this.state.resources.wood}、石料${this.state.resources.stone}`;

        return `你是游戏《治村物语》的对话建议生成器。玩家正在和${village.name}的村长对话。

村长刚说：「${lastLeaderText}」
好感度：${favor}/100。季节：${season}。
玩家资源：${playerRes}。
${village.name}需要：${need?.need || '无'}，擅长：${need?.offer || '无'}。

请生成3个玩家可能想说的简短回复建议（8-20字），包括：
1. 一个友善/闲聊类的回复
2. 一个与资源/贸易相关的回复（比如询问需求、提议交换等）
3. 一个根据当前情境灵活生成的回复

输出JSON：{"suggestions":["回复1","回复2","回复3"]}`;
    }

    /** 构建 AI 开场白 Prompt */
    _buildGreetingPrompt(villageId) {
        const village = NEIGHBOR_VILLAGES[villageId];
        const favor = this.getFavor(villageId);
        const leaderName = this._getLeaderName(villageId);
        const statusKey = this.state.neighbors.status[villageId] || 'stable';
        const statusConfig = NEIGHBOR_STATUS[statusKey];
        const season = this.state.seasonName;
        const need = village.seasonalNeeds[this.state.season];
        const prevMemory = this._getPreviousMemory(villageId);
        const recentChat = this._getRecentChatText(villageId, 2);

        const favorDesc = favor >= 70 ? '亲密好友' :
                         favor >= 50 ? '关系友好' :
                         favor >= 30 ? '关系一般' :
                         favor >= 15 ? '不太熟悉' : '关系冷淡';

        // 资源丢失记忆
        const stealRecords = this.state.neighbors._stealRecords?.[villageId];
        let stealNote = '';
        if (stealRecords?.length > 0) {
            const detectedCount = stealRecords.filter(r => r.detected).length;
            if (detectedCount >= 2) {
                stealNote = '你的村庄多次丢东西，有人看到桃源村方向的可疑人影。你高度怀疑但没证据，会旁敲侧击试探。';
            } else if (detectedCount === 1) {
                stealNote = '你的村庄丢过东西，方向似乎是桃源村那边。你有些怀疑，但语气委婉。';
            } else {
                stealNote = '你的村庄最近丢过东西，原因不明，你有点烦恼。';
            }
        }

        return `你是${village.name}的${leaderName}村长。性格：${village.personality}。
当前季节：${season}，你的村庄状态：${statusConfig.name}。
与桃源村好感度：${favor}/100（${favorDesc}）。
你现在缺：${need?.need || '无'}。
${prevMemory ? `往季交往：${prevMemory}` : ''}
${recentChat ? `最近对话：\n${recentChat}` : '（之前没有对话过）'}
${stealNote}

桃源村的村长来拜访你了。请用1-2句话自然地打个招呼。
规则：
• 15-40字，自然口语化，体现你的性格
• 好感度高→热情欢迎，好感度低→客气但保持距离
• 可以自然提及近况、季节、或之前的交往（如果有的话）
• 如果你的村庄最近丢过东西，可以自然地提起，怀疑程度取决于你掌握的线索
• 不要每次都说一样的开场白

输出JSON：{"text":"你的开场白"}`;
    }

    /** 静态降级欢迎语（AI不可用时） */
    _getGreeting(villageId, favor) {
        const village = NEIGHBOR_VILLAGES[villageId];
        const greetings = {
            high: [
                '哈哈，老朋友来了！快请坐！',
                '桃源村的朋友！来来来，喝杯热茶！',
                '哎呀，好久不见！最近可好？',
            ],
            mid: [
                '欢迎来访，请坐请坐。',
                '你好你好，有什么事吗？',
                '桃源村的村长是吧？请进。',
            ],
            low: [
                '……你好。',
                '嗯，来了。',
                '有事？',
            ],
        };
        const pool = favor >= 50 ? greetings.high : favor >= 25 ? greetings.mid : greetings.low;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** 降级回复（AI不可用时） */
    _getFallbackReply(villageId, favor) {
        const village = NEIGHBOR_VILLAGES[villageId];
        const replies = favor >= 50
            ? [
                '哈哈，说得对！我们两村要多走动走动。',
                '是啊，最近日子还算过得去。你们那边呢？',
                `如果需要${village.strength}方面的帮助，尽管开口！`,
            ]
            : [
                '嗯...你说的有道理。',
                '好吧，我考虑一下。',
                '最近我们这边也不太容易啊...',
            ];
        return replies[Math.floor(Math.random() * replies.length)];
    }
}
