/**
 * PolicySystem - 政策系统
 * 管理四大政策（工时制度、分配制度、奖惩机制、休假制度）的切换、每日结算和事件触发
 *
 * 核心设计：每种政策都有 trade-off，没有最优解，只有适合当前局势的解。
 */
import { MAX_MOOD } from '../config/villagers.js';
import {
    POLICY_CATEGORIES,
    calculatePolicyEffects,
    isRestDay,
    getPolicyConfig,
} from '../config/policies.js';

/** 政策切换冷却时间（游戏天数） */
const POLICY_CHANGE_COOLDOWN = 2;

export class PolicySystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        /** 各政策类别的上次变更日（防止频繁切换） */
        this.changeCooldowns = {};

        // 监听事件
        this.bus.on('newDay', () => this.onNewDay());

        console.log('[PolicySystem] 政策系统已初始化');
    }

    // ===== 政策切换 =====

    /**
     * 切换某类政策
     * @param {string} category - 政策类别 key（workHours/distribution/reward/holiday）
     * @param {string} newPolicyId - 新政策 ID
     * @returns {{ success: boolean, reason?: string }}
     */
    changePolicy(category, newPolicyId) {
        const catConfig = POLICY_CATEGORIES[category];
        if (!catConfig) return { success: false, reason: '无效的政策类别' };

        const option = catConfig.options[newPolicyId];
        if (!option) return { success: false, reason: '无效的政策选项' };

        const currentValue = this.state.policies[category];
        if (currentValue === newPolicyId) return { success: false, reason: '已是当前政策' };

        // 冷却检查
        const lastChange = this.changeCooldowns[category] || 0;
        const daysSince = this.state.totalDays - lastChange;
        if (daysSince < POLICY_CHANGE_COOLDOWN && lastChange > 0) {
            return {
                success: false,
                reason: `政策切换冷却中，还需 ${POLICY_CHANGE_COOLDOWN - daysSince} 天后才能再次更改${catConfig.name}`,
            };
        }

        const oldPolicy = getPolicyConfig(category, currentValue);
        const oldName = oldPolicy ? oldPolicy.name : currentValue;

        // 执行切换
        this.state.policies[category] = newPolicyId;
        this.changeCooldowns[category] = this.state.totalDays;

        // 日志
        this.state.addLog(
            '📜',
            `${catConfig.icon} ${catConfig.name}变更：${oldName} → ${option.name}`,
            'info'
        );

        // 发射事件
        this.bus.emit('policyChanged', {
            category,
            oldPolicy: currentValue,
            newPolicy: newPolicyId,
            oldName,
            newName: option.name,
        });
        this.bus.emit('showToast', {
            message: `📜 ${catConfig.name}已变更为「${option.name}」`,
            type: 'success',
        });
        this.bus.emit('uiUpdate');

        console.log(`[PolicySystem] ${catConfig.name}: ${oldName} → ${option.name}`);
        return { success: true };
    }

    /**
     * 获取某类政策是否处于冷却中
     * @param {string} category
     * @returns {{ onCooldown: boolean, remaining: number }}
     */
    getCooldownStatus(category) {
        const lastChange = this.changeCooldowns[category] || 0;
        if (lastChange === 0) return { onCooldown: false, remaining: 0 };
        const daysSince = this.state.totalDays - lastChange;
        const remaining = Math.max(0, POLICY_CHANGE_COOLDOWN - daysSince);
        return { onCooldown: remaining > 0, remaining };
    }

    // ===== 每日结算 =====

    /** 每日政策效果结算（在 newDay 事件中触发） */
    onNewDay() {
        const effects = this.state.getPolicyEffects();
        const today = this.state.time.day;
        const restDay = this.state.isRestDay;

        // ─── 休假制度：连续工作追踪 ───
        if (restDay) {
            this.state._consecutiveWorkDays = 0;
            this.applyRestDayEffects(effects);
        } else {
            this.state._consecutiveWorkDays = (this.state._consecutiveWorkDays || 0) + 1;
            // 连续工作疲劳惩罚
            if (this.state._consecutiveWorkDays > effects.continuousWorkThreshold) {
                this.applyFatigueEffects(effects);
            }
        }

        // ─── 工时制度：每日心情变化 ───
        // ─── 分配制度：每日心情变化 ───
        // ─── 奖惩机制：每日心情变化 + 金币扣除 ───
        // 综合心情变化（非休息日才应用工作相关心情惩罚）
        if (!restDay) {
            this.applyDailyMoodEffects(effects);
        }

        // ─── 奖惩机制：绩效奖金扣款 ───
        if (effects.dailyGoldCost > 0 && !restDay) {
            this.applyBonusCost(effects);
        }

        // ─── 奖惩机制：偷懒处罚 - 懒惰村民额外心情惩罚 ───
        if (effects.lazyMoodDelta !== 0 && !restDay) {
            this.applyLazyPunishment(effects);
        }
    }

    /** 应用休息日效果（心情恢复 + 体力全恢复） */
    applyRestDayEffects(effects) {
        this.state.villagers.forEach(v => {
            // 心情恢复
            if (effects.restDayMoodBonus > 0) {
                v.mood = Math.min(MAX_MOOD, v.mood + effects.restDayMoodBonus);
            }
            // 体力全恢复
            if (effects.restDayStaminaRestore) {
                v.stamina = v.maxStamina;
            }
        });

        if (this.state.villagers.length > 0) {
            this.state.addLog('🏖️', `今天是休息日，村民身心得到恢复`, 'info');
        }
    }

    /** 应用连续工作疲劳效果 */
    applyFatigueEffects(effects) {
        const days = this.state._consecutiveWorkDays;
        this.state.villagers.forEach(v => {
            v.mood = Math.max(0, v.mood + effects.fatigueMoodDelta);
        });

        if (days === effects.continuousWorkThreshold + 1) {
            this.state.addLog('😰', `村民已连续工作${days}天，疲劳开始积累！`, 'warning');
            this.bus.emit('showToast', {
                message: `😰 村民连续工作${days}天，状态下降中！`,
                type: 'warning',
            });
        }
    }

    /** 应用每日心情变化（综合所有政策的 dailyMoodDelta） */
    applyDailyMoodEffects(effects) {
        if (effects.dailyMoodDelta === 0) return;

        this.state.villagers.forEach(v => {
            v.mood = Math.max(0, Math.min(MAX_MOOD, v.mood + effects.dailyMoodDelta));
        });

        if (effects.dailyMoodDelta < 0) {
            // 只在心情下降时记录警告
            const absVal = Math.abs(effects.dailyMoodDelta);
            this.state.addLog('😞', `当前政策导致村民心情 -${absVal}`, 'warning');
        }
    }

    /** 应用绩效奖金扣款 */
    applyBonusCost(effects) {
        const cost = effects.dailyGoldCost * this.state.villagers.length;
        if (cost <= 0) return;

        if (this.state.resources.gold >= cost) {
            this.state.modifyResource('gold', -cost);
            this.state.addLog('💰', `发放绩效奖金 -${cost}💰`, 'info');
        } else {
            // 金币不足，绩效奖金失效，心情反而下降
            this.state.villagers.forEach(v => {
                v.mood = Math.max(0, v.mood - 1);
            });
            this.state.addLog('💸', `金币不足以发放绩效奖金！村民心情下降`, 'danger');
            this.bus.emit('showToast', {
                message: '💸 金币不足发放奖金，村民失望了！',
                type: 'warning',
            });
        }
    }

    /** 应用懒惰村民额外心情惩罚（偷懒处罚政策） */
    applyLazyPunishment(effects) {
        this.state.villagers.forEach(v => {
            if (v.traits.includes('懒惰')) {
                v.mood = Math.max(0, v.mood + effects.lazyMoodDelta);
            }
        });
    }

    // ===== 查询接口 =====

    /** 获取当前所有政策的详细配置信息（供 UI 使用） */
    getPoliciesInfo() {
        const result = {};
        for (const [catKey, catConfig] of Object.entries(POLICY_CATEGORIES)) {
            const currentId = this.state.policies[catKey];
            const cooldown = this.getCooldownStatus(catKey);
            result[catKey] = {
                ...catConfig,
                currentId,
                currentOption: catConfig.options[currentId],
                cooldown,
                options: Object.values(catConfig.options).map(opt => ({
                    ...opt,
                    isCurrent: opt.id === currentId,
                })),
            };
        }
        return result;
    }

    /** 获取当前政策综合效果描述（供 UI 概览使用） */
    getEffectsSummary() {
        const effects = this.state.getPolicyEffects();
        const parts = [];

        // 产出倍率
        const prodStr = effects.productionMult.toFixed(2);
        if (effects.productionMult > 1) parts.push(`产出×${prodStr}↑`);
        else if (effects.productionMult < 1) parts.push(`产出×${prodStr}↓`);
        else parts.push(`产出×1.00`);

        // 心情
        if (effects.dailyMoodDelta > 0) parts.push(`心情+${effects.dailyMoodDelta}/天`);
        else if (effects.dailyMoodDelta < 0) parts.push(`心情${effects.dailyMoodDelta}/天`);
        else parts.push('心情±0/天');

        // 体力恢复
        if (effects.staminaRecoveryMult !== 1.0) {
            parts.push(`体力恢复×${effects.staminaRecoveryMult}`);
        }

        // 金币成本
        if (effects.dailyGoldCost > 0) {
            const totalCost = effects.dailyGoldCost * this.state.villagers.length;
            parts.push(`日耗${totalCost}💰`);
        }

        return parts.join('　');
    }

    // ===== 面板接口（UIManager 注册用） =====

    /** 标签页激活时调用 */
    onActivate() {
        this.bus.emit('policyPanelUpdate');
    }

    /** 标签页更新 */
    update() {
        this.bus.emit('policyPanelUpdate');
    }
}
