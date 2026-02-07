/**
 * 政策配置 — 治村物语政策系统
 * 定义四大政策（工时制度、分配制度、奖惩机制、休假制度）的所有选项、数值参数和描述文本
 *
 * 核心设计原则：每种政策都有 trade-off，没有最优解，只有适合当前局势的解。
 */

// ===== 工时制度 =====
export const WORK_HOURS_POLICIES = {
    standard: {
        id: 'standard',
        name: '朝八晚六',
        icon: '🏢',
        description: '经典朝八晚六工作制，劳逸结合、稳扎稳打。',
        workStart: 8,       // 工作开始时间
        workEnd: 18,        // 工作结束时间（之后安排轻松活动）
        productionMult: 1.0, // 产出倍率
        dailyMoodDelta: 0,  // 每日心情变化
        staminaRecoveryMult: 1.0, // 体力恢复倍率
        tags: ['均衡'],
    },
    996: {
        id: '996',
        name: '996',
        icon: '🔥',
        description: '早九晚九、一周六天，产出大增但村民身心俱疲。适合短期冲刺。',
        workStart: 8,
        workEnd: 21,
        productionMult: 1.35,
        dailyMoodDelta: -1,
        staminaRecoveryMult: 0.7,
        tags: ['高压', '高产出'],
    },
    chill: {
        id: 'chill',
        name: '佛系模式',
        icon: '🧘',
        description: '十点上班四点下班，村民开心但产出大降。适合危机后的恢复期。',
        workStart: 10,
        workEnd: 16,
        productionMult: 0.65,
        dailyMoodDelta: 1,
        staminaRecoveryMult: 1.3,
        tags: ['轻松', '低产出'],
    },
};

// ===== 分配制度 =====
export const DISTRIBUTION_POLICIES = {
    public: {
        id: 'public',
        name: '产出归公',
        icon: '🏛️',
        description: '所有产出全部归入公库，统一分配。村民缺乏动力，效率下降。',
        storageRate: 1.0,       // 入库比例（100%）
        efficiencyMult: 0.85,   // 效率倍率
        dailyMoodDelta: -1,
        skillGrowthMult: 1.0,   // 技能成长倍率
        tags: ['集中管控', '低效率'],
    },
    merit: {
        id: 'merit',
        name: '按劳分配',
        icon: '⚖️',
        description: '产出80%归公，20%转化为村民积极性。多劳多得，技能成长加速。',
        storageRate: 0.8,
        efficiencyMult: 1.1,
        dailyMoodDelta: 0,
        skillGrowthMult: 1.5,
        tags: ['均衡', '成长快'],
    },
    freeMarket: {
        id: 'freeMarket',
        name: '自由市场',
        icon: '🏪',
        description: '村民可自行保留和交易30%产出。快乐但可能出现"倒爷"。',
        storageRate: 0.7,
        efficiencyMult: 1.0,
        dailyMoodDelta: 1,
        skillGrowthMult: 1.0,
        scalperChance: 0.08,    // 每日倒爷事件触发概率
        tags: ['自由', '有风险'],
    },
};

// ===== 奖惩机制 =====
export const REWARD_POLICIES = {
    none: {
        id: 'none',
        name: '无奖惩',
        icon: '😐',
        description: '不设奖惩，一切靠自觉。省钱但缺乏激励。',
        dailyGoldCost: 0,       // 每日金币消耗（每村民）
        obedientBonus: 1.0,     // "听话"特质加成倍率
        rebelPenalty: 1.0,      // "叛逆"偏差概率倍率
        lazyPenalty: 1.0,       // "懒惰"偏差概率倍率
        dailyMoodDelta: 0,
        efficiencyMult: 1.0,
        tags: ['省钱', '无激励'],
    },
    bonus: {
        id: 'bonus',
        name: '绩效奖金',
        icon: '💰',
        description: '每日发放绩效奖金，村民干劲十足。听话的更听话，叛逆的也会收敛。',
        dailyGoldCost: 5,       // 每村民每天消耗5金币
        obedientBonus: 2.0,     // "听话"加成翻倍
        rebelPenalty: 0.5,      // "叛逆"偏差减半
        lazyPenalty: 0.6,       // "懒惰"偏差减少
        dailyMoodDelta: 1,
        efficiencyMult: 1.0,
        tags: ['花钱', '高激励'],
    },
    punish: {
        id: 'punish',
        name: '偷懒处罚',
        icon: '⚡',
        description: '严惩偷懒者！懒人更容易被抓到，但叛逆者可能变本加厉。',
        dailyGoldCost: 0,
        obedientBonus: 1.0,
        rebelPenalty: 1.8,      // 叛逆偏差大幅增加
        lazyPenalty: 1.5,       // 懒惰偏差增加（被发现概率更高）
        dailyMoodDelta: 0,      // 总体心情不变
        lazyMoodDelta: -1,      // 懒惰村民额外心情惩罚
        efficiencyMult: 1.1,    // 非懒惰村民效率提升
        tags: ['严厉', '高风险'],
    },
};

