/**
 * 建筑配置表
 * 定义所有建筑的属性、造价和功能
 */

export const BUILDINGS = {
    // ===== 住房 =====
    hut: {
        id: 'hut',
        name: '茅草屋',
        icon: '🏚️',
        category: 'housing',
        capacity: 1,
        cost: { gold: 35, wood: 15, stone: 0 },
        description: '简陋但便宜，容纳1名村民',
        unlocked: true,
    },
    woodHouse: {
        id: 'woodHouse',
        name: '木屋',
        icon: '🏠',
        category: 'housing',
        capacity: 2,
        cost: { gold: 90, wood: 35, stone: 10 },
        description: '舒适木屋，容纳2名村民',
        unlocked: false,
        unlockCondition: '拥有2块农田',
    },
    stoneHouse: {
        id: 'stoneHouse',
        name: '石屋',
        icon: '🏡',
        category: 'housing',
        capacity: 3,
        cost: { gold: 200, wood: 20, stone: 60 },
        description: '坚固石屋，容纳3名村民',
        unlocked: false,
        unlockCondition: '拥有采石场',
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
