/**
 * 建筑配置表
 * 定义所有建筑的属性、造价和功能
 */

export const BUILDINGS = {
    // ===== 住房（单栋可升级） =====
    house: {
        id: 'house',
        name: '住宅',
        icon: '🏚️',
        category: 'housing',
        capacity: 1,  // 初始容量（Lv0）
        cost: { gold: 35, wood: 15, stone: 0 },
        description: '建造住宅供村民居住，可逐级扩建',
        unlocked: true,
    },

    // ===== 采集/生产建筑 =====
    farmPlot: {
        id: 'farmPlot',
        name: '农田',
        icon: '🌾',
        category: 'production',
        subcategory: 'gathering',
        cost: { gold: 50, wood: 10, stone: 0 },
        production: '粮食/作物',
        workersNeeded: 1,
        description: '种植各类作物的基础设施',
        unlocked: true,
    },
    lumberYard: {
        id: 'lumberYard',
        name: '伐木场',
        icon: '🪓',
        category: 'production',
        subcategory: 'gathering',
        cost: { gold: 70, wood: 20, stone: 0 },
        production: '木材',
        outputPerDay: 2,
        workersNeeded: 1,
        description: '每日产出木材',
        unlocked: true,
    },
    quarry: {
        id: 'quarry',
        name: '采石场',
        icon: '⛏️',
        category: 'production',
        subcategory: 'gathering',
        cost: { gold: 70, wood: 15, stone: 0 },
        production: '石料',
        outputPerDay: 2,
        workersNeeded: 1,
        description: '每日产出石料',
        unlocked: true,
    },
    fishPond: {
        id: 'fishPond',
        name: '鱼塘',
        icon: '🎣',
        category: 'production',
        subcategory: 'gathering',
        cost: { gold: 80, wood: 15, stone: 0 },
        production: '鱼类',
        workersNeeded: 0,
        description: '建造鱼塘，解锁钓鱼玩法',
        unlocked: true,
        maxCount: 1,
    },
    mill: {
        id: 'mill',
        name: '磨坊',
        icon: '🏭',
        category: 'production',
        subcategory: 'processing',
        cost: { gold: 160, wood: 25, stone: 20 },
        production: '小麦→面粉',
        workersNeeded: 1,
        description: '将小麦加工为面粉',
        unlocked: false,
        unlockCondition: '收获过小麦',
    },
    bakery: {
        id: 'bakery',
        name: '面包坊',
        icon: '🍞',
        category: 'production',
        subcategory: 'processing',
        cost: { gold: 230, wood: 30, stone: 30 },
        production: '面粉→面包',
        workersNeeded: 1,
        description: '将面粉烘焙为面包',
        unlocked: false,
        unlockCondition: '拥有磨坊',
    },

    // ===== 市政建筑 =====
    warehouse: {
        id: 'warehouse',
        name: '仓库升级',
        icon: '📦',
        category: 'municipal',
        cost: { gold: 100, wood: 20, stone: 0 },
        description: '扩大存储上限',
        unlocked: true,
        maxCount: 3,
    },
    well: {
        id: 'well',
        name: '水井',
        icon: '🪣',
        category: 'municipal',
        cost: { gold: 45, wood: 0, stone: 10 },
        description: '减少农田浇水需求',
        unlocked: true,
        maxCount: 1,
    },
};

/**
 * 住宅升级等级配置
 * 每栋住宅初建为 Lv0（茅草屋），可逐级扩建
 */
export const HOUSE_LEVELS = [
    { level: 0, name: '茅草屋', icon: '🏚️', capacity: 1 },
    { level: 1, name: '木屋',   icon: '🏠', capacity: 2,
      upgradeCost: { gold: 60, wood: 25, stone: 0 },
      description: '扩建为木屋，容纳2名村民' },
    { level: 2, name: '石屋',   icon: '🏡', capacity: 3,
      upgradeCost: { gold: 120, wood: 20, stone: 50 },
      description: '扩建为石屋，容纳3名村民',
      unlockCondition: '拥有采石场' },
];

/**
 * 检查是否有足够资源建造
 * @param {object} resources - 当前资源
 * @param {object} cost - 建造花费
 * @returns {boolean}
 */
export function canAfford(resources, cost) {
    return (resources.gold >= (cost.gold || 0))
        && (resources.wood >= (cost.wood || 0))
        && (resources.stone >= (cost.stone || 0));
}

/**
 * 扣除建造费用
 * @param {object} resources - 当前资源（会被修改）
 * @param {object} cost - 建造花费
 */
export function deductCost(resources, cost) {
    resources.gold -= (cost.gold || 0);
    resources.wood -= (cost.wood || 0);
    resources.stone -= (cost.stone || 0);
}
