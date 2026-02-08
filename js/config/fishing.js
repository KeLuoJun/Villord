/**
 * 钓鱼系统配置表
 * 定义鱼种、鱼塘等级、鱼饵、时机判定参数和天气修正
 */

// ===== 稀有度定义 =====
export const RARITY = {
    common:    { id: 'common',    name: '普通', color: '#9e9e9e', weight: 60 },
    uncommon:  { id: 'uncommon',  name: '优质', color: '#2196f3', weight: 25 },
    rare:      { id: 'rare',      name: '稀有', color: '#9c27b0', weight: 12 },
    legendary: { id: 'legendary', name: '传说', color: '#ff9800', weight: 3  },
};

// ===== 鱼种配置 =====
export const FISH_TYPES = {
    // --- 普通 (60%) ---
    crucianCarp: {
        id: 'crucianCarp',
        name: '鲫鱼',
        icon: '🐟',
        rarity: 'common',
        basePrice: 8,
        seasons: ['spring', 'summer', 'autumn', 'winter'],
        description: '最常见的淡水鱼，肉质鲜嫩',
    },
    grassCarp: {
        id: 'grassCarp',
        name: '草鱼',
        icon: '🐟',
        rarity: 'common',
        basePrice: 12,
        seasons: ['spring', 'summer', 'autumn'],
        description: '个头较大的常见鱼，喜欢吃草',
    },

    // --- 优质 (25%) ---
    commonCarp: {
        id: 'commonCarp',
        name: '鲤鱼',
        icon: '🐠',
        rarity: 'uncommon',
        basePrice: 15,
        seasons: ['spring', 'summer'],
        description: '红色鳞片闪闪发光，是好兆头',
    },
    silverCarp: {
        id: 'silverCarp',
        name: '鲢鱼',
        icon: '🐠',
        rarity: 'uncommon',
        basePrice: 18,
        seasons: ['summer', 'autumn'],
        description: '银白色大鱼，力气很大',
    },

    // --- 稀有 (12%) ---
    mandarin: {
        id: 'mandarin',
        name: '鳜鱼',
        icon: '🐡',
        rarity: 'rare',
        basePrice: 30,
        seasons: ['autumn'],
        description: '桃花流水鳜鱼肥，秋季限定美味',
    },
    snakehead: {
        id: 'snakehead',
        name: '黑鱼',
        icon: '🐡',
        rarity: 'rare',
        basePrice: 35,
        seasons: ['summer', 'autumn'],
        description: '凶猛的肉食性鱼类，营养丰富',
    },

    // --- 传说 (3%) ---
    koi: {
        id: 'koi',
        name: '锦鲤',
        icon: '🎏',
        rarity: 'legendary',
        basePrice: 100,
        seasons: ['spring', 'autumn'],
        description: '传说中的幸运之鱼，金红相间',
    },
    goldenDragon: {
        id: 'goldenDragon',
        name: '金龙鱼',
        icon: '🐉',
        rarity: 'legendary',
        basePrice: 200,
        seasons: ['summer'],
        description: '极为罕见的金色巨鱼，价值连城',
    },
};

// ===== 鱼塘等级配置 =====
export const POND_LEVELS = [
    {
        level: 0,
        name: '简易鱼塘',
        capacity: 5,
        upgradeCost: null, // 初始等级，无升级费用
    },
    {
        level: 1,
        name: '标准鱼塘',
        capacity: 8,
        upgradeCost: { gold: 50, wood: 10, stone: 0 },
    },
    {
        level: 2,
        name: '高级鱼塘',
        capacity: 12,
        upgradeCost: { gold: 80, wood: 15, stone: 5 },
    },
];

// ===== 鱼饵配置 =====
export const BAIT_TYPES = {
    normal: {
        id: 'normal',
        name: '普通鱼饵',
        icon: '🪱',
        rarityBonus: 0,        // 无稀有度加成
        cost: 0,               // 免费（默认）
        description: '基础鱼饵，勉强能用',
    },
    premium: {
        id: 'premium',
        name: '高级鱼饵',
        icon: '🦗',
        rarityBonus: 0.15,     // 稀有及以上概率 +15%
        cost: 10,
        description: '品质优良，更容易吸引好鱼',
        unlockCondition: '图鉴收集5种鱼',
    },
    legendary: {
        id: 'legendary',
        name: '传说鱼饵',
        icon: '✨',
        rarityBonus: 0.30,     // 稀有及以上概率 +30%
        cost: 30,
        description: '神秘鱼饵，传说级鱼概率大幅提升',
        unlockCondition: '图鉴收集全部鱼种',
    },
};

