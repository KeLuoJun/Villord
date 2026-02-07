/**
 * main.js - 治村物语 入口文件
 * 初始化所有游戏系统并启动游戏
 */

import { EventBus } from './core/EventBus.js';
import { GameState } from './core/GameState.js';
import { TimeSystem } from './core/TimeSystem.js';
import { SaveSystem } from './core/SaveSystem.js';
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
import { TutorialSystem } from './systems/TutorialSystem.js';
import { ProsperitySystem } from './systems/ProsperitySystem.js';
import { DailySummary } from './systems/DailySummary.js';
import { NPCChatSystem } from './systems/NPCChatSystem.js';
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
const prosperitySystem = new ProsperitySystem(gameState, eventBus);
const dailySummary = new DailySummary(aiService, gameState, eventBus);
const npcChatSystem = new NPCChatSystem(aiService, gameState, eventBus);

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

// ===== 注册子面板 =====
uiManager.registerPanel('build', buildingSystem);
uiManager.registerPanel('villagers', uiManager.villagerPanel);
uiManager.registerPanel('farm', farmSystem);
uiManager.registerPanel('market', marketEngine);
uiManager.registerPanel('events', dailySummary);

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
        <p>解雇需支付 20💰 遣散费，且其他村民心情 -1。</p>
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

