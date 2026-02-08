/**
 * 市场商品配置表
 * 定义所有可交易商品的基准价、波动率和回归速度
 */
export const MARKET_ITEMS = {
    radish:  { id: 'radish',  name: '萝卜',     icon: '🥕', basePrice: 5,   volatility: 0.03,  reversionSpeed: 0.04,  category: 'crop' },
    wheat:   { id: 'wheat',   name: '小麦',     icon: '🌾', basePrice: 10,  volatility: 0.02,  reversionSpeed: 0.03,  category: 'crop' },
    potato:  { id: 'potato',  name: '土豆',     icon: '🥔', basePrice: 7.5, volatility: 0.025, reversionSpeed: 0.035, category: 'crop' },
    pumpkin: { id: 'pumpkin', name: '南瓜',     icon: '🎃', basePrice: 25,  volatility: 0.04,  reversionSpeed: 0.02,  category: 'crop' },
    cotton:  { id: 'cotton',  name: '棉花',     icon: '🧵', basePrice: 17.5, volatility: 0.035, reversionSpeed: 0.025, category: 'crop' },
    grape:   { id: 'grape',   name: '葡萄',     icon: '🍇', basePrice: 40,  volatility: 0.04,  reversionSpeed: 0.02,  category: 'crop' },
    flour:   { id: 'flour',   name: '面粉',     icon: '🫘', basePrice: 15,  volatility: 0.02,  reversionSpeed: 0.03,  category: 'processed' },
    bread:   { id: 'bread',   name: '面包',     icon: '🍞', basePrice: 22.5, volatility: 0.03,  reversionSpeed: 0.025, category: 'processed' },
    wood:    { id: 'wood',    name: '木材',     icon: '🪵', basePrice: 6,   volatility: 0.02,  reversionSpeed: 0.04,  category: 'material' },
    stone:   { id: 'stone',   name: '石料',     icon: '🪨', basePrice: 7.5, volatility: 0.015, reversionSpeed: 0.04,  category: 'material' },
    // 鱼类
    crucianCarp: { id: 'crucianCarp', name: '鲫鱼',   icon: '🐟', basePrice: 8,    volatility: 0.03,  reversionSpeed: 0.04,  category: 'fish' },
    grassCarp:   { id: 'grassCarp',   name: '草鱼',   icon: '🐟', basePrice: 12,   volatility: 0.03,  reversionSpeed: 0.04,  category: 'fish' },
    commonCarp:  { id: 'commonCarp',  name: '鲤鱼',   icon: '🐠', basePrice: 15,   volatility: 0.035, reversionSpeed: 0.03,  category: 'fish' },
    silverCarp:  { id: 'silverCarp',  name: '鲢鱼',   icon: '🐠', basePrice: 18,   volatility: 0.035, reversionSpeed: 0.03,  category: 'fish' },
    mandarin:    { id: 'mandarin',    name: '鳜鱼',   icon: '🐡', basePrice: 30,   volatility: 0.04,  reversionSpeed: 0.025, category: 'fish' },
    snakehead:   { id: 'snakehead',   name: '黑鱼',   icon: '🐡', basePrice: 35,   volatility: 0.04,  reversionSpeed: 0.025, category: 'fish' },
    koi:         { id: 'koi',         name: '锦鲤',   icon: '🎏', basePrice: 100,  volatility: 0.05,  reversionSpeed: 0.02,  category: 'fish' },
    goldenDragon:{ id: 'goldenDragon',name: '金龙鱼', icon: '🐉', basePrice: 200,  volatility: 0.05,  reversionSpeed: 0.015, category: 'fish' },
    seed_r:  { id: 'seed_r',  name: '萝卜种子', icon: '🌱', basePrice: 2.5, volatility: 0.01,  reversionSpeed: 0.05,  category: 'seed' },
    seed_w:  { id: 'seed_w',  name: '小麦种子', icon: '🌱', basePrice: 5,   volatility: 0.01,  reversionSpeed: 0.05,  category: 'seed' },
    seed_p:  { id: 'seed_p',  name: '土豆种子', icon: '🌱', basePrice: 4,   volatility: 0.01,  reversionSpeed: 0.05,  category: 'seed' },
    seed_pk: { id: 'seed_pk', name: '南瓜种子', icon: '🌱', basePrice: 12.5, volatility: 0.015, reversionSpeed: 0.04,  category: 'seed' },
    seed_c:  { id: 'seed_c',  name: '棉花种子', icon: '🌱', basePrice: 10,  volatility: 0.015, reversionSpeed: 0.04,  category: 'seed' },
    seed_g:  { id: 'seed_g',  name: '葡萄种子', icon: '🌱', basePrice: 20,  volatility: 0.02,  reversionSpeed: 0.035, category: 'seed' },
};

/** 季节对市场的影响系数 */
export const SEASON_MARKET_MODS = {
    spring: {
        seed_r: 1.1, seed_w: 1.15, seed_p: 1.1,  // 种子需求高
        radish: 1.0, wheat: 1.05,
        commonCarp: 1.15, koi: 1.2,               // 春季鲤鱼/锦鲤旺季
    },
    summer: {
        cotton: 0.95,
        wheat: 1.0,
        goldenDragon: 1.3, silverCarp: 1.1,       // 夏季大鱼活跃
    },
    autumn: {
        radish: 0.85, wheat: 0.85, potato: 0.85,  // 收获季供给大，原材料跌
        flour: 1.1, bread: 1.15,                   // 加工品需求高
        mandarin: 1.25, snakehead: 1.1, koi: 1.15, // 秋季鳜鱼旺季
    },
    winter: {
        radish: 1.15, wheat: 1.2, potato: 1.1,     // 粮食需求高
        wood: 1.1,                                  // 取暖用木材
        crucianCarp: 1.2, grassCarp: 1.15,         // 冬季鱼稀缺，价格上涨
    },
};
