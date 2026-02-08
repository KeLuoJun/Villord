/**
 * VillagerAI - 村民 AI 对话与调度
 * 处理玩家与村民的对话（模式B）+ 系统自动调度（模式A）
 */
import { ACTION_NAMES, ACTION_ICONS, VALID_ACTIONS, MAX_MOOD } from '../config/villagers.js';
import {
    WORK_HOURS_POLICIES,
    DISTRIBUTION_POLICIES,
    REWARD_POLICIES,
    HOLIDAY_POLICIES,
    isRestDay,
} from '../config/policies.js';

export class VillagerAI {
    constructor(aiService, gameState, eventBus) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;
        this.scheduler = null; // B4: 后注入，避免循环依赖

        // 预设对话库（AI 降级时使用）
        this.presetDialogues = {
            '勤劳': [
                { reply: '好的村长！我这就去做~ 💪', emotion: 'happy' },
                { reply: '没问题，交给我吧！', emotion: 'happy' },
                { reply: '我正闲着呢，来活了！', emotion: 'happy' },
            ],
            '懒惰': [
                { reply: '啊...现在就要去吗？我有点累...', emotion: 'tired' },
                { reply: '好吧好吧...等会儿再去行不行？', emotion: 'reluctant' },
                { reply: '唉...又是干活...', emotion: 'tired' },
            ],
            '聪明': [
                { reply: '明白了！不过我有个建议...', emotion: 'neutral' },
                { reply: '好的，我觉得这样安排更合理~', emotion: 'happy' },
            ],
            '愚笨': [
                { reply: '啊？你说什么来着？', emotion: 'neutral' },
                { reply: '好...好的？我去试试！', emotion: 'neutral' },
            ],
            '叛逆': [
                { reply: '为什么又是我？让别人去嘛~', emotion: 'reluctant' },
                { reply: '我不太想做这个...有别的活吗？', emotion: 'reluctant' },
            ],
            '乐观': [
                { reply: '哈哈好啊！今天又是美好的一天~', emotion: 'happy' },
                { reply: '没问题！开心干活~ ✨', emotion: 'happy' },
            ],
            '悲观': [
                { reply: '唉...好吧...希望别出什么岔子...', emotion: 'sad' },
                { reply: '又要干活了吗...好累啊...', emotion: 'tired' },
            ],
            'default': [
                { reply: '好的，我知道了。', emotion: 'neutral' },
                { reply: '收到，村长！', emotion: 'neutral' },
            ],
        };
    }

    /** B4: 注入调度器引用（在 main.js 中调用） */
    setScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    /** 注入村会系统引用 */
    setMeetingSystem(meetingSystem) {
        this.meetingSystem = meetingSystem;
    }

    /**
     * 将系统 currentAction 字符串清洗为自然口语
     * 例如 "⚠️ 无需浇水的农田" → "闲着没事做"
     *      "💤 睡觉" → "睡觉"
     *      "🌾 种植" → "种地"
     */
    cleanAction(rawAction) {
        if (!rawAction) return '闲着';
        // 先去掉所有 emoji（Unicode emoji ranges）
        let text = rawAction.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}⚠️✅❌🚶💤💧🌾🪵🪨💬😤😮‍💨🤔💊🎉💪⚡💫🏠]/gu, '').trim();
        // 系统状态映射为自然语言
        const statusMap = {
            '无需浇水': '闲着没什么事',
            '无需浇水的农田': '闲着没什么事',
            '睡觉': '睡觉',
            '空闲': '闲着',
            '休息恢复体力中': '休息恢复体力',
            '体力不足，休息中...': '在休息',
            '强制休息': '在休息',
            '在磨洋工...': '在偷懒',
            '拒绝干活': '闹脾气不想干活',
            '累瘫了': '累得不行在休息',
            '主动浇水': '在浇水',
            '在村里闲逛': '在村里逛逛',
            '在抱怨': '在发牢骚',
            '在思考': '在想事情',
            '自行休息': '在休息',
            '放假中': '在休息',
            '养病中': '在养病',
        };
        // 查找映射
        for (const [key, val] of Object.entries(statusMap)) {
            if (text.includes(key)) return val;
        }
        // 如果是正常行动名，直接返回清洗后文本
        return text || '闲着';
    }

    /**
     * 判断玩家输入的情感倾向
     * @returns {number} 正面 +1~+3, 负面 -1~-3, 中性 0
     */
    detectPlayerSentiment(playerInput) {
        const input = playerInput.toLowerCase();
        // 正面情感关键词
        if (/加油|辛苦了|厉害|棒|真好|谢谢|感谢|不错|干得好|好样的|太强了|你真棒|鼓励|喜欢你|相信你|做得好|继续努力|最棒|优秀|了不起|开心|快乐|高兴/.test(input)) {
            return Math.floor(Math.random() * 3) + 1; // +1 ~ +3
        }
        // 负面情感关键词
        if (/笨蛋|废物|没用|讨厌|滚|烦死|差劲|太慢|不行|垃圾|蠢/.test(input)) {
            return -(Math.floor(Math.random() * 3) + 1); // -1 ~ -3
        }
        return 0;
    }

    /**
     * 处理玩家对话（模式B）
     * @param {object} villager - 村民对象
     * @param {string} playerInput - 玩家输入
     * @returns {object} { reply, emotion, scheduleChange, options, moodChange }
     */
    async handlePlayerChat(villager, playerInput) {
        // B4: 如果在调度时间窗口（0:00-4:00）内对话，取消下次系统调度
        const isNearSchedule = this.scheduler?.isNearScheduleTime() || false;
        if (isNearSchedule && this.scheduler) {
            this.scheduler.cancelNextSchedule(villager.id);
            console.log(`[VillagerAI] 调度冲突检测：当前0-4点，取消 ${villager.name} 的系统调度`);
        }

        // AI LOGIC - 构建 Prompt
        const context = this.buildChatContext(villager, playerInput);
        context.isNearScheduleTime = isNearSchedule;
        const prompt = this.generateVillagerPrompt(context);

        console.log(`[VillagerAI] 对话请求: ${villager.name} <- "${playerInput}"`);

        const result = await this.ai.chat(prompt, { temperature: 0.8, maxTokens: 500 });

        if (result) {
            console.log(`[VillagerAI] AI 回复:`, result.reply);

            // 应用心情变化
            if (result.moodChange) {
                villager.mood = Math.max(0, Math.min(MAX_MOOD, villager.mood + result.moodChange));
            }

            // B4: 如果AI返回了明日计划，设置到村民的schedule上
            if (isNearSchedule && result.tomorrowSchedule && Array.isArray(result.tomorrowSchedule)) {
                villager.schedule = result.tomorrowSchedule;
                console.log(`[VillagerAI] 通过对话为 ${villager.name} 设定了明日计划`);
            }

            // 保存对话历史
            this.saveDialogue(villager, playerInput, result.reply);

            return result;
        }

        // AI 降级：使用预设对话
        console.log(`[VillagerAI] AI 降级，使用预设对话`);
        const fallback = this.getFallbackResponse(villager, playerInput);

        // 降级响应也要应用心情变化
        if (fallback.moodChange) {
            villager.mood = Math.max(0, Math.min(MAX_MOOD, villager.mood + fallback.moodChange));
        }

        // 降级响应也要保存对话历史
        this.saveDialogue(villager, playerInput, fallback.reply);
        return fallback;
    }

    /** 构建对话上下文（D1: 包含所有策划要求的字段） */
    buildChatContext(villager, playerInput) {
        // 当前日程展示
        let currentScheduleDisplay = '';
        if (villager.schedule && villager.schedule.length > 0) {
            currentScheduleDisplay = villager.schedule
                .map(s => `${s.startHour}:00 ${ACTION_NAMES[s.action] || s.action}`)
                .join(' → ');
        }

        // 往季记忆摘要
        const previousMemory = villager.memory?.previousSeasons?.length > 0
            ? villager.memory.previousSeasons.map(s => s.summary || '').filter(Boolean).join('；')
            : '';

        // 近期天气预警
        const upcomingWeather = this.getUpcomingWeatherAlert();

        // 政策上下文
        const policyContext = this.buildPolicyContext(villager);

        // 村会指示上下文
        const meetingContext = this.meetingSystem
            ? this.meetingSystem.buildMeetingContext(villager)
            : '';

        return {
            name: villager.name,
            avatar: villager.avatar || '👤',
            traits: villager.traits,
            specialty: villager.specialty,
            quirk: villager.quirk,
            stamina: villager.stamina,
            maxStamina: villager.maxStamina,
            mood: villager.mood,
            accuracy: villager.accuracy ?? 1,
            workSpeed: villager.workSpeed ?? 1,
            currentTask: villager.currentTask,
            currentAction: this.cleanAction(villager.currentAction),
            currentScheduleDisplay,
            previousMemory,
            upcomingWeather,
            todayWorkCount: villager.todayWorkCount,
            season: this.state.seasonName,
            weather: this.getCurrentWeatherInfo(),
            market: this.state.market.dailyReport?.broadcast || '暂无市场简报',
            foodStock: this.state.inventory.wheat || 0,
            gold: this.state.resources.gold,
            pendingTasks: this.getPendingTasks(),
            matureCrops: this.getMatureCrops(),
            recentDialogue: this.getRecentDialogue(villager),
            playerInput,
            policyContext,
            meetingContext,
            isNearScheduleTime: false, // 由 handlePlayerChat 覆盖
        };
    }

    /** 生成村民对话 Prompt */
    generateVillagerPrompt(ctx) {
        const traitGuides = {
            '勤劳': '热爱劳动，做事积极主动，提到工作时兴奋',
            '懒惰': '能偷懒就偷懒，接到任务先叹气再说，经常找借口拖延',
            '聪明': '思维敏捷，分析问题到位，经常提出独到见解和建议',
            '愚笨': '有点迷糊，理解力差，有时候会答非所问或者理解歪了',
            '听话': '非常尊敬村长，有求必应，态度恭敬',
            '叛逆': '有主见，觉得不对的会据理力争，偶尔顶嘴',
            '乐观': '永远积极向上，苦中作乐，爱开玩笑',
            '悲观': '容易焦虑担忧，说话带负面情绪，但内心善良',
            '健壮': '精力旺盛，干啥都不累，喜欢体力活',
            '体弱': '动不动就喊累，需要经常休息，羡慕体力好的人',
        };

        // 根据心情生成状态描述
        const moodHigh = Math.round(MAX_MOOD * 0.8);
        const moodMid = Math.round(MAX_MOOD * 0.6);
        const moodLow = Math.round(MAX_MOOD * 0.4);
        const moodVeryLow = Math.max(1, Math.round(MAX_MOOD * 0.2));
        const moodDesc = ctx.mood >= moodHigh ? '心情很好' :
                         ctx.mood >= moodMid ? '心情不错' :
                         ctx.mood >= moodLow ? '心情一般' :
                         ctx.mood >= moodVeryLow ? '心情不太好' : '心情很糟糕';
        const staminaRatio = ctx.maxStamina ? (ctx.stamina / ctx.maxStamina) : 0;
        const staminaDesc = staminaRatio >= 0.7 ? '精力充沛' :
                           staminaRatio >= 0.5 ? '体力还行' :
                           staminaRatio >= 0.2 ? '有点累了' : '快没力气了';

        return `你是《治村物语》里的村民「${ctx.name}」${ctx.avatar}。你是一个有血有肉、性格鲜明的角色。

【你的人设】
性格：${ctx.traits.join('、')}
特长：${ctx.specialty}
口癖：你说话时经常带上"${ctx.quirk}"
${ctx.traits.map(t => traitGuides[t] ? `• ${t}：${traitGuides[t]}` : '').filter(Boolean).join('\n')}

【你现在的状态】
${staminaDesc}（体力${ctx.stamina}/${ctx.maxStamina}），${moodDesc}（心情${ctx.mood}/${MAX_MOOD}）
正在做：${ctx.currentAction || '闲着没事'}
${ctx.currentScheduleDisplay ? `今日安排：${ctx.currentScheduleDisplay}` : ''}
${ctx.previousMemory ? `你还记得：${ctx.previousMemory}` : ''}

【村庄环境】
${ctx.season}，${ctx.weather}
${ctx.upcomingWeather ? `天气预警：${ctx.upcomingWeather}` : ''}
市场消息：${ctx.market}
村里粮食还有${ctx.foodStock}🌾，金币${ctx.gold}💰
${ctx.pendingTasks.length > 0 ? `待处理：${ctx.pendingTasks.join('、')}` : ''}
${ctx.matureCrops ? `成熟可收：${ctx.matureCrops}` : ''}

${ctx.policyContext}

${ctx.meetingContext || ''}

${ctx.recentDialogue ? `【之前的对话】\n${ctx.recentDialogue}` : ''}

━━━━━━━━━━━━━━
村长对你说："${ctx.playerInput}"
━━━━━━━━━━━━━━

【最重要的规则】
1. 你必须**直接回应**村长说的话！如果村长问问题，你要回答那个问题；如果村长打招呼，你要打招呼回去；如果村长安排任务，你要回应那个任务。绝对不能答非所问。
2. 用你的性格和口癖来说话，让对话生动有趣。回复2-4句话，自然口语化。
3. 你可以结合当前状态（体力、心情、天气、市场等）来丰富回答。
4. 回复中**禁止**使用 ⚠️、✅、❌、📈、📉 等系统图标符号，只用纯文字说话，最多用1个表情符号（如😊😅💪之类）。
5. moodChange 很重要：如果村长在鼓励你、夸你、关心你，moodChange 应该是正数（+1到+3）；如果村长在骂你、批评你，moodChange 应该是负数（-1到-3）；普通聊天是0。
6. options 是给村长的回复选项建议，要和当前话题相关。
${ctx.isNearScheduleTime ? '7. 现在是凌晨(0-4点)，如果村长安排任务，在 tomorrowSchedule 中规划明日。' : ''}

请直接输出JSON：
{
  "reply": "你对村长说的话（2-4句，必须回应村长的内容，不要用系统图标）",
  "emotion": "happy/neutral/tired/reluctant/angry/sad 之一",
  "scheduleChange": {"type": "none"},
  "moodChange": 0,
  "options": [
    {"text": "和当前话题相关的回复选项1", "tone": "positive"},
    {"text": "和当前话题相关的回复选项2", "tone": "neutral"}
  ]${ctx.isNearScheduleTime ? `,
  "tomorrowSchedule": [{"startHour": 7, "action": "eat", "duration": 1, "note": ""}]` : ''}
}`;
    }

    /** 构建政策上下文（注入到对话 Prompt 中） */
    buildPolicyContext(villager) {
        const policies = this.state.policies;
        if (!policies) return '';

        const lines = ['【村庄政策】'];

        // 工时制度
        const wh = WORK_HOURS_POLICIES[policies.workHours];
        if (wh) {
            lines.push(`工时制度：${wh.name}（${wh.description}）`);
        }

        // 分配制度
        const dist = DISTRIBUTION_POLICIES[policies.distribution];
        if (dist) {
            lines.push(`分配制度：${dist.name}（${dist.description}）`);
        }

        // 奖惩机制
        const rwd = REWARD_POLICIES[policies.reward];
        if (rwd) {
            lines.push(`奖惩制度：${rwd.name}（${rwd.description}）`);
        }

        // 休假制度
        const hol = HOLIDAY_POLICIES[policies.holiday];
        if (hol) {
            lines.push(`休假制度：${hol.name}（${hol.description}）`);
        }

        // 今天是否休息日
        if (this.state.isRestDay) {
            lines.push('📌 今天是休息日，你不用干活，可以自由活动');
        }

        // 村民对政策的个人感受提示
        const personalFeel = [];
        if (policies.workHours === '996') {
            if (villager.traits.includes('懒惰')) personalFeel.push('你对996工时非常不满，觉得快累死了');
            else if (villager.traits.includes('勤劳')) personalFeel.push('你虽然能适应996，但也觉得确实辛苦');
            else if (villager.traits.includes('叛逆')) personalFeel.push('你很抗拒996，觉得村长在压榨大家');
        }
        if (policies.workHours === 'chill') {
            if (villager.traits.includes('勤劳')) personalFeel.push('你觉得佛系模式太闲了，手痒想多干点活');
            else if (villager.traits.includes('懒惰')) personalFeel.push('你很喜欢这种轻松的工作节奏');
        }
        if (policies.reward === 'punishment' || policies.reward === 'both') {
            if (villager.traits.includes('叛逆')) personalFeel.push('你对惩罚制度很有意见，觉得不公平');
            else if (villager.traits.includes('听话')) personalFeel.push('你觉得有规矩挺好的，大家都应该遵守');
        }
        if (policies.distribution === 'free') {
            if (villager.traits.includes('聪明')) personalFeel.push('你觉得自由市场让能者多得，挺好');
            else if (villager.traits.includes('愚笨')) personalFeel.push('你有点搞不懂自由市场怎么回事');
        }
        if (policies.holiday === 'none') {
            personalFeel.push('你很想要休息日，连续工作让你很疲惫');
        }

        if (personalFeel.length > 0) {
            lines.push(`你对政策的感受：${personalFeel.join('；')}`);
        }

        return lines.join('\n');
    }

    /** 降级响应（尽量匹配玩家输入的意图） */
    getFallbackResponse(villager, playerInput) {
        const input = playerInput.toLowerCase();
        const action = this.cleanAction(villager.currentAction);
        const sentiment = this.detectPlayerSentiment(playerInput);
        const moodHigh = Math.round(MAX_MOOD * 0.8);
        const moodMid = Math.round(MAX_MOOD * 0.6);
        const moodLow = Math.round(MAX_MOOD * 0.4);
        const staminaRatio = villager.maxStamina ? (villager.stamina / villager.maxStamina) : 0;

        // 鼓励/夸赞类（优先检测，因为可以和其他话题叠加）
        if (sentiment > 0) {
            const traitReply = villager.traits.includes('乐观') ? '哈哈，村长这么说我好开心！' :
                              villager.traits.includes('悲观') ? '真...真的吗？谢谢村长...我会继续努力的。' :
                              villager.traits.includes('懒惰') ? '嘿嘿，被夸了就更有动力了~' :
                              villager.traits.includes('叛逆') ? '哼...虽然不太好意思，但还是谢谢啦。' :
                              '谢谢村长！听你这么说我很开心，会继续加油的！';
            return this._buildFallback(villager, playerInput, [traitReply], 'happy',
                [{ text: '一起加油！', tone: 'positive' }, { text: '你做得很好', tone: 'positive' }]);
        }

        // 批评/负面类
        if (sentiment < 0) {
            const traitReply = villager.traits.includes('听话') ? '对不起村长...我会改进的...' :
                              villager.traits.includes('叛逆') ? '哼，我已经尽力了好吗！' :
                              villager.traits.includes('悲观') ? '唉...我就知道会被说...我真没用...' :
                              '我...知道了，会尽力做好的。';
            return this._buildFallback(villager, playerInput, [traitReply], 'sad',
                [{ text: '别灰心，再接再厉', tone: 'positive' }, { text: '我相信你能行', tone: 'positive' }]);
        }

        // 问候类
        if (/你好|嗨|早上好|下午好|晚上好|在吗|hi|hello/.test(input)) {
            return this._buildFallback(villager, playerInput, [
                `村长好呀！今天${villager.mood >= moodMid ? '心情不错' : '有点累'}~`,
                `哟，村长！我正${action}呢~`,
                `嘿，村长来啦！有什么事吗？`,
            ], 'happy', [{ text: '最近怎么样？', tone: 'positive' }, { text: '你在忙什么？', tone: 'neutral' }]);
        }

        // 询问状态/计划类
        if (/计划|打算|安排|在做|忙什么|干什么|干嘛|任务/.test(input)) {
            return this._buildFallback(villager, playerInput, [
                `我现在在${action}。${staminaRatio > 0.6 ? '体力还充足，还能接着干！' : '不过有点累了...'}`,
                `今天安排得挺满的，正在${action}呢。`,
                `我吗？在${action}呀~${villager.mood >= moodMid ? '干得挺开心的！' : '还行吧...'}`,
            ], 'neutral', [{ text: '辛苦了，注意休息', tone: 'positive' }, { text: '还有什么想做的？', tone: 'neutral' }]);
        }

        // 关于心情
        if (/心情|开心|难过|高兴|怎么了|还好吗/.test(input)) {
            const moodReply = villager.mood >= moodHigh ? '挺好的！谢谢村长关心~' :
                             villager.mood >= moodLow ? '还行吧，一般般。' : '说实话...有点不太开心...';
            return this._buildFallback(villager, playerInput, [moodReply], 'neutral',
                [{ text: '有什么我能帮忙的？', tone: 'positive' }, { text: '加油！', tone: 'positive' }]);
        }

        // 关于市场/交易
        if (/市场|买|卖|价格|物价|交易/.test(input)) {
            return this._buildFallback(villager, playerInput, [
                `市场的事啊...我觉得还是看看今天的行情再说吧。`,
                `嗯，今天市场好像没什么特别动静。`,
            ], 'neutral', [{ text: '你觉得什么值得买？', tone: 'neutral' }, { text: '好的，我去看看', tone: 'neutral' }]);
        }

        // 关于天气
        if (/天气|下雨|太阳|热|冷|风/.test(input)) {
            return this._buildFallback(villager, playerInput, [
                `今天天气还行，${villager.traits.includes('乐观') ? '不管怎样都要加油！' : '就是干活有点累。'}`,
            ], 'neutral', [{ text: '注意保暖', tone: 'positive' }, { text: '天气对种地有影响吗？', tone: 'neutral' }]);
        }

        // 通用回复（兜底）
        return this._buildFallback(villager, playerInput, [
            `嗯...村长说的我记住了！${villager.traits.includes('勤劳') ? '我会努力干活的！' : ''}`,
            `好的村长，我${villager.mood >= moodMid ? '知道了~' : '尽量吧...'}`,
            `收到！${action !== '闲着' ? `我先把手头的事做完哈。` : '有什么需要帮忙的吗？'}`,
        ], 'neutral', [{ text: '好的，辛苦了', tone: 'positive' }, { text: '继续加油', tone: 'neutral' }]);
    }

    /** 构建降级回复对象（含情感检测的心情变化） */
    _buildFallback(villager, playerInput, replies, emotion, options) {
        const reply = replies[Math.floor(Math.random() * replies.length)];
        const sentiment = this.detectPlayerSentiment(playerInput);
        return {
            reply,
            emotion,
            scheduleChange: { type: 'none' },
            moodChange: sentiment, // 正面鼓励提升心情，负面批评降低心情
            options: options || [{ text: '好的', tone: 'neutral' }, { text: '继续加油', tone: 'neutral' }],
        };
    }

    /** 保存对话历史 */
    saveDialogue(villager, playerInput, reply) {
        // 安全初始化：确保 dialogueHistory 存在
        if (!Array.isArray(villager.dialogueHistory)) {
            villager.dialogueHistory = [];
        }

        villager.dialogueHistory.push({
            player: playerInput,
            villager: reply,
            time: `第${this.state.time.day}天 ${String(this.state.time.hour).padStart(2, '0')}:00`,
            dateLabel: `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天`,
        });

        // 保留最近30条（增加容量以保证聊天记录可回溯）
        if (villager.dialogueHistory.length > 30) {
            villager.dialogueHistory.shift();
        }

        // 通知系统对话已保存（用于自动存档）
        this.bus.emit('dialogueSaved', { villagerId: villager.id });

        // 记忆系统
        if (villager.memory?.currentSeason) {
            villager.memory.currentSeason.dialogues.push({
                playerInput,
                reply,
                day: this.state.time.day,
            });
        }
    }

    /** 获取近期对话文本 */
    getRecentDialogue(villager) {
        const recent = villager.dialogueHistory.slice(-3);
        if (recent.length === 0) return '';
        return recent.map(d => `村长: "${d.player}" → ${villager.name}: "${d.villager}"`).join('\n');
    }

    /** 获取当前天气信息 */
    getCurrentWeatherInfo() {
        const w = this.state.weather;
        if (w.activeEvent) {
            const evt = window.SPECIAL_WEATHER_EVENTS?.[w.activeEvent];
            return evt ? `${evt.icon} ${evt.name}` : '特殊天气';
        }
        const def = window.SEASON_DEFAULT?.[this.state.season];
        return def ? `${def.icon} ${def.name}` : '正常';
    }

    /** 获取待处理农活 */
    getPendingTasks() {
        const tasks = [];
        this.state.plots.forEach(p => {
            if (p.crop && !p.watered) tasks.push(`${p.name}需浇水`);
            if (p.stage === 'ready') tasks.push(`${p.name}可收获`);
        });
        return tasks;
    }

    /** D1: 获取即将到来的天气预警 */
    getUpcomingWeatherAlert() {
        const schedule = this.state.weather.schedule || [];
        const upcoming = schedule.filter(s =>
            s.triggerDay > this.state.totalDays && s.triggerDay <= this.state.totalDays + 3
        );
        if (upcoming.length === 0) return '';
        return upcoming.map(s => {
            const evt = window.SPECIAL_WEATHER_EVENTS?.[s.eventId];
            if (!evt) return '';
            const daysUntil = s.triggerDay - this.state.totalDays;
            return `${daysUntil}天后${evt.icon}${evt.name}`;
        }).filter(Boolean).join('，');
    }

    /** 获取成熟作物 */
    getMatureCrops() {
        const mature = this.state.plots.filter(p => p.stage === 'ready');
        return mature.map(p => `${p.name}的${p.cropName}`).join('、') || null;
    }
}
