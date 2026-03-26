/**
 * main.js - 治村物语 入口文件
 * 初始化所有游戏系统并启动游戏
 */

import { EventBus } from './core/EventBus.js';
import { GameState } from './core/GameState.js';
import { TimeSystem } from './core/TimeSystem.js';
import { SaveSystem } from './core/SaveSystem.js';
import { SoundManager } from './core/SoundManager.js';
import { UIManager } from './ui/UIManager.js';
import { MAX_MOOD } from './config/villagers.js';

// 系统模块
import { FarmSystem } from './systems/FarmSystem.js';
import { BuildingSystem } from './systems/BuildingSystem.js';
import { VillagerSystem } from './systems/VillagerSystem.js';
import { EconomySystem } from './systems/EconomySystem.js';
import { WeatherSystem } from './systems/WeatherSystem.js';
import { VillagerScheduler } from './systems/VillagerScheduler.js';
import { EventSystem } from './systems/EventSystem.js';
import { PersonalitySystem } from './systems/PersonalitySystem.js';
import { PolicySystem } from './systems/PolicySystem.js';
import { TutorialSystem } from './systems/TutorialSystem.js';
import { ProsperitySystem } from './systems/ProsperitySystem.js';
import { DailySummary } from './systems/DailySummary.js';
import { NPCChatSystem } from './systems/NPCChatSystem.js';
import { MeetingSystem } from './systems/MeetingSystem.js';
import { FishingSystem } from './systems/FishingSystem.js';
import { NeighborSystem } from './systems/NeighborSystem.js';
import { MarketEngine } from './market/MarketEngine.js';

// AI 模块
import { AIService } from './ai/AIService.js';
import { VillagerAI } from './ai/VillagerAI.js';
import { MarketAnalyst } from './ai/MarketAnalyst.js';
import { WeatherForecaster } from './ai/WeatherForecaster.js';
import { ContextCompressor } from './ai/ContextCompressor.js';

// UI 模块
import { DialogueManager } from './ui/DialogueBox.js';
import { RecruitReveal } from './ui/RecruitReveal.js';
import { PriceChart } from './market/PriceChart.js';
import { FishingPanel } from './ui/FishingPanel.js';
import { GameRulesHelper } from './ui/GameRulesHelper.js';

// 3D 沙盘（懒加载，失败不影响游戏）
let VillageDiorama = null;
try {
    const mod = await import('./ui/VillageDiorama.js');
    VillageDiorama = mod.VillageDiorama;
    console.log('[Main] 🗺️ 3D 沙盘模块加载成功');
} catch (e) {
    console.warn('[Main] 3D 沙盘模块不可用（Three.js 未加载）:', e.message);
}

// 配置暴露到全局（供 UIManager 等使用）
import { SEASON_DEFAULT, SPECIAL_WEATHER_EVENTS } from './config/weather.js';
import { MARKET_ITEMS } from './config/marketItems.js';
window.SEASON_DEFAULT = SEASON_DEFAULT;
window.SPECIAL_WEATHER_EVENTS = SPECIAL_WEATHER_EVENTS;
window.MARKET_ITEMS = MARKET_ITEMS;

// ===== 全局实例 =====
const eventBus = new EventBus();
const gameState = GameState;
const timeSystem = new TimeSystem(gameState, eventBus);
const saveSystem = new SaveSystem(gameState, eventBus);

// ===== 加载配置（localStorage 优先，回退 config.json） =====
let config = {};
try {
    // 优先使用玩家在前端配置的设置
    const localConfig = localStorage.getItem('villord_config');
    if (localConfig) {
        config = JSON.parse(localConfig);
        console.log('[Main] 使用玩家自定义配置:', { baseUrl: config.baseUrl, model: config.model });
    } else {
        const resp = await fetch('./config.json');
        config = await resp.json();
        console.log('[Main] 使用 config.json 配置:', { baseUrl: config.baseUrl, model: config.model });
    }
} catch (e) {
    console.warn('[Main] 配置加载失败，AI 功能将降级:', e.message);
}

// ===== 初始化 AI 服务 =====
const aiService = new AIService(config);
aiService.setEventBus(eventBus); // 允许关键调用暂停/恢复游戏

// ===== 初始化游戏系统 =====
const weatherSystem = new WeatherSystem(gameState, eventBus, aiService);
const marketEngine = new MarketEngine(gameState, eventBus);
marketEngine.setAI(aiService);
const farmSystem = new FarmSystem(gameState, eventBus);
const buildingSystem = new BuildingSystem(gameState, eventBus);
const villagerSystem = new VillagerSystem(gameState, eventBus);
const economySystem = new EconomySystem(gameState, eventBus);
const villagerAI = new VillagerAI(aiService, gameState, eventBus);
const villagerScheduler = new VillagerScheduler(gameState, eventBus, aiService, villagerSystem, farmSystem);
villagerAI.setScheduler(villagerScheduler); // B4: 注入调度器引用
const marketAnalyst = new MarketAnalyst(aiService, gameState, eventBus, marketEngine);
const weatherForecaster = new WeatherForecaster(aiService, gameState, eventBus, weatherSystem);

// 初始化天气面板点击事件（在首次播报前也可用）
const weatherPanel = document.getElementById('weather-panel');
if (weatherPanel) {
    weatherPanel.onclick = () => {
        const weatherSysInst = weatherSystem;
        const effects = weatherSysInst.getCurrentEffects?.() || {};
        const name = weatherSysInst.getCurrentWeatherName?.() || '正常';
        weatherForecaster.showWeatherDetailModal(name, effects, '');
    };
}
const contextCompressor = new ContextCompressor(aiService, gameState, eventBus);
const priceChart = new PriceChart('price-chart-container');
priceChart.init(marketEngine);
const personalitySystem = new PersonalitySystem(gameState, eventBus);
const policySystem = new PolicySystem(gameState, eventBus);
const prosperitySystem = new ProsperitySystem(gameState, eventBus);
const dailySummary = new DailySummary(aiService, gameState, eventBus);
const npcChatSystem = new NPCChatSystem(aiService, gameState, eventBus);
const meetingSystem = new MeetingSystem(aiService, gameState, eventBus);
const fishingSystem = new FishingSystem(gameState, eventBus);
const fishingPanel = new FishingPanel(gameState, eventBus, fishingSystem);
const neighborSystem = new NeighborSystem(gameState, eventBus, null, aiService); // uiManager set later

// 注入 MeetingSystem 到需要访问会议上下文的模块
villagerAI.setMeetingSystem(meetingSystem);
villagerScheduler.setMeetingSystem(meetingSystem);
npcChatSystem.setMeetingSystem(meetingSystem);
dailySummary.setMeetingSystem(meetingSystem);

// ===== 初始化 UI =====
const uiManager = new UIManager(gameState, eventBus, timeSystem);

// ===== 自动暂停处理 =====
eventBus.on('autoPause', (data) => {
    if (!gameState.time.isPaused) {
        timeSystem.pause();
        gameState.addLog('⏸', `自动暂停：${data.reason}`, 'warning');
        uiManager.showToast(`⏸ ${data.reason}`, 'info');
    }
});

