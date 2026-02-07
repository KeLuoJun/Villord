/**
 * UIManager - UI 总管理器
 * 负责面板切换、UI 更新节流、全局 UI 操作
 */
import { MAX_MOOD } from '../config/villagers.js';

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
        this.bus.on('buildingBuilt', () => {
            this.updateResourcePanel();
            this.updateVillagerList();
        });
        this.bus.on('villagerAdded', () => this.updateVillagerList());
        this.bus.on('villagerRemoved', () => this.updateVillagerList());

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
            const newText = `${String(t.hour).padStart(2, '0')}:00`;
            if (hourEl.textContent !== newText) {
                hourEl.textContent = newText;
                // 时钟变更时微脉冲
                hourEl.classList.remove('tick-pulse');
                void hourEl.offsetWidth; // 强制回流以重新触发动画
                hourEl.classList.add('tick-pulse');
            }
        }

    }

    /** 更新资源面板（左侧，仓库堆叠展示） */
    updateResourcePanel() {
        const r = this.state.resources;
        const d = this.state.dailyChanges;
        const s = this.state;

        const usedCapacity = typeof s.getStorageUsed === 'function' ? s.getStorageUsed() : 0;
        const remainingCapacity = Math.max(0, s.warehouseCapacity - usedCapacity);

        // 仓库容量显示
        const whLevel = document.getElementById('warehouse-level');
        if (whLevel) {
            whLevel.textContent = `仓库容量: ${usedCapacity}/${s.warehouseCapacity}`;
        }

        const container = document.getElementById('resource-list');
        if (!container) return;

        // 更新顶部金币显示
        this._updateTopbarGold(r.gold, d.gold);

        // 定义资源配置（金币已移至顶部栏）
        const resources = [
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

        const stackColors = {
            food: 'var(--color-warning, #e5b94e)',
            wood: '#8d6e63',
            stone: '#90a4ae',
            seeds: '#6b9e4f',
            radish: '#ff8a65',
            wheat: '#f2c94c',
            potato: '#d4a373',
            pumpkin: '#ffb74d',
            cotton: '#cfd8dc',
            grape: '#9575cd',
            flour: '#f6d9b1',
            bread: '#f0b37e',
        };

        const stackItems = resources.filter(res => res.value > 0);

        // flex-grow 方案：每个资源条按数量分配空间，空白区域按剩余容量分配
        // 排序：数量大的在下面（视觉上更稳定），数量小的在上面
        const sortedItems = [...stackItems].sort((a, b) => a.value - b.value);

        const stackHtml = sortedItems.map(res => {
            let changeHtml = '';
            if (res.change !== null && res.change !== undefined) {
                if (res.change > 0) changeHtml = `<span class="stack-change up">+${res.change}</span>`;
                else if (res.change < 0) changeHtml = `<span class="stack-change down">${res.change}</span>`;
            }
            const color = stackColors[res.key] || 'var(--color-primary, #6B9E4F)';
            // flex-grow 按资源数量，min-height 保证可读性
            return `
                <div class="resource-stack-item" style="flex-grow:${res.value};background:${color};">
                    <span class="stack-name">${res.icon} ${res.name}</span>
                    <span class="stack-value">${res.value}${changeHtml}</span>
                </div>
            `;
        }).join('');

        // 顶部空白区域的 flex-grow = 剩余容量，形成"水位线"效果
        const emptyGrow = Math.max(0, s.warehouseCapacity - usedCapacity);

        container.innerHTML = `
            <div class="resource-barrel-wrap">
                <div class="resource-barrel">
                    <div class="resource-barrel-inner">
                        <div class="barrel-empty-space" style="flex-grow:${emptyGrow};"></div>
                        ${stackHtml || ''}
                    </div>
                    ${stackItems.length === 0 ? '<div class="resource-barrel-empty">仓库空空如也</div>' : ''}
                </div>
                <div class="resource-barrel-summary">已用 ${usedCapacity}/${s.warehouseCapacity} · 剩余 ${remainingCapacity}</div>
            </div>
        `;

    }

    /** 更新顶部栏金币显示 */
    _updateTopbarGold(gold, dailyChange) {
        const valEl = document.getElementById('topbar-gold-value');
        const changeEl = document.getElementById('topbar-gold-change');
        if (valEl) {
            const oldVal = valEl.textContent;
            valEl.textContent = gold;
            // 金币变化时微弹
            if (oldVal !== '' && oldVal !== String(gold)) {
                valEl.classList.remove('gold-bump');
                void valEl.offsetWidth;
                valEl.classList.add('gold-bump');
            }
        }
        if (changeEl) {
            if (dailyChange > 0) {
                changeEl.textContent = `+${dailyChange}`;
                changeEl.className = 'topbar-gold-change topbar-gold-up';
            } else if (dailyChange < 0) {
                changeEl.textContent = `${dailyChange}`;
                changeEl.className = 'topbar-gold-change topbar-gold-down';
            } else {
                changeEl.textContent = '';
                changeEl.className = 'topbar-gold-change';
            }
        }
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
            // 允许点击显示原因（房屋不足等），仅金币不足时禁用
            btn.disabled = this.state.resources.gold < 50;
            btn.addEventListener('click', () => this.bus.emit('recruitRequest', {}));
            container.appendChild(btn);
        }
    }

    /** 创建村民卡片 */
    createVillagerCard(villager) {
        const card = document.createElement('div');
        card.className = 'villager-card';
        card.dataset.villagerId = villager.id;

        const moodPercent = Math.round((villager.mood / MAX_MOOD) * 100);
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
                    <span class="stat-value">${villager.mood}/${MAX_MOOD}</span>
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
        `;

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

        // 创建左右分栏布局（60:40），两侧独立滚动
        container.innerHTML = `
            <div style="display:flex;gap:var(--spacing-md);height:100%;min-height:0;">
                <div id="villager-left-panel" style="flex:6;overflow-y:auto;min-height:0;padding-right:var(--spacing-sm);"></div>
                <div id="villager-chat-panel" style="flex:4;display:flex;flex-direction:column;min-height:0;
                    border-left:1px solid var(--color-divider, #e2ddd4);padding-left:var(--spacing-md);">
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
            const moodPercent = Math.round((v.mood / MAX_MOOD) * 100);
            const staminaPercent = Math.round((v.stamina / v.maxStamina) * 100);
            const moodLevel = moodPercent >= 60 ? 'high' : moodPercent >= 30 ? 'medium' : 'low';
            const staminaLevel = staminaPercent >= 60 ? 'high' : staminaPercent >= 30 ? 'medium' : 'low';
            const moodEmoji = moodPercent >= 60 ? '😊' : moodPercent >= 30 ? '😐' : '😟';

            const isPositive = (t) => ['勤劳','聪明','听话','健壮','乐观'].includes(t);
            const traitTags = v.traits.map(t =>
                `<span class="trait-tag ${isPositive(t) ? 'positive' : 'negative'}">${t}</span>`
            ).join('');

            const scheduleHTML = v.schedule ? v.schedule.map(s => {
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
                            <span>${moodEmoji} 心情 ${v.mood}/${MAX_MOOD}</span>
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

    // ===== 政策面板渲染 =====

    /** 设置政策系统引用（由 main.js 调用） */
    setPolicySystem(policySystem) {
        this.policySystem = policySystem;
        this.bus.on('policyPanelUpdate', () => this.renderPolicyPanel());
        this.bus.on('policyChanged', () => this.renderPolicyPanel());
    }

    /** 渲染政策面板内容 */
    renderPolicyPanel() {
        if (!this.policySystem) return;

        const summaryEl = document.getElementById('policy-summary');
        const contentEl = document.getElementById('policy-panel-content');
        if (!summaryEl || !contentEl) return;

        const policiesInfo = this.policySystem.getPoliciesInfo();
        const effectsSummary = this.policySystem.getEffectsSummary();
        const restDay = this.state.isRestDay;

        // 综合效果概览
        summaryEl.innerHTML = `
            <div class="policy-summary-bar">
                <span class="policy-summary-label">当前政策效果：</span>
                <span class="policy-summary-value">${effectsSummary}</span>
                ${restDay ? '<span class="policy-rest-badge">🏖️ 今天是休息日</span>' : ''}
            </div>
        `;

        // 渲染四大政策分类
        let html = '';
        for (const [catKey, catInfo] of Object.entries(policiesInfo)) {
            const cooldownText = catInfo.cooldown.onCooldown
                ? `<span class="policy-cooldown">冷却中（${catInfo.cooldown.remaining}天）</span>`
                : '';

            html += `
                <div class="policy-category">
                    <div class="policy-category-header">
                        <span class="policy-category-icon">${catInfo.icon}</span>
                        <span class="policy-category-name">${catInfo.name}</span>
                        <span class="policy-category-desc">${catInfo.description}</span>
                        ${cooldownText}
                    </div>
                    <div class="policy-options-grid">
            `;

            for (const opt of catInfo.options) {
                const isCurrent = opt.isCurrent;
                const isDisabled = catInfo.cooldown.onCooldown && !isCurrent;
                const tags = (opt.tags || []).map(t => `<span class="policy-tag">${t}</span>`).join('');

                // 构建效果描述
                const effectLines = this._buildPolicyEffectLines(catKey, opt);

                html += `
                    <div class="policy-option-card ${isCurrent ? 'policy-active' : ''} ${isDisabled ? 'policy-disabled' : ''}"
                         data-category="${catKey}" data-policy="${opt.id}">
                        <div class="policy-option-header">
                            <span class="policy-option-icon">${opt.icon}</span>
                            <span class="policy-option-name">${opt.name}</span>
                            ${isCurrent ? '<span class="policy-current-badge">当前</span>' : ''}
                        </div>
                        <div class="policy-option-desc">${opt.description}</div>
                        <div class="policy-option-effects">${effectLines}</div>
                        <div class="policy-option-tags">${tags}</div>
                    </div>
                `;
            }

            html += `</div></div>`;
        }

        contentEl.innerHTML = html;

        // 绑定点击事件
        contentEl.querySelectorAll('.policy-option-card').forEach(card => {
            card.addEventListener('click', () => {
                if (card.classList.contains('policy-disabled') || card.classList.contains('policy-active')) return;
                const category = card.dataset.category;
                const policyId = card.dataset.policy;
                const result = this.policySystem.changePolicy(category, policyId);
                if (!result.success) {
                    this.showToast(`⚠️ ${result.reason}`, 'warning');
                } else {
                    this.renderPolicyPanel();
                }
            });
        });
    }

    /** 构建单个政策选项的效果描述 HTML */
    _buildPolicyEffectLines(category, opt) {
        const lines = [];
        switch (category) {
            case 'workHours':
                lines.push(`⏰ 工作 ${opt.workStart}:00-${opt.workEnd}:00`);
                lines.push(`📈 产出 ×${opt.productionMult}`);
                if (opt.dailyMoodDelta > 0) lines.push(`😊 心情 +${opt.dailyMoodDelta}/天`);
                else if (opt.dailyMoodDelta < 0) lines.push(`😞 心情 ${opt.dailyMoodDelta}/天`);
                else lines.push(`😐 心情 ±0/天`);
                if (opt.staminaRecoveryMult !== 1.0) lines.push(`💪 体力恢复 ×${opt.staminaRecoveryMult}`);
                break;
            case 'distribution':
                lines.push(`📦 入库 ${Math.round(opt.storageRate * 100)}%`);
                lines.push(`⚡ 效率 ×${opt.efficiencyMult}`);
                if (opt.dailyMoodDelta !== 0) lines.push(`${opt.dailyMoodDelta > 0 ? '😊' : '😞'} 心情 ${opt.dailyMoodDelta > 0 ? '+' : ''}${opt.dailyMoodDelta}/天`);
                if (opt.skillGrowthMult !== 1.0) lines.push(`📚 技能成长 ×${opt.skillGrowthMult}`);
                if (opt.scalperChance) lines.push(`⚠️ 倒爷风险 ${Math.round(opt.scalperChance * 100)}%`);
                break;
            case 'reward':
                if (opt.dailyGoldCost > 0) lines.push(`💰 每人每天 -${opt.dailyGoldCost}💰`);
                else lines.push(`💰 无额外开销`);
                if (opt.rebelPenalty !== 1.0) lines.push(`😤 叛逆偏差 ×${opt.rebelPenalty}`);
                if (opt.lazyPenalty !== 1.0) lines.push(`🚶 懒惰偏差 ×${opt.lazyPenalty}`);
                if (opt.dailyMoodDelta !== 0) lines.push(`${opt.dailyMoodDelta > 0 ? '😊' : '😞'} 心情 ${opt.dailyMoodDelta > 0 ? '+' : ''}${opt.dailyMoodDelta}/天`);
                break;
            case 'holiday':
                if (opt.restDays.length > 0) lines.push(`📅 休息日：每季第${opt.restDays.join(',')}天`);
                else lines.push(`🚫 全年无休`);
                if (opt.restDayMoodBonus) lines.push(`🏖️ 休息日心情 +${opt.restDayMoodBonus}`);
                if (opt.restDayStaminaRestore) lines.push(`💪 休息日体力全恢复`);
                if (opt.continuousWorkThreshold < Infinity) lines.push(`⚠️ 连续${opt.continuousWorkThreshold}天后疲劳`);
                break;
        }
        return lines.map(l => `<div class="policy-effect-line">${l}</div>`).join('');
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
