/**
 * SaveSystem - 存档系统
 * localStorage 存档/读档，自动存档
 */

const SAVE_KEY = 'villord_save';
const AUTO_SAVE_KEY = 'villord_autosave';

export class SaveSystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        // 自动存档：每季末 + 重要事件 + 对话完成
        this.bus.on('seasonChange', () => this.autoSave('季末'));
        this.bus.on('buildingBuilt', () => this.autoSave('建筑'));
        this.bus.on('villagerRecruited', () => this.autoSave('招募'));
        this.bus.on('dialogueSaved', () => this.autoSave('对话'));
    }

    /** 手动存档 */
    save(slot = 'manual') {
        try {
            const data = this.serializeState();
            const key = `${SAVE_KEY}_${slot}`;
            localStorage.setItem(key, JSON.stringify({
                version: 1,
                timestamp: Date.now(),
                dateString: new Date().toLocaleString('zh-CN'),
                gameTime: `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天`,
                data,
            }));
            console.log(`[SaveSystem] 存档成功: ${slot}`);
            this.state.addLog('💾', '游戏已保存', 'success');
            return true;
        } catch (e) {
            console.error('[SaveSystem] 存档失败:', e);
            return false;
        }
    }

    /** 自动存档 */
    autoSave(reason = '') {
        try {
            const data = this.serializeState();
            localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify({
                version: 1,
                timestamp: Date.now(),
                dateString: new Date().toLocaleString('zh-CN'),
                gameTime: `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天`,
                reason,
                data,
            }));
            console.log(`[SaveSystem] 自动存档: ${reason}`);
        } catch (e) {
            console.warn('[SaveSystem] 自动存档失败:', e);
        }
    }

    /** 读档 */
    load(slot = 'manual') {
        try {
            const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_KEY}_${slot}`;
            const raw = localStorage.getItem(key);
            if (!raw) return { success: false, reason: '没有找到存档' };

            const save = JSON.parse(raw);
            this.deserializeState(save.data);
            console.log(`[SaveSystem] 读档成功: ${slot}, 游戏时间: ${save.gameTime}`);
            this.state.addLog('📂', `已加载存档（${save.gameTime}）`, 'success');
            return { success: true, gameTime: save.gameTime };
        } catch (e) {
            console.error('[SaveSystem] 读档失败:', e);
            return { success: false, reason: e.message };
        }
    }

    /** 检查是否有存档 */
    hasSave(slot = 'manual') {
        const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_KEY}_${slot}`;
        return !!localStorage.getItem(key);
    }

    /** 获取存档信息 */
    getSaveInfo(slot = 'manual') {
        const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_KEY}_${slot}`;
        const raw = localStorage.getItem(key);
        if (!raw) return null;

        try {
            const save = JSON.parse(raw);
            return {
                gameTime: save.gameTime,
                dateString: save.dateString,
                reason: save.reason || '',
            };
        } catch {
            return null;
        }
    }

    /** 删除存档 */
    deleteSave(slot = 'manual') {
        const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_KEY}_${slot}`;
        localStorage.removeItem(key);
    }

    /** 序列化游戏状态 */
    serializeState() {
        return {
            time: { ...this.state.time },
            resources: JSON.parse(JSON.stringify(this.state.resources)),
            villagers: JSON.parse(JSON.stringify(this.state.villagers)),
            buildings: JSON.parse(JSON.stringify(this.state.buildings)),
            plots: JSON.parse(JSON.stringify(this.state.plots)),
            inventory: { ...this.state.inventory },
            weather: JSON.parse(JSON.stringify(this.state.weather)),
            market: {
                prices: { ...this.state.market.prices },
                dailyReport: this.state.market.dailyReport,
            },
            eventLog: this.state.eventLog.slice(0, 20),
            settings: { ...this.state.settings },
            prosperity: this.state.prosperity,
            policies: { ...this.state.policies },
            _consecutiveWorkDays: this.state._consecutiveWorkDays || 0,
            meetings: JSON.parse(JSON.stringify(this.state.meetings || { history: [] })),
            fishing: JSON.parse(JSON.stringify(this.state.fishing)),
            neighbors: JSON.parse(JSON.stringify(this.state.neighbors)),
        };
    }

    /** 反序列化到游戏状态 */
    deserializeState(data) {
        if (data.time) Object.assign(this.state.time, data.time);
        if (data.resources) this.state.resources = data.resources;
        if (data.villagers) {
            this.state.villagers = data.villagers;
            // 数据迁移：确保每个村民都有必要的字段
            this.state.villagers.forEach(v => {
                if (!Array.isArray(v.dialogueHistory)) v.dialogueHistory = [];
                if (!v.memory) v.memory = { previousSeasons: [], currentSeason: { dialogues: [], events: [] } };
                if (!v.memory.currentSeason) v.memory.currentSeason = { dialogues: [], events: [] };
            });
        }
        if (data.buildings) this.state.buildings = data.buildings;
        if (data.plots) this.state.plots = data.plots;
        if (data.inventory) Object.assign(this.state.inventory, data.inventory);
        if (data.weather) Object.assign(this.state.weather, data.weather);
        if (data.market) {
            if (data.market.prices) this.state.market.prices = data.market.prices;
            if (data.market.dailyReport) this.state.market.dailyReport = data.market.dailyReport;
        }
        if (data.eventLog) this.state.eventLog = data.eventLog;
        if (data.settings) Object.assign(this.state.settings, data.settings);
        if (data.prosperity !== undefined) this.state.prosperity = data.prosperity;

        // 政策系统数据恢复（兼容旧存档）
        if (data.policies) {
            Object.assign(this.state.policies, data.policies);
        }
        if (data._consecutiveWorkDays !== undefined) {
            this.state._consecutiveWorkDays = data._consecutiveWorkDays;
        }

        // 村会系统数据恢复（兼容旧存档）
        if (data.meetings) {
            this.state.meetings = data.meetings;
        }

        // 钓鱼系统数据恢复（兼容旧存档）
        if (data.fishing) {
            Object.assign(this.state.fishing, data.fishing);
        }

        // 邻村往来系统数据恢复（兼容旧存档）
        if (data.neighbors) {
            Object.assign(this.state.neighbors, data.neighbors);
        }

        // 暂停游戏
        this.state.time.isPaused = true;
    }
}