// ===== AI 关键调用：暂停/恢复/警告 =====
eventBus.on('aiPauseGame', (data) => {
    if (!gameState.time.isPaused) {
        timeSystem.pause();
        console.log(`[AI] 关键调用暂停游戏: ${data.reason}`);
    }
});
eventBus.on('aiResumeGame', () => {
    if (gameState.time.isPaused) {
        timeSystem.resume();
        console.log('[AI] 关键调用完成，恢复游戏');
    }
});
eventBus.on('aiWarningModal', (data) => {
    uiManager.showModal(data.title, `<div style="white-space:pre-line;font-size:14px;line-height:1.6;">${data.message}</div>`, [
        { id: 'ai-warn-ok', text: '知道了', class: 'btn-primary', onClick: () => {} },
    ]);
});

// AI 关键调用最终失败：暂停游戏，弹窗让玩家确认后才恢复（防止级联失败）
eventBus.on('aiCriticalFailure', (data) => {
    uiManager.showModal(
        `⚠️ ${data.label} 生成失败`,
        `<div style="white-space:pre-line;font-size:14px;line-height:1.6;">${data.message}</div>`,
        [
            {
                id: 'ai-fail-ok',
                text: '知道了，继续游戏',
                class: 'btn-primary',
                onClick: () => {
                    timeSystem.resume();
                    console.log('[AI] 玩家确认关键调用失败，恢复游戏（降级模式）');
                },
            },
        ]
    );
});

const dialogueManager = new DialogueManager(gameState, eventBus, villagerAI, uiManager);
dialogueManager.setTimeSystem(timeSystem);
const recruitReveal = new RecruitReveal(gameState, eventBus, uiManager);
const eventSystem = new EventSystem(gameState, eventBus, uiManager);
const tutorialSystem = new TutorialSystem(gameState, eventBus, uiManager);

// ===== 规则小助手初始化 =====
const gameRulesHelper = new GameRulesHelper(gameState, aiService, eventBus);
window.gameRulesHelper = gameRulesHelper; // 暴露给全局供规则弹窗调用

// ===== 3D 沙盘初始化 =====
let villageDiorama = null;
if (VillageDiorama) {
    villageDiorama = new VillageDiorama(gameState, eventBus);
}

// ===== 注册子面板 =====
uiManager.registerPanel('build', buildingSystem);
uiManager.registerPanel('villagers', uiManager.villagerPanel);
uiManager.registerPanel('farm', farmSystem);
uiManager.registerPanel('market', marketEngine);
uiManager.registerPanel('fishing', fishingPanel);
if (villageDiorama) uiManager.registerPanel('diorama', villageDiorama);
neighborSystem.ui = uiManager;
uiManager.registerPanel('neighbor', neighborSystem);
uiManager.registerPanel('policy', policySystem);
uiManager.registerPanel('events', dailySummary);

// 连接政策系统与 UI
uiManager.setPolicySystem(policySystem);

// ===== 繁荣度点击事件 =====
const prosperityClickable = document.getElementById('prosperity-clickable');
if (prosperityClickable) {
    prosperityClickable.addEventListener('click', () => prosperitySystem.showProsperityModal());
}

// ===== 标签页切换事件 =====
eventBus.on('switchTab', (data) => {
    uiManager.switchTab(data.tab);
});

// ===== 解雇事件 =====
eventBus.on('dismissRequest', (data) => {
    uiManager.showModal('👋 确认解雇？', `
        <p>解雇将返还 20💰，但其他村民心情 -1。</p>
        <p>确定要解雇吗？</p>
    `, [
        { id: 'cancel', text: '取消', class: 'btn-secondary', onClick: () => {} },
        { id: 'confirm', text: '确认解雇', class: 'btn-danger', onClick: () => {
            villagerSystem.dismiss(data.villagerId);
            uiManager.updateAll();
            uiManager.updateVillagerSelect();
        }},
    ]);
});

// ===== UI 更新事件 =====
eventBus.on('uiUpdate', () => {
    uiManager.updateAll();
});

// ===== 最高等级达成事件 =====
eventBus.on('gameWin', (data) => {
    uiManager.showModal('🏆 传说桃源达成！', `
        <p style="font-size:18px;text-align:center;margin-bottom:16px;">👑 桃源村已成为传说中的桃源！</p>
        <div style="text-align:center;">
            <p>🏘️ 村民：${gameState.villagers.length}人</p>
            <p>🏗️ 建筑：${gameState.buildings.length}座</p>
            <p>🌾 农田：${gameState.plots.length}块</p>
            <p>💰 金币：${gameState.resources.gold}</p>
            <p>⭐ 繁荣度：${gameState.prosperityData.total}（传说桃源）</p>
        </div>
        <p style="text-align:center;margin-top:16px;color:var(--text-secondary);">你可以继续游戏，繁荣度会继续增长~</p>
    `, [
        { id: 'continue', text: '继续游戏', class: 'btn-primary', onClick: () => {} },
        { id: 'save', text: '💾 存档', class: 'btn-gold', onClick: () => saveSystem.save('win') },
    ]);
});

