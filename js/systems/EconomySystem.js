/**
 * EconomySystem - 经济系统
 * 管理每日消耗（食物、木材）、资源变化追踪
 */
import { DAILY_FOOD_COST, MAX_MOOD } from '../config/villagers.js';

export class EconomySystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        this.bus.on('newDay', () => this.onNewDay());
    }

    /** 每日经济结算 */
    onNewDay() {
        const villagerCount = this.state.villagers.length;

        // 扣除村民食物消耗
        const foodNeeded = villagerCount * DAILY_FOOD_COST;
        if (this.state.resources.food >= foodNeeded) {
            this.state.modifyResource('food', -foodNeeded);
        } else {
            // 粮食不足
            const deficit = foodNeeded - this.state.resources.food;
            this.state.resources.food = 0;

            // 全体村民心情下降
            this.state.villagers.forEach(v => {
                v.mood = Math.max(0, v.mood - 3);
            });

            this.state.addLog('⚠️', `粮食不足！缺少${deficit}🌾，村民心情大幅下降`, 'danger');
            this.bus.emit('foodShortage', { deficit });

            // 粮食告急：记录日志提醒，不暂停游戏
            if (this.state.resources.food === 0) {
                this.bus.emit('showToast', { message: '⚠️ 粮食告急！请尽快解决粮食问题', type: 'warning' });
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

        // 粮食即将耗尽预警
        if (this.state.resources.food > 0 && this.state.resources.food <= villagerCount * 3) {
            this.state.addLog('⚠️', `粮食仅剩${this.state.resources.food}🌾，只够${Math.floor(this.state.resources.food / Math.max(1, villagerCount))}天`, 'warning');
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
