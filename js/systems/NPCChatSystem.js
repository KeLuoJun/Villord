/**
 * NPCChatSystem - NPC 自由对话系统
 * 
 * 规则：
 * - 每日 0:00 预排当天发言顺序和时间点
 * - 白天活动时间（7:00-21:00）NPC 之间自由对话
 * - 每人每天最多发言 2 次
 * - 发言间隔不小于 2 Tick（2小时）
 * - 串行调用 LLM（非并行），保证对话上下文连贯
 * - 聊天内容：闲聊、吐槽、互相鼓励、讨论天气/市场/工作等
 */
import { MAX_MOOD } from '../config/villagers.js';

export class NPCChatSystem {
    constructor(aiService, gameState, eventBus) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;

        /** 今日发言计划: [{ villagerId, hour, spoken: false }] */
        this.todayChatPlan = [];
        /** 今日聊天记录（展示在 UI 右侧） */
        this.chatMessages = [];
        /** 每人每天已发言次数 */
        this.todaySpeakCount = {};
        /** 上次发言的 Tick */
        this.lastSpeakHour = -10;
        /** 正在调用 LLM */
        this.isSpeaking = false;

        // 监听事件
        this.bus.on('tick', (data) => this.onTick(data));
        this.bus.on('newDay', () => this.onNewDay());
    }

    /** 新的一天：重置并预排发言 */
    onNewDay() {
        this.todaySpeakCount = {};
        this.lastSpeakHour = -10;
        // 保留最近 20 条历史
        if (this.chatMessages.length > 20) {
            this.chatMessages = this.chatMessages.slice(-20);
        }
        // 0 点预排当天发言
        this.generateChatPlan();
    }

    /** 预排当天发言计划 */
    generateChatPlan() {
        this.todayChatPlan = [];
        const villagers = this.state.villagers;
        if (villagers.length < 1) return;

        // 每人最多 2 次发言
        const MAX_SPEAKS_PER_DAY = 2;
        const MIN_INTERVAL = 2; // 至少间隔 2 小时
        const SPEAK_WINDOW_START = 8; // 8:00 开始（起床后 1 小时）
        const SPEAK_WINDOW_END = 21;  // 21:00 之前

        // 为每个村民生成 0-2 次发言时间
        const allSlots = [];
        villagers.forEach(v => {
            const speakCount = Math.floor(Math.random() * (MAX_SPEAKS_PER_DAY + 1)); // 0, 1, 或 2
            for (let i = 0; i < speakCount; i++) {
                const hour = SPEAK_WINDOW_START + Math.floor(Math.random() * (SPEAK_WINDOW_END - SPEAK_WINDOW_START));
                allSlots.push({ villagerId: v.id, hour, spoken: false });
            }
        });

        // 按时间排序
        allSlots.sort((a, b) => a.hour - b.hour);

        // 过滤：确保相邻发言间隔 >= MIN_INTERVAL
        const filtered = [];
        let lastHour = -10;
        for (const slot of allSlots) {
            if (slot.hour - lastHour >= MIN_INTERVAL) {
                filtered.push(slot);
                lastHour = slot.hour;
            }
        }

        this.todayChatPlan = filtered;
        console.log(`[NPCChat] 今日预排 ${filtered.length} 次发言:`,
            filtered.map(s => {
                const v = villagers.find(vv => vv.id === s.villagerId);
                return `${v?.name || '?'}@${s.hour}:00`;
            }).join(', ')
        );
    }

    /** 每 Tick 检查是否有发言 */
    async onTick(data) {
        if (this.isSpeaking) return;

        const currentHour = data.hour;

        // 查找当前小时需要发言的计划
        const slot = this.todayChatPlan.find(s =>
            !s.spoken && s.hour === currentHour
        );

        if (!slot) return;

        // 间隔检查
        if (currentHour - this.lastSpeakHour < 2) return;

        const villager = this.state.villagers.find(v => v.id === slot.villagerId);
        if (!villager) {
            slot.spoken = true;
            return;
        }

        // 串行执行
        this.isSpeaking = true;
        slot.spoken = true;
        this.lastSpeakHour = currentHour;

        try {
            await this.generateChat(villager, currentHour);
        } catch (e) {
            console.warn(`[NPCChat] ${villager.name} 发言失败:`, e.message);
            this.addFallbackChat(villager);
        }

        this.isSpeaking = false;
        this.todaySpeakCount[villager.id] = (this.todaySpeakCount[villager.id] || 0) + 1;
    }

    /** 生成 NPC 聊天 */
    async generateChat(villager, currentHour) {
        // 构建上下文
        const recentChats = this.chatMessages.slice(-5).map(m =>
            `${m.avatar} ${m.name}: "${m.text}"`
        ).join('\n') || '（今天还没人说话）';

        const otherVillagers = this.state.villagers
            .filter(v => v.id !== villager.id)
            .map(v => `${v.avatar||'👤'}${v.name}（性格：${v.traits.join('·')}，在做：${v.currentAction || '闲着'}）`)
            .join('\n');

        // 根据时间段生成话题建议
        const timeTopic = currentHour < 10 ? '刚起床、吃早饭、今天的计划' :
                         currentHour < 13 ? '上午的工作、天气、市场' :
                         currentHour < 17 ? '下午的活、累不累、今天的收获' :
                         '快下班了、今天总结、晚上打算';

        const moodDesc = villager.mood >= Math.round(MAX_MOOD * 0.7) ? '心情不错' :
                        villager.mood >= Math.round(MAX_MOOD * 0.4) ? '心情一般' : '心情不好';

        const prompt = `你是${villager.name}${villager.avatar}，《治村物语》的村民。现在${currentHour}:00。

【你的性格】${villager.traits.join('、')}
【口癖】说话爱带"${villager.quirk}"
【当前状态】${moodDesc}，体力${villager.stamina}/${villager.maxStamina}，正在${villager.currentAction || '闲逛'}

【村里的人】
${otherVillagers || '只有你一个人'}

【之前的聊天】
${recentChats}

【环境】${this.state.seasonName}，${this.getCurrentWeatherInfo()}
市场：${this.state.market.morningReport?.broadcast || '暂无消息'}

现在你想说一句话。话题参考：${timeTopic}
规则：20-50字，自然口语化，体现性格特点。如果前面有人说了话，优先接话或回应。不要重复别人说过的。

输出JSON：{"text": "你说的话", "mood": "happy/neutral/tired/grumpy/excited"}`;

        const result = await this.ai.chat(prompt, { temperature: 0.95, maxTokens: 150 });

        if (result && result.text) {
            this.addChatMessage(villager, result.text, result.mood || 'neutral');
        } else {
            this.addFallbackChat(villager);
        }
    }

    /** 添加聊天消息 */
    addChatMessage(villager, text, mood = 'neutral') {
        const moodEmoji = {
            happy: '😊', neutral: '😐', tired: '😴', grumpy: '😤', excited: '🤩',
            sad: '😢',
        };

        const msg = {
            id: Date.now() + Math.random(),
            villagerId: villager.id,
            name: villager.name,
            avatar: villager.avatar || '👤',
            text,
            mood: moodEmoji[mood] || '💬',
            hour: this.state.time.hour,
            day: this.state.time.day,
            year: this.state.time.year,
            month: this.state.time.month,
            seasonName: this.state.seasonName,
            timestamp: Date.now(),
        };

        this.chatMessages.push(msg);
        this.state.addLog(villager.avatar || '💬', `${villager.name}：${text}`, 'info');

        // 通知 UI 更新
        this.bus.emit('npcChatMessage', msg);
    }

    /** 降级闲聊 */
    addFallbackChat(villager) {
        const fallbacks = {
            '勤劳': ['今天活真多，不过干完了就舒服了！', '大家加油干啊~', '这天气干活正好！'],
            '懒惰': ['啊...好想偷懒...', '什么时候能休息啊...', '今天好累，不想动...'],
            '聪明': ['我觉得今天的市场行情还不错。', '根据天气来看，应该调整下种植计划。', '嗯...让我想想...'],
            '愚笨': ['欸？今天要干啥来着？', '我...我在干活呢！', '好复杂啊，搞不懂...'],
            '乐观': ['哈哈，今天又是美好的一天！', '加油！一切都会好起来的~', '开心开心~✨'],
            '悲观': ['唉...今天又要辛苦了...', '希望别出什么问题...', '好累...什么时候是个头啊...'],
            '叛逆': ['切，谁规定必须这样做的？', '我想按自己的方式来！', '又要听村长指挥...'],
            'default': ['今天天气不错呢。', '大家辛苦了~', '嗯...继续干活吧。'],
        };

        let pool = fallbacks['default'];
        for (const trait of villager.traits) {
            if (fallbacks[trait]) { pool = fallbacks[trait]; break; }
        }

        const text = pool[Math.floor(Math.random() * pool.length)];
        this.addChatMessage(villager, text, 'neutral');
    }

    /** 获取天气信息 */
    getCurrentWeatherInfo() {
        const w = this.state.weather;
        if (w.activeEvent) {
            const evt = window.SPECIAL_WEATHER_EVENTS?.[w.activeEvent];
            return evt ? `${evt.icon} ${evt.name}` : '特殊天气';
        }
        const def = window.SEASON_DEFAULT?.[this.state.season];
        return def ? `${def.icon} ${def.name}` : '正常';
    }

    /** 获取今日聊天记录（供 UI 渲染） */
    getRecentMessages(limit = 30) {
        return this.chatMessages.slice(-limit);
    }
}