// ===== 休假制度 =====
export const HOLIDAY_POLICIES = {
    none: {
        id: 'none',
        name: '无休息',
        icon: '🚫',
        description: '全年无休！短期高效但连续工作超过3天后村民状态急剧下降。',
        restDays: [],                // 每季中的休息日（空=无）
        continuousWorkThreshold: 3,  // 连续工作X天后开始疲劳惩罚
        fatigueMoodDelta: -1,        // 疲劳期每日心情惩罚
        fatigueStaminaMult: 0.8,     // 疲劳期体力恢复倍率
        productionMult: 1.0,         // 基础产出倍率（仅按工作天数算）
        tags: ['无休', '高风险'],
    },
    one: {
        id: 'one',
        name: '单休',
        icon: '📅',
        description: '每季第5天为休息日。适度休息，维持稳定产出。',
        restDays: [5],               // 第5天休息
        continuousWorkThreshold: Infinity,
        fatigueMoodDelta: 0,
        fatigueStaminaMult: 1.0,
        productionMult: 1.0,         // 4/5天工作
        restDayMoodBonus: 1,         // 休息日额外心情恢复
        restDayStaminaRestore: true, // 休息日体力完全恢复
        tags: ['均衡', '推荐'],
    },
    two: {
        id: 'two',
        name: '双休',
        icon: '🏖️',
        description: '每季第4-5天休息。村民身心愉悦但产出只有三天份额。',
        restDays: [4, 5],            // 第4+5天休息
        continuousWorkThreshold: Infinity,
        fatigueMoodDelta: 0,
        fatigueStaminaMult: 1.0,
        productionMult: 1.0,         // 3/5天工作
        restDayMoodBonus: 1,         // 休息日心情恢复更多
        restDayStaminaRestore: true,
        tags: ['轻松', '低产出'],
    },
};

// ===== 政策分类汇总 =====
export const POLICY_CATEGORIES = {
    workHours: {
        key: 'workHours',
        name: '工时制度',
        icon: '⏰',
        description: '设定村民的每日工作时间范围',
        options: WORK_HOURS_POLICIES,
        defaultValue: 'standard',
    },
    distribution: {
        key: 'distribution',
        name: '分配制度',
        icon: '📦',
        description: '决定村民产出如何分配',
        options: DISTRIBUTION_POLICIES,
        defaultValue: 'public',
    },
    reward: {
        key: 'reward',
        name: '奖惩机制',
        icon: '🏅',
        description: '奖励勤劳者还是惩罚偷懒者',
        options: REWARD_POLICIES,
        defaultValue: 'none',
    },
    holiday: {
        key: 'holiday',
        name: '休假制度',
        icon: '🏖️',
        description: '设定村民的每季休息日安排',
        options: HOLIDAY_POLICIES,
        defaultValue: 'one',
    },
};

// ===== 默认政策组合 =====
export const DEFAULT_POLICIES = {
    workHours: 'standard',
    distribution: 'public',
    reward: 'none',
    holiday: 'one',
};

/**
 * 获取指定政策类别的当前选中配置
 * @param {string} category - 政策类别 key（workHours/distribution/reward/holiday）
 * @param {string} policyId - 当前选中的政策 ID
 * @returns {object} 政策配置对象
 */
export function getPolicyConfig(category, policyId) {
    const cat = POLICY_CATEGORIES[category];
    if (!cat) return null;
    return cat.options[policyId] || cat.options[cat.defaultValue];
}

/**
 * 汇总当前政策组合的综合效果
 * @param {object} policies - 当前政策状态 { workHours, distribution, reward, holiday }
 * @returns {object} 综合效果
 */
export function calculatePolicyEffects(policies) {
    const wh = WORK_HOURS_POLICIES[policies.workHours] || WORK_HOURS_POLICIES.standard;
    const dist = DISTRIBUTION_POLICIES[policies.distribution] || DISTRIBUTION_POLICIES.public;
    const rwd = REWARD_POLICIES[policies.reward] || REWARD_POLICIES.none;
    const hol = HOLIDAY_POLICIES[policies.holiday] || HOLIDAY_POLICIES.one;

    return {
        // 工作时间
        workStart: wh.workStart,
        workEnd: wh.workEnd,
        workHours: wh.workEnd - wh.workStart,

        // 产出：工时倍率 * 分配效率 * 奖惩效率
        productionMult: wh.productionMult * dist.efficiencyMult * rwd.efficiencyMult,

        // 每日心情变化：所有政策的心情增量叠加
        dailyMoodDelta: wh.dailyMoodDelta + dist.dailyMoodDelta + rwd.dailyMoodDelta,

        // 体力恢复倍率
        staminaRecoveryMult: wh.staminaRecoveryMult,

        // 入库比例
        storageRate: dist.storageRate,

        // 技能成长倍率
        skillGrowthMult: dist.skillGrowthMult,

        // 奖惩系数
        obedientBonus: rwd.obedientBonus,
        rebelPenalty: rwd.rebelPenalty,
        lazyPenalty: rwd.lazyPenalty,
        dailyGoldCost: rwd.dailyGoldCost,
        lazyMoodDelta: rwd.lazyMoodDelta || 0,

        // 休假
        restDays: hol.restDays,
        continuousWorkThreshold: hol.continuousWorkThreshold,
        fatigueMoodDelta: hol.fatigueMoodDelta,
        fatigueStaminaMult: hol.fatigueStaminaMult,
        restDayMoodBonus: hol.restDayMoodBonus || 0,
        restDayStaminaRestore: hol.restDayStaminaRestore || false,

        // 自由市场倒爷概率
        scalperChance: dist.scalperChance || 0,
    };
}

/**
 * 判断今天是否为休息日
 * @param {number} dayInSeason - 当季第几天（1-5）
 * @param {object} policies - 当前政策状态
 * @returns {boolean}
 */
export function isRestDay(dayInSeason, policies) {
    const hol = HOLIDAY_POLICIES[policies.holiday] || HOLIDAY_POLICIES.one;
    return hol.restDays.includes(dayInSeason);
}