// ===== 启动：检查存档并让玩家选择 =====
function showStartScreen() {
    const hasManual = saveSystem.hasSave('manual');
    const hasAuto = saveSystem.hasSave('auto');
    const hasSave = hasManual || hasAuto;

    let saveInfoHTML = '';
    if (hasSave) {
        const manualInfo = saveSystem.getSaveInfo('manual');
        const autoInfo = saveSystem.getSaveInfo('auto');
        if (manualInfo) {
            saveInfoHTML += `<div style="background:var(--surface);padding:12px;border-radius:8px;margin-bottom:8px;">
                <div style="font-weight:600;">💾 手动存档</div>
                <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
                    游戏进度：${manualInfo.gameTime}<br>保存时间：${manualInfo.dateString}
                </div>
            </div>`;
        }
        if (autoInfo) {
            saveInfoHTML += `<div style="background:var(--surface);padding:12px;border-radius:8px;">
                <div style="font-weight:600;">🔄 自动存档</div>
                <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
                    游戏进度：${autoInfo.gameTime}<br>保存时间：${autoInfo.dateString}${autoInfo.reason ? '<br>触发：' + autoInfo.reason : ''}
                </div>
            </div>`;
        }
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
        <div class="modal fade-in" style="max-width:480px;text-align:center;">
            <div style="font-size:48px;margin-bottom:8px;">🏘️</div>
            <div class="modal-title" style="font-size:24px;margin-bottom:4px;">治村物语</div>
            <div style="color:var(--text-secondary);margin-bottom:20px;">AI 村长模拟器</div>
            ${hasSave ? `<div style="text-align:left;margin-bottom:20px;">${saveInfoHTML}</div>` : ''}
            <div class="modal-actions" style="flex-direction:column;gap:12px;">
                ${hasSave ? `
                    <button class="btn btn-primary" id="start-continue" style="width:100%;padding:12px;font-size:15px;">
                        📂 继续游戏
                    </button>
                ` : ''}
                <button class="btn ${hasSave ? 'btn-secondary' : 'btn-primary'}" id="start-new" style="width:100%;padding:12px;font-size:15px;">
                    🌱 开始新游戏
                </button>
                <button class="btn btn-ghost" id="start-rules" style="width:100%;padding:10px;font-size:13px;color:var(--text-secondary);">
                    📖 游戏规则与玩法介绍
                </button>
                <button class="btn btn-ghost" id="start-config" style="width:100%;padding:10px;font-size:13px;color:var(--text-secondary);">
                    ⚙️ AI 服务配置
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // 继续游戏
    if (hasSave) {
        overlay.querySelector('#start-continue').addEventListener('click', () => {
            overlay.remove();
            // 优先加载手动存档，其次自动存档
            const slot = hasManual ? 'manual' : 'auto';
            const result = saveSystem.load(slot);
            if (result.success) {
                // 迁移旧版住房数据（hut/woodHouse/stoneHouse → house+level）
                buildingSystem.migrateOldHousing();
                // 重新初始化市场价格引擎（用存档中的价格）
                marketEngine.initPricesFromState();
                weatherSystem.init();
                uiManager.updateAll();
                uiManager.updateSeasonTheme();
                uiManager.updateVillagerSelect();
                uiManager.showToast(`📂 已继续游戏 (${result.gameTime})`, 'success');
                // 自动开始时间
                timeSystem.resume();
            } else {
                // 读档失败，走新游戏流程
                initNewGame();
            }
            initChatBar();
        });
    }

    // 新游戏
    overlay.querySelector('#start-new').addEventListener('click', () => {
        const startNewGameFlow = () => {
            initNewGame();
            initChatBar();
            // 新游戏：在暂停状态下展示初始教程序列
            // 全部教程确认后自动开始时间
            tutorialSystem.showInitialTutorial(() => {
                timeSystem.resume();
                uiManager.showToast('🎮 游戏开始！祝你好运，村长！', 'success');
            });
        };

        if (hasSave) {
            // 二次确认
            const confirmOverlay = document.createElement('div');
            confirmOverlay.className = 'modal-overlay';
            confirmOverlay.style.zIndex = '10000';
            confirmOverlay.innerHTML = `
                <div class="modal fade-in" style="max-width:360px;text-align:center;">
                    <div class="modal-title">⚠️ 确认开始新游戏？</div>
                    <div class="modal-body"><p>旧的存档将被<b>永久清除</b>，无法恢复。</p></div>
                    <div class="modal-actions">
                        <button class="btn btn-secondary" id="confirm-cancel">取消</button>
                        <button class="btn btn-danger" id="confirm-new">确认，开始新游戏</button>
                    </div>
                </div>
            `;
            document.body.appendChild(confirmOverlay);
            confirmOverlay.querySelector('#confirm-cancel').addEventListener('click', () => confirmOverlay.remove());
            confirmOverlay.querySelector('#confirm-new').addEventListener('click', () => {
                confirmOverlay.remove();
                overlay.remove();
                // 清除所有存档
                saveSystem.deleteSave('manual');
                saveSystem.deleteSave('auto');
                saveSystem.deleteSave('win');
                startNewGameFlow();
            });
        } else {
            overlay.remove();
            startNewGameFlow();
        }
    });

    // 游戏规则
    overlay.querySelector('#start-rules').addEventListener('click', () => {
        showGameRulesModal();
    });

    // AI 配置
    overlay.querySelector('#start-config').addEventListener('click', () => {
        showConfigModal();
    });
}

// ===== 初始化新游戏 =====
function fillInitialStorageToCapacity() {
    const addResource = (type, amount) => {
        const canAdd = Math.min(amount, gameState.getStorageSpace(type));
        gameState.resources[type] += canAdd;
        return canAdd;
    };
    const addSeed = (seedType, amount) => {
        if (!gameState.resources.seeds || gameState.resources.seeds[seedType] === undefined) return 0;
        const canAdd = Math.min(amount, gameState.getStorageSpace('seeds'));
        gameState.resources.seeds[seedType] += canAdd;
        return canAdd;
    };

    // 清空库存与资源（金币不变）
    gameState.resources.food = 0; // 废弃字段，保持为0
    gameState.resources.wood = 0;
    gameState.resources.stone = 0;
    Object.keys(gameState.resources.seeds || {}).forEach(type => {
        gameState.resources.seeds[type] = 0;
    });
    Object.keys(gameState.inventory || {}).forEach(type => {
        gameState.inventory[type] = 0;
    });

    // 基础物资
    gameState.inventory.wheat = 20;  // 小麦 = 粮食
    addResource('wood', 30);
    addResource('stone', 15);
    addSeed('radish', 5);
    addSeed('wheat', 3);

    gameState.resetDailyChanges();
}

function initNewGame() {
    console.log('[Main] 🏘️ 治村物语 新游戏初始化...');

    // 重置村民列表，确保初始村民固定
    gameState.villagers = [];

    // 赠送初始建筑：2块农田 + 1座茅草屋
    buildingSystem.buildInitial();

    // 初始资源按仓库总容量分配
    fillInitialStorageToCapacity();

    // 赠送初始村民："小青"（勤劳·乐观）
    villagerSystem.addInitialVillager();

    // 初始化市场价格
    marketEngine.initPrices();

    // 天气系统初始化
    weatherSystem.init();

    // 记录初始事件日志
    gameState.addLog('🏘️', '欢迎来到桃源村！你是这里的新村长。', 'success');
    gameState.addLog('🌱', '系统赠送：2块农田 + 1座茅草屋 + 村民小青', 'info');
    gameState.addLog('💡', '提示：建造房屋后才能招募更多村民', 'info');

    // 初始更新 UI
    uiManager.updateAll();
    uiManager.updateVillagerSelect();

    console.log('[Main] ✅ 初始化完成，点击 ▶ 开始游戏');
}

// ===== 悬浮聊天气泡：村民快选列表 =====
function initChatBar() {
    const bubble = document.getElementById('chat-bubble');
    const panel = document.getElementById('chat-float-panel');
    const closeBtn = document.getElementById('chat-float-close');

    // 点击气泡 → 打开/关闭面板并刷新村民列表
    bubble.addEventListener('click', () => {
        const isOpen = !panel.classList.contains('chat-float-hidden');
        if (isOpen) {
            panel.classList.add('chat-float-hidden');
        } else {
            refreshChatVillagerList();
            panel.classList.remove('chat-float-hidden');
        }
    });
    closeBtn.addEventListener('click', () => panel.classList.add('chat-float-hidden'));

    // 村民变化时刷新列表（面板打开时）
    eventBus.on('villagerAdded', () => refreshChatVillagerList());
    eventBus.on('villagerRemoved', () => refreshChatVillagerList());
}

/** 刷新悬浮面板中的村民快选列表 */
function refreshChatVillagerList() {
    const container = document.getElementById('chat-villager-list');
    if (!container) return;

    if (gameState.villagers.length === 0) {
        container.innerHTML = '<div class="text-muted" style="text-align:center;padding:24px 0;font-size:13px;">暂无村民，请先招募</div>';
        return;
    }

    container.innerHTML = '';

    // ===== 开村会按钮 =====
    const meetingRow = document.createElement('div');
    meetingRow.className = 'chat-villager-row chat-meeting-row';
    const canMeet = meetingSystem.canStartMeeting();
    const activeDirective = meetingSystem.getActiveDirective();
    meetingRow.innerHTML = `
        <span class="chat-v-avatar">📢</span>
        <div class="chat-v-info">
            <div class="chat-v-name">开村会</div>
            <div class="chat-v-status">${activeDirective
                ? `📌 当前指示：${activeDirective.directive}`
                : '召集全体村民开会讨论村务'}</div>
        </div>
        <span class="chat-v-arrow">›</span>
    `;
    if (!canMeet.ok) {
        meetingRow.style.opacity = '0.5';
        meetingRow.title = canMeet.reason;
        meetingRow.addEventListener('click', () => {
            uiManager.showToast(`❌ ${canMeet.reason}`, 'warning');
        });
    } else {
        meetingRow.addEventListener('click', () => {
            document.getElementById('chat-float-panel').classList.add('chat-float-hidden');
            openMeetingModal();
        });
    }
    container.appendChild(meetingRow);

    // ===== 分割线 =====
    const divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:var(--border-color,#e0e0e0);margin:4px 12px;opacity:0.5;';
    container.appendChild(divider);

    // ===== 村民列表 =====
    gameState.villagers.forEach(v => {
        const moodEmoji = v.mood >= Math.round(MAX_MOOD * 0.6) ? '😊'
            : v.mood >= Math.round(MAX_MOOD * 0.3) ? '😐' : '😟';
        const row = document.createElement('div');
        row.className = 'chat-villager-row';
        row.innerHTML = `
            <span class="chat-v-avatar">${v.avatar || '👤'}</span>
            <div class="chat-v-info">
                <div class="chat-v-name">${v.name}</div>
                <div class="chat-v-status">${moodEmoji} ${v.mood}　💪 ${v.stamina}/${v.maxStamina}　📋 ${v.currentAction || '空闲'}</div>
            </div>
            <span class="chat-v-arrow">›</span>
        `;
        row.addEventListener('click', () => {
            // 关闭面板，直接打开完整对话框
            document.getElementById('chat-float-panel').classList.add('chat-float-hidden');
            eventBus.emit('openDialogue', { villagerId: v.id });
        });
        container.appendChild(row);
    });
}

// ===== 村会弹窗 =====

/** 打开村会弹窗 */
function openMeetingModal() {
    // 暂停游戏
    const wasPaused = gameState.time.isPaused;
    if (!wasPaused) timeSystem.pause();

    const overlay = document.createElement('div');
    overlay.className = 'dialogue-overlay meeting-overlay';

    // 获取活跃指示
    const activeDirective = meetingSystem.getActiveDirective();
    const historyMeetings = meetingSystem.getMeetingHistory(3);

    overlay.innerHTML = `
        <div class="dialogue-box meeting-box">
            <div class="dialogue-header">
                <div class="dialogue-title">📢 村会</div>
                <button class="close-btn meeting-close-btn">✕</button>
            </div>

            ${activeDirective ? `
            <div class="meeting-active-directive">
                <span class="directive-label">📌 当前指示</span>
                <span class="directive-text">${activeDirective.directive}</span>
                <span class="directive-expires">（${activeDirective.dayLabel}发布，还有${Math.max(0, activeDirective.validUntil - gameState.totalDays)}天有效）</span>
            </div>
            ` : ''}

            <div class="meeting-attendees">
                <span class="attendees-label">参会村民：</span>
                ${gameState.villagers.map(v => `<span class="attendee-tag">${v.avatar || '👤'} ${v.name}</span>`).join('')}
            </div>

            <div class="meeting-messages" id="meeting-messages">
                <div class="message system">
                    <div class="message-bubble">— 村会开始，请村长发言 —</div>
                </div>
            </div>

            <div class="dialogue-input meeting-input">
                <input type="text" id="meeting-input-field" placeholder="说点什么吧，村长...（如：接下来重点砍木头，准备建新房子）" maxlength="200">
                <button class="send-btn" id="meeting-send-btn">📢 发言</button>
            </div>

            ${historyMeetings.length > 0 ? `
            <div class="meeting-history-toggle">
                <button class="meeting-history-btn" id="meeting-history-toggle-btn">📜 查看往期会议 (${historyMeetings.length})</button>
            </div>
            <div class="meeting-history" id="meeting-history" style="display:none;">
                ${historyMeetings.map(m => `
                    <div class="meeting-history-item">
                        <div class="meeting-history-header">
                            <span class="meeting-history-date">${m.dayLabel}</span>
                            <span class="meeting-history-directive">📌 ${m.directive}</span>
                        </div>
                        <div class="meeting-history-responses">
                            ${(m.responses || []).map(r => `
                                <span class="meeting-history-response">
                                    ${r.avatar || '👤'} ${r.name}：${r.response}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
            ` : ''}
        </div>
    `;

    document.body.appendChild(overlay);

    // 事件绑定
    const closeBtn = overlay.querySelector('.meeting-close-btn');
    const sendBtn = overlay.querySelector('#meeting-send-btn');
    const inputField = overlay.querySelector('#meeting-input-field');
    const messagesArea = overlay.querySelector('#meeting-messages');
    const historyToggle = overlay.querySelector('#meeting-history-toggle-btn');
    const historyPanel = overlay.querySelector('#meeting-history');

    const closeModal = () => {
        overlay.remove();
        if (!wasPaused) timeSystem.resume();
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // 历史切换
    if (historyToggle && historyPanel) {
        historyToggle.addEventListener('click', () => {
            const isHidden = historyPanel.style.display === 'none';
            historyPanel.style.display = isHidden ? 'block' : 'none';
            historyToggle.textContent = isHidden
                ? '📜 收起往期会议'
                : `📜 查看往期会议 (${historyMeetings.length})`;
        });
    }

    // 发送
    let isSending = false;

    async function sendMeetingSpeech() {
        if (isSending) return;
        const text = inputField.value.trim();
        if (!text) return;

        isSending = true;
        sendBtn.disabled = true;
        sendBtn.textContent = '⏳ 思考中...';
        inputField.disabled = true;

        // 显示村长发言
        const playerMsg = document.createElement('div');
        playerMsg.className = 'message player';
        playerMsg.innerHTML = `
            <div class="message-avatar">👑</div>
            <div class="message-bubble">${text}</div>
        `;
        messagesArea.appendChild(playerMsg);

        // 显示加载中
        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'message system';
        loadingMsg.innerHTML = `<div class="message-bubble">🤔 村民们正在思考...</div>`;
        messagesArea.appendChild(loadingMsg);
        messagesArea.scrollTop = messagesArea.scrollHeight;

        // 调用 MeetingSystem
        inputField.value = '';
        const result = await meetingSystem.holdMeeting(text);

        // 移除加载中
        loadingMsg.remove();

        if (result.success) {
            const meeting = result.meeting;

            // 显示指示摘要
            const directiveMsg = document.createElement('div');
            directiveMsg.className = 'message system';
            directiveMsg.innerHTML = `<div class="message-bubble meeting-directive-msg">📌 工作指示：${meeting.directive}（有效${Math.max(0, meeting.validUntil - gameState.totalDays)}天）</div>`;
            messagesArea.appendChild(directiveMsg);

            // 依次显示每位村民的回应（带动画延迟）
            for (let i = 0; i < meeting.responses.length; i++) {
                const r = meeting.responses[i];
                await new Promise(resolve => setTimeout(resolve, 300));

                const attitudeEmoji = {
                    support: '👍',
                    hesitant: '😅',
                    question: '🤔',
                    confused: '😵',
                }[r.attitude] || '💬';

                const villagerMsg = document.createElement('div');
                villagerMsg.className = 'message villager';
                villagerMsg.innerHTML = `
                    <div class="message-avatar">${r.avatar || '👤'}</div>
                    <div class="message-bubble">
                        <div class="meeting-response-name">${r.name} ${attitudeEmoji}</div>
                        <div>${r.response}</div>
                    </div>
                `;
                messagesArea.appendChild(villagerMsg);
                messagesArea.scrollTop = messagesArea.scrollHeight;
            }

            // 自动存档
            saveSystem.autoSave('村会');
        } else {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'message system';
            errorMsg.innerHTML = `<div class="message-bubble" style="color:var(--color-danger);">❌ ${result.error}</div>`;
            messagesArea.appendChild(errorMsg);
        }

        isSending = false;
        sendBtn.disabled = false;
        sendBtn.textContent = '📢 发言';
        inputField.disabled = false;
        inputField.focus();
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    sendBtn.addEventListener('click', sendMeetingSpeech);
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            sendMeetingSpeech();
        }
    });

    inputField.focus();
}

// ===== 顶栏功能按钮 =====
function initTopBarButtons() {
    // 存档按钮
    document.getElementById('btn-save')?.addEventListener('click', () => {
        saveSystem.save('manual');
        uiManager.showToast('💾 游戏已保存', 'success');
    });

    // 设置按钮
    document.getElementById('btn-config')?.addEventListener('click', () => showConfigModal());

    // 帮助按钮
    document.getElementById('btn-help')?.addEventListener('click', () => showGameRulesModal());

    // 退出按钮
    document.getElementById('btn-exit')?.addEventListener('click', () => {
        uiManager.showModal('🚪 退出游戏', '<p>是否保存并退出？退出后将返回主菜单。</p>', [
            { id: 'cancel', text: '取消', class: 'btn-secondary', onClick: () => {} },
            { id: 'save-exit', text: '💾 保存并退出', class: 'btn-primary', onClick: () => {
                timeSystem.pause();
                saveSystem.save('manual');
                uiManager.showToast('💾 已保存，正在退出...', 'success');
                setTimeout(() => location.reload(), 600);
            }},
            { id: 'exit-no-save', text: '直接退出', class: 'btn-danger', onClick: () => {
                timeSystem.pause();
                location.reload();
            }},
        ]);
    });
}

// ===== 配置模态框 =====
function showConfigModal() {
    const currentConfig = { ...config };
    // 尝试从 localStorage 读取最新配置
    try {
        const stored = localStorage.getItem('villord_config');
        if (stored) Object.assign(currentConfig, JSON.parse(stored));
    } catch (e) {}

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10001';
    overlay.innerHTML = `
        <div class="modal fade-in" style="max-width:500px;">
            <div class="modal-title">⚙️ AI 服务配置</div>
            <div class="modal-body" style="text-align:left;">
                <div style="background:rgba(91,140,90,0.08);border:1px solid rgba(91,140,90,0.2);border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;line-height:1.6;">
                    💡 <b>建议</b>：使用生成速度较快的模型（如 <b>doubao-seed-2-0-mini-260215</b>、<b>gpt-4o-mini</b> 等）可显著提升游戏体验。<br>
                    大模型响应越快，村民对话和每日计划生成越流畅，游戏不会频繁暂停等待。<br>
                    如果没有 API Key，可以前往 <a href="https://www.volcengine.com/" target="_blank" style="color:var(--primary);text-decoration:underline;">火山引擎官网</a> 注册并获取豆包模型的 API Key。
                </div>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <label style="font-size:13px;font-weight:500;">
                        API Base URL <span style="color:var(--danger,#c62828);">*</span>
                        <input id="cfg-baseurl" type="text" value="${currentConfig.baseUrl || ''}" placeholder="例: https://ark.cn-beijing.volces.com/api/v3"
                            style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </label>
                    <label style="font-size:13px;font-weight:500;">
                        API Key <span style="color:var(--danger,#c62828);">*</span>
                        <input id="cfg-apikey" type="password" value="${currentConfig.apiKey || ''}" placeholder="输入你的 API Key"
                            style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </label>
                    <label style="font-size:13px;font-weight:500;">
                        模型名称 <span style="color:var(--danger,#c62828);">*</span>
                        <input id="cfg-model" type="text" value="${currentConfig.model || ''}" placeholder="例: doubao-seed-2-0-mini-260215"
                            style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </label>
                </div>
                <div style="margin-top:12px;font-size:11px;color:var(--text-muted);">
                    🔒 <b>安全声明</b>：您配置的 API Key 仅保存在当前浏览器的本地缓存（Local Storage）中，不会上传到任何第三方服务器。<br>
                    配置保存在浏览器本地，刷新后仍有效。
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" data-action="cancel">取消</button>
                <button class="btn btn-danger" data-action="reset">恢复默认</button>
                <button class="btn btn-primary" data-action="save">保存配置</button>
            </div>
        </div>
    `;

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());

    overlay.querySelector('[data-action="reset"]').addEventListener('click', () => {
        localStorage.removeItem('villord_config');
        overlay.remove();
        uiManager.showToast('🔄 已恢复默认配置，刷新页面后生效', 'info');
    });

    overlay.querySelector('[data-action="save"]').addEventListener('click', () => {
        const newConfig = {
            baseUrl: document.getElementById('cfg-baseurl').value.trim(),
            apiKey: document.getElementById('cfg-apikey').value.trim(),
            model: document.getElementById('cfg-model').value.trim(),
        };

        if (!newConfig.baseUrl || !newConfig.apiKey || !newConfig.model) {
            uiManager.showToast('⚠️ 请填写必填项（Base URL、API Key、模型名称）', 'warning');
            return;
        }

        // 保存到 localStorage
        localStorage.setItem('villord_config', JSON.stringify(newConfig));

        // 热更新当前 AI 服务配置
        Object.assign(config, newConfig);
        aiService.updateConfig(newConfig);

        overlay.remove();
        uiManager.showToast('✅ 配置已保存并生效', 'success');
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}
window.showConfigModal = showConfigModal;

// ===== 存档/读档快捷键 =====
document.addEventListener('keydown', (e) => {
    // Ctrl+S 存档
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveSystem.save('manual');
        uiManager.showToast('💾 游戏已保存', 'success');
    }

    // Ctrl+L 读档
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        const result = saveSystem.load('manual');
        if (result.success) {
            buildingSystem.migrateOldHousing();
            uiManager.updateAll();
            uiManager.updateSeasonTheme();
            uiManager.updateVillagerSelect();
            uiManager.showToast(`📂 已加载存档 (${result.gameTime})`, 'success');
        } else {
            uiManager.showToast('❌ 没有找到存档', 'warning');
        }
    }

    // Space 键已分配给钓鱼模块，暂停请使用顶栏按钮
});

// ===== 游戏规则弹窗 =====
function showGameRulesModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10001';
    overlay.innerHTML = `
        <div class="modal fade-in" style="max-width:600px;max-height:80vh;overflow-y:auto;">
            <div class="modal-title">📖 游戏规则与玩法介绍</div>
            <div class="modal-body" style="line-height:1.9;text-align:left;">
                <!-- 游戏助手入口 -->
                <div class="game-helper-banner" onclick="this.closest('.modal-overlay').remove();showRulesHelperModal();">
                    <span class="helper-icon">🤖</span>
                    <div class="helper-content">
                        <div class="helper-title">游戏助手「小村助」</div>
                        <div class="helper-subtitle">有问必答 · 智能建议 · 点击开始对话</div>
                    </div>
                    <span class="helper-action">💬</span>
                </div>

                <h4 style="margin:0 0 8px;">🎯 游戏目标</h4>
                <p>你是桃源村的新村长，目标是将小村庄建设成繁荣的社区。不断提升<b>繁荣度</b>，解锁更高等级，向「👑 传说桃源」迈进！</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">💡 新手攻略建议</h4>
                <p style="font-size:13px;line-height:2;">
                    <b>① 建鱼塘</b> — 开局优先建造鱼塘，钓鱼后到市场卖出换取启动资金<br>
                    <b>② 建伐木场</b> — 用金币买入木材，建造伐木场后村民就能帮你伐木了<br>
                    <b>③ 扩建房屋</b> — 攒够金币和木材后建房，然后招募村民壮大队伍<br>
                    <b>④ 建采石场</b> — 继续积累资源，建造采石场解锁石材产出<br>
                    <b>⑤ 持续发展</b> — 扩建农田、招募更多村民、升级建筑，迈向繁荣！
                </p>
                <p style="font-size:12px;color:var(--text-secondary);margin-top:4px;">
                    📌 小贴士：繁荣度达到新等级可以<b>领取金币奖励</b>；收获的农作物可以<b>卖出换金币</b>；任何时候金币不够，都可以去<b>钓鱼卖鱼</b>补充收入！
                </p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">⏰ 时间系统</h4>
                <p>游戏以 <b>Tick</b> 为单位推进，1 Tick = 1 游戏小时，1天 = 24 Tick。</p>
                <p><b>1 Tick = 现实 3 秒</b>（1倍速下），即现实 72 秒 = 游戏 1 天。</p>
                <p><b>1 季 = 5 天</b>，春→夏→秋→冬，<b>1 年 = 4 季 = 20 天</b>。</p>
                <p>可通过右上角按钮调节速度（0.5x / 1x / 1.5x），点击暂停按钮暂停/恢复。</p>
                <p>重要事件发生时游戏会自动暂停，给你时间做决策。</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">👥 村民系统</h4>
                <p>• 每个村民有<b>性格</b>（勤劳/懒惰/聪明/愚笨等）和<b>特长</b></p>
                <p>• 招募村民需要<b>50💰</b>和空余房屋，招募是盲抽机制</p>
                <p>• 通过底部对话栏与村民交流，可以安排任务</p>
                <p>• AI 会每隔一天自动为村民安排行动计划</p>
                <p>• 注意管理村民的<b>体力</b>和<b>心情</b>！</p>
                <p style="margin-top:6px;"><b>🔧 村民可以做的事：</b></p>
                <p style="padding-left:12px;font-size:13px;">🌾 种植/浇水/施肥/收获 — 打理农田<br>🪓 伐木 — 需先建造<b>伐木场</b><br>⛏️ 采石 — 需先建造<b>采石场</b><br>🛒 市场交易 — 买卖商品赚取差价<br>🍚 吃饭/休息/闲逛/聊天 — 恢复体力和心情</p>
                <p style="padding-left:12px;font-size:13px;color:var(--text-secondary);">🎣 钓鱼 — <b>仅限玩家亲自操作</b>，村民无法钓鱼</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">🌾 农业系统</h4>
                <p>• 在农田中种植作物，需要<b>种子</b>和<b>浇水</b></p>
                <p>• <b>施肥</b>可提升产量 30%，每块田每茬只能施一次</p>
                <p>• 作物有生长周期，受天气和季节影响</p>
                <p>• 收获后可以在市场出售赚取金币</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">🎣 钓鱼系统</h4>
                <p>• 建造<b>鱼塘</b>后解锁，<b>仅限玩家亲自操作</b>（村民不会钓鱼）</p>
                <p>• 操作：点击抛竿 → 等鱼咬钩 → 时机点击 → 拉杆搏斗</p>
                <p>• 共 8 种鱼（普通→传说），钓到的鱼可在<b>市场卖出换金币</b></p>
                <p>• 连续成功不跑鱼可触发<b>连击</b>特效</p>
                <p>• 鱼塘可升级（3 级），提升鱼群容量</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">🛒 市场经济</h4>
                <p>• <b>市场开放时间：9:00 - 18:00</b>，非营业时间无法交易</p>
                <p>• 市场价格实时波动，受供需、季节、天气影响</p>
                <p>• ☀️ 每天 5:00 AI 分析师发布早报（走势预测）</p>
                <p>• 🌙 每天 19:00 发布晚报（交易回顾 + 毒舌点评）</p>
                <p>• 低买高卖，把握天气和季节变化带来的商机</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">🌤️ 天气系统</h4>
                <p>• 每天 5:00 天气播报，每季有特殊天气事件</p>
                <p>• 特殊天气会影响作物生长、村民体力和市场价格</p>
                <p>• AI 天气预报员会提前预测未来 5 天的天气（每季一次）</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">🏗️ 建设系统</h4>
                <p>• 建造<b>住宅</b> → 招募更多村民（住宅可升级：茅草屋→木屋→石屋）</p>
                <p>• 扩建<b>农田</b> → 种植更多作物</p>
                <p>• 建造<b>鱼塘</b> → 解锁钓鱼玩法（可升级3级）</p>
                <p>• 建造<b>伐木场/采石场</b> → 村民可伐木采石</p>
                <p>• 建造<b>磨坊/面包坊</b> → 将小麦加工为面粉、面包（更高价值）</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">📜 政策系统</h4>
                <p>• 在"📜 政策"标签页中管理村庄的四大政策</p>
                <p>• <b>工时制度</b>：朝八晚六 / 996 / 佛系模式，影响工作时间和产出</p>
                <p>• <b>分配制度</b>：产出归公 / 按劳分配 / 自由市场，影响资源入库比例</p>
                <p>• <b>奖惩机制</b>：无奖惩 / 绩效奖金 / 偷懒处罚，影响村民行为偏差</p>
                <p>• <b>休假制度</b>：无休息 / 单休 / 双休，影响村民状态恢复节奏</p>
                <p>• <b style="color:var(--accent);">每种政策都有 trade-off</b>，没有最优解，只有适合当前局势的解</p>
                <p>• 政策切换有 2 天冷却时间，请谨慎决策</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">⭐ 繁荣度系统</h4>
                <p>• 繁荣度为<b>累计制</b>，可增可减（最低为0），无上限</p>
                <p>• 每天根据村民数、建筑、农田、幸福度、资源状况<b>自动增长</b></p>
                <p>• 建造建筑(+5)、招募村民(+10)、收获作物(+2) 额外加分</p>
                <p>• <b style="color:#c62828;">负面状态会导致繁荣度衰减</b>（衰减力度较小）：</p>
                <p style="padding-left:12px;font-size:12px;">村民心情低迷(-1~-2)、饥荒(-2)、金币耗尽(-1)、无村民(-1)、农田荒废(-1)</p>
                <p>• 共 <b>10 个等级</b>，每达到新等级可<b>领取金币奖励</b></p>
                <p>• 点击右侧面板「⭐ 繁荣度」查看等级详情与领取奖励</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">🏘️ 邻村往来</h4>
                <p>• 桃源村周围有 <b>3 个邻村</b>：🌾丰谷村（农业）、⛏️铁岭镇（矿业）、🏮云水乡（商贸）</p>
                <p>• 点击<b>「💬 拜访村长」</b>与邻村村长自由对话，AI 会实时生成回复和建议话术</p>
                <p>• 通过对话、<b>赠礼</b>（每村每天2次）提升好感度</p>
                <p>• 好感度 ≥ 30 解锁<b>村际贸易</b>，各邻村物价有差异，可赚取差价</p>
                <p>• 好感度 ≥ 35 时邻村可能<b>主动送来资源</b>（每村每季最多1次）</p>
                <p>• 邻村可能发来<b>求援请求</b>（每季最多2次），帮助可提升好感度和声望，日后会有回报</p>
                <p>• <b>声望</b>越高，招募费用越低、贸易次数越多</p>
                <p>• <b>超过 5 天不与某邻村互动</b>，好感度会缓慢下降</p>
                <p>• 🤫 可以<b>偷窃</b>邻村资源（每村每季1次），但好感度会大幅下降，35%概率被发现更严重</p>
                <p>• 偷窃记录会被村长记住，影响后续对话态度！</p>
                <p>• 村庄政策也会影响好感度（996 降低，双休提升）</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">⌨️ 快捷键</h4>
                <p><b>Ctrl+S</b> = 存档　<b>Ctrl+L</b> = 读档　<b>空格</b> = 钓鱼操作</p>
            </div>
            <div class="modal-actions">
                <button class="btn btn-primary rules-close" style="width:100%;">知道了</button>
            </div>
        </div>
    `;

    overlay.querySelector('.rules-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

// ===== 游戏助手弹窗 =====
function showRulesHelperModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10002';
    overlay.innerHTML = `
        <div class="modal fade-in rules-helper-modal" style="max-width:500px;height:70vh;display:flex;flex-direction:column;">
            <div class="modal-title" style="flex-shrink:0;">
                🤖 游戏助手「小村助」
                <span style="font-size:12px;color:var(--text-secondary);font-weight:normal;margin-left:8px;">有问必答 · 智能建议</span>
            </div>
            <div class="rules-helper-chat" style="flex:1;overflow-y:auto;padding:12px;border-radius:8px;">
                <div class="chat-messages" id="rules-helper-messages">
                    <div class="chat-msg assistant">
                        <div class="chat-avatar">🤖</div>
                        <div class="chat-bubble">
                            你好呀，村长！我是小村助~ 🎉<br><br>
                            有任何游戏问题都可以问我，比如：<br>
                            • 怎么招募村民？<br>
                            • 市场什么时候开门？<br>
                            • 现在该怎么办？<br><br>
                            我也可以根据你当前的游戏状态给你建议哦！
                        </div>
                    </div>
                </div>
            </div>
            <div class="rules-helper-input" style="flex-shrink:0;display:flex;gap:8px;">
                <input type="text" id="rules-helper-input" placeholder="输入你的问题..." style="flex:1;padding:10px 14px;border-radius:20px;border:1px solid var(--border);background:var(--bg-input, #E8EFE3);color:var(--text-primary);font-size:14px;">
                <button class="btn btn-primary" id="rules-helper-send" style="border-radius:20px;padding:10px 20px;">发送</button>
            </div>
            <div class="rules-helper-quick" style="flex-shrink:0;padding:0 12px 12px;display:flex;flex-wrap:wrap;gap:6px;">
                <button class="btn btn-ghost quick-q" data-q="现在该怎么办？" style="font-size:12px;padding:4px 10px;">💡 给我建议</button>
                <button class="btn btn-ghost quick-q" data-q="新手开局怎么玩？" style="font-size:12px;padding:4px 10px;">🌟 新手指南</button>
                <button class="btn btn-ghost quick-q" data-q="怎么赚钱最快？" style="font-size:12px;padding:4px 10px;">💰 赚钱技巧</button>
                <button class="btn btn-ghost quick-q" data-q="政策怎么选？" style="font-size:12px;padding:4px 10px;">📜 政策建议</button>
            </div>
            <div class="modal-actions" style="flex-shrink:0;border-top:1px solid var(--border);padding-top:12px;">
                <button class="btn btn-secondary helper-back" style="flex:1;">📖 返回游戏说明</button>
                <button class="btn btn-ghost helper-close" style="flex:1;">关闭</button>
            </div>
        </div>
    `;

    const messagesContainer = overlay.querySelector('#rules-helper-messages');
    const inputField = overlay.querySelector('#rules-helper-input');
    const sendBtn = overlay.querySelector('#rules-helper-send');

    // 添加消息到聊天区
    function addMessage(content, isUser = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${isUser ? 'user' : 'assistant'}`;
        msgDiv.innerHTML = `
            <div class="chat-avatar">${isUser ? '👤' : '🤖'}</div>
            <div class="chat-bubble">${content}</div>
        `;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // 发送问题
    async function sendQuestion(presetQuestion) {
        const question = (presetQuestion || inputField.value).trim();
        if (!question) return;

        inputField.value = '';
        addMessage(question, true);

        // 显示加载状态
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'chat-msg assistant loading';
        loadingDiv.innerHTML = '<div class="chat-avatar">🤖</div><div class="chat-bubble">思考中...</div>';
        messagesContainer.appendChild(loadingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        try {
            const answer = await window.gameRulesHelper.askQuestion(question);
            loadingDiv.remove();
            // 将换行符转换为 <br>
            const formattedAnswer = answer.replace(/\n/g, '<br>');
            addMessage(formattedAnswer, false);
        } catch (e) {
            loadingDiv.remove();
            addMessage('抱歉，我遇到了一点问题，请稍后再试~ 😅', false);
        }
    }

    // 绑定事件
    sendBtn.addEventListener('click', sendQuestion);
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendQuestion();
    });

    // 快捷问题
    overlay.querySelectorAll('.quick-q').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.q || '';
            inputField.value = preset;
            sendQuestion(preset);
        });
    });

    // 返回规则
    overlay.querySelector('.helper-back').addEventListener('click', () => {
        overlay.remove();
        showGameRulesModal();
    });

    // 关闭
    overlay.querySelector('.helper-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.body.appendChild(overlay);
    inputField.focus();
}

// 暴露给全局，方便从UI按钮调用
window.showGameRulesModal = showGameRulesModal;
window.showRulesHelperModal = showRulesHelperModal;

// ===== BGM 背景音乐系统（含音量调节） =====
const bgm = (() => {
    const audio = new Audio('./assets/sounds/gbm.mp3');
    audio.preload = 'none';
    audio.loop = true;

    // 默认值
    const DEFAULT_VOLUME = 8; // 0-100

    // 从 localStorage 读取偏好
    const savedMuted = localStorage.getItem('villord_bgm_muted');
    const savedVolume = localStorage.getItem('villord_bgm_volume');
    let volume = savedVolume !== null ? parseInt(savedVolume, 10) : DEFAULT_VOLUME;
    let muted = savedMuted === 'true';

    audio.volume = volume / 100;
    audio.muted = muted;

    let started = false;

    // DOM 引用
    const btnBgm = document.getElementById('btn-bgm');
    const panel = document.getElementById('bgm-panel');
    const muteBtn = document.getElementById('bgm-mute-btn');
    const slider = document.getElementById('bgm-slider');
    const volumeVal = document.getElementById('bgm-volume-val');

    /** 更新所有 UI 状态 */
    function updateUI() {
        // 顶栏按钮图标
        if (btnBgm) {
            btnBgm.textContent = muted ? '🔇' : '🎵';
            btnBgm.classList.toggle('bgm-muted', muted);
        }
        // 静音按钮图标
        if (muteBtn) {
            if (muted || volume === 0) {
                muteBtn.textContent = '🔇';
            } else if (volume < 40) {
                muteBtn.textContent = '🔉';
            } else {
                muteBtn.textContent = '🔊';
            }
        }
        // 滑条值与填充色
        if (slider) {
            slider.value = volume;
            slider.style.setProperty('--slider-pct', `${volume}%`);
        }
        // 百分比文字
        if (volumeVal) {
            volumeVal.textContent = muted ? '静音' : `${volume}%`;
        }
    }

    /** 设置音量 (0-100) */
    function setVolume(val) {
        volume = Math.max(0, Math.min(100, Math.round(val)));
        audio.volume = volume / 100;
        // 调节音量时自动取消静音
        if (volume > 0 && muted) {
            muted = false;
            audio.muted = false;
            localStorage.setItem('villord_bgm_muted', 'false');
        }
        // 音量为0时自动静音
        if (volume === 0) {
            muted = true;
            audio.muted = true;
            localStorage.setItem('villord_bgm_muted', 'true');
        }
        localStorage.setItem('villord_bgm_volume', volume);
        updateUI();
    }

    /** 切换静音 */
    function toggleMute() {
        muted = !muted;
        audio.muted = muted;
        localStorage.setItem('villord_bgm_muted', muted);
        updateUI();
        // 取消静音但尚未播放，尝试播放
        if (!muted && !started) {
            tryPlay();
        }
    }

    /** 尝试播放 */
    function tryPlay() {
        if (started) return;
        audio.play().then(() => {
            started = true;
            console.log('[BGM] 🎵 背景音乐已开始播放');
        }).catch(() => {
            // 浏览器阻止自动播放，等待用户交互
        });
    }

    // --- 事件绑定 ---

    // 点击音乐按钮：展开/收起音量面板
    if (btnBgm && panel) {
        btnBgm.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('open');
            // 首次交互时尝试播放
            if (!started && !muted) tryPlay();
        });
    }

    // 静音按钮
    if (muteBtn) {
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMute();
            // 首次交互时尝试播放
            if (!started && !muted) tryPlay();
        });
    }

    // 滑条拖动
    if (slider) {
        slider.addEventListener('input', (e) => {
            setVolume(parseInt(e.target.value, 10));
            // 首次交互时尝试播放
            if (!started && !muted) tryPlay();
        });
        // 阻止面板内的点击冒泡关闭面板
        slider.addEventListener('click', (e) => e.stopPropagation());
    }

    // 面板内点击不冒泡
    if (panel) {
        panel.addEventListener('click', (e) => e.stopPropagation());
    }

    // 点击页面其他区域关闭面板
    document.addEventListener('click', () => {
        if (panel) panel.classList.remove('open');
    });

    // 首次用户交互时尝试播放（解决浏览器 autoplay 限制）
    const startOnInteraction = () => {
        if (!muted) tryPlay();
        document.removeEventListener('click', startOnInteraction);
        document.removeEventListener('keydown', startOnInteraction);
    };
    document.addEventListener('click', startOnInteraction);
    document.addEventListener('keydown', startOnInteraction);

    // 初始渲染
    updateUI();

    return { audio, setVolume, toggleMute, tryPlay };
})();

// ===== SFX 音效系统 =====
const sfx = new SoundManager();
sfx.registerAll({
    click:   './assets/sounds/click.mp3',
    coin:    './assets/sounds/coin.mp3',
    harvest: './assets/sounds/harvest.mp3',
    recruit: './assets/sounds/recruit.mp3',
    notify:  './assets/sounds/notify.mp3',
    season:  './assets/sounds/season.mp3',
    // 钓鱼音效
    fish_cast:    './assets/sounds/fish/cast.mp3',
    fish_splash:  './assets/sounds/fish/splash.mp3',
    fish_bite:    './assets/sounds/fish/bite.mp3',
    fish_reel:    './assets/sounds/fish/reel.mp3',
    fish_success: './assets/sounds/fish/success.mp3',
    fish_fail:    './assets/sounds/fish/fail.mp3',
    fish_combo:   './assets/sounds/fish/combo.mp3',
});

// --- 绑定事件 → 音效 ---
// 建造完成 → coin（扣费 + 建造反馈）
eventBus.on('buildingBuilt', () => sfx.play('coin'));
// 作物收获 → harvest
eventBus.on('cropHarvested', () => sfx.play('harvest'));
// 招募村民 → recruit
eventBus.on('villagerRecruited', () => sfx.play('recruit'));
// 季节变更 → season
eventBus.on('seasonChange', () => sfx.play('season'));
// Toast 通知 → notify（仅 warning/danger 类型触发，避免过于频繁）
eventBus.on('showToast', (data) => {
    if (data?.type === 'warning' || data?.type === 'danger') {
        sfx.play('notify');
    }
});
// 自动暂停事件（重要提醒） → notify
eventBus.on('autoPause', () => sfx.play('notify'));
// 通关 → recruit（复用庆祝音效）
eventBus.on('gameWin', () => sfx.play('recruit'));
// 市场交易成功 → coin
eventBus.on('marketTrade', () => sfx.play('coin'));
// 钓鱼音效
eventBus.on('fishingCast',    () => sfx.play('fish_cast'));
eventBus.on('fishingSplash',  () => sfx.play('fish_splash'));
eventBus.on('fishingBite',    () => sfx.play('fish_bite'));
eventBus.on('fishingReel',    () => sfx.play('fish_reel'));
eventBus.on('fishingSuccess', () => sfx.play('fish_success'));
eventBus.on('fishingFail',    () => sfx.play('fish_fail'));
eventBus.on('fishingCombo',   () => sfx.play('fish_combo'));

// --- 按钮点击音效（事件委托） ---
document.addEventListener('click', (e) => {
    const target = e.target.closest('.btn, .tab-btn, .speed-btn, .pause-btn, .topbar-icon-btn, .policy-option-card, .send-btn');
    // 排除音量面板内的控件（避免调音量时不停响）
    if (target && !target.closest('.bgm-panel')) {
        sfx.play('click');
    }
});

// --- SFX 音量面板控件 ---
const sfxMuteBtn = document.getElementById('sfx-mute-btn');
const sfxSlider = document.getElementById('sfx-slider');
const sfxVolumeVal = document.getElementById('sfx-volume-val');

function updateSfxUI() {
    const vol = sfx.getVolume();
    const muted = sfx.isMuted();
    if (sfxMuteBtn) {
        sfxMuteBtn.textContent = (muted || vol === 0) ? '🔇' : vol < 40 ? '🔉' : '🔊';
    }
    if (sfxSlider) {
        sfxSlider.value = vol;
        sfxSlider.style.setProperty('--slider-pct', `${vol}%`);
    }
    if (sfxVolumeVal) {
        sfxVolumeVal.textContent = muted ? '静音' : `${vol}%`;
    }
}

if (sfxMuteBtn) {
    sfxMuteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.toggleMute();
        updateSfxUI();
        // 取消静音时播放一个示例音效
        if (!sfx.isMuted()) sfx.play('click');
    });
}
if (sfxSlider) {
    sfxSlider.addEventListener('input', (e) => {
        sfx.setVolume(parseInt(e.target.value, 10));
        updateSfxUI();
    });
    // 松开滑条时播放示例音效
    sfxSlider.addEventListener('change', () => {
        if (!sfx.isMuted()) sfx.play('click');
    });
    sfxSlider.addEventListener('click', (e) => e.stopPropagation());
}

updateSfxUI();

// ===== 启动 =====
initTopBarButtons();
showStartScreen();

// 暴露到全局（调试用）
window.game = {
    state: gameState,
    bus: eventBus,
    time: timeSystem,
    save: saveSystem,
    ui: uiManager,
    ai: aiService,
    farm: farmSystem,
    building: buildingSystem,
    villager: villagerSystem,
    economy: economySystem,
    weather: weatherSystem,
    market: marketEngine,
    scheduler: villagerScheduler,
    policy: policySystem,
    dailySummary,
    npcChat: npcChatSystem,
    fishing: fishingSystem,
    fishingPanel,
    neighbor: neighborSystem,
    priceChart,
    diorama: villageDiorama,
    bgm,
    sfx,
};

console.log('[Main] 🎮 治村物语已就绪 — 在控制台输入 window.game 查看游戏实例');
console.log('[Main] ⌨️ 快捷键: Ctrl+S=存档, Ctrl+L=读档, Space=钓鱼操作');
