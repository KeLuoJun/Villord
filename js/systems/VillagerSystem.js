/**
 * VillagerSystem - 村民管理系统
 * 管理村民的招募、属性、体力、心情、技能
 */
import {
    TRAIT_POOL, EXCLUSIVE_TRAITS, SPECIALTY_POOL, QUIRK_POOL,
    TRAIT_EFFECTS, RECRUIT_COST, DISMISS_COST, DAILY_FOOD_COST,
    STAMINA_COSTS, AVATAR_POOL, generateRandomName, MAX_MOOD,
} from '../config/villagers.js';

export class VillagerSystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        // 监听事件
        this.bus.on('tick', (data) => this.onTick(data));
        this.bus.on('newDay', () => this.onNewDay());
        this.bus.on('recruitRequest', () => this.recruit());
    }

    /** 获取未使用的头像 */
    getAvailableAvatar() {
        const usedAvatars = this.state.villagers.map(v => v.avatar);
        const available = AVATAR_POOL.filter(a => !usedAvatars.includes(a));
        return available.length > 0
            ? available[Math.floor(Math.random() * available.length)]
            : AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)];
    }

    /** 添加初始村民（系统赠送，固定属性） */
    addInitialVillager() {
        const villager = {
            id: 'villager_initial',
            name: '小青',
            avatar: '👩‍🌾',
            traits: ['勤劳', '乐观'],
            specialty: '种植能手',
            quirk: '没问题！',
            stamina: 50,
            maxStamina: 50,
            mood: 16,
            accuracy: 0.9,
            workSpeed: 1.3,
            skills: { farming: 2, gathering: 1, processing: 1 },
            currentTask: null,
            currentAction: null,
            todayWorkCount: 0,
            memory: {
                previousSeasons: [],
                currentSeason: { dialogues: [], events: [] },
            },
            dialogueHistory: [],
            schedule: null,
        };

        this.state.villagers.push(villager);
        this.bus.emit('villagerAdded', { villager });
    }

    /**
     * 从预设池随机生成一个新村民
     * @returns {object} 村民对象
     */
    generateCandidate() {
        // 1. 随机性格标签（2-3个，互斥规则）
        const traitCount = Math.random() < 0.4 ? 3 : 2;
        const traits = [];
        const usedPairs = new Set();
        const allTraits = [...TRAIT_POOL.positive, ...TRAIT_POOL.negative];

        while (traits.length < traitCount) {
            const candidate = allTraits[Math.floor(Math.random() * allTraits.length)];
            const pairIndex = EXCLUSIVE_TRAITS.findIndex(pair => pair.includes(candidate));
            if (pairIndex !== -1 && usedPairs.has(pairIndex)) continue;
            if (traits.includes(candidate)) continue;
            traits.push(candidate);
            if (pairIndex !== -1) usedPairs.add(pairIndex);
        }

        // 2. 随机特长
        const specialty = SPECIALTY_POOL[Math.floor(Math.random() * SPECIALTY_POOL.length)];

        // 3. 随机口癖
        const quirk = QUIRK_POOL[Math.floor(Math.random() * QUIRK_POOL.length)];

        // 4. 根据性格推算属性
        let maxStamina = 50;
        let accuracy = 0.9;
        let workSpeed = 1.0;

        traits.forEach(t => {
            const effect = TRAIT_EFFECTS[t];
            if (effect) {
                if (effect.maxStamina) maxStamina = effect.maxStamina;
                if (effect.accuracy) accuracy = effect.accuracy;
                if (effect.workSpeed) workSpeed = effect.workSpeed;
            }
        });

        // 5. 生成姓名
        const usedNames = this.state.villagers.map(v => v.name);
        const name = generateRandomName(usedNames);

        return {
            id: 'villager_' + Date.now() + Math.random().toString(36).substr(2, 4),
            name,
            avatar: this.getAvailableAvatar(),
            traits,
            specialty,
            quirk,
            stamina: maxStamina,
            maxStamina,
            mood: 14,
            accuracy,
            workSpeed,
            skills: { farming: 1, gathering: 1, processing: 1 },
            currentTask: null,
            currentAction: null,
            todayWorkCount: 0,
            memory: {
                previousSeasons: [],
                currentSeason: { dialogues: [], events: [] },
            },
            dialogueHistory: [],
            schedule: null,
        };
    }

    /** 招募村民（盲抽） */
    recruit() {
        if (this.state.resources.gold < RECRUIT_COST) {
            this.bus.emit('showToast', { message: '金币不足，需要50💰', type: 'warning' });
            return { success: false, reason: '金币不足' };
        }
        if (this.state.villagers.length >= this.state.settings.maxVillagers) {
            this.bus.emit('showToast', { message: '村民已满4人', type: 'warning' });
            return { success: false, reason: '村民已满' };
        }
        if (this.state.villagers.length >= this.state.housingCapacity) {
            this.bus.emit('showToast', { message: '没有空余房屋，请先建造房屋', type: 'warning' });
            return { success: false, reason: '没有空余房屋' };
        }

        this.state.resources.gold -= RECRUIT_COST;
        const villager = this.generateCandidate();
        this.state.villagers.push(villager);

        this.state.addLog('🎉', `招募了新村民 ${villager.name}（${villager.traits.join('·')}）`, 'success');
        this.bus.emit('villagerAdded', { villager });
        this.bus.emit('villagerRecruited', { villager });

        return { success: true, villager };
    }

    /** 解雇村民 */
    dismiss(villagerId) {
        if (this.state.resources.gold < DISMISS_COST) {
            return { success: false, reason: '金币不足以支付遣散费' };
        }

        const index = this.state.villagers.findIndex(v => v.id === villagerId);
        if (index === -1) return { success: false, reason: '村民不存在' };

        this.state.resources.gold -= DISMISS_COST;
        const dismissed = this.state.villagers.splice(index, 1)[0];

        // 其他村民心情 -1
        this.state.villagers.forEach(v => {
            v.mood = Math.max(0, v.mood - 1);
        });

        this.state.addLog('👋', `${dismissed.name}离开了村庄`, 'warning');
        this.bus.emit('villagerRemoved', { villager: dismissed });
        return { success: true, dismissed };
    }

    /** 获取村民 */
    getVillager(villagerId) {
        return this.state.villagers.find(v => v.id === villagerId);
    }

    /**
     * 消耗村民体力
     * @param {string} villagerId
     * @param {string} actionType
     * @returns {boolean} 是否成功消耗
     */
    consumeStamina(villagerId, actionType) {
        const villager = this.getVillager(villagerId);
        if (!villager) return false;

        const baseCost = STAMINA_COSTS[actionType] || 0;
        if (baseCost === 0) return true;

        // 天气体力修正
        const weatherEffects = this.getWeatherEffects();
        const staminaMod = weatherEffects.staminaMod || 1.0;

        // 性格修正
        const traitMod = villager.traits.includes('健壮') ? 0.9 :
                         villager.traits.includes('体弱') ? 1.15 : 1.0;

        const actualCost = Math.ceil(baseCost * staminaMod * traitMod);

        if (villager.stamina < actualCost) return false;

        villager.stamina -= actualCost;
        return true;
    }

    /** 每 Tick 处理 */
    onTick(data) {
        this.state.villagers.forEach(villager => {
            // 闲逛消耗少量体力
            if (!villager.currentTask && villager.stamina > 0) {
                // 不消耗，仅在有任务时消耗
            }

            // 体力过低自动进入休息
            if (villager.stamina <= 0) {
                villager.currentAction = '💤 强制休息';
                villager.stamina = 0;
            }
        });
    }

    /** 每日处理 */
    onNewDay() {
        this.state.villagers.forEach(villager => {
            // 重置工作计数
            villager.todayWorkCount = 0;

            // 睡眠恢复体力（夜间自动恢复）
            villager.stamina = Math.min(villager.maxStamina, villager.stamina + 10);

            // 心情自然衰减（每天-1）
            villager.mood = Math.max(0, villager.mood - 1);

            // 乐观性格心情恢复快（+1）
            if (villager.traits.includes('乐观')) {
                villager.mood = Math.min(MAX_MOOD, villager.mood + 1);
            }

            // 悲观性格额外衰减（-1）
            if (villager.traits.includes('悲观')) {
                villager.mood = Math.max(0, villager.mood - 1);
            }
        });
    }

    /** 获取天气效果 */
    getWeatherEffects() {
        const w = this.state.weather;
        if (w.activeEvent) {
            return window.SPECIAL_WEATHER_EVENTS?.[w.activeEvent] || { staminaMod: 1.0 };
        }
        return window.SEASON_DEFAULT?.[this.state.season] || { staminaMod: 1.0 };
    }
}
