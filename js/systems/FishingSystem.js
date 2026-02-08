/**
 * FishingSystem - 钓鱼系统
 * 管理鱼塘状态、钓鱼判定、鱼类图鉴、连击系统
 */

import {
    FISH_TYPES, RARITY, POND_LEVELS, BAIT_TYPES,
    FISHING_TIMING, FISH_RECOVERY, COLLECTION_REWARDS, COMBO_BONUSES,
    getSeasonalFish, getWeatherMod,
} from '../config/fishing.js';
import { canAfford, deductCost } from '../config/buildings.js';

export class FishingSystem {
    /**
     * @param {object} gameState - GameState
     * @param {import('../core/EventBus.js').EventBus} eventBus
     */
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        // 事件监听
        this.bus.on('newDay', () => this.onNewDay());
        this.bus.on('buildingBuilt', (data) => this.onBuildingBuilt(data));
    }

    // ===== 鱼塘管理 =====

    /** 鱼塘是否已建造 */
    get isPondBuilt() {
        return this.state.fishing.pondBuilt;
    }

    /** 当前鱼塘等级配置 */
    get currentPondConfig() {
        return POND_LEVELS[this.state.fishing.pondLevel] || POND_LEVELS[0];
    }

    /** 当前鱼塘容量 */
    get pondCapacity() {
        return this.currentPondConfig.capacity;
    }

    /** 下一级鱼塘配置（null 表示已满级） */
    get nextPondConfig() {
        const nextLevel = this.state.fishing.pondLevel + 1;
        return nextLevel < POND_LEVELS.length ? POND_LEVELS[nextLevel] : null;
    }

    /** 建筑系统建造鱼塘时触发 */
    onBuildingBuilt(data) {
        if (data?.config?.id === 'fishPond' && !this.state.fishing.pondBuilt) {
            this.state.fishing.pondBuilt = true;
            this.state.fishing.pondLevel = 0;
            this.state.fishing.fishStock = POND_LEVELS[0].capacity;
            this.state.fishing.fishRecovery = [];
            this.state.addLog('🎣', '鱼塘建造完成！可以开始钓鱼了', 'success');
            this.bus.emit('pondBuilt');
            this.bus.emit('uiUpdate');
        }
    }

    /**
     * 升级鱼塘
     * @returns {{ success: boolean, reason?: string }}
     */
    upgradePond() {
        if (!this.isPondBuilt) {
            return { success: false, reason: '尚未建造鱼塘' };
        }

        const next = this.nextPondConfig;
        if (!next) {
            return { success: false, reason: '鱼塘已达最高等级' };
        }

        if (!canAfford(this.state.resources, next.upgradeCost)) {
            return { success: false, reason: '资源不足' };
        }

        deductCost(this.state.resources, next.upgradeCost);
        this.state.fishing.pondLevel = next.level;

        // 升级后鱼存量恢复到新容量
        this.state.fishing.fishStock = Math.min(
            this.state.fishing.fishStock + 3, // 升级奖励额外3条鱼
            next.capacity
        );

        this.state.addLog('🎣', `鱼塘升级为「${next.name}」！容量提升至${next.capacity}条`, 'success');
        this.bus.emit('pondUpgraded', { level: next.level });
        this.bus.emit('uiUpdate');
        return { success: true };
    }

    // ===== 每日更新 =====

    /** 每日鱼存量恢复 */
    onNewDay() {
        if (!this.isPondBuilt) return;

        const fishing = this.state.fishing;
        const today = this.state.totalDays;
        const capacity = this.pondCapacity;

        // 检查恢复队列中已到期的鱼
        const readyFish = fishing.fishRecovery.filter(r => today >= r.recoveryDay);
        const newStock = Math.min(fishing.fishStock + readyFish.length, capacity);

        if (readyFish.length > 0) {
            fishing.fishStock = newStock;
            fishing.fishRecovery = fishing.fishRecovery.filter(r => today < r.recoveryDay);
            if (readyFish.length > 0) {
                this.state.addLog('🐟', `鱼塘恢复了${readyFish.length}条鱼（当前${newStock}/${capacity}）`, 'info');
            }
        }
    }

    // ===== 钓鱼核心逻辑 =====

    /**
     * 检查是否可以钓鱼
     * @returns {{ ok: boolean, reason?: string }}
     */
    canFish() {
        if (!this.isPondBuilt) {
            return { ok: false, reason: '尚未建造鱼塘' };
        }
        if (this.state.fishing.fishStock <= 0) {
            return { ok: false, reason: '鱼塘暂无鱼可钓，等待恢复' };
        }

        // 检查天气是否允许钓鱼
        const weatherId = this.state.weather.activeEvent || this.state.weather.current;
        const mod = getWeatherMod(weatherId);
        if (mod.speedMod <= 0) {
            return { ok: false, reason: '当前天气无法钓鱼' };
        }

        return { ok: true };
    }

    /**
     * 消耗一条鱼存量，并加入恢复队列
     */
    consumeFishStock() {
        if (this.state.fishing.fishStock <= 0) return false;
        this.state.fishing.fishStock--;
        this.state.fishing.fishRecovery.push({
            recoveryDay: this.state.totalDays + FISH_RECOVERY.daysPerFish,
        });
        return true;
    }

    /**
     * 根据概率决定钓到什么鱼
     * @returns {object|null} 鱼种配置，null 表示没有当季鱼
     */
    determineCatch() {
        const season = this.state.season;
        const availableFish = getSeasonalFish(season);
        if (availableFish.length === 0) return null;

        // 获取天气修正
        const weatherId = this.state.weather.activeEvent || this.state.weather.current;
        const weatherMod = getWeatherMod(weatherId);

        // 获取鱼饵加成
        const baitConfig = BAIT_TYPES[this.state.fishing.currentBait] || BAIT_TYPES.normal;
        const rarityBonus = baitConfig.rarityBonus || 0;

        // 传说鱼竿加成
        const rodBonus = this.state.fishing.legendaryRod ? 0.10 : 0;

        // 按稀有度分组
        const byRarity = {};
        for (const fish of availableFish) {
            if (!byRarity[fish.rarity]) byRarity[fish.rarity] = [];
            byRarity[fish.rarity].push(fish);
        }

        // 计算调整后的权重
        const adjustedWeights = {};
        let totalWeight = 0;
        for (const [rarityId, rarityConfig] of Object.entries(RARITY)) {
            if (!byRarity[rarityId] || byRarity[rarityId].length === 0) continue;

            let weight = rarityConfig.weight;

            // 稀有及以上鱼获得加成
            if (rarityId === 'rare' || rarityId === 'legendary') {
                weight *= (1 + rarityBonus + rodBonus);
                weight *= weatherMod.rarityMod;
            }

            adjustedWeights[rarityId] = weight;
            totalWeight += weight;
        }

        // 加权随机选择稀有度
        let roll = Math.random() * totalWeight;
        let selectedRarity = 'common';
        for (const [rarityId, weight] of Object.entries(adjustedWeights)) {
            roll -= weight;
            if (roll <= 0) {
                selectedRarity = rarityId;
                break;
            }
        }

        // 从该稀有度的鱼中随机选一条
        const candidates = byRarity[selectedRarity] || byRarity.common || availableFish;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /**
     * 钓鱼成功结算
     * @param {string} fishId - 鱼种ID
     * @param {'perfect'|'good'} quality - 操作质量
     * @returns {object} 结算结果
     */
    onCatchSuccess(fishId, quality = 'good') {
        const fishConfig = FISH_TYPES[fishId];
        if (!fishConfig) return null;

        const fishing = this.state.fishing;

        // 更新库存
        if (!fishing.caughtFish[fishId]) fishing.caughtFish[fishId] = 0;
        fishing.caughtFish[fishId]++;

        // 更新 inventory（市场可交易）
        if (this.state.inventory[fishId] !== undefined) {
            this.state.inventory[fishId]++;
        }

        // 更新图鉴
        let isNewDiscovery = false;
        if (!fishing.collection.includes(fishId)) {
            fishing.collection.push(fishId);
            isNewDiscovery = true;
        }

        // 更新连击
        fishing.combo++;
        fishing.totalCaught++;
        if (fishing.combo > fishing.bestCombo) {
            fishing.bestCombo = fishing.combo;
        }

        // 售价由市场实时价格决定，这里用基准价作为估值参考
        const estimatedValue = fishConfig.basePrice;

        // 繁荣度
        const rarityConfig = RARITY[fishConfig.rarity];
        let prosperityGain = 1;
        if (fishConfig.rarity === 'rare') prosperityGain = 3;
        if (fishConfig.rarity === 'legendary') prosperityGain = 5;

        // 日志
        const qualityLabel = quality === 'perfect' ? ' ✨Perfect!' : '';
        const comboLabel = fishing.combo >= 3
            ? ` (${fishing.combo}连击！)`
            : '';
        this.state.addLog(
            fishConfig.icon,
            `钓到了${rarityConfig.name}「${fishConfig.name}」！${qualityLabel}${comboLabel}`,
            fishConfig.rarity === 'legendary' ? 'success' : 'info'
        );

        // 事件
        this.bus.emit('fishCaught', {
            fishId,
            fishConfig,
            quality,
            isNewDiscovery,
            combo: fishing.combo,
            estimatedValue,
        });

        if (isNewDiscovery) {
            this.bus.emit('collectionUnlocked', { fishId, fishConfig });
            this.state.addLog('📖', `图鉴新增：${fishConfig.name}（${fishing.collection.length}/${Object.keys(FISH_TYPES).length}）`, 'success');
        }

        this.bus.emit('uiUpdate');

        return {
            fishConfig,
            quality,
            isNewDiscovery,
            combo: fishing.combo,
            estimatedValue,
            prosperityGain,
            rarityConfig,
        };
    }

    /** 钓鱼失败 */
    onCatchFail() {
        const oldCombo = this.state.fishing.combo;
        this.state.fishing.combo = 0;
        this.state.addLog('🎣', '鱼跑了...连击中断', 'warning');
        this.bus.emit('fishMissed', { oldCombo });
    }

    // ===== 图鉴系统 =====

    /** 获取图鉴进度 */
    getCollectionProgress() {
        const total = Object.keys(FISH_TYPES).length;
        const discovered = this.state.fishing.collection.length;
        return { discovered, total, percentage: Math.round((discovered / total) * 100) };
    }

    /** 获取图鉴详情（含是否已发现） */
    getCollectionDetails() {
        return Object.values(FISH_TYPES).map(fish => ({
            ...fish,
            discovered: this.state.fishing.collection.includes(fish.id),
            count: this.state.fishing.caughtFish[fish.id] || 0,
            rarityConfig: RARITY[fish.rarity],
        }));
    }

    /** 检查并领取图鉴奖励 */
    checkCollectionRewards() {
        const fishing = this.state.fishing;
        const discovered = fishing.collection.length;
        const rewards = [];

        for (const reward of COLLECTION_REWARDS) {
            if (discovered >= reward.threshold && !fishing.collectionRewardsClaimed.includes(reward.threshold)) {
                fishing.collectionRewardsClaimed.push(reward.threshold);

                // 发放金币奖励
                if (reward.gold) {
                    this.state.resources.gold += reward.gold;
                }

                // 传说鱼竿
                if (reward.legendaryRod) {
                    fishing.legendaryRod = true;
                }

                this.state.addLog('🏆', `图鉴奖励「${reward.name}」已领取！${reward.reward}`, 'success');
                rewards.push(reward);
            }
        }

        if (rewards.length > 0) {
            this.bus.emit('uiUpdate');
        }

        return rewards;
    }

    /** 获取可领取的奖励列表 */
    getAvailableRewards() {
        const fishing = this.state.fishing;
        const discovered = fishing.collection.length;
        return COLLECTION_REWARDS.map(reward => ({
            ...reward,
            unlocked: discovered >= reward.threshold,
            claimed: fishing.collectionRewardsClaimed.includes(reward.threshold),
        }));
    }

    // ===== 鱼饵管理 =====

    /** 检查鱼饵是否可用 */
    isBaitUnlocked(baitId) {
        const bait = BAIT_TYPES[baitId];
        if (!bait) return false;
        if (baitId === 'normal') return true;
        if (baitId === 'premium') return this.state.fishing.collection.length >= 5;
        if (baitId === 'legendary') return this.state.fishing.collection.length >= Object.keys(FISH_TYPES).length;
        return false;
    }

    /** 切换鱼饵 */
    setBait(baitId) {
        if (!this.isBaitUnlocked(baitId)) return false;
        this.state.fishing.currentBait = baitId;
        return true;
    }

    /** 获取所有鱼饵状态 */
    getBaitList() {
        return Object.values(BAIT_TYPES).map(bait => ({
            ...bait,
            unlocked: this.isBaitUnlocked(bait.id),
            active: this.state.fishing.currentBait === bait.id,
        }));
    }

    // ===== 统计 =====

    /** 获取当前连击加成倍率 */
    getCurrentComboMultiplier() {
        const combo = this.state.fishing.combo;
        let multiplier = 1.0;
        for (const cb of COMBO_BONUSES) {
            if (combo >= cb.threshold) multiplier = cb.multiplier;
        }
        return multiplier;
    }

    /** 获取当前连击标签 */
    getCurrentComboLabel() {
        const combo = this.state.fishing.combo;
        for (let i = COMBO_BONUSES.length - 1; i >= 0; i--) {
            if (combo >= COMBO_BONUSES[i].threshold) return COMBO_BONUSES[i].label;
        }
        return null;
    }
}
