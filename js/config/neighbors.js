/**
 * 邻村往来系统配置
 * 定义 3 个邻村的属性、贸易定价、事件池、声望等级
 */

// ===== 邻村配置 =====
export const NEIGHBOR_VILLAGES = {
    fenggu: {
        id: 'fenggu',
        name: '丰谷村',
        icon: '🌾',
        personality: '友善热情，乐于分享',
        description: '农业大村，粮食充足但缺石材',
        strength: '农产品',
        weakness: '石料、加工品',
        initialFavor: 25,
        // 贸易定价：相对公开市场的折扣/溢价（<1=便宜, >1=贵）
        tradePricing: {
            wheat: 0.80,     // 小麦便宜 20%
            radish: 0.85,    // 萝卜便宜 15%
            potato: 0.85,
            pumpkin: 0.90,
            stone: 1.30,     // 石料贵 30%
            wood: 1.10,      // 木材略贵
        },
        // 不同季节的需求倾向
        seasonalNeeds: {
            spring: { need: 'stone', offer: 'wheat' },
            summer: { need: 'wood',  offer: 'radish' },
            autumn: { need: 'stone', offer: 'potato' },
            winter: { need: 'wood',  offer: 'wheat' },
        },
    },

    tieling: {
        id: 'tieling',
        name: '铁岭镇',
        icon: '⛏️',
        personality: '务实精明，讲究公平交易',
        description: '矿业小镇，石材木材丰富但缺粮食',
        strength: '建材',
        weakness: '农产品',
        initialFavor: 20,
        tradePricing: {
            stone: 0.75,     // 石料便宜 25%
            wood: 0.80,      // 木材便宜 20%
            wheat: 1.25,     // 小麦贵 25%
            radish: 1.20,    // 萝卜贵 20%
            potato: 1.15,
        },
        seasonalNeeds: {
            spring: { need: 'wheat', offer: 'stone' },
            summer: { need: 'wheat', offer: 'wood' },
            autumn: { need: 'radish', offer: 'stone' },
            winter: { need: 'wheat', offer: 'wood' },
        },
    },

    yunshui: {
        id: 'yunshui',
        name: '云水乡',
        icon: '🏮',
        personality: '圆滑多变，时而慷慨时而计较',
        description: '商贸村落，金币充裕但资源紧缺',
        strength: '金币、市场信息',
        weakness: '各类原料',
        initialFavor: 15,
        tradePricing: {
            wheat: 1.10,
            radish: 1.10,
            stone: 1.15,
            wood: 1.15,
            // 鱼类有优势
            crucianCarp: 1.20,   // 鱼在云水乡溢价收购
            grassCarp: 1.25,
            commonCarp: 1.15,
            koi: 1.40,
        },
        seasonalNeeds: {
            spring: { need: 'wood',  offer: 'gold' },
            summer: { need: 'wheat', offer: 'gold' },
            autumn: { need: 'stone', offer: 'gold' },
            winter: { need: 'wheat', offer: 'gold' },
        },
    },
};

// ===== 声望等级 =====
export const REPUTATION_LEVELS = [
    { level: 1, name: '默默无闻', threshold: 0,   icon: '🏘️', recruitDiscount: 0,   tradeBonus: 0 },
    { level: 2, name: '小有名气', threshold: 30,  icon: '📢', recruitDiscount: 0.05, tradeBonus: 1 },
    { level: 3, name: '远近闻名', threshold: 80,  icon: '🌟', recruitDiscount: 0.10, tradeBonus: 2 },
    { level: 4, name: '德高望重', threshold: 150, icon: '🏅', recruitDiscount: 0.15, tradeBonus: 3 },
    { level: 5, name: '天下桃源', threshold: 250, icon: '👑', recruitDiscount: 0.20, tradeBonus: 5 },
];

// ===== 邻村繁荣状态 =====
export const NEIGHBOR_STATUS = {
    thriving:  { name: '兴旺', icon: '🌟', helpChance: 0.15, requestChance: 0.05, tradeSlots: 3 },
    stable:    { name: '平稳', icon: '☀️', helpChance: 0.10, requestChance: 0.10, tradeSlots: 2 },
    difficult: { name: '困难', icon: '🌧️', helpChance: 0.03, requestChance: 0.20, tradeSlots: 1 },
};

