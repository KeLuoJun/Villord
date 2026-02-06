/**
 * VillagerAI - 村民 AI 对话与调度
 * 处理玩家与村民的对话（模式B）+ 系统自动调度（模式A）
 */
import { ACTION_NAMES, ACTION_ICONS, VALID_ACTIONS } from '../config/villagers.js';

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
                villager.mood = Math.max(0, Math.min(100, villager.mood + result.moodChange));
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
        return this.getFallbackResponse(villager, playerInput);
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
            currentAction: villager.currentAction,
            currentScheduleDisplay,
            previousMemory,
            upcomingWeather,
            todayWorkCount: villager.todayWorkCount,
            season: this.state.seasonName,
            weather: this.getCurrentWeatherInfo(),
            market: this.state.market.dailyReport?.broadcast || '暂无市场简报',
            foodStock: this.state.resources.food,
            gold: this.state.resources.gold,
            pendingTasks: this.getPendingTasks(),
            matureCrops: this.getMatureCrops(),
            recentDialogue: this.getRecentDialogue(villager),
            playerInput,
            isNearScheduleTime: false, // 由 handlePlayerChat 覆盖
        };
    }

    /** 生成村民对话 Prompt */
    generateVillagerPrompt(ctx) {
        const traitGuides = {
            '勤劳': '你热爱工作，主动寻找事情做，执行任务积极迅速',
            '懒惰': '你不太喜欢干活，接到任务会拖延找借口',
            '聪明': '你理解力强，能准确执行指令，还会给村长提建议',
            '愚笨': '你理解力差，可能误解指令（比如让你浇水你跑去施肥）',
            '听话': '你很尊重村长，几乎不会拒绝指令',
            '叛逆': '觉得不合理的指令会反驳或拒绝',
            '乐观': '总是开开心心的，即使辛苦也笑着面对',
            '悲观': '容易抱怨，动不动发牢骚，但该干的活最终还是会干',
            '健壮': '体力充沛，干重活也不觉得累',
            '体弱': '体力有限，容易疲劳，干一会儿就要休息',
        };

        return `# 角色设定
你是村庄经营游戏《治村物语》中的村民。

## 基本信息
- 姓名：${ctx.name}　头像：${ctx.avatar}
- 性格：${ctx.traits.join('、')}
- 特长：${ctx.specialty}
- 口癖：经常说"${ctx.quirk}"

## 当前状态
- 体力：${ctx.stamina}/${ctx.maxStamina}
- 心情：${ctx.mood}/100
- 准确率：${Math.round((ctx.accuracy || 1) * 100)}%
- 工作速度：${Math.round((ctx.workSpeed || 1) * 100)}%
- 当前任务：${ctx.currentAction || '空闲'}
${ctx.currentScheduleDisplay ? `- 今日安排：${ctx.currentScheduleDisplay}` : ''}
${ctx.previousMemory ? `- 往季记忆摘要：${ctx.previousMemory}` : ''}

## 性格行为指南
${ctx.traits.map(t => `- ${t}：${traitGuides[t] || ''}`).join('\n')}

## 环境
- 季节：${ctx.season}
- 天气：${ctx.weather}
${ctx.upcomingWeather ? `- 近期天气预警：${ctx.upcomingWeather}` : ''}
- 市场：${ctx.market}
- 粮食库存：${ctx.foodStock}🌾
- 待处理农活：${ctx.pendingTasks.join('、') || '无'}
- 成熟作物：${ctx.matureCrops || '无'}

## 近期对话
${ctx.recentDialogue || '（首次对话）'}

---
# 村长说
"${ctx.playerInput}"

---
# 回复要求
- 回复1-3句话，自然口语化，符合性格
- 行动只能从以下选择：${VALID_ACTIONS.join(', ')}
${ctx.isNearScheduleTime ? '- ⚠️ 当前是凌晨(0-4点)，即将到调度时间。如果村长安排了任务，请在 tomorrowSchedule 中给出明日行动计划。' : ''}

# 输出格式（严格JSON）
\`\`\`json
{
  "reply": "村民回复",
  "emotion": "happy|neutral|tired|reluctant|angry|sad",
  "scheduleChange": { "type": "none", "reason": "", "newActions": [] },
  "moodChange": 0,
  "options": [
    {"text": "选项1", "tone": "positive"},
    {"text": "选项2", "tone": "neutral"}
  ]${ctx.isNearScheduleTime ? `,
  "tomorrowSchedule": [
    {"startHour": 6, "action": "eat", "duration": 1, "note": ""}
  ]` : ''}
}
\`\`\``;
    }

    /** 降级响应 */
    getFallbackResponse(villager, playerInput) {
        // 根据性格选择预设对话
        let pool = this.presetDialogues['default'];
        for (const trait of villager.traits) {
            if (this.presetDialogues[trait]) {
                pool = this.presetDialogues[trait];
                break;
            }
        }

        const preset = pool[Math.floor(Math.random() * pool.length)];

        return {
            reply: preset.reply,
            emotion: preset.emotion,
            scheduleChange: { type: 'none' },
            moodChange: 0,
            options: [
                { text: '好的，辛苦了', tone: 'positive' },
                { text: '继续加油', tone: 'neutral' },
            ],
        };
    }

    /** 保存对话历史 */
    saveDialogue(villager, playerInput, reply) {
        villager.dialogueHistory.push({
            player: playerInput,
            villager: reply,
            time: `第${this.state.time.day}天 ${this.state.time.hour}:00`,
        });

        // 只保留最近10条
        if (villager.dialogueHistory.length > 10) {
            villager.dialogueHistory.shift();
        }

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
