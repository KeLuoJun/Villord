/**
 * 天气配置表
 * 季节默认天气 + 12种特殊天气事件
 */

/** 季节默认天气（常态） */
export const SEASON_DEFAULT = {
    spring: {
        id: 'spring_default', name: '和风', icon: '🌸',
        cropGrowth: 1.1, staminaMod: 1.0, marketMod: 1.0,
        canGoOut: true, desc: '春风拂面，万物生长',
    },
    summer: {
        id: 'summer_default', name: '烈日', icon: '☀️',
        cropGrowth: 1.0, staminaMod: 1.1, marketMod: 1.0,
        canGoOut: true, desc: '烈日当空，注意防暑',
    },
    autumn: {
        id: 'autumn_default', name: '爽朗', icon: '🍂',
        cropGrowth: 1.0, staminaMod: 0.9, marketMod: 1.0,
        canGoOut: true, desc: '秋高气爽，丰收时节',
    },
    winter: {
        id: 'winter_default', name: '寒冷', icon: '🥶',
        cropGrowth: 0.5, staminaMod: 1.2, marketMod: 1.05,
        canGoOut: true, extraWoodCost: 1, desc: '天寒地冻，注意保暖',
    },
};

/** 12 种特殊天气事件（效果完全固定，AI只决定何时触发） */
export const SPECIAL_WEATHER_EVENTS = {
    // === 春季 ===
    springRain: {
        id: 'springRain', name: '春雨连绵', icon: '🌧️', season: 'spring',
        duration: 2, cropGrowth: 1.3, staminaMod: 1.1, marketMod: 1.0,
        canGoOut: true, autoWater: true,
        effectSummary: '自动浇水，作物+30%，体力消耗+10%',
    },
    pestOutbreak: {
        id: 'pestOutbreak', name: '虫害爆发', icon: '🐛', season: 'spring',
        duration: 2, cropGrowth: 0.5, staminaMod: 1.0, marketMod: 1.0,
        canGoOut: true, seedPriceMod: 1.15, needPestControl: true,
        effectSummary: '未除虫农田产量-50%，种子涨价15%',
    },
    lateFrost: {
        id: 'lateFrost', name: '倒春寒', icon: '🧊', season: 'spring',
        duration: 1, cropGrowth: 0.0, staminaMod: 1.3, marketMod: 1.1,
        canGoOut: true, seedlingFreezeChance: 0.2,
        effectSummary: '作物停止生长，幼苗20%冻死概率，体力+30%',
    },

    // === 夏季 ===
    thunderstorm: {
        id: 'thunderstorm', name: '暴风雨', icon: '⛈️', season: 'summer',
        duration: 1, cropGrowth: 1.0, staminaMod: 1.0, marketMod: 1.0,
        canGoOut: false, cropDamageChance: 0.3,
        effectSummary: '禁止外出，30%作物受损',
    },
    drought: {
        id: 'drought', name: '持续干旱', icon: '🔥', season: 'summer',
        duration: 3, cropGrowth: 0.0, staminaMod: 1.3, marketMod: 1.2,
        canGoOut: true, unwateredCropWilt: true,
        effectSummary: '未浇水作物枯萎，粮价+20%，体力+30%',
    },
    heatwave: {
        id: 'heatwave', name: '酷暑高温', icon: '🌡️', season: 'summer',
        duration: 2, cropGrowth: 0.8, staminaMod: 1.5, marketMod: 1.0,
        canGoOut: true, moodPenalty: -10,
        effectSummary: '体力消耗+50%，心情-10，作物-20%',
    },

    // === 秋季 ===
    typhoon: {
        id: 'typhoon', name: '秋台风', icon: '🌀', season: 'autumn',
        duration: 1, cropGrowth: 1.0, staminaMod: 1.0, marketMod: 1.0,
        canGoOut: false, cropDamageChance: 0.4, buildingDamage: true,
        woodPriceMod: 1.15,
        effectSummary: '禁止外出，40%作物+建筑受损',
    },
    denseFog: {
        id: 'denseFog', name: '浓雾弥漫', icon: '🌫️', season: 'autumn',
        duration: 2, cropGrowth: 1.0, staminaMod: 1.0, marketMod: 1.0,
        canGoOut: true, stupidEfficiencyPenalty: 0.3, transportDelay: true,
        effectSummary: '愚笨村民效率-30%，运输延迟',
    },
    harvestRain: {
        id: 'harvestRain', name: '丰收祥雨', icon: '🌈', season: 'autumn',
        duration: 2, cropGrowth: 1.5, staminaMod: 0.8, marketMod: 0.9,
        canGoOut: true,
        effectSummary: '作物+50%，体力消耗-20%，粮价-10%',
    },

    // === 冬季 ===
    blizzard: {
        id: 'blizzard', name: '暴雪封路', icon: '❄️', season: 'winter',
        duration: 3, cropGrowth: 0.0, staminaMod: 1.0, marketMod: 1.0,
        canGoOut: false, foodPriceMod: 1.15, woodPriceMod: 1.2,
        extraWoodCost: 2,
        effectSummary: '禁止外出，额外消耗2木材/天，粮价+15%',
    },
    coldSnap: {
        id: 'coldSnap', name: '寒潮来袭', icon: '💨', season: 'winter',
        duration: 2, cropGrowth: 0.0, staminaMod: 1.8, marketMod: 1.1,
        canGoOut: true, sickChanceWeak: 0.3,
        effectSummary: '体力消耗+80%，体弱村民30%生病概率',
    },
    winterSun: {
        id: 'winterSun', name: '冬日暖阳', icon: '🌤️', season: 'winter',
        duration: 2, cropGrowth: 0.8, staminaMod: 0.9, marketMod: 1.0,
        canGoOut: true, moodBonus: 10,
        effectSummary: '作物恢复生长，体力-10%，心情+10',
    },
};

/**
 * 获取某个季节可用的特殊天气
 * @param {string} season
 * @returns {object[]}
 */
export function getSeasonEvents(season) {
    return Object.values(SPECIAL_WEATHER_EVENTS).filter(e => e.season === season);
}
