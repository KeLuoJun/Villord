/**
 * GameState - 全局游戏状态管理
 * 所有游戏数据的唯一数据源
 */

// 季节名称映射
const SEASON_NAMES = ['春', '夏', '秋', '冬'];
const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];

export const GameState = {
    // ===== 时间状态 =====
    time: {
        year: 1,
        month: 1,       // 1-4（即季节序号：1=春 2=夏 3=秋 4=冬）
        day: 1,          // 1-9（每季9天）
        hour: 6,         // 0-23
        speed: 1,        // 游戏速度倍率
        isPaused: true,  // 初始暂停，等待玩家开始
        totalTicks: 0,   // 总Tick数
    },

    // ===== 资源 =====
    resources: {
        gold: 100,
        food: 20,
        wood: 30,
        stone: 15,
        seeds: {
            radish: 5,
            wheat: 3,
            potato: 0,
            pumpkin: 0,
            cotton: 0,
            grape: 0,
        },
    },

    // ===== 村民列表（最多4人） =====
    villagers: [],

    // ===== 建筑列表 =====
    buildings: [],

    // ===== 农田列表 =====
    plots: [],

    // ===== 仓库（加工品等） =====
    inventory: {
        radish: 0,
        wheat: 0,
        potato: 0,
        pumpkin: 0,
        cotton: 0,
        grape: 0,
        flour: 0,
        bread: 0,
    },

    // ===== 天气状态 =====
    weather: {
        current: 'spring_default',      // 当前天气ID
        activeEvent: null,              // 当前特殊天气事件ID
        activeEventRemaining: 0,        // 特殊天气剩余天数
        schedule: [],                   // AI预测的14天时间表
        predictionReason: '',           // AI预测理由
        lastEventEndDay: -5,            // 上次特殊天气结束日
    },

    // ===== 市场状态 =====
    market: {
        prices: {},                     // 实时价格 { itemId: price }
        dailyReport: null,              // 今日AI分析师报告
        priceHistory: {},               // 价格历史
    },

    // ===== 事件日志 =====
    eventLog: [],

    // ===== 仓库容量系统 =====
    storage: {
        baseCapacity: 50,          // 基础仓库容量
        upgradeBonus: 50,          // 每次升级增加的容量
        // 重要系数：基础且重要的资源系数高（gold 不占仓库容量）
        importanceFactors: {
            food: 1.5,             // 粮食 - 生存必需
            wood: 1.0,             // 木材 - 建设基础
            stone: 0.8,            // 石料 - 建设辅助
            seeds: 0.6,            // 种子 - 农业储备
            radish: 0.4,           // 萝卜 - 初级农产品
            wheat: 0.4,            // 小麦 - 初级农产品
            potato: 0.4,           // 土豆 - 初级农产品
            pumpkin: 0.3,          // 南瓜 - 中级农产品
            cotton: 0.3,           // 棉花 - 中级农产品
            grape: 0.3,            // 葡萄 - 中级农产品
            flour: 0.3,            // 面粉 - 加工品
            bread: 0.3,            // 面包 - 高级加工品
        },
    },

    // ===== 游戏设置 =====
    settings: {
        villageName: '桃源村',
        maxVillagers: 4,
    },

    // ===== 繁荣度（累计制） =====
    prosperity: 0,
    prosperityData: {
        total: 0,               // 累计繁荣度
        claimedLevels: [],      // 已领取奖励的等级
        todayGain: 0,           // 今日获得
    },

    // ===== 每日资源变化追踪 =====
    dailyChanges: {
        gold: 0,
        food: 0,
        wood: 0,
        stone: 0,
    },

    // ===== 计算属性 =====

    /** 当前季节ID（spring/summer/autumn/winter） */
    get season() {
        // month 直接对应季节：1=春 2=夏 3=秋 4=冬
        return SEASON_IDS[(this.time.month - 1) % 4] || 'spring';
    },

    /** 当前季节中文名 */
    get seasonName() {
        return SEASON_NAMES[(this.time.month - 1) % 4] || '春';
    },

    /** 房屋总容量 */
    get housingCapacity() {
        return this.buildings
            .filter(b => b.category === 'housing')
            .reduce((sum, b) => sum + b.capacity, 0);
    },

    /** 当前仓库总容量（基础 + 升级次数 × 升级加成） */
    get warehouseCapacity() {
        const upgradeCount = this.buildings.filter(b => b.id === 'warehouse').length;
        return this.storage.baseCapacity + upgradeCount * this.storage.upgradeBonus;
    },

    /** 获取某资源的容量上限（金币无上限） */
    getStorageLimit(resourceType) {
        if (resourceType === 'gold') return Infinity;
        const factor = this.storage.importanceFactors[resourceType] || 0.3;
        return Math.floor(factor * this.warehouseCapacity);
    },

    /** 获取某资源的当前数量 */
    getResourceAmount(resourceType) {
        // 主资源
        if (this.resources[resourceType] !== undefined && typeof this.resources[resourceType] === 'number') {
            return this.resources[resourceType];
        }
        // 种子总量
        if (resourceType === 'seeds') {
            return Object.values(this.resources.seeds).reduce((a, b) => a + b, 0);
        }
        // 库存物品
        if (this.inventory[resourceType] !== undefined) {
            return this.inventory[resourceType];
        }
        return 0;
    },

    /** 检查资源是否已满 */
    isStorageFull(resourceType) {
        return this.getResourceAmount(resourceType) >= this.getStorageLimit(resourceType);
    },

    /** 获取可存入的最大数量 */
    getStorageSpace(resourceType) {
        const limit = this.getStorageLimit(resourceType);
        const current = this.getResourceAmount(resourceType);
        return Math.max(0, limit - current);
    },

    /** 是否可以招募 */
    get canRecruit() {
        return this.villagers.length < this.settings.maxVillagers
            && this.villagers.length < this.housingCapacity;
    },

    /** 当前总游戏天数（从第1天开始） */
    get totalDays() {
        return (this.time.year - 1) * 36  // 36天/年
            + (this.time.month - 1) * 9   // 9天/季
            + this.time.day;
    },

    /** 重置每日变化追踪 */
    resetDailyChanges() {
        this.dailyChanges = { gold: 0, food: 0, wood: 0, stone: 0 };
    },

    /**
     * 修改资源并追踪变化（受仓库容量限制）
     * @param {string} type - 资源类型
     * @param {number} amount - 变化量（正=增加，负=减少）
     * @returns {boolean} 是否成功
     */
    modifyResource(type, amount) {
        if (this.resources[type] === undefined) return false;
        let newVal = this.resources[type] + amount;
        if (newVal < 0) return false;

        // 增加时检查仓库容量上限（金币无上限）
        if (amount > 0 && type !== 'gold') {
            const limit = this.getStorageLimit(type);
            if (newVal > limit) {
                newVal = limit; // 超出部分丢弃
            }
        }

        this.resources[type] = newVal;
        if (this.dailyChanges[type] !== undefined) {
            this.dailyChanges[type] += amount;
        }
        return true;
    },

    /**
     * 添加事件日志
     * @param {string} icon - 图标
     * @param {string} text - 文本
     * @param {string} type - 类型（info/warning/danger/success）
     */
    addLog(icon, text, type = 'info') {
        this.eventLog.unshift({
            id: Date.now() + Math.random(),
            icon,
            text,
            type,
            time: `第${this.time.year}年·${this.seasonName} 第${this.time.day}天 ${this.time.hour}:00`,
            timestamp: Date.now(),
        });
        // 最多保留100条日志
        if (this.eventLog.length > 100) {
            this.eventLog.pop();
        }
    },
};
