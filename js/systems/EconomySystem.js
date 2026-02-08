/**
 * EconomySystem - 经济系统
 * 管理每日消耗（食物、木材）、资源变化追踪
 *
 * 政策系统集成说明：
 * - 绩效奖金扣款、分配制度心情惩罚等由 PolicySystem.onNewDay() 处理
 * - 产出分配比例在 VillagerScheduler.executeAction() 中应用
 * - 此模块保持基础经济逻辑不变（食物消耗、取暖等）
 */
export class EconomySystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        this.bus.on('newDay', () => this.onNewDay());
    }

    /**
     * 获取村民每日小麦消耗量（根据性格特征决定，同一村民始终固定）
     * @param {object} villager
     * @returns {number}
     */
    getVillagerWheatCost(villager) {
        let cost = 1; // 基础消耗
        if (villager.traits?.includes('健壮')) cost = 2;      // 体格大，吃得多
        else if (villager.traits?.includes('体弱')) cost = 1;  // 体弱吃得少
        else if (villager.traits?.includes('勤劳')) cost = 2;  // 干活多消耗大
        else if (villager.traits?.includes('懒惰')) cost = 1;  // 不动弹，吃的少
        return cost;
    }

    /** 每日经济结算 */
    onNewDay() {
        // 每个村民按各自消耗量扣除小麦（inventory.wheat）
        let totalNeeded = 0;
        this.state.villagers.forEach(v => {
            totalNeeded += this.getVillagerWheatCost(v);
        });

        const wheatStock = this.state.inventory.wheat || 0;

        if (wheatStock >= totalNeeded) {
            this.state.inventory.wheat -= totalNeeded;
            // 追踪每日变化
            if (this.state.dailyChanges) {
                this.state.dailyChanges.wheat = (this.state.dailyChanges.wheat || 0) - totalNeeded;
            }
        } else {
            // 小麦不足
            const deficit = totalNeeded - wheatStock;
            this.state.inventory.wheat = 0;

            // 全体村民心情下降
            this.state.villagers.forEach(v => {
                v.mood = Math.max(0, v.mood - 3);
            });

            this.state.addLog('⚠️', `小麦不足！缺少${deficit}🌾，村民心情大幅下降`, 'danger');
            this.bus.emit('foodShortage', { deficit });

            if (wheatStock === 0) {
                this.bus.emit('showToast', { message: '⚠️ 小麦告急！请尽快种植或购买小麦', type: 'warning' });
            }
        }

        // 冬季额外消耗木材取暖
        if (this.state.season === 'winter') {
            const woodCost = this.getWinterWoodCost();
            if (woodCost > 0) {
                if (this.state.resources.wood >= woodCost) {
                    this.state.modifyResource('wood', -woodCost);
                } else {
                    this.state.addLog('🥶', '木材不足以取暖，村民心情下降', 'warning');
                    this.state.villagers.forEach(v => {
                        v.mood = Math.max(0, v.mood - 1);
                    });
                }
            }
        }

        // 小麦即将耗尽预警
        const remaining = this.state.inventory.wheat || 0;
        if (remaining > 0 && remaining <= totalNeeded * 3) {
            this.state.addLog('⚠️', `小麦仅剩${remaining}🌾，只够约${Math.floor(remaining / Math.max(1, totalNeeded))}天`, 'warning');
        }
    }

    /** 计算冬季取暖木材消耗 */
    getWinterWoodCost() {
        const w = this.state.weather;
        // 暴雪封路额外消耗2木材
        if (w.activeEvent === 'blizzard') return 2;
        // 冬季默认消耗1木材
        return 1;
    }

    /** 金币收入（出售物品时调用） */
    earnGold(amount, reason) {
        this.state.modifyResource('gold', amount);
        this.state.addLog('💰', `${reason}，获得${amount}💰`, 'success');
    }

    /** 金币支出 */
    spendGold(amount, reason) {
        if (this.state.resources.gold < amount) return false;
        this.state.modifyResource('gold', -amount);
        return true;
    }
}
