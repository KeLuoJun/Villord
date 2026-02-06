/**
 * BuildingSystem - 建筑管理系统
 * 管理建筑的建造、升级，以及建设面板UI
 */
import { BUILDINGS, canAfford, deductCost } from '../config/buildings.js';

export class BuildingSystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;
    }

    /** 初始建筑（游戏开始赠送） */
    buildInitial() {
        // 赠送1块农田
        this.state.plots.push({
            id: 'plot_initial',
            name: '农田A',
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

        // 赠送1座茅草屋
        this.state.buildings.push({
            id: 'building_hut_initial',
            type: 'hut',
            category: 'housing',
            name: '茅草屋',
            icon: '🏚️',
            capacity: 1,
            builtAt: 1,
        });
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
            this.state.addLog('🏗️', `建造了${config.icon} ${config.name}`, 'success');
        }

        this.bus.emit('buildingBuilt', { building, config });
        return { success: true, building };
    }

    /** 检查解锁条件 */
    isUnlocked(buildingId) {
        const config = BUILDINGS[buildingId];
        if (!config) return false;
        if (config.unlocked === true || config.unlocked === undefined) return true;

        // 根据 unlockCondition 判断
        switch (buildingId) {
            case 'woodHouse':
                return this.state.plots.length >= 2;
            case 'stoneHouse':
                return this.state.buildings.some(b => b.type === 'quarry');
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
        this.renderCategory('buildings-gathering', ['farmPlot', 'lumberYard', 'quarry']);
        this.renderCategory('buildings-housing', ['hut', 'woodHouse', 'stoneHouse']);
        this.renderCategory('buildings-processing', ['mill', 'bakery']);
        this.renderCategory('buildings-municipal', ['warehouse', 'well']);
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