// ===== 邻村事件池 =====
export const NEIGHBOR_EVENTS = [
    // --- 正面来访 ---
    {
        id: 'merchant_visit',
        type: 'positive',
        village: 'yunshui',
        name: '行商来访',
        icon: '🛒',
        description: '云水乡的商人来村里摆摊，带来了稀有种子！',
        minFavor: 20,
        cooldown: 8,
        effect: (state) => {
            // 赠送随机种子
            const seedTypes = ['potato', 'pumpkin', 'grape'];
            const seed = seedTypes[Math.floor(Math.random() * seedTypes.length)];
            state.resources.seeds[seed] = (state.resources.seeds[seed] || 0) + 2;
            return `获得了 2 颗${seed === 'potato' ? '土豆' : seed === 'pumpkin' ? '南瓜' : '葡萄'}种子`;
        },
    },
    {
        id: 'tech_exchange',
        type: 'positive',
        village: 'tieling',
        name: '技术交流',
        icon: '🔧',
        description: '铁岭镇派工匠前来交流，今日伐木和采石效率提升！',
        minFavor: 30,
        cooldown: 10,
        effect: (state) => {
            state.resources.wood += 3;
            state.resources.stone += 2;
            return '获得 3 木材 + 2 石料作为技术交流礼物';
        },
    },
    {
        id: 'harvest_festival',
        type: 'positive',
        village: 'fenggu',
        name: '丰收节邀请',
        icon: '🎉',
        description: '丰谷村邀请你们参加丰收祭典！村民心情大幅提升！',
        minFavor: 40,
        cooldown: 15,
        effect: (state) => {
            state.villagers.forEach(v => { v.mood = Math.min(10, v.mood + 3); });
            state.inventory.wheat = (state.inventory.wheat || 0) + 5;
            return '全体村民心情 +3，获得 5 小麦';
        },
    },

    // --- 互助请求 ---
    {
        id: 'fenggu_pest',
        type: 'request',
        village: 'fenggu',
        name: '虫灾求援',
        icon: '🐛',
        description: '丰谷村遭遇虫灾，请求支援 8 小麦度过难关。',
        minFavor: 10,
        cooldown: 12,
        cost: { wheat: 8 },
        reward: { favor: 12, reputation: 5 },
        delayedReward: { day: 3, seeds: { wheat: 3, radish: 2 } },
        refusePenalty: { favor: -5 },
    },
    {
        id: 'tieling_collapse',
        type: 'request',
        village: 'tieling',
        name: '矿洞塌方',
        icon: '⚠️',
        description: '铁岭镇矿洞塌方，急需 5 木材进行修复支撑。',
        minFavor: 10,
        cooldown: 12,
        cost: { wood: 5 },
        reward: { favor: 15, reputation: 6 },
        delayedReward: { day: 5, resources: { stone: 10 } },
        refusePenalty: { favor: -5 },
    },
    {
        id: 'yunshui_loan',
        type: 'request',
        village: 'yunshui',
        name: '商船搁浅',
        icon: '⛵',
        description: '云水乡商船搁浅，请求借款 20 金币周转。',
        minFavor: 15,
        cooldown: 10,
        cost: { gold: 20 },
        reward: { favor: 10, reputation: 4 },
        delayedReward: { day: 5, resources: { gold: 28 } },
        refusePenalty: { favor: -5 },
    },

    // --- 负面来访 ---
    {
        id: 'trade_dispute',
        type: 'negative',
        village: null,  // 随机邻村
        name: '贸易纠纷',
        icon: '😤',
        description: '邻村商人认为上次交易有猫腻，要求赔偿 10 金币。',
        minFavor: 0,
        cooldown: 15,
        effect: (state) => {
            state.resources.gold = Math.max(0, state.resources.gold - 10);
            return '赔偿了 10 金币平息纠纷';
        },
    },
    {
        id: 'refugee_influx',
        type: 'negative',
        village: null,
        name: '流民涌入',
        icon: '🚶',
        description: '邻村困难时期，流民涌入你的村庄，消耗了部分粮食。',
        minFavor: 0,
        cooldown: 12,
        effect: (state) => {
            const loss = Math.min(state.inventory.wheat || 0, 5);
            state.inventory.wheat = (state.inventory.wheat || 0) - loss;
            return `流民消耗了 ${loss} 小麦（已离开）`;
        },
    },

    // --- 中性来访 ---
    {
        id: 'info_exchange',
        type: 'neutral',
        village: null,
        name: '信息交换',
        icon: '📜',
        description: '邻村来人带来了市场和天气消息。',
        minFavor: 15,
        cooldown: 6,
        effect: (state) => {
            // 给点小好处：提升少量金币
            state.resources.gold += 5;
            return '获得 5 金币作为消息报酬';
        },
    },
    {
        id: 'special_recruit',
        type: 'neutral',
        village: 'fenggu',
        name: '联姻提议',
        icon: '💌',
        description: '丰谷村送来一位候选村民，属性优秀但招募费用翻倍。',
        minFavor: 50,
        cooldown: 20,
        effect: (state) => {
            // 标记有特殊招募可用
            state.neighbors._specialRecruit = true;
            return '特殊候选人已到，下次招募可选择（费用 100 金币）';
        },
    },
];

