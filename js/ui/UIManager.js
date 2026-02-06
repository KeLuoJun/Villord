/**
 * UIManager - UI 总管理器
 * 负责面板切换、UI 更新节流、全局 UI 操作
 */

export class UIManager {
    /**
     * @param {object} gameState - GameState
     * @param {import('../core/EventBus.js').EventBus} eventBus
     * @param {import('../core/TimeSystem.js').TimeSystem} timeSystem
     */
    constructor(gameState, eventBus, timeSystem) {
        this.state = gameState;
        this.bus = eventBus;
        this.timeSystem = timeSystem;
        this.currentTab = 'build';
        this.updateCounter = 0;

        // 子面板管理器（由各面板模块注册）
        this.panels = {};

        this.init();
    }

    /** 初始化 UI 事件绑定 */
    init() {
        // 标签页切换
        document.querySelectorAll('#tab-nav .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // 速度控制
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const speed = parseFloat(btn.dataset.speed);
                this.timeSystem.setSpeed(speed);
                this.updateSpeedButtons(speed);
            });
        });

        // 暂停按钮
        const pauseBtn = document.querySelector('.pause-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                this.timeSystem.togglePause();
                this.updatePauseButton();
            });
        }

        // 监听事件更新 UI
        this.bus.on('tick', () => {
            this.updateCounter++;
            // 每4个 Tick 批量更新UI（节流）
            if (this.updateCounter % 4 === 0 || this.state.time.hour === 0) {
                this.updateAll();
            }
            // 状态栏和资源面板每 Tick 更新（进度条需要实时）
            this.updateStatusBar();
            this.updateResourcePanel();
        });

        this.bus.on('newDay', () => this.updateAll());
        this.bus.on('gamePaused', () => this.updatePauseButton());
        this.bus.on('gameResumed', () => this.updatePauseButton());
        this.bus.on('speedChanged', (data) => this.updateSpeedButtons(data.speed));
        this.bus.on('seasonChange', () => this.updateSeasonTheme());

        // 资源变化时立即刷新资源面板和进度条
        this.bus.on('uiUpdate', () => {
            this.updateResourcePanel();
            this.updateEventLog();
        });
        this.bus.on('cropHarvested', () => this.updateResourcePanel());
        this.bus.on('cropPlanted', () => this.updateResourcePanel());
        this.bus.on('buildingBuilt', () => this.updateResourcePanel());

        // 初始渲染
        this.updateAll();
        this.updateSeasonTheme();
        this.updatePauseButton();
        this.updateSpeedButtons(this.state.time.speed);
    }

    /** 注册子面板 */
    registerPanel(name, panel) {
        this.panels[name] = panel;
    }

    /** 切换标签页 */
    switchTab(tabId) {
        this.currentTab = tabId;

        // 更新标签按钮
        document.querySelectorAll('#tab-nav .tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        // 更新标签内容
        document.querySelectorAll('.tab-page').forEach(page => {
            page.classList.toggle('active', page.id === `tab-${tabId}`);
        });

        // 通知面板被激活
        if (this.panels[tabId]?.onActivate) {
            this.panels[tabId].onActivate();
        }
    }

    /** 更新全部 UI */
    updateAll() {
        this.updateStatusBar();
        this.updateResourcePanel();
        this.updateVillagerList();
        this.updateOverviewPanel();
        this.updateEventLog();

        // 更新当前活跃的标签页
        if (this.panels[this.currentTab]?.update) {
            this.panels[this.currentTab].update();
        }
    }

    /** 更新顶部状态栏 */
    updateStatusBar() {
        const t = this.state.time;
        const seasonIcons = { spring: '🌱', summer: '☀️', autumn: '🍂', winter: '❄️' };

        const timeEl = document.getElementById('status-time');
        if (timeEl) {
            timeEl.textContent = `${seasonIcons[this.state.season] || '🌱'}第${t.year}年·${this.state.seasonName} 第${t.day}天`;
        }

        const hourEl = document.getElementById('status-hour');
        if (hourEl) {
            hourEl.textContent = `${String(t.hour).padStart(2, '0')}:00`;
        }

    }

    /** 更新资源面板（左侧，含仓库容量进度条） */
    updateResourcePanel() {
        const r = this.state.resources;
        const d = this.state.dailyChanges;
        const s = this.state;

        // 仓库等级显示
        const whLevel = document.getElementById('warehouse-level');
        if (whLevel) {
            const upgrades = s.buildings.filter(b => b.id === 'warehouse').length;
            whLevel.textContent = `仓库容量: ${s.warehouseCapacity}`;
        }

        const container = document.getElementById('resource-list');
        if (!container) return;

        // 定义资源配置
        const resources = [
            { key: 'gold', icon: '💰', name: '金币', value: r.gold, change: d.gold },
            { key: 'food', icon: '🌾', name: '粮食', value: r.food, change: d.food },
            { key: 'wood', icon: '🪵', name: '木材', value: r.wood, change: d.wood },
            { key: 'stone', icon: '🪨', name: '石料', value: r.stone, change: d.stone },
            { key: 'seeds', icon: '🌱', name: '种子', value: Object.values(r.seeds).reduce((a, b) => a + b, 0), change: null },
        ];

        // 库存物品（仅显示有数量的）
        const invItems = [
            { key: 'radish', icon: '🥕', name: '萝卜' },
            { key: 'wheat', icon: '🌾', name: '小麦' },
            { key: 'potato', icon: '🥔', name: '土豆' },
            { key: 'pumpkin', icon: '🎃', name: '南瓜' },
            { key: 'cotton', icon: '🧶', name: '棉花' },
            { key: 'grape', icon: '🍇', name: '葡萄' },
            { key: 'flour', icon: '🫘', name: '面粉' },
            { key: 'bread', icon: '🍞', name: '面包' },
        ];

        invItems.forEach(item => {
            const qty = s.inventory[item.key] || 0;
            if (qty > 0) {
                resources.push({ key: item.key, icon: item.icon, name: item.name, value: qty, change: null });
            }
        });

        container.innerHTML = resources.map(res => {
            const limit = s.getStorageLimit(res.key);
            const noLimit = !isFinite(limit); // 金币无上限

            let changeHtml = '';
            if (res.change !== null && res.change !== undefined) {
                if (res.change > 0) {
                    changeHtml = `<span class="resource-change text-up">+${res.change}</span>`;
                } else if (res.change < 0) {
                    changeHtml = `<span class="resource-change text-down">${res.change}</span>`;
                }
            }

            if (noLimit) {
                // 金币：不显示容量条
                return `
                    <div class="resource-row-with-bar">
                        <div class="resource-row-top">
                            <span class="resource-name">${res.icon} ${res.name}</span>
                            <span>
                                <span class="resource-value">${res.value}</span>
                                ${changeHtml}
                            </span>
                        </div>
                    </div>
                `;
            }

            const pct = limit > 0 ? Math.min(100, Math.round((res.value / limit) * 100)) : 0;
            const isFull = res.value >= limit;
            const barColor = pct >= 90 ? 'var(--danger, #c62828)' :
                             pct >= 70 ? 'var(--warning, #e08800)' :
                             'var(--accent)';

            return `
                <div class="resource-row-with-bar">
                    <div class="resource-row-top">
                        <span class="resource-name">${res.icon} ${res.name}</span>
                        <span>
                            <span class="resource-value ${isFull ? 'text-danger' : ''}">${res.value}</span>
                            <span class="resource-limit">/${limit}</span>
                            ${changeHtml}
                        </span>
                    </div>
                    <div class="resource-bar-track">
                        <div class="resource-bar-fill" style="width:${pct}%;background:${barColor};"></div>
                    </div>
                </div>
            `;
        }).join('');

    }

    /** 更新村民列表（左侧） */
    updateVillagerList() {
        const container = document.getElementById('villager-list');
        if (!container) return;

        // 保留招募按钮
        const recruitBtn = container.querySelector('.recruit-btn');
        container.innerHTML = '';

        this.state.villagers.forEach(v => {
            const card = this.createVillagerCard(v);
            container.appendChild(card);
        });

        // 添加招募按钮
        if (this.state.villagers.length < this.state.settings.maxVillagers) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-gold recruit-btn';
            btn.textContent = `+ 招募村民 50💰`;
            btn.disabled = !this.state.canRecruit || this.state.resources.gold < 50;
            btn.addEventListener('click', () => this.bus.emit('recruitRequest', {}));
            container.appendChild(btn);
        }
    }

    /** 创建村民卡片 */
    createVillagerCard(villager) {
        const card = document.createElement('div');
        card.className = 'villager-card';
        card.dataset.villagerId = villager.id;

        const moodPercent = villager.mood;
        const staminaPercent = Math.round((villager.stamina / villager.maxStamina) * 100);
        const moodLevel = moodPercent >= 60 ? 'high' : moodPercent >= 30 ? 'medium' : 'low';
        const staminaLevel = staminaPercent >= 60 ? 'high' : staminaPercent >= 30 ? 'medium' : 'low';
        const moodEmoji = moodPercent >= 60 ? '😊' : moodPercent >= 30 ? '😐' : '😟';

        card.innerHTML = `
            <div class="villager-header">
                <span class="villager-name">${villager.traits.includes('勤劳') || villager.traits.includes('聪明') ? '👩‍🌾' : '👨‍🌾'} ${villager.name}</span>
            </div>
            <div class="villager-traits">${villager.traits.join(' · ')}</div>
            <div class="villager-stats">
                <div class="stat-row">
                    <span class="stat-icon">${moodEmoji}</span>
                    <span style="width:28px">心情</span>
                    <div class="stat-bar">
                        <div class="stat-fill ${moodLevel}" style="width:${moodPercent}%; background:var(--color-${moodLevel === 'high' ? 'success' : moodLevel === 'medium' ? 'warning' : 'danger'})"></div>
                    </div>
                    <span class="stat-value">${moodPercent}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-icon">💪</span>
                    <span style="width:28px">体力</span>
                    <div class="stat-bar">
                        <div class="stat-fill ${staminaLevel}" style="width:${staminaPercent}%; background:var(--color-${staminaLevel === 'high' ? 'success' : staminaLevel === 'medium' ? 'warning' : 'danger'})"></div>
                    </div>
                    <span class="stat-value">${villager.stamina}</span>
                </div>
            </div>
            <div class="villager-task">📋 ${villager.currentAction ? villager.currentAction : '空闲'}</div>
            <button class="btn btn-primary btn-sm chat-btn" data-villager-id="${villager.id}">💬 对话</button>
        `;

        // 对话按钮事件
        card.querySelector('.chat-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.bus.emit('openDialogue', { villagerId: villager.id });
        });

        return card;
    }

    /** 更新右侧概况面板 */
    updateOverviewPanel() {
        this.setTextContent('overview-villagers', `${this.state.villagers.length}/${this.state.settings.maxVillagers}`);
        this.setTextContent('overview-housing', `${this.state.housingCapacity}`);
        this.setTextContent('overview-plots', this.state.plots.length);
        // 繁荣度显示（累计制 + 等级名）
        const prosEl = document.getElementById('overview-prosperity');
        if (prosEl) {
            const pd = this.state.prosperityData;
            const total = pd?.total || this.state.prosperity || 0;
            // 获取当前等级名称
            const levels = [
                { threshold: 0, name: '荒芜村落', icon: '🏚️' },
                { threshold: 20, name: '初建小村', icon: '🏠' },
                { threshold: 60, name: '安宁村庄', icon: '🏡' },
                { threshold: 120, name: '朝气小镇', icon: '🌱' },
                { threshold: 200, name: '繁忙集市', icon: '🛒' },
                { threshold: 300, name: '富饶之地', icon: '🌾' },
                { threshold: 450, name: '兴旺村镇', icon: '🏘️' },
                { threshold: 650, name: '锦绣乡里', icon: '🌸' },
                { threshold: 900, name: '四海升平', icon: '🏛️' },
                { threshold: 1200, name: '传说桃源', icon: '👑' },
            ];
            let currentName = levels[0].icon + ' ' + levels[0].name;
            for (const lv of levels) {
                if (total >= lv.threshold) currentName = lv.icon + ' ' + lv.name;
            }
            prosEl.innerHTML = `${total} <span style="font-size:11px;font-weight:400;color:var(--text-secondary);">${currentName}</span>`;
        }
    }

    /** 更新事件日志 */
    updateEventLog() {
        const container = document.getElementById('event-log');
        if (!container) return;

        container.innerHTML = '';
        const recentLogs = this.state.eventLog.slice(0, 8);

        if (recentLogs.length === 0) {
            container.innerHTML = '<div class="text-muted" style="padding:8px;font-size:12px;">暂无事件</div>';
            return;
        }

        recentLogs.forEach(log => {
            const item = document.createElement('div');
            item.className = 'event-log-item';
            item.innerHTML = `
                <span class="log-icon">${log.icon}</span>
                <div>
                    <div class="log-text">${log.text}</div>
                    <div class="log-time">${log.time}</div>
                </div>
            `;
            container.appendChild(item);
        });
    }

    /** 更新季节主题 */
    updateSeasonTheme() {
        const body = document.body;
        body.classList.remove('season-spring', 'season-summer', 'season-autumn', 'season-winter');
        body.classList.add(`season-${this.state.season}`);
    }

    /** 更新暂停按钮状态 */
    updatePauseButton() {
        const btn = document.querySelector('.pause-btn');
        if (btn) {
            btn.textContent = this.state.time.isPaused ? '▶' : '⏸';
            btn.classList.toggle('paused', this.state.time.isPaused);
            btn.title = this.state.time.isPaused ? '继续' : '暂停';
        }
    }

    /** 更新速度按钮高亮 */
    updateSpeedButtons(speed) {
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
        });
    }

    /** 安全设置文本内容 */
    setTextContent(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    /** 显示 Toast 提示 */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => toast.remove(), 3500);
    }

    /** 显示模态框 */
    showModal(title, contentHTML, actions = []) {
        const existing = document.querySelector('.modal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const actionsHTML = actions.map(a =>
            `<button class="btn ${a.class || 'btn-primary'}" data-action="${a.id}">${a.text}</button>`
        ).join('');

        overlay.innerHTML = `
            <div class="modal fade-in">
                <div class="modal-title">${title}</div>
                <div class="modal-body">${contentHTML}</div>
                <div class="modal-actions">${actionsHTML}</div>
            </div>
        `;

        // 绑定动作按钮
        actions.forEach(a => {
            const btn = overlay.querySelector(`[data-action="${a.id}"]`);
            if (btn) btn.addEventListener('click', () => {
                if (a.onClick) a.onClick();
                overlay.remove();
            });
        });

        // 点击遮罩关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
        return overlay;
    }

    // ===== 村民管理面板（中央标签页） =====

    /** 村民管理面板对象（注册给 'villagers' 标签） */
    get villagerPanel() {
        const self = this;
        return {
            onActivate() { self.updateVillagerDetailPanel(); },
            update() { self.updateVillagerDetailPanel(); },
        };
    }

    /** 更新村民管理面板 */
    updateVillagerDetailPanel() {
        const container = document.getElementById('villager-detail-area');
        if (!container) return;

        // 创建左右分栏布局（60:40）
        container.innerHTML = `
            <div style="display:flex;gap:var(--spacing-md);height:100%;">
                <div id="villager-left-panel" style="flex:6;overflow-y:auto;min-height:0;"></div>
                <div id="villager-chat-panel" style="flex:4;display:flex;flex-direction:column;min-height:0;
                    border-left:1px solid var(--border);padding-left:var(--spacing-md);">
                    <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-secondary);flex-shrink:0;">
                        💬 村民实时发言
                    </div>
                    <div id="npc-chat-feed" style="flex:1;overflow-y:auto;min-height:0;"></div>
                </div>
            </div>
        `;

        const leftPanel = container.querySelector('#villager-left-panel');
        const chatFeed = container.querySelector('#npc-chat-feed');

        // 左侧：村民信息列表
        this.renderVillagerCards(leftPanel);

        // 右侧：NPC 聊天流
        this.renderNPCChatFeed(chatFeed);
    }

    /** 渲染村民卡片列表 */
    renderVillagerCards(leftPanel) {
        if (this.state.villagers.length === 0) {
            leftPanel.innerHTML = '<p class="text-muted">尚无村民，请先建造房屋再招募</p>';
            return;
        }

        this.state.villagers.forEach(v => {
            const moodPercent = v.mood;
            const staminaPercent = Math.round((v.stamina / v.maxStamina) * 100);
            const moodLevel = moodPercent >= 60 ? 'high' : moodPercent >= 30 ? 'medium' : 'low';
            const staminaLevel = staminaPercent >= 60 ? 'high' : staminaPercent >= 30 ? 'medium' : 'low';
            const moodEmoji = moodPercent >= 60 ? '😊' : moodPercent >= 30 ? '😐' : '😟';

            const isPositive = (t) => ['勤劳','聪明','听话','健壮','乐观'].includes(t);
            const traitTags = v.traits.map(t =>
                `<span class="trait-tag ${isPositive(t) ? 'positive' : 'negative'}">${t}</span>`
            ).join('');

            const scheduleHTML = v.schedule ? v.schedule.slice(0, 10).map(s => {
                const icons = { plant:'🌱', water:'💧', fertilize:'🧪', harvest:'🌾', chop:'🪓', mine:'⛏️', process:'🏭', trade:'🛒', rest:'💤', eat:'🍽️', idle:'🚶', chat:'💬', pest_control:'🐛' };
                const names = { plant:'种植', water:'浇水', fertilize:'施肥', harvest:'收获', chop:'伐木', mine:'采石', process:'加工', trade:'交易', rest:'休息', eat:'吃饭', idle:'闲逛', chat:'聊天', pest_control:'除虫' };
                const sh = s.startHour ?? s.hour;
                const isCurrent = this.state.time.hour >= sh && this.state.time.hour < sh + (s.duration || 1);
                const _st = v._scheduleStatus?.[`${sh}_${s.action}`];
                const statusIcon = _st === 'done' ? '✅' :
                                   _st === 'skipped' ? '⚠️' :
                                   _st === 'failed' ? '❌' :
                                   _st === 'past' ? '⏭️' :
                                   _st === 'deferred' ? '💤' : '';
                return `<div class="schedule-item ${isCurrent ? 'current' : ''}">
                    <span class="schedule-time">${String(sh).padStart(2,'0')}:00</span>
                    <span class="schedule-icon">${icons[s.action] || '📋'}</span>
                    <span class="schedule-action">${names[s.action] || s.action}</span>
                    ${statusIcon ? `<span style="font-size:10px;">${statusIcon}</span>` : ''}
                </div>`;
            }).join('') : '<div class="text-muted" style="font-size:12px;">暂无今日计划</div>';

            const card = document.createElement('div');
            card.className = 'card villager-detail';
            card.style.marginBottom = 'var(--spacing-md)';
            card.innerHTML = `
                <div class="detail-header">
                    <div class="detail-avatar">${v.avatar || '👤'}</div>
                    <div class="detail-info">
                        <h3>${v.name}</h3>
                        <div class="trait-tags">${traitTags}</div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">🎯 ${v.specialty}　💬 口癖："${v.quirk}"</div>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--spacing-md);">
                    <div>
                        <div class="stat-row" style="margin-bottom:6px;">
                            <span>${moodEmoji} 心情 ${moodPercent}</span>
                            <div class="progress-bar" style="margin-left:8px;flex:1;"><div class="fill ${moodLevel}" style="width:${moodPercent}%"></div></div>
                        </div>
                        <div class="stat-row" style="margin-bottom:6px;">
                            <span>💪 体力 ${v.stamina}/${v.maxStamina}</span>
                            <div class="progress-bar" style="margin-left:8px;flex:1;"><div class="fill ${staminaLevel}" style="width:${staminaPercent}%"></div></div>
                        </div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:8px;">
                            🎯 准确率 ${Math.round(v.accuracy * 100)}%　⚡ 工速 ${Math.round(v.workSpeed * 100)}%
                        </div>
                        <div style="font-size:12px;color:var(--text-secondary);">
                            🌾 农业 Lv.${Math.floor(v.skills.farming)}　🪓 采集 Lv.${Math.floor(v.skills.gathering)}　🏭 加工 Lv.${Math.floor(v.skills.processing)}
                        </div>
                        <div style="font-size:12px;color:var(--color-sky);margin-top:4px;">
                            📋 当前：${v.currentAction || '空闲'}
                        </div>
                    </div>
                    <div>
                        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">📅 今日计划</div>
                        <div class="schedule-timeline">${scheduleHTML}</div>
                    </div>
                </div>
                <div style="margin-top:var(--spacing-md);display:flex;gap:var(--spacing-sm);">
                    <button class="btn btn-primary btn-sm" data-chat="${v.id}">💬 对话</button>
                    <button class="btn btn-danger btn-sm" data-dismiss="${v.id}">👋 解雇 (20💰)</button>
                </div>
            `;

            card.querySelector(`[data-chat="${v.id}"]`).addEventListener('click', () => {
                this.bus.emit('openDialogue', { villagerId: v.id });
            });
            card.querySelector(`[data-dismiss="${v.id}"]`).addEventListener('click', () => {
                this.bus.emit('dismissRequest', { villagerId: v.id });
            });

            leftPanel.appendChild(card);
        });
    }

    /** 渲染 NPC 聊天流（日期分隔线 + 聊天气泡） */
    renderNPCChatFeed(chatFeed) {
        // 从全局获取 NPC 聊天系统
        const npcChat = window.game?.npcChat;
        const messages = npcChat ? npcChat.getRecentMessages(50) : [];

        if (messages.length === 0) {
            chatFeed.innerHTML = `
                <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">
                    <div style="font-size:24px;margin-bottom:8px;">🤫</div>
                    今天还没人说话呢...<br>
                </div>
            `;
            return;
        }

        chatFeed.innerHTML = '';
        let lastDateKey = '';

        // 柔和的气泡背景色组（按 villagerId 取色）
        const bubbleColors = [
            'rgba(52,152,219,0.08)',   // 蓝
            'rgba(46,204,113,0.08)',   // 绿
            'rgba(155,89,182,0.08)',   // 紫
            'rgba(241,196,15,0.08)',   // 黄
            'rgba(231,76,60,0.08)',    // 红
            'rgba(26,188,156,0.08)',   // 青
        ];

        messages.forEach(msg => {
            // ---- 日期分隔线 ----
            const year = msg.year || 1;
            const seasonName = msg.seasonName || '春';
            const day = msg.day || 1;
            const dateKey = `${year}-${seasonName}-${day}`;

            if (dateKey !== lastDateKey) {
                lastDateKey = dateKey;
                const dateLine = document.createElement('div');
                dateLine.style.cssText = `
                    display: flex; align-items: center; gap: 8px;
                    margin: 12px 0 8px; padding: 0 4px;
                `;
                dateLine.innerHTML = `
                    <div style="flex:1;height:1px;background:var(--border);"></div>
                    <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;font-weight:500;">
                        📅 第${year}年·${seasonName} 第${day}天
                    </span>
                    <div style="flex:1;height:1px;background:var(--border);"></div>
                `;
                chatFeed.appendChild(dateLine);
            }

            // ---- 聊天气泡 ----
            const colorIdx = typeof msg.villagerId === 'number' ? msg.villagerId % bubbleColors.length : 0;
            const bgColor = bubbleColors[colorIdx];

            const bubble = document.createElement('div');
            bubble.style.cssText = `
                display: flex; gap: 8px; padding: 6px 8px; margin-bottom: 6px;
                align-items: flex-start;
            `;
            bubble.innerHTML = `
                <span style="font-size:22px;flex-shrink:0;margin-top:2px;">${msg.avatar}</span>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                        <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${msg.name}</span>
                        <span style="font-size:10px;color:var(--text-muted);">${String(msg.hour).padStart(2,'0')}:00</span>
                        <span style="font-size:12px;">${msg.mood}</span>
                    </div>
                    <div style="
                        font-size:13px; line-height:1.5; color:var(--text-primary);
                        word-break:break-word; padding: 8px 12px;
                        background: ${bgColor}; border-radius: 2px 12px 12px 12px;
                        border: 1px solid rgba(0,0,0,0.04);
                        box-shadow: 0 1px 2px rgba(0,0,0,0.03);
                    ">${msg.text}</div>
                </div>
            `;
            chatFeed.appendChild(bubble);
        });

        // 自动滚动到底部
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }

    /** 更新底部对话栏的村民选择下拉 */
    updateVillagerSelect() {
        const select = document.getElementById('villager-select');
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '<option value="">选择村民...</option>';

        this.state.villagers.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = `${v.avatar || '👤'} ${v.name}`;
            select.appendChild(opt);
        });

        if (currentValue) select.value = currentValue;
    }
}
