/**
 * 作物配置表
 * 定义所有作物的基础属性
 */
export const CROPS = {
    radish: {
        id: 'radish',
        name: '萝卜',
        icon: '🥕',
        seedPrice: 5,
        growthDays: 3,
        baseYield: 3,         // 基础产量
        sellPrice: 10,
        seedId: 'radish',
        seasons: ['spring', 'summer', 'autumn', 'winter'],  // 全季节
        stage: 'initial',     // initial / develop / prosper
        needsWater: true,
        needsFertilizer: false,
        description: '生长快，全季可种，新手首选',
    },
    wheat: {
        id: 'wheat',
        name: '小麦',
        icon: '🌾',
        seedPrice: 10,
        growthDays: 5,
        baseYield: 4,
        sellPrice: 20,
        seedId: 'wheat',
        seasons: ['spring', 'summer', 'autumn'],
        stage: 'initial',
        needsWater: true,
        needsFertilizer: true,
        description: '利润较高，可加工成面粉',
    },
    potato: {
        id: 'potato',
        name: '土豆',
        icon: '🥔',
        seedPrice: 8,
        growthDays: 4,
        baseYield: 3,
        sellPrice: 15,
        seedId: 'potato',
        seasons: ['spring', 'autumn'],
        stage: 'initial',
        needsWater: true,
        needsFertilizer: false,
        description: '春秋两季，产量稳定',
    },
    pumpkin: {
        id: 'pumpkin',
        name: '南瓜',
        icon: '🎃',
        seedPrice: 25,
        growthDays: 8,
        baseYield: 2,
        sellPrice: 50,
        seedId: 'pumpkin',
        seasons: ['autumn'],
        stage: 'develop',
        needsWater: true,
        needsFertilizer: true,
        description: '仅秋季，利润极高',
    },
    cotton: {
        id: 'cotton',
        name: '棉花',
        icon: '🧵',
        seedPrice: 20,
        growthDays: 6,
        baseYield: 3,
        sellPrice: 35,
        seedId: 'cotton',
        seasons: ['summer'],
        stage: 'develop',
        needsWater: true,
        needsFertilizer: true,
        description: '仅夏季，高利润经济作物',
    },
    grape: {
        id: 'grape',
        name: '葡萄',
        icon: '🍇',
        seedPrice: 40,
        growthDays: 10,
        baseYield: 2,
        sellPrice: 80,
        seedId: 'grape',
        seasons: ['summer', 'autumn'],
        stage: 'prosper',
        needsWater: true,
        needsFertilizer: true,
        description: '夏秋两季，最高利润作物',
    },
};

/** 作物生长阶段 */
export const CROP_STAGES = {
    seed: { name: '种子', icon: '🌱', progress: 0 },
    sprout: { name: '发芽', icon: '🌿', progress: 0.25 },
    growing: { name: '生长中', icon: '🌾', progress: 0.5 },
    mature: { name: '即将成熟', icon: '✨', progress: 0.75 },
    ready: { name: '可收获', icon: '🌟', progress: 1.0 },
    withered: { name: '枯萎', icon: '🥀', progress: -1 },
};

/** 加工配方 */
export const RECIPES = {
    flour: {
        id: 'flour',
        name: '面粉',
        icon: '🫘',
        input: { wheat: 3 },
        output: { flour: 2 },
        facility: 'mill',
        duration: 3,  // 小时
    },
    bread: {
        id: 'bread',
        name: '面包',
        icon: '🍞',
        input: { flour: 2 },
        output: { bread: 1 },
        facility: 'bakery',
        duration: 3,
    },
};