// ===== 小游戏时机判定参数 =====
export const FISHING_TIMING = {
    // 等待鱼咬钩的时间范围（毫秒）
    waitMin: 2000,
    waitMax: 6000,

    // 试探阶段持续时间（毫秒）
    nibbleDuration: 1500,

    // 咬钩窗口持续时间（毫秒）—— 玩家必须在此期间点击
    biteWindowDuration: 1500,

    // 进度条指针速度（像素/毫秒）
    pointerSpeed: 0.20,

    // 判定区域占比（进度条总宽度的百分比）
    zones: {
        perfect: 0.10,   // 中间10%为Perfect区
        good: 0.25,      // 两侧各12.5%为Good区（总25%）
        miss: 0.65,      // 剩余为Miss区
    },

    // Perfect 加成
    perfectBonus: 1.5,  // 售价 ×1.5
};

// ===== 鱼恢复参数 =====
export const FISH_RECOVERY = {
    daysPerFish: 2,  // 每条鱼需要2天恢复
};

// ===== 天气对钓鱼的影响 =====
export const WEATHER_FISHING_MODS = {
    // 默认天气（各季节）
    spring_default: { speedMod: 1.0,  rarityMod: 1.0  },
    summer_default: { speedMod: 1.0,  rarityMod: 1.0  },
    autumn_default: { speedMod: 1.0,  rarityMod: 1.1  },  // 秋季鱼肥
    winter_default: { speedMod: 0.8,  rarityMod: 0.9  },  // 冬季鱼少

    // 特殊天气
    rain:          { speedMod: 1.5,  rarityMod: 1.2  },  // 雨天鱼活跃
    heavy_rain:    { speedMod: 1.3,  rarityMod: 1.3  },  // 大雨更好
    storm:         { speedMod: 0,    rarityMod: 0    },  // 暴风雨禁止钓鱼
    drought:       { speedMod: 0.5,  rarityMod: 0.7  },  // 干旱鱼少
    fog:           { speedMod: 1.2,  rarityMod: 1.1  },  // 雾天不错
    snow:          { speedMod: 0.3,  rarityMod: 0.8  },  // 雪天极慢
    blizzard:      { speedMod: 0,    rarityMod: 0    },  // 暴风雪禁止
    heatwave:      { speedMod: 0.7,  rarityMod: 0.9  },  // 酷暑鱼躲深处
};

// ===== 图鉴奖励 =====
export const COLLECTION_REWARDS = [
    {
        threshold: 5,
        name: '初级钓手',
        reward: '解锁高级鱼饵',
        icon: '🦗',
        gold: 30,
    },
    {
        threshold: 10,
        name: '钓鱼大师',
        reward: '50💰 + 称号',
        icon: '🏆',
        gold: 50,
    },
    {
        threshold: Object.keys(FISH_TYPES).length,  // 全收集
        name: '传说渔夫',
        reward: '传说鱼竿（稀有率+10%）',
        icon: '👑',
        gold: 100,
        legendaryRod: true,
    },
];

// ===== 连击奖励 =====
export const COMBO_BONUSES = [
    { threshold: 3,  multiplier: 1.1, label: '×3 连击！' },
    { threshold: 5,  multiplier: 1.2, label: '×5 连击！！' },
    { threshold: 10, multiplier: 1.5, label: '×10 超级连击！！！' },
];

/**
 * 根据当前季节获取可钓鱼种列表
 * @param {string} season - 季节ID（spring/summer/autumn/winter）
 * @returns {object[]} 当季可钓鱼种配置数组
 */
export function getSeasonalFish(season) {
    return Object.values(FISH_TYPES).filter(f => f.seasons.includes(season));
}

/**
 * 根据天气ID获取钓鱼修正
 * @param {string} weatherId - 天气ID
 * @returns {{ speedMod: number, rarityMod: number }}
 */
export function getWeatherMod(weatherId) {
    return WEATHER_FISHING_MODS[weatherId] || { speedMod: 1.0, rarityMod: 1.0 };
}
