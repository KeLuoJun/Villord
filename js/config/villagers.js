/**
 * 村民属性配置
 * 定义性格池、特长池、口癖池及互斥规则
 */

/** 性格特征池 */
export const TRAIT_POOL = {
    positive: ['勤劳', '聪明', '听话', '健壮', '乐观'],
    negative: ['懒惰', '愚笨', '叛逆', '体弱', '悲观'],
};

/** 互斥性格对（同一对中只能抽一个） */
export const EXCLUSIVE_TRAITS = [
    ['勤劳', '懒惰'],
    ['聪明', '愚笨'],
    ['听话', '叛逆'],
    ['健壮', '体弱'],
    ['乐观', '悲观'],
];

/** 特长池 */
export const SPECIALTY_POOL = ['种植能手', '采集好手', '加工巧匠'];

/** 口癖池 */
export const QUIRK_POOL = [
    '嘿嘿', '唉...', '没问题！', '这个嘛...',
    '交给我吧', '好累啊~', '报告村长！', '随便啦', '我尽力...',
];

/** 姓名库 */
const FIRST_NAMES = ['小', '阿', '大', '老', ''];
const LAST_NAMES = ['青', '牛', '花', '石', '竹', '云', '铁', '水', '金', '木',
    '春', '夏', '秋', '冬', '明', '亮', '星', '月', '风', '雨'];
const FULL_NAMES = [
    '小青', '阿牛', '大壮', '小花', '阿石', '竹子', '云儿', '铁柱', '水灵', '金宝',
    '春娃', '夏荷', '秋实', '冬梅', '明月', '小亮', '星儿', '风信', '雨萍', '土根',
    '翠翠', '虎子', '燕子', '豆豆', '福贵', '银杏', '稻香', '麦穗', '桃花', '柳絮',
];

/** 固定费用 */
export const RECRUIT_COST = 50;
export const DISMISS_COST = 20;

/** 每日食物消耗（每个村民） */
export const DAILY_FOOD_COST = 1;

/** 体力消耗表 */
export const STAMINA_COSTS = {
    plant: 15,
    water: 10,
    fertilize: 10,
    harvest: 15,
    pest_control: 20,
    chop: 20,
    mine: 25,
    process: 15,
    trade: 5,
    rest: 0,
    eat: 0,
    idle: 2,         // 每小时
    chat: 3,
};

/** 行动耗时表（小时） */
export const ACTION_DURATIONS = {
    plant: 2,
    water: 1,
    fertilize: 1,
    harvest: 2,
    pest_control: 2,
    chop: 2,
    mine: 2,
    process: 3,
    trade: 1,
    rest: 2,
    eat: 1,
    idle: 1,
    chat: 1,
};

/** 所有合法行动ID */
export const VALID_ACTIONS = [
    'plant', 'water', 'fertilize', 'harvest', 'pest_control',
    'chop', 'mine', 'process', 'trade', 'rest', 'eat', 'idle', 'chat',
];

/** 行动图标 */
export const ACTION_ICONS = {
    plant: '🌱', water: '💧', fertilize: '🧪', harvest: '🌾',
    pest_control: '🐛', chop: '🪓', mine: '⛏️', process: '🏭',
    trade: '🛒', rest: '💤', eat: '🍽️', idle: '🚶', chat: '💬',
};

/** 行动名称 */
export const ACTION_NAMES = {
    plant: '种植', water: '浇水', fertilize: '施肥', harvest: '收获',
    pest_control: '除虫', chop: '伐木', mine: '采石', process: '加工',
    trade: '市场交易', rest: '休息', eat: '吃东西', idle: '闲逛', chat: '聊天',
};

/** 性格对属性的影响 */
export const TRAIT_EFFECTS = {
    '健壮': { maxStamina: 120, staminaMod: 0.9 },
    '体弱': { maxStamina: 80, staminaMod: 1.15 },
    '聪明': { accuracy: 1.0 },
    '愚笨': { accuracy: 0.7 },
    '勤劳': { workSpeed: 1.3 },
    '懒惰': { workSpeed: 0.6 },
};

/**
 * 生成随机姓名
 * @param {string[]} usedNames - 已使用的名字列表
 * @returns {string}
 */
export function generateRandomName(usedNames = []) {
    const available = FULL_NAMES.filter(n => !usedNames.includes(n));
    if (available.length === 0) {
        // 如果全用过了，加后缀
        const base = FULL_NAMES[Math.floor(Math.random() * FULL_NAMES.length)];
        return base + '·' + Math.floor(Math.random() * 100);
    }
    return available[Math.floor(Math.random() * available.length)];
}
