/**
 * BuildingSystem - 建筑管理系统
 * 管理建筑的建造、升级，以及建设面板UI
 */
import { BUILDINGS, HOUSE_LEVELS, canAfford, deductCost } from '../config/buildings.js';

export class BuildingSystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;
    }

    /** 初始建筑（游戏开始赠送） */
    buildInitial() {
        // 赠送2块农田
        for (let i = 0; i < 2; i++) {
            const plotName = `农田${String.fromCharCode(65 + this.state.plots.length)}`;
            this.state.plots.push({
                id: `plot_initial_${i + 1}`,
                name: plotName,
                crop: null,
                cropName: null,
                stage: 'empty',
                progress: 0,
                growthHours: 0,
                totalGrowthHours: 0,
                watered: false,
                fertilized: false,
                assignedVillager: null,
            });
        }

        // 赠送1座 Lv0 茅草屋
        const lv0 = HOUSE_LEVELS[0];
        this.state.buildings.push({
            id: 'building_house_initial',
            type: 'house',
            category: 'housing',
            name: lv0.name,
            icon: lv0.icon,
            capacity: lv0.capacity,
            level: 0,
            builtAt: 1,
        });
    }

    /**
     * 迁移旧存档的住房数据（hut/woodHouse/stoneHouse → house + level）
     * 在加载存档后调用
     */
    migrateOldHousing() {
        const oldTypeMap = { hut: 0, woodHouse: 1, stoneHouse: 2 };
        let migrated = false;

        for (const b of this.state.buildings) {
            if (b.type in oldTypeMap) {
                const lvl = oldTypeMap[b.type];
                const lvConfig = HOUSE_LEVELS[lvl];
                b.type = 'house';
                b.level = lvl;
                b.name = lvConfig.name;
                b.icon = lvConfig.icon;
                b.capacity = lvConfig.capacity;
                migrated = true;
            }
            // 确保 house 类型的建筑都有 level 字段
            if (b.type === 'house' && b.level === undefined) {
                b.level = 0;
            }
        }

        if (migrated) {
            console.log('[BuildingSystem] 已迁移旧版住房数据');
        }
    }

    /**
     * 建造建筑
     * @param {string} buildingId - 建筑配置ID
     * @returns {object} { success, reason?, building? }
     */
    build(buildingId) {
        const config = BUILDINGS[buildingId];
        if (!config) return { success: false, reason: '未知建筑' };

        // 检查解锁条件
        if (!this.isUnlocked(buildingId)) {
            return { success: false, reason: `未解锁（${config.unlockCondition || '条件未满足'}）` };
        }

        // 检查是否已达上限
        if (config.maxCount) {
            const count = this.state.buildings.filter(b => b.type === buildingId).length;
            if (count >= config.maxCount) {
                return { success: false, reason: `${config.name}已达上限` };
            }
        }

        // 检查资源
        if (!canAfford(this.state.resources, config.cost)) {
            const missing = this.getMissingResources(config.cost);
            return { success: false, reason: `资源不足：${missing}` };
        }

        // 扣除资源
        deductCost(this.state.resources, config.cost);

        // 创建建筑
        const building = {
            id: 'building_' + Date.now() + Math.random().toString(36).substr(2, 4),
            type: buildingId,
            category: config.category,
            name: config.name,
            icon: config.icon,
            capacity: config.capacity || 0,
            builtAt: this.state.totalDays,
        };

        // 住宅初建为 Lv0
        if (buildingId === 'house') {
            const lv0 = HOUSE_LEVELS[0];
            building.level = 0;
            building.name = lv0.name;
            building.icon = lv0.icon;
            building.capacity = lv0.capacity;
        }

        this.state.buildings.push(building);

        // 如果是农田，同时创建对应的 plot
        if (buildingId === 'farmPlot') {
            const plotName = `农田${String.fromCharCode(65 + this.state.plots.length)}`;
            this.state.plots.push({
                id: 'plot_' + Date.now(),
                name: plotName,
                crop: null, cropName: null,
                stage: 'empty', progress: 0,
                growthHours: 0, totalGrowthHours: 0,
                watered: false, fertilized: false,
                assignedVillager: null,
            });
            this.state.addLog('🌾', `建造了${plotName}`, 'success');
        } else {
            this.state.addLog('🏗️', `建造了${config.icon} ${building.name}`, 'success');
        }

        this.bus.emit('buildingBuilt', { building, config });
        return { success: true, building };
    }

    /**
     * 升级住宅
     * @param {string} buildingInstanceId - 建筑实例ID
     * @returns {object} { success, reason? }
     */
    upgradeHouse(buildingInstanceId) {
        const building = this.state.buildings.find(b => b.id === buildingInstanceId);
        if (!building || building.type !== 'house') {
            return { success: false, reason: '找不到该住宅' };
        }

        const currentLevel = building.level || 0;
        const nextLevel = currentLevel + 1;
        if (nextLevel >= HOUSE_LEVELS.length) {
            return { success: false, reason: '已达最高等级' };
        }

        const nextConfig = HOUSE_LEVELS[nextLevel];

        // 检查解锁条件
        if (!this.isHouseLevelUnlocked(nextLevel)) {
            return { success: false, reason: `未解锁（${nextConfig.unlockCondition || '条件未满足'}）` };
        }

        // 检查资源
        const cost = nextConfig.upgradeCost;
        if (!canAfford(this.state.resources, cost)) {
            const missing = this.getMissingResources(cost);
            return { success: false, reason: `资源不足：${missing}` };
        }

        // 扣除资源
        deductCost(this.state.resources, cost);

        // 升级建筑
        building.level = nextLevel;
        building.name = nextConfig.name;
        building.icon = nextConfig.icon;
        building.capacity = nextConfig.capacity;

        this.state.addLog('⬆️', `${nextConfig.icon} 住宅扩建为「${nextConfig.name}」！容纳 ${nextConfig.capacity} 人`, 'success');
        this.bus.emit('buildingBuilt', { building, config: BUILDINGS.house });
        return { success: true };
    }

    /** 检查住宅等级解锁条件 */
    isHouseLevelUnlocked(level) {
        const config = HOUSE_LEVELS[level];
        if (!config) return false;
        if (!config.unlockCondition) return true;

        // 石屋需要采石场
        if (level === 2) {
            return this.state.buildings.some(b => b.type === 'quarry');
        }
        return true;
    }

    /** 检查解锁条件 */
    isUnlocked(buildingId) {
        const config = BUILDINGS[buildingId];
        if (!config) return false;
        if (config.unlocked === true || config.unlocked === undefined) return true;

        // 根据 unlockCondition 判断
        switch (buildingId) {
            case 'mill':
                return (this.state.inventory.wheat || 0) > 0 || this.state.eventLog.some(e => e.text?.includes('小麦'));
            case 'bakery':
                return this.state.buildings.some(b => b.type === 'mill');
            default:
                return false;
        }
    }

    /** 获取缺少的资源描述 */
    getMissingResources(cost) {
        const res = this.state.resources;
        const parts = [];
        if ((cost.gold || 0) > res.gold) parts.push(`还需${(cost.gold || 0) - res.gold}💰`);
        if ((cost.wood || 0) > res.wood) parts.push(`还需${(cost.wood || 0) - res.wood}🪵`);
        if ((cost.stone || 0) > res.stone) parts.push(`还需${(cost.stone || 0) - res.stone}🪨`);
        return parts.join('，') || '未知';
    }

    /** 获取某类型建筑数量 */
    getCount(buildingId) {
        return this.state.buildings.filter(b => b.type === buildingId).length;
    }

    /** 检查是否拥有某建筑 */
    has(buildingId) {
        return this.getCount(buildingId) > 0;
    }

    // ===== UI 面板更新 =====

    onActivate() { this.update(); }

    update() {
        this.renderCategory('buildings-gathering', ['farmPlot', 'lumberYard', 'quarry', 'fishPond']);
        this.renderHousing('buildings-housing');
        this.renderCategory('buildings-processing', ['mill', 'bakery']);
        this.renderCategory('buildings-municipal', ['warehouse', 'well']);
    }

    /** 渲染住房区域（新建 + 已有住宅升级） */
    renderHousing(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const config = BUILDINGS.house;
        const houses = this.state.buildings.filter(b => b.type === 'house');

        // --- 已有住宅卡片（每栋单独显示，支持升级）---
        houses.forEach((house, idx) => {
            const lvl = house.level || 0;
            const lvConfig = HOUSE_LEVELS[lvl];
            const nextLvl = lvl + 1;
            const hasNext = nextLvl < HOUSE_LEVELS.length;
            const nextConfig = hasNext ? HOUSE_LEVELS[nextLvl] : null;

            const card = document.createElement('div');
            card.className = 'building-card card';

            // 当前等级信息
            let upgradeHTML = '';
            if (hasNext) {
                const unlocked = this.isHouseLevelUnlocked(nextLvl);
                const cost = nextConfig.upgradeCost;
                const affordable = unlocked && canAfford(this.state.resources, cost);
                const canUpgrade = unlocked && affordable;

                const costParts = [];
                if (cost.gold) {
                    const enough = this.state.resources.gold >= cost.gold;
                    costParts.push(`<span style="color:${enough ? 'var(--text-primary)' : 'var(--color-danger, #e74c3c)'}">${cost.gold}💰</span>`);
                }
                if (cost.wood) {
                    const enough = this.state.resources.wood >= cost.wood;
                    costParts.push(`<span style="color:${enough ? 'var(--text-primary)' : 'var(--color-danger, #e74c3c)'}">${cost.wood}🪵</span>`);
                }
                if (cost.stone) {
                    const enough = this.state.resources.stone >= cost.stone;
                    costParts.push(`<span style="color:${enough ? 'var(--text-primary)' : 'var(--color-danger, #e74c3c)'}">${cost.stone}🪨</span>`);
                }

                let statusText = '';
                if (!unlocked) {
                    statusText = `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">🔒 ${nextConfig.unlockCondition}</div>`;
                } else if (!affordable) {
                    const missing = this.getMissingResources(cost);
                    statusText = `<div style="font-size:11px;color:var(--color-danger, #e74c3c);margin-top:4px;">${missing}</div>`;
                }

                upgradeHTML = `
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;">
                        ⬆️ 扩建为 ${nextConfig.icon} ${nextConfig.name}（容纳${nextConfig.capacity}人）
                    </div>
                    <div class="building-cost">${costParts.join(' + ')}</div>
                    ${statusText}
                    <button class="btn btn-sm ${canUpgrade ? 'btn-primary' : 'btn-secondary'}"
                        ${!canUpgrade ? 'disabled' : ''}
                        data-upgrade-house="${house.id}">
                        ${!unlocked ? '🔒 未解锁' : '⬆️ 扩建'}
                    </button>
                `;
            } else {
                upgradeHTML = `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">✅ 已达最高等级</div>`;
            }

            card.innerHTML = `
                <div class="building-icon">${lvConfig.icon}</div>
                <div class="building-name">${lvConfig.name}${houses.length > 1 ? ` #${idx + 1}` : ''}</div>
                <div class="building-info">容纳 ${lvConfig.capacity} 人　<span style="font-size:11px;color:var(--text-secondary);">Lv.${lvl}</span></div>
                ${upgradeHTML}
            `;

            // 升级按钮事件
            const upgradeBtn = card.querySelector('[data-upgrade-house]');
            if (upgradeBtn) {
                upgradeBtn.addEventListener('click', () => {
                    const result = this.upgradeHouse(house.id);
                    if (result.success) {
                        this.update();
                        this.bus.emit('uiUpdate', {});
                    } else {
                        if (window.game?.ui) {
                            window.game.ui.showToast(`❌ ${result.reason}`, 'warning');
                        }
                    }
                });
            }

            container.appendChild(card);
        });

        // --- 新建住宅卡片 ---
        const buildCard = document.createElement('div');
        buildCard.className = 'building-card card';

        const affordable = canAfford(this.state.resources, config.cost);
        const costParts = [];
        if (config.cost.gold) {
            const enough = this.state.resources.gold >= config.cost.gold;
            costParts.push(`<span style="color:${enough ? 'var(--text-primary)' : 'var(--color-danger, #e74c3c)'}">${config.cost.gold}💰</span>`);
        }
        if (config.cost.wood) {
            const enough = this.state.resources.wood >= config.cost.wood;
            costParts.push(`<span style="color:${enough ? 'var(--text-primary)' : 'var(--color-danger, #e74c3c)'}">${config.cost.wood}🪵</span>`);
        }

        let buildStatus = '';
        if (!affordable) {
            const missing = this.getMissingResources(config.cost);
            buildStatus = `<div style="font-size:11px;color:var(--color-danger, #e74c3c);margin-top:4px;">${missing}</div>`;
        }

        buildCard.innerHTML = `
            <div class="building-icon" style="opacity:0.6;">🏗️</div>
            <div class="building-name">新建住宅</div>
            <div class="building-info">建造一栋 ${HOUSE_LEVELS[0].icon} ${HOUSE_LEVELS[0].name}（容纳${HOUSE_LEVELS[0].capacity}人），之后可逐级扩建</div>
            <div class="building-cost">${costParts.join(' + ')}</div>
            ${buildStatus}
            <button class="btn btn-sm ${affordable ? 'btn-primary' : 'btn-secondary'}"
                ${!affordable ? 'disabled' : ''}
                data-build="house">
                🏗️ 建造
            </button>
        `;

        const buildBtn = buildCard.querySelector('[data-build]');
        buildBtn.addEventListener('click', () => {
            const result = this.build('house');
            if (result.success) {
                this.update();
                this.bus.emit('uiUpdate', {});
            } else {
                if (window.game?.ui) {
                    window.game.ui.showToast(`❌ ${result.reason}`, 'warning');
                }
            }
        });

        container.appendChild(buildCard);
    }

    renderCategory(containerId, buildingIds) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        buildingIds.forEach(bid => {
            const config = BUILDINGS[bid];
            if (!config) return;

            const count = this.getCount(bid);
            const unlocked = this.isUnlocked(bid);
            const affordable = unlocked && canAfford(this.state.resources, config.cost);
            const atMax = config.maxCount && count >= config.maxCount;
            const canBuild = unlocked && affordable && !atMax;

            const card = document.createElement('div');
            card.className = 'building-card card';
            if (!unlocked) card.style.opacity = '0.55';

            // 构建每项资源的花费显示（颜色标注是否够）
            const costParts = [];
            if (config.cost.gold) {
                const enough = this.state.resources.gold >= config.cost.gold;
                costParts.push(`<span style="color:${enough ? 'var(--text-primary)' : 'var(--color-danger, #e74c3c)'}">${config.cost.gold}💰</span>`);
            }
            if (config.cost.wood) {
                const enough = this.state.resources.wood >= config.cost.wood;
                costParts.push(`<span style="color:${enough ? 'var(--text-primary)' : 'var(--color-danger, #e74c3c)'}">${config.cost.wood}🪵</span>`);
            }
            if (config.cost.stone) {
                const enough = this.state.resources.stone >= config.cost.stone;
                costParts.push(`<span style="color:${enough ? 'var(--text-primary)' : 'var(--color-danger, #e74c3c)'}">${config.cost.stone}🪨</span>`);
            }

            let statusText = '';
            if (!unlocked) {
                statusText = `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">🔒 ${config.unlockCondition || '未解锁'}</div>`;
            } else if (atMax) {
                statusText = `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">已达上限</div>`;
            } else if (!affordable) {
                const missing = this.getMissingResources(config.cost);
                statusText = `<div style="font-size:11px;color:var(--color-danger, #e74c3c);margin-top:4px;">${missing}</div>`;
            }

            card.innerHTML = `
                <div class="building-icon">${config.icon}</div>
                <div class="building-name">${config.name} ${count > 0 ? `×${count}` : ''}</div>
                <div class="building-info">${config.description}</div>
                ${config.capacity ? `<div class="building-info">容纳 ${config.capacity} 人</div>` : ''}
                ${config.workersNeeded ? `<div class="building-info">需 ${config.workersNeeded} 人运作</div>` : ''}
                <div class="building-cost">${costParts.join(' + ')}</div>
                ${statusText}
                <button class="btn btn-sm ${canBuild ? 'btn-primary' : 'btn-secondary'}"
                    ${!canBuild ? 'disabled' : ''}
                    data-build="${bid}">
                    ${!unlocked ? '🔒 未解锁' : atMax ? '已满' : count > 0 ? '+ 扩建' : '建造'}
                </button>
            `;

            // 建造按钮事件
            const btn = card.querySelector('[data-build]');
            btn.addEventListener('click', () => {
                const result = this.build(bid);
                if (result.success) {
                    this.update();
                    this.bus.emit('uiUpdate', {});
                } else {
                    // 显示失败原因
                    if (window.game?.ui) {
                        window.game.ui.showToast(`❌ ${result.reason}`, 'warning');
                    }
                    console.warn('[BuildingSystem]', result.reason);
                }
            });

            container.appendChild(card);
        });
    }
}
