/**
 * FarmSystem - 农田管理系统
 * 管理农田、作物种植、生长、浇水、施肥、收获
 */
import { CROPS, CROP_STAGES } from '../config/crops.js';

export class FarmSystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        // 监听时间事件
        this.bus.on('tick', (data) => this.onTick(data));
        this.bus.on('newDay', () => this.onNewDay());
    }

    /** 初始化（添加初始农田） */
    addInitialPlot() {
        const plot = this.createPlot('农田A');
        this.state.plots.push(plot);
        this.bus.emit('plotAdded', { plot });
    }

    /** 创建空农田 */
    createPlot(name) {
        return {
            id: 'plot_' + Date.now() + Math.random().toString(36).substr(2, 4),
            name: name || `农田${String.fromCharCode(65 + this.state.plots.length)}`,
            crop: null,          // 当前作物ID
            cropName: null,
            stage: 'empty',      // empty, seed, sprout, growing, mature, ready, withered
            progress: 0,         // 0-1 生长进度
            growthHours: 0,      // 已生长小时数
            totalGrowthHours: 0, // 总需生长小时数
            watered: false,      // 今日是否已浇水
            fertilized: false,   // 是否已施肥
            assignedVillager: null,
        };
    }

    /** 扩建农田 */
    expandPlot() {
        const cost = { gold: 80, wood: 15 };
        if (this.state.resources.gold < cost.gold || this.state.resources.wood < cost.wood) {
            return { success: false, reason: '资源不足' };
        }

        this.state.resources.gold -= cost.gold;
        this.state.resources.wood -= cost.wood;

        const plot = this.createPlot();
        this.state.plots.push(plot);

        this.state.addLog('🌾', `扩建了${plot.name}`, 'success');
        this.bus.emit('plotAdded', { plot });
        return { success: true, plot };
    }

    /**
     * 种植作物
     * @param {string} plotId - 农田ID
     * @param {string} cropId - 作物ID
     * @returns {object}
     */
    plant(plotId, cropId) {
        const plot = this.state.plots.find(p => p.id === plotId);
        if (!plot) return { success: false, reason: '农田不存在' };
        if (plot.stage !== 'empty') return { success: false, reason: '农田已有作物' };

        const cropConfig = CROPS[cropId];
        if (!cropConfig) return { success: false, reason: '未知作物' };

        // 检查季节
        if (!cropConfig.seasons.includes(this.state.season)) {
            return { success: false, reason: `${cropConfig.name}不能在${this.state.seasonName}季种植` };
        }

        // 检查种子
        if ((this.state.resources.seeds[cropId] || 0) < 1) {
            return { success: false, reason: '种子不足' };
        }

        // 消耗种子
        this.state.resources.seeds[cropId]--;

        // 设置农田状态
        plot.crop = cropId;
        plot.cropName = cropConfig.name;
        plot.stage = 'seed';
        plot.progress = 0;
        plot.growthHours = 0;
        plot.totalGrowthHours = cropConfig.growthDays * 24;
        plot.watered = false;
        plot.fertilized = false;

        this.state.addLog('🌱', `在${plot.name}种下了${cropConfig.icon}${cropConfig.name}`, 'info');
        this.bus.emit('cropPlanted', { plot, crop: cropConfig });
        this.bus.emit('uiUpdate', {});
        this.update(); // 立即刷新农场面板
        return { success: true };
    }

    /** 浇水 */
    water(plotId) {
        const plot = this.state.plots.find(p => p.id === plotId);
        if (!plot || !plot.crop) return { success: false, reason: '没有作物需要浇水' };
        if (plot.watered) return { success: false, reason: '今天已经浇过水了' };

        plot.watered = true;
        this.bus.emit('cropWatered', { plot });
        this.bus.emit('uiUpdate', {});
        this.update(); // 立即刷新农场面板
        return { success: true };
    }

    /** 施肥 */
    fertilize(plotId) {
        const plot = this.state.plots.find(p => p.id === plotId);
        if (!plot || !plot.crop) return { success: false, reason: '没有作物需要施肥' };
        if (plot.fertilized) return { success: false, reason: '已经施过肥了' };

        plot.fertilized = true;
        this.bus.emit('cropFertilized', { plot });
        this.bus.emit('uiUpdate', {});
        this.update(); // 立即刷新农场面板
        return { success: true };
    }

    /** 收获 */
    harvest(plotId) {
        const plot = this.state.plots.find(p => p.id === plotId);
        if (!plot || plot.stage !== 'ready') return { success: false, reason: '作物尚未成熟' };

        const cropConfig = CROPS[plot.crop];
        let yield_ = cropConfig.baseYield;

        // 施肥加成 +30%
        if (plot.fertilized) yield_ = Math.ceil(yield_ * 1.3);

        // 加入库存
        if (this.state.inventory[plot.crop] !== undefined) {
            this.state.inventory[plot.crop] += yield_;
        }

        // 粮食特殊处理（食物资源）
        if (['wheat', 'radish', 'potato'].includes(plot.crop)) {
            this.state.resources.food += yield_;
        }

        const harvestInfo = { plot, crop: cropConfig, yield: yield_ };

        // 重置农田
        plot.crop = null;
        plot.cropName = null;
        plot.stage = 'empty';
        plot.progress = 0;
        plot.growthHours = 0;
        plot.totalGrowthHours = 0;
        plot.watered = false;
        plot.fertilized = false;

        this.state.addLog('🌾', `从${plot.name}收获了${yield_}个${cropConfig.icon}${cropConfig.name}`, 'success');
        this.bus.emit('cropHarvested', harvestInfo);
        this.bus.emit('uiUpdate', {});
        this.update(); // 立即刷新农场面板
        return { success: true, yield: yield_ };
    }

    /** 每 Tick 推进作物生长 */
    onTick(data) {
        // 获取当前天气的作物生长修正
        const weatherEffects = this.getWeatherEffects();
        const growthMod = weatherEffects.cropGrowth || 1.0;

        this.state.plots.forEach(plot => {
            if (!plot.crop || plot.stage === 'empty' || plot.stage === 'ready' || plot.stage === 'withered') return;

            // 浇水加速 +20%
            const waterBonus = plot.watered ? 1.2 : 0.8;

            // 每小时生长量
            const growthPerHour = (1 / plot.totalGrowthHours) * growthMod * waterBonus;
            plot.growthHours++;
            plot.progress = Math.min(1.0, plot.progress + growthPerHour);

            // 更新阶段
            if (plot.progress >= 1.0) {
                plot.stage = 'ready';
                this.state.addLog('✨', `${plot.name}的${plot.cropName}成熟了！`, 'success');
                this.bus.emit('cropMature', { plot });
                // 自动暂停
                this.bus.emit('autoPause', { reason: `[农场] ${plot.name}的${plot.cropName}成熟了` });
            } else if (plot.progress >= 0.75) {
                plot.stage = 'mature';
            } else if (plot.progress >= 0.5) {
                plot.stage = 'growing';
            } else if (plot.progress >= 0.25) {
                plot.stage = 'sprout';
            }
        });
    }

    /** 每日重置浇水状态 */
    onNewDay() {
        this.state.plots.forEach(plot => {
            plot.watered = false;
        });
    }

    /** 获取天气效果 */
    getWeatherEffects() {
        const w = this.state.weather;
        if (w.activeEvent) {
            const evt = window.SPECIAL_WEATHER_EVENTS?.[w.activeEvent];
            return evt || { cropGrowth: 1.0 };
        }
        const def = window.SEASON_DEFAULT?.[this.state.season];
        return def || { cropGrowth: 1.0 };
    }

    // ===== UI 面板更新 =====

    /** 面板激活时更新 */
    onActivate() { this.update(); }

    /** 更新农场面板 */
    update() {
        const grid = document.getElementById('farm-grid');
        if (!grid) return;

        grid.innerHTML = '';

        if (this.state.plots.length === 0) {
            grid.innerHTML = '<p class="text-muted">暂无农田，请先在建设面板中建造农田</p>';
            return;
        }

        this.state.plots.forEach(plot => {
            const card = document.createElement('div');
            card.className = 'farm-plot-card card';

            const cropConfig = plot.crop ? CROPS[plot.crop] : null;
            const stageInfo = CROP_STAGES[plot.stage] || CROP_STAGES.seed;
            const progressPercent = Math.round(plot.progress * 100);
            const progressLevel = progressPercent >= 60 ? 'high' : progressPercent >= 30 ? 'medium' : 'low';

            card.innerHTML = `
                <div class="plot-header">
                    <span class="plot-crop">${plot.name}</span>
                    <span>${cropConfig ? cropConfig.icon + ' ' + cropConfig.name : '🏜️ 空地'}</span>
                </div>
                ${cropConfig ? `
                    <div class="plot-status">阶段: ${stageInfo.name} ${stageInfo.icon}</div>
                    <div style="margin-bottom:8px;">
                        <div class="progress-bar">
                            <div class="fill ${progressLevel}" style="width:${progressPercent}%"></div>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:2px;">
                            <span>进度: ${progressPercent}%</span>
                            <span>浇水: ${plot.watered ? '✅' : '❌'}  施肥: ${plot.fertilized ? '✅' : '❌'}</span>
                        </div>
                    </div>
                ` : '<div class="plot-status">等待种植...</div>'}
                <div class="plot-actions">
                    ${plot.stage === 'empty' ? this.renderPlantOptions(plot.id) : ''}
                    ${plot.crop && plot.stage !== 'ready' && !plot.watered ? `<button class="btn btn-sm btn-primary" onclick="game.farm.water('${plot.id}')">💧 浇水</button>` : ''}
                    ${plot.crop && plot.stage !== 'ready' && !plot.fertilized ? `<button class="btn btn-sm btn-secondary" onclick="game.farm.fertilize('${plot.id}')">🧪 施肥</button>` : ''}
                    ${plot.stage === 'ready' ? `<button class="btn btn-sm btn-gold" onclick="game.farm.harvest('${plot.id}')">🌾 收获</button>` : ''}
                </div>
            `;

            grid.appendChild(card);
        });
    }

    /** 渲染种植选项 */
    renderPlantOptions(plotId) {
        const seeds = this.state.resources.seeds;
        const season = this.state.season;

        let html = '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
        Object.entries(CROPS).forEach(([cropId, crop]) => {
            if (!crop.seasons.includes(season)) return;
            const count = seeds[cropId] || 0;
            if (count <= 0) return;

            html += `<button class="btn btn-sm btn-primary" onclick="game.farm.plant('${plotId}','${cropId}')" title="需要1颗${crop.name}种子">
                ${crop.icon} 种${crop.name}(${count})
            </button>`;
        });
        html += '</div>';

        return html;
    }
}