// ===== 通关事件 =====
eventBus.on('gameWin', (data) => {
    uiManager.showModal('🏆 恭喜通关！', `
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
    const limitOf = (type) => gameState.getStorageLimit(type);

    // 主资源
    gameState.resources.food = limitOf('food');
    gameState.resources.wood = limitOf('wood');
    gameState.resources.stone = limitOf('stone');

    // 种子总量按容量平均分配
    const seedTypes = Object.keys(gameState.resources.seeds || {});
    const seedLimit = limitOf('seeds');
    if (seedTypes.length > 0) {
        const per = Math.floor(seedLimit / seedTypes.length);
        let remain = seedLimit - per * seedTypes.length;
        seedTypes.forEach(type => {
            const extra = remain > 0 ? 1 : 0;
            if (remain > 0) remain -= 1;
            gameState.resources.seeds[type] = per + extra;
        });
    }

    // 仓库物品
    Object.keys(gameState.inventory || {}).forEach(type => {
        gameState.inventory[type] = limitOf(type);
    });

    gameState.resetDailyChanges();
}

function initNewGame() {
    console.log('[Main] 🏘️ 治村物语 新游戏初始化...');

    // 重置村民列表，确保初始村民固定
    gameState.villagers = [];

    // 赠送初始建筑：2块农田 + 1座茅草屋
    buildingSystem.buildInitial();

    // 初始资源按仓库容量填满
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
                    💡 <b>建议</b>：使用生成速度较快的模型（如 <b>gemini-2.5-flash</b>、<b>gpt-4o-mini</b> 等）可显著提升游戏体验。<br>
                    大模型响应越快，村民对话和每日计划生成越流畅，游戏不会频繁暂停等待。
                </div>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <label style="font-size:13px;font-weight:500;">
                        代理地址 (Proxy URL)
                        <input id="cfg-proxy" type="text" value="${currentConfig.proxyUrl || ''}" placeholder="例: http://127.0.0.1:7890（可留空）"
                            style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </label>
                    <label style="font-size:13px;font-weight:500;">
                        API Base URL <span style="color:var(--danger,#c62828);">*</span>
                        <input id="cfg-baseurl" type="text" value="${currentConfig.baseUrl || ''}" placeholder="例: https://generativelanguage.googleapis.com/v1beta"
                            style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </label>
                    <label style="font-size:13px;font-weight:500;">
                        API Key <span style="color:var(--danger,#c62828);">*</span>
                        <input id="cfg-apikey" type="password" value="${currentConfig.apiKey || ''}" placeholder="输入你的 API Key"
                            style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </label>
                    <label style="font-size:13px;font-weight:500;">
                        模型名称 <span style="color:var(--danger,#c62828);">*</span>
                        <input id="cfg-model" type="text" value="${currentConfig.model || ''}" placeholder="例: gemini-2.5-flash"
                            style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
                    </label>
                </div>
                <div style="margin-top:12px;font-size:11px;color:var(--text-muted);">
                    配置保存在浏览器本地，刷新后仍有效。清空所有字段并保存将恢复使用 config.json 默认配置。
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
            proxyUrl: document.getElementById('cfg-proxy').value.trim(),
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
            uiManager.updateAll();
            uiManager.updateSeasonTheme();
            uiManager.updateVillagerSelect();
            uiManager.showToast(`📂 已加载存档 (${result.gameTime})`, 'success');
        } else {
            uiManager.showToast('❌ 没有找到存档', 'warning');
        }
    }

    // Space 暂停/恢复
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        timeSystem.togglePause();
    }
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
                <h4 style="margin:0 0 8px;">🎯 游戏目标</h4>
                <p>你是桃源村的新村长，目标是将小村庄建设成繁荣的社区。提升<b>繁荣度</b>，达到最高等级「👑 传说桃源」即为通关！</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">⏰ 时间系统</h4>
                <p>游戏以 <b>Tick</b> 为单位推进，1 Tick = 1 游戏小时，1天 = 24 Tick。</p>
                <p><b>1 Tick = 现实 3 秒</b>（1倍速下），即现实 72 秒 = 游戏 1 天。</p>
                <p><b>1 季 = 5 天</b>，春→夏→秋→冬，<b>1 年 = 4 季 = 20 天</b>。</p>
                <p>可通过右上角按钮调节速度（0.5x / 1x / 1.5x），空格键暂停/恢复。</p>
                <p>重要事件发生时游戏会自动暂停，给你时间做决策。</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">👥 村民系统</h4>
                <p>• 每个村民有<b>性格</b>（勤劳/懒惰/聪明/愚笨等）、<b>特长</b>和<b>口癖</b></p>
                <p>• 招募村民需要<b>50💰</b>和空余房屋，招募是盲抽机制</p>
                <p>• 通过底部对话栏与村民交流，可以安排任务</p>
                <p>• AI 会每隔一天自动为村民安排行动计划</p>
                <p>• 注意管理村民的<b>体力</b>和<b>心情</b>！</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">🌾 农业系统</h4>
                <p>• 在农田中种植作物，需要种子和浇水</p>
                <p>• 作物有生长周期，受天气和季节影响</p>
                <p>• 收获后可以在市场出售赚取金币</p>

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
                <p>• AI 天气预报员会提前预测未来 14 天的天气</p>

                <hr class="divider">
                <h4 style="margin:0 0 8px;">🏗️ 建设系统</h4>
                <p>• 建造房屋 → 招募更多村民</p>
                <p>• 扩建农田 → 种植更多作物</p>
                <p>• 建造伐木场/采石场 → 获取建筑材料</p>
                <p>• 建造加工坊 → 将原料加工为高价值商品</p>

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
                <h4 style="margin:0 0 8px;">⌨️ 快捷键</h4>
                <p><b>空格</b> = 暂停/恢复　<b>Ctrl+S</b> = 存档　<b>Ctrl+L</b> = 读档</p>
            </div>
            <div class="modal-actions">
                <button class="btn btn-primary rules-close">知道了</button>
            </div>
        </div>
    `;

    overlay.querySelector('.rules-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

// 暴露给全局，方便从UI按钮调用
window.showGameRulesModal = showGameRulesModal;

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
    dailySummary,
    npcChat: npcChatSystem,
    priceChart,
};

console.log('[Main] 🎮 治村物语已就绪 — 在控制台输入 window.game 查看游戏实例');
console.log('[Main] ⌨️ 快捷键: Space=暂停/恢复, Ctrl+S=存档, Ctrl+L=读档');
