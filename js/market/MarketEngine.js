/**
 * MarketEngine - 市场价格引擎
 * 均值回归 + 随机游走 + 虚拟交易者 + 季节修正 + 事件冲击
 */
import { MARKET_ITEMS, SEASON_MARKET_MODS } from '../config/marketItems.js';
import { SPECIAL_WEATHER_EVENTS } from '../config/weather.js';

// 市场开放时间
export const MARKET_OPEN_HOUR = 9;
export const MARKET_CLOSE_HOUR = 18;

export class MarketEngine {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;
        this.prices = {};
        this.history = {};
        this.recentTrades = []; // 近期玩家/村民交易记录
        this.ai = null; // AI 服务，由 main.js 注入

        // 监听事件
        this.bus.on('tick', () => this.updatePrices());
    }

    /** 市场是否开放 */
    isMarketOpen() {
        const hour = this.state.time.hour;
        return hour >= MARKET_OPEN_HOUR && hour < MARKET_CLOSE_HOUR;
    }

    /** 注入 AI 服务 */
    setAI(aiService) {
        this.ai = aiService;
    }

    /** 初始化所有商品价格 */
    initPrices() {
        for (const [id, config] of Object.entries(MARKET_ITEMS)) {
            this.prices[id] = config.basePrice;
            this.history[id] = [{ tick: 0, price: config.basePrice }];
        }
        this.state.market.prices = { ...this.prices };
        this.updatePriceList();
    }

    /** 从存档恢复价格 */
    initPricesFromState() {
        const savedPrices = this.state.market.prices;
        for (const [id, config] of Object.entries(MARKET_ITEMS)) {
            this.prices[id] = savedPrices[id] || config.basePrice;
            if (!this.history[id] || this.history[id].length === 0) {
                this.history[id] = [{ tick: this.state.time.totalTicks, price: this.prices[id] }];
            }
        }
        this.updatePriceList();
    }

    /** 每 Tick 更新价格（仅市场开放期间） */
    updatePrices() {
        if (!this.isMarketOpen()) return;

        for (const [id, config] of Object.entries(MARKET_ITEMS)) {
            const price = this.prices[id] || config.basePrice;
            const deviation = (price - config.basePrice) / config.basePrice;

            // 1. 均值回归
            const meanReversion = -deviation * config.reversionSpeed;

            // 2. 随机波动
            const noise = (Math.random() - 0.5) * config.volatility;

            // 3. 虚拟交易者压力
            const traderPressure = this.simulateTraders(id, price, config);

            // 4. 季节修正
            const seasonMod = this.getSeasonMod(id);

            // 5. C1: 天气/事件冲击
            const eventShock = this.getEventShock(id);

            // 6. 综合
            const change = meanReversion + noise + traderPressure + seasonMod + eventShock;
            this.prices[id] = Math.max(
                config.basePrice * 0.3,
                Math.min(config.basePrice * 3.0, price * (1 + change))
            );

            // 记录历史
            this.recordHistory(id, this.prices[id]);
        }

        this.state.market.prices = { ...this.prices };

        // 每3 tick 更新一次价格列表UI + 市场面板
        if (this.state.time.totalTicks % 3 === 0) {
            this.updatePriceList();
            // 如果市场标签页正在显示，也刷新主面板
            if (document.getElementById('tab-market')?.classList.contains('active')) {
                this.update();
            }
        }
    }

    /** 模拟虚拟交易者 */
    simulateTraders(itemId, price, config) {
        let netPressure = 0;
        const ratio = price / config.basePrice;

        // 1) 基础供需（在 ratio=1 附近保持零漂移）
        const demandBase = 30;
        const supplyBase = 30 * (this.state.season === 'autumn' ? 1.3 : 1.0);
        const sensitivity = 0.6;
        const demand = demandBase * Math.max(0, 1 - (ratio - 1) * sensitivity);
        const supply = supplyBase * Math.max(0, 1 + (ratio - 1) * sensitivity);
        netPressure += (demand - supply) * 0.001;

        // 2) 投机商人（趋势动量，幅度下调以避免整体上行）
        const trend = this.getTrend(itemId, 24);
        const specPressure = 8 * trend;
        netPressure += specPressure * 0.001;

        // 3) 囤货商（价格低时买入、价格高时抛售）
        const hoarderPressure = 6 * (1 - ratio);
        netPressure += hoarderPressure * 0.001;

        // 4) 随机散户噪声（对称）
        netPressure += (Math.random() - 0.5) * 6 * 0.001;

        return netPressure;
    }

    /** 获取季节修正 */
    getSeasonMod(itemId) {
        const seasonMods = SEASON_MARKET_MODS[this.state.season];
        if (!seasonMods || !seasonMods[itemId]) return 0;
        return (seasonMods[itemId] - 1) * 0.002; // 微小每Tick影响
    }

    /** C1: 获取天气/事件冲击对某商品的价格影响 */
    getEventShock(itemId) {
        const activeEventId = this.state.weather.activeEvent;
        if (!activeEventId) return 0;

        const evt = SPECIAL_WEATHER_EVENTS[activeEventId];
        if (!evt) return 0;

        let shockMod = 0;

        // 检查 marketMod（整体市场乘数）
        if (evt.marketMod && evt.marketMod !== 1.0) {
            shockMod += (evt.marketMod - 1) * 0.01;
        }

        // 检查特定商品类型的价格修正
        // seedPriceMod 影响种子类商品
        if (evt.seedPriceMod && itemId.startsWith('seed_')) {
            shockMod += (evt.seedPriceMod - 1) * 0.01;
        }
        // foodPriceMod 影响粮食类商品
        if (evt.foodPriceMod && ['radish', 'wheat', 'potato', 'flour', 'bread'].includes(itemId)) {
            shockMod += (evt.foodPriceMod - 1) * 0.01;
        }
        // woodPriceMod 影响木材
        if (evt.woodPriceMod && itemId === 'wood') {
            shockMod += (evt.woodPriceMod - 1) * 0.01;
        }
        // 干旱 -> 粮价上涨（通过 marketMod 体现，但也可更精确）
        // unwateredCropWilt 影响所有农产品
        if (evt.unwateredCropWilt && ['radish', 'wheat', 'potato'].includes(itemId)) {
            shockMod += 0.005;
        }

        return shockMod;
    }

    /** 获取价格趋势 */
    getTrend(itemId, hours = 168) {
        const hist = this.history[itemId];
        if (!hist || hist.length < 2) return 0;
        const recent = hist.slice(-hours);
        if (recent.length < 2) return 0;
        return (recent[recent.length - 1].price - recent[0].price) / recent[0].price;
    }

    /** 记录价格历史 */
    recordHistory(itemId, price) {
        if (!this.history[itemId]) this.history[itemId] = [];
        this.history[itemId].push({
            tick: this.state.time.totalTicks,
            price: Math.round(price * 100) / 100,
        });
        // 保留最近1年（20天 × 24 Tick = 480 Tick）
        if (this.history[itemId].length > 480) {
            this.history[itemId].shift();
        }
    }

    /**
     * 执行交易
     * @param {string} itemId - 商品ID
     * @param {number} quantity - 数量
     * @param {boolean} isBuy - true=买入, false=卖出
     * @returns {object} { success, totalPrice, newPrice }
     */
    executeTrade(itemId, quantity, isBuy) {
        const config = MARKET_ITEMS[itemId];
        if (!config) return { success: false, reason: '未知商品' };

        const price = Math.round(this.prices[itemId]);
        const totalPrice = price * quantity;

        if (isBuy) {
            if (this.state.resources.gold < totalPrice) {
                return { success: false, reason: '金币不足' };
            }
            this.state.resources.gold -= totalPrice;

            // 根据商品类型加入对应库存
            this.addToInventory(itemId, quantity);
        } else {
            // 检查库存
            if (!this.removeFromInventory(itemId, quantity)) {
                return { success: false, reason: '库存不足' };
            }
            this.state.resources.gold += totalPrice;
        }

        // C2: 交易影响价格（2-5%随机浮动）
        const impactRate = 0.02 + Math.random() * 0.03;
        const impact = (quantity / 10) * impactRate * (isBuy ? 1 : -1);
        this.prices[itemId] *= (1 + impact);
        this.prices[itemId] = Math.max(
            config.basePrice * 0.3,
            Math.min(config.basePrice * 3.0, this.prices[itemId])
        );

        this.state.market.prices = { ...this.prices };

        const action = isBuy ? '买入' : '卖出';
        this.state.addLog('🛒', `${action}了${quantity}个${config.icon}${config.name}，${isBuy ? '花费' : '获得'}${totalPrice}💰`, 'info');

        // 记录交易用于AI分析
        const tradeRecord = {
            itemId, itemName: config.name, itemIcon: config.icon,
            quantity, price, totalPrice, isBuy,
            basePrice: config.basePrice,
            trend: this.getTrend(itemId, 24),
            deviation: (price - config.basePrice) / config.basePrice,
            season: this.state.seasonName,
            time: Date.now(),
        };
        this.recentTrades.push(tradeRecord);
        if (this.recentTrades.length > 20) this.recentTrades.shift();

        return { success: true, totalPrice, newPrice: this.prices[itemId], tradeRecord };
    }

    /** 添加物品到库存（受仓库容量限制） */
    addToInventory(itemId, quantity) {
        // 种子
        if (itemId.startsWith('seed_')) {
            const cropMap = { seed_r: 'radish', seed_w: 'wheat', seed_p: 'potato', seed_pk: 'pumpkin', seed_c: 'cotton', seed_g: 'grape' };
            const cropId = cropMap[itemId];
            if (cropId && this.state.resources.seeds[cropId] !== undefined) {
                // 种子容量限制
                const seedLimit = this.state.getStorageLimit('seeds');
                const currentSeeds = Object.values(this.state.resources.seeds).reduce((a, b) => a + b, 0);
                const canAdd = Math.min(quantity, Math.max(0, seedLimit - currentSeeds));
                this.state.resources.seeds[cropId] += canAdd;
            }
        } else if (['wood', 'stone'].includes(itemId)) {
            const limit = this.state.getStorageLimit(itemId);
            const current = this.state.resources[itemId] || 0;
            const canAdd = Math.min(quantity, Math.max(0, limit - current));
            this.state.resources[itemId] = current + canAdd;
        } else if (itemId === 'radish' || itemId === 'wheat' || itemId === 'potato') {
            // 粮食容量限制
            const foodLimit = this.state.getStorageLimit('food');
            const canAddFood = Math.min(quantity, Math.max(0, foodLimit - this.state.resources.food));
            this.state.resources.food += canAddFood;
            // 库存物品容量限制
            const invLimit = this.state.getStorageLimit(itemId);
            const canAddInv = Math.min(quantity, Math.max(0, invLimit - (this.state.inventory[itemId] || 0)));
            this.state.inventory[itemId] = (this.state.inventory[itemId] || 0) + canAddInv;
        } else {
            const limit = this.state.getStorageLimit(itemId);
            const current = this.state.inventory[itemId] || 0;
            const canAdd = Math.min(quantity, Math.max(0, limit - current));
            this.state.inventory[itemId] = current + canAdd;
        }
    }

    /** 从库存移除物品 */
    removeFromInventory(itemId, quantity) {
        if (['wood', 'stone'].includes(itemId)) {
            if ((this.state.resources[itemId] || 0) < quantity) return false;
            this.state.resources[itemId] -= quantity;
            return true;
        } else if (['radish', 'wheat', 'potato'].includes(itemId)) {
            if ((this.state.inventory[itemId] || 0) < quantity) return false;
            this.state.inventory[itemId] -= quantity;
            return true;
        } else {
            if ((this.state.inventory[itemId] || 0) < quantity) return false;
            this.state.inventory[itemId] -= quantity;
            return true;
        }
    }

    /** 获取某商品当前价格（取整） */
    getPrice(itemId) {
        return Math.round(this.prices[itemId] || MARKET_ITEMS[itemId]?.basePrice || 0);
    }

    // ===== UI =====

    onActivate() { this.update(); }

    /** 更新左侧价格简览 */
    updatePriceList() {
        const container = document.getElementById('price-list');
        if (!container) return;

        container.innerHTML = '';

        // 市场状态指示器
        const isOpen = this.isMarketOpen();
        const statusDiv = document.createElement('div');
        statusDiv.style.cssText = 'font-size:11px;margin-bottom:6px;padding:2px 6px;border-radius:4px;text-align:center;';
        if (isOpen) {
            statusDiv.style.background = 'rgba(46,125,50,0.1)';
            statusDiv.style.color = '#2e7d32';
            statusDiv.textContent = `🟢 营业中 (${MARKET_OPEN_HOUR}:00-${MARKET_CLOSE_HOUR}:00)`;
        } else {
            statusDiv.style.background = 'rgba(198,40,40,0.1)';
            statusDiv.style.color = '#c62828';
            statusDiv.textContent = `🔴 已关闭 (${MARKET_OPEN_HOUR}:00-${MARKET_CLOSE_HOUR}:00)`;
        }
        container.appendChild(statusDiv);

        const mainItems = ['radish', 'wheat', 'potato', 'flour', 'bread'];

        mainItems.forEach(id => {
            const config = MARKET_ITEMS[id];
            if (!config) return;

            const price = this.getPrice(id);
            const trend = this.getTrend(id, 24);
            const trendText = trend > 0.02 ? `📈+${Math.round(trend * 100)}%` :
                              trend < -0.02 ? `📉${Math.round(trend * 100)}%` : '→持平';
            const trendClass = trend > 0.02 ? 'text-up' : trend < -0.02 ? 'text-down' : 'text-muted';

            const row = document.createElement('div');
            row.className = 'price-row';
            row.innerHTML = `
                <span class="price-name">${config.icon} ${config.name}</span>
                <span><span class="price-value">${price}💰</span> <span class="price-change ${trendClass}">${trendText}</span></span>
            `;
            container.appendChild(row);
        });
    }

    /** 更新市场面板 */
    update() {
        const content = document.getElementById('market-content');
        if (!content) return;

        const isOpen = this.isMarketOpen();
        const hour = this.state.time.hour;

        // 市场状态栏
        let statusHtml = '';
        if (isOpen) {
            const remaining = MARKET_CLOSE_HOUR - hour;
            statusHtml = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-input);border-radius:8px;margin-bottom:12px;">
                <span style="color:#2e7d32;font-weight:600;">🟢 市场开放中</span>
                <span style="font-size:12px;color:var(--text-secondary);">⏰ 营业时间 ${MARKET_OPEN_HOUR}:00 - ${MARKET_CLOSE_HOUR}:00　剩余 ${remaining} 小时</span>
            </div>`;
        } else {
            const nextOpen = hour >= MARKET_CLOSE_HOUR
                ? `明天 ${MARKET_OPEN_HOUR}:00`
                : `今天 ${MARKET_OPEN_HOUR}:00`;
            statusHtml = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-input);border-radius:8px;margin-bottom:12px;opacity:0.7;">
                <span style="color:#c62828;font-weight:600;">🔴 市场已关闭</span>
                <span style="font-size:12px;color:var(--text-secondary);">⏰ 营业时间 ${MARKET_OPEN_HOUR}:00 - ${MARKET_CLOSE_HOUR}:00　下次开放：${nextOpen}</span>
            </div>`;
        }

        let html = statusHtml;
        html += '<table class="market-table"><thead><tr>';
        html += '<th>商品</th><th>当前价</th><th>基准价</th><th>涨跌</th><th>操作</th>';
        html += '</tr></thead><tbody>';

        Object.entries(MARKET_ITEMS).forEach(([id, config]) => {
            const price = this.getPrice(id);
            const trend = this.getTrend(id, 24);
            const trendText = trend > 0.02 ? `📈+${Math.round(trend * 100)}%` :
                              trend < -0.02 ? `📉${Math.round(trend * 100)}%` : '→';
            const trendClass = trend > 0.02 ? 'text-up' : trend < -0.02 ? 'text-down' : '';

            const disabledAttr = isOpen ? '' : 'disabled style="opacity:0.4;cursor:not-allowed;"';

            html += `<tr>
                <td>${config.icon} ${config.name}</td>
                <td>${price}💰</td>
                <td style="color:var(--text-muted)">${config.basePrice}💰</td>
                <td class="${trendClass}">${trendText}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="game.market.showTradeDialog('${id}',true)" ${disabledAttr}>买入</button>
                    <button class="btn btn-sm btn-secondary" onclick="game.market.showTradeDialog('${id}',false)" ${disabledAttr}>卖出</button>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';
        content.innerHTML = html;
    }

    /** 显示交易数量选择弹窗 */
    showTradeDialog(itemId, isBuy) {
        // 检查市场是否开放
        if (!this.isMarketOpen()) {
            const hour = this.state.time.hour;
            const msg = hour < MARKET_OPEN_HOUR
                ? `市场还未开放，开放时间 ${MARKET_OPEN_HOUR}:00 - ${MARKET_CLOSE_HOUR}:00`
                : `市场已关闭，明天 ${MARKET_OPEN_HOUR}:00 再来吧`;
            // 简单 toast 提示
            this.bus.emit('showToast', { message: `🚫 ${msg}`, type: 'warning' });
            return;
        }

        const config = MARKET_ITEMS[itemId];
        if (!config) return;

        const price = this.getPrice(itemId);
        const action = isBuy ? '买入' : '卖出';
        const actionColor = isBuy ? 'var(--accent)' : 'var(--secondary, #e67e22)';

        // 计算最大可交易数量（买入时受仓库容量限制）
        let maxQty;
        // storageType 需在 if 块外声明，模板字符串中也要用
        let storageType = itemId;
        let maxByGold = Infinity;
        let storageSpace = Infinity;
        if (isBuy) {
            maxByGold = Math.floor(this.state.resources.gold / price);
            // 根据物品类型获取对应的仓库剩余空间
            if (itemId.startsWith('seed_')) storageType = 'seeds';
            else if (['radish', 'wheat', 'potato'].includes(itemId)) storageType = 'food';
            storageSpace = this.state.getStorageSpace(storageType);
            maxQty = Math.min(maxByGold, storageSpace);
        } else {
            maxQty = this.getInventoryCount(itemId);
        }
        maxQty = Math.max(0, maxQty);
        const initialQty = maxQty > 0 ? 1 : 0;
        const buyLimitReason = isBuy
            ? (maxByGold <= 0 ? '金币不足' : storageSpace <= 0 ? '仓库已满' : '')
            : '';

        // 移除已有弹窗
        const existing = document.querySelector('.trade-dialog-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay trade-dialog-overlay';
        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:380px;">
                <div class="modal-title">${config.icon} ${action} ${config.name}</div>
                <div class="modal-body" style="text-align:center;">
                    <div style="margin-bottom:12px;">
                        <span style="font-size:13px;color:var(--text-secondary);">单价</span>
                        <span style="font-size:20px;font-weight:700;margin-left:8px;">${price}💰</span>
                    </div>
                    <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:16px;">
                        <button class="btn btn-sm btn-secondary trade-qty-btn" data-delta="-10">-10</button>
                        <button class="btn btn-sm btn-secondary trade-qty-btn" data-delta="-1">-1</button>
                        <input type="number" class="trade-qty-input" value="${initialQty}" min="0" max="${maxQty}" style="
                            width:70px;text-align:center;font-size:18px;font-weight:700;
                            border:2px solid var(--border);border-radius:8px;padding:6px;
                            background:var(--surface);color:var(--text-primary);
                        ">
                        <button class="btn btn-sm btn-secondary trade-qty-btn" data-delta="1">+1</button>
                        <button class="btn btn-sm btn-secondary trade-qty-btn" data-delta="10">+10</button>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                        <button class="btn btn-sm btn-ghost trade-preset" data-pct="25">25%</button>
                        <button class="btn btn-sm btn-ghost trade-preset" data-pct="50">50%</button>
                        <button class="btn btn-sm btn-ghost trade-preset" data-pct="100">全部</button>
                    </div>
                    <div style="font-size:13px;color:var(--text-secondary);margin-top:8px;">
                        ${isBuy ?
                            `当前金币: ${this.state.resources.gold}💰　仓库余量: ${storageSpace}　可买: ${maxQty}个${buyLimitReason ? `（${buyLimitReason}）` : ''}` :
                            `当前库存: ${maxQty}个`
                        }
                    </div>
                    <div style="font-size:16px;font-weight:600;margin-top:12px;">
                        总计: <span class="trade-total" style="color:${actionColor};">${price}💰</span>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary trade-cancel">取消</button>
                    <button class="btn ${isBuy ? 'btn-primary' : 'btn-gold'} trade-confirm" ${maxQty <= 0 ? 'disabled' : ''}>
                        确认${action}
                    </button>
                </div>
            </div>
        `;

        const qtyInput = overlay.querySelector('.trade-qty-input');
        const totalEl = overlay.querySelector('.trade-total');
        const confirmBtn = overlay.querySelector('.trade-confirm');

        const updateTotal = () => {
            let qty = parseInt(qtyInput.value) || 0;
            qty = Math.max(0, Math.min(maxQty, qty));
            qtyInput.value = qty;
            totalEl.textContent = `${qty * price}💰`;
            confirmBtn.disabled = qty <= 0;
        };

        // +/- 按钮
        overlay.querySelectorAll('.trade-qty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const delta = parseInt(btn.dataset.delta);
                qtyInput.value = Math.max(0, Math.min(maxQty, parseInt(qtyInput.value || 0) + delta));
                updateTotal();
            });
        });

        // 预设百分比
        overlay.querySelectorAll('.trade-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const pct = parseInt(btn.dataset.pct);
                qtyInput.value = maxQty <= 0
                    ? 0
                    : Math.max(1, Math.floor(maxQty * pct / 100));
                updateTotal();
            });
        });

        // 输入变化
        qtyInput.addEventListener('input', updateTotal);

        // 取消
        overlay.querySelector('.trade-cancel').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // 确认交易
        confirmBtn.addEventListener('click', async () => {
            const qty = parseInt(qtyInput.value) || 0;
            if (qty <= 0) return;

            const result = this.executeTrade(itemId, qty, isBuy);
            overlay.remove();

            if (result.success) {
                // 刷新市场面板
                this.update();
                this.updatePriceList();
                // 触发 AI 交易点评
                this.showTradeCommentary(result.tradeRecord);
            }
        });

        // 初始状态同步
        updateTotal();

        // 无法买入时禁用输入控件
        if (isBuy && maxQty <= 0) {
            qtyInput.disabled = true;
            overlay.querySelectorAll('.trade-qty-btn, .trade-preset').forEach(btn => {
                btn.disabled = true;
            });
        }

        document.body.appendChild(overlay);
        qtyInput.focus();
        qtyInput.select();
    }

    /**
     * AI 交易分析师 - 对玩家买卖行为进行点评
     * 做的好时表扬，做的不好时嘲讽
     */
    async showTradeCommentary(trade) {
        if (!this.ai) return;

        // 创建浮动评论面板
        const existing = document.querySelector('.trade-commentary-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.className = 'trade-commentary-popup';
        popup.innerHTML = `
            <div class="trade-commentary-card fade-in">
                <div class="commentary-header">
                    <span>🧠 交易分析师</span>
                    <button class="commentary-close" title="关闭">✕</button>
                </div>
                <div class="commentary-body">
                    <div class="commentary-loading">
                        <span class="commentary-spinner"></span>正在分析你的操作...
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(popup);

        popup.querySelector('.commentary-close').addEventListener('click', () => popup.remove());
        // 5秒后自动关闭
        const autoClose = setTimeout(() => popup.remove(), 12000);

        try {
            const commentary = await this.generateTradeCommentary(trade);
            const body = popup.querySelector('.commentary-body');
            if (!body) return;
            body.innerHTML = `
                <div class="commentary-verdict ${commentary.verdict}">
                    <span class="verdict-emoji">${commentary.emoji}</span>
                    <span class="verdict-label">${commentary.label}</span>
                </div>
                <div class="commentary-text">${commentary.text}</div>
                ${commentary.tip ? `<div class="commentary-tip">💡 ${commentary.tip}</div>` : ''}
            `;
            // 延长自动关闭
            clearTimeout(autoClose);
            setTimeout(() => { if (popup.parentNode) popup.remove(); }, 15000);
        } catch (e) {
            console.warn('[TradeAnalyst] AI评论生成失败', e);
            const body = popup.querySelector('.commentary-body');
            if (body) body.innerHTML = `<div class="commentary-text">📊 交易已完成</div>`;
            setTimeout(() => { if (popup.parentNode) popup.remove(); }, 3000);
        }
    }

    /** 生成 AI 交易点评 */
    async generateTradeCommentary(trade) {
        const trendDesc = trade.trend > 0.05 ? '正在上涨📈' :
                          trade.trend < -0.05 ? '正在下跌📉' : '相对平稳➡️';
        const deviationPct = Math.round(trade.deviation * 100);
        const deviationDesc = deviationPct > 20 ? '远高于基准价（贵了）' :
                              deviationPct > 5 ? '略高于基准价' :
                              deviationPct < -20 ? '远低于基准价（便宜）' :
                              deviationPct < -5 ? '略低于基准价' : '接近基准价';

        const action = trade.isBuy ? '买入' : '卖出';
        const recentTradesDesc = this.recentTrades.slice(-5).map(t =>
            `${t.isBuy ? '买' : '卖'}${t.quantity}个${t.itemName}@${t.price}`
        ).join('；');

        const prompt = `你是一个游戏中的市场交易分析师NPC，性格毒舌但专业。玩家刚完成一笔交易，请给出简短点评（2-3句话）。

交易信息：
- 操作：${action}
- 商品：${trade.itemIcon}${trade.itemName}
- 数量：${trade.quantity}
- 单价：${trade.price}💰（基准价：${trade.basePrice}💰）
- 总花费/收入：${trade.totalPrice}💰
- 当前价格偏离基准：${deviationDesc}（${deviationPct > 0 ? '+' : ''}${deviationPct}%）
- 近期趋势：${trendDesc}
- 当前季节：${trade.season}
- 玩家近期操作：${recentTradesDesc || '无'}

要求：
1. 如果这笔交易很精明（低买高卖、抓住趋势），用夸张的表扬语气
2. 如果交易一般，给出中性评价和建议
3. 如果交易很亏（高买低卖、逆势操作、价格偏离太大），用毒舌嘲讽语气
4. 用JSON格式回复：
{
  "verdict": "good" 或 "neutral" 或 "bad",
  "emoji": "一个表情符号",
  "label": "2-4字结论",
  "text": "2-3句点评",
  "tip": "可选的一句简短建议"
}`;

        try {
            const result = await this.ai.chat(prompt, {
                temperature: 0.9,
                maxTokens: 300,
            });
            if (result && result.verdict) {
                return result;
            }
        } catch (e) {
            console.warn('[TradeAnalyst] AI调用失败，使用本地分析', e);
        }

        // 本地 fallback 分析
        return this.localTradeAnalysis(trade);
    }

    /** 本地交易分析（Fallback） */
    localTradeAnalysis(trade) {
        const deviationPct = Math.round(trade.deviation * 100);
        const isBuy = trade.isBuy;
        const trend = trade.trend;

        // 判断交易质量
        let score = 0;
        // 买入时：价格低于基准好，趋势下跌时买好（抄底）
        if (isBuy) {
            if (deviationPct < -10) score += 2;
            else if (deviationPct < 0) score += 1;
            else if (deviationPct > 20) score -= 2;
            else if (deviationPct > 10) score -= 1;
            if (trend < -0.03) score += 1; // 下跌时买入（可能抄底）
            if (trend > 0.05) score -= 1; // 上涨时追高
        } else {
            // 卖出时：价格高于基准好，趋势上涨时卖出好
            if (deviationPct > 10) score += 2;
            else if (deviationPct > 0) score += 1;
            else if (deviationPct < -20) score -= 2;
            else if (deviationPct < -10) score -= 1;
            if (trend > 0.03) score += 1;
            if (trend < -0.05) score -= 1;
        }

        if (score >= 2) {
            const goods = [
                { emoji: '🎉', label: '精明操作', text: `${isBuy ? '低价抄底' : '高位出手'}，时机把握得不错！这笔赚了。`, tip: '继续保持对市场趋势的敏锐嗅觉。' },
                { emoji: '👏', label: '完美交易', text: `好眼光！${trade.itemName}的价格${isBuy ? '确实很便宜' : '确实是好价'}，有经济头脑。`, tip: null },
                { emoji: '🤑', label: '商业天才', text: `这波操作属实可以！${deviationPct > 0 ? '高价出手' : '低价收入'}，利润空间拿捏了。`, tip: null },
            ];
            return { verdict: 'good', ...goods[Math.floor(Math.random() * goods.length)] };
        } else if (score <= -2) {
            const bads = [
                { emoji: '🤦', label: '冤大头', text: `${isBuy ? '这价格买贵了吧' : '亏本大甩卖'}？${trade.itemName}的基准价才${trade.basePrice}💰，你这操作让商人们都笑了。`, tip: '注意观察价格趋势再下手。' },
                { emoji: '💸', label: '亏麻了', text: `说实话，这笔交易让我很难评……${isBuy ? '追高买入' : '割肉甩卖'}，经典韭菜操作。`, tip: '建议先看看市场简报再做决策。' },
                { emoji: '🙃', label: '大冤种', text: `${trade.totalPrice}💰就这么${isBuy ? '花出去了' : '贱卖了'}？我都替你心疼。`, tip: '耐心等待价格回归基准附近。' },
            ];
            return { verdict: 'bad', ...bads[Math.floor(Math.random() * bads.length)] };
        } else {
            const neutrals = [
                { emoji: '🤔', label: '中规中矩', text: `这笔交易谈不上好坏，价格尚可接受。`, tip: '如果能等到更好的价格会更划算。' },
                { emoji: '😐', label: '平平无奇', text: `正常操作，没啥好说的。${trade.itemName}的价格目前还行。`, tip: null },
                { emoji: '📊', label: '及格水平', text: `交易价格在合理范围内，虽然不算精明但也不亏。`, tip: '多关注季节变化对价格的影响。' },
            ];
            return { verdict: 'neutral', ...neutrals[Math.floor(Math.random() * neutrals.length)] };
        }
    }

    /** 获取某商品的库存数量 */
    getInventoryCount(itemId) {
        if (['wood', 'stone'].includes(itemId)) {
            return this.state.resources[itemId] || 0;
        }
        if (['radish', 'wheat', 'potato'].includes(itemId)) {
            return this.state.inventory[itemId] || 0;
        }
        if (itemId.startsWith('seed_')) {
            const cropMap = { seed_r: 'radish', seed_w: 'wheat', seed_p: 'potato', seed_pk: 'pumpkin', seed_c: 'cotton', seed_g: 'grape' };
            const cropId = cropMap[itemId];
            return cropId ? (this.state.resources.seeds[cropId] || 0) : 0;
        }
        return this.state.inventory[itemId] || 0;
    }
}