// ===== 邻村援助条件 =====
export const NEIGHBOR_AID = [
    {
        id: 'famine_aid',
        village: 'fenggu',
        condition: (state, favor) => favor >= 60 && (state.inventory.wheat || 0) <= 2,
        description: '丰谷村看到你们粮食告急，主动送来小麦！',
        icon: '🤝',
        effect: (state) => {
            state.inventory.wheat = (state.inventory.wheat || 0) + 10;
            return '丰谷村援助了 10 小麦';
        },
        cooldown: 10,
    },
    {
        id: 'material_aid',
        village: 'tieling',
        condition: (state, favor) => favor >= 70 && state.resources.wood < 5 && state.resources.stone < 5,
        description: '铁岭镇了解到你们建材短缺，送来一批物资！',
        icon: '🤝',
        effect: (state) => {
            state.resources.wood += 8;
            state.resources.stone += 5;
            return '铁岭镇援助了 8 木材 + 5 石料';
        },
        cooldown: 12,
    },
    {
        id: 'intel_aid',
        village: 'yunshui',
        condition: (state, favor) => favor >= 80,
        description: '云水乡分享独家市场情报，帮你把握商机！',
        icon: '📊',
        effect: (state) => {
            state.resources.gold += 15;
            return '云水乡的独家情报帮你赚了 15 金币';
        },
        cooldown: 8,
    },
];

// ===== 政策对好感度的影响 =====
export const POLICY_FAVOR_EFFECTS = {
    workHours: {
        '996':      { favorDelta: -2, message: '你们村对人太狠了' },
        'chill':    { favorDelta: 1,  message: '你们村的生活节奏不错' },
        'standard': { favorDelta: 0,  message: null },
    },
    holiday: {
        'two':  { favorDelta: 1,  message: '你们村很人道' },
        'one':  { favorDelta: 0,  message: null },
        'none': { favorDelta: -1, message: '你们村连休息日都没有？' },
    },
};

// ===== 赠礼选项（主动提升好感度） =====
export const GIFT_OPTIONS = [
    {
        id: 'gift_gold',
        name: '赠送金币',
        icon: '💰',
        cost: { gold: 15 },
        favorGain: 5,
        reputationGain: 1,
        description: '送去 15 金币作为见面礼',
    },
    {
        id: 'gift_wheat',
        name: '赠送小麦',
        icon: '🌾',
        cost: { wheat: 8 },
        favorGain: 6,
        reputationGain: 2,
        description: '送去 8 小麦表达善意',
    },
    {
        id: 'gift_wood',
        name: '赠送木材',
        icon: '🪵',
        cost: { wood: 5 },
        favorGain: 5,
        reputationGain: 1,
        description: '送去 5 木材帮助建设',
    },
    {
        id: 'gift_stone',
        name: '赠送石料',
        icon: '🪨',
        cost: { stone: 5 },
        favorGain: 5,
        reputationGain: 1,
        description: '送去 5 石料支持发展',
    },
];

// ===== 贸易相关常量 =====
export const TRADE_CONSTANTS = {
    baseFavorForTrade: 30,     // 解锁贸易所需最低好感度
    maxDiscountFavor: 85,      // 好感度达到此值时折扣最大
    maxDiscount: 0.85,         // 最大折扣（85 折）
    baseDailyTrades: 1,        // 基础每日贸易次数
    tradeQuantityPerSlot: 5,   // 每次贸易的数量
    maxGiftsPerDay: 2,         // 每个邻村每天最多赠礼次数
};
