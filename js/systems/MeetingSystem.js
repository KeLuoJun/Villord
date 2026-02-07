/**
 * MeetingSystem - 村会系统
 * 村长与全体村民开会讨论村务，发布工作指示
 *
 * 核心设计：
 * - 村长发言后，每位村民根据性格做出差异化回应
 * - 会议决议作为"活跃指示"注入所有 NPC AI 上下文
 * - 指示有有效期（默认3天），到期自动过期
 * - 村民执行指示的程度受性格影响（听话>勤劳>普通>叛逆>懒惰）
 */

import { MAX_MOOD } from '../config/villagers.js';
import { WORK_HOURS_POLICIES } from '../config/policies.js';

/** 指示默认有效天数 */
const DIRECTIVE_DURATION = 3;

/** 会议历史最大保留数 */
const MAX_MEETING_HISTORY = 5;

/** 每日最多开会次数 */
const MAX_MEETINGS_PER_DAY = 2;

export class MeetingSystem {
    constructor(aiService, gameState, eventBus) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;

        /** 今日已开会次数 */
        this._todayMeetingCount = 0;

        this.bus.on('newDay', () => {
            this._todayMeetingCount = 0;
        });

        console.log('[MeetingSystem] 村会系统已初始化');
    }

    // ===== 状态查询 =====

    /** 是否可以开会 */
    canStartMeeting() {
        if (this.state.villagers.length === 0) {
            return { ok: false, reason: '没有村民可以开会' };
        }
        if (this._todayMeetingCount >= MAX_MEETINGS_PER_DAY) {
            return { ok: false, reason: '今天已经开过会了，明天再说吧' };
        }
        return { ok: true };
    }

    /** 获取当前活跃指示（未过期的最新指示） */
    getActiveDirective() {
        const meetings = this.state.meetings?.history || [];
        if (meetings.length === 0) return null;

        const latest = meetings[0]; // 按时间倒序，第一个是最新的
        if (!latest || !latest.directive) return null;

        // 检查是否过期
        if (this.state.totalDays > latest.validUntil) return null;

        return latest;
    }

    /** 获取最近N次会议记录 */
    getMeetingHistory(count = 3) {
        return (this.state.meetings?.history || []).slice(0, count);
    }

    // ===== 会议核心逻辑 =====

    /**
     * 发起村会 — 生成全体村民的回应
     * @param {string} playerSpeech - 村长发言内容
     * @returns {Promise<object>} 会议结果 { success, meeting, error }
     */
    async holdMeeting(playerSpeech) {
        const canMeet = this.canStartMeeting();
        if (!canMeet.ok) {
            return { success: false, error: canMeet.reason };
        }

        if (!playerSpeech || playerSpeech.trim().length < 2) {
            return { success: false, error: '请输入会议内容' };
        }

        const topic = playerSpeech.trim();
        console.log(`[MeetingSystem] 村长发起村会: "${topic}"`);

        // 构建会议 Prompt
        const prompt = this.buildMeetingPrompt(topic);

        // AI 生成响应
        let aiResult = null;
        try {
            aiResult = await this.ai.chat(prompt, {
                temperature: 0.85,
                maxTokens: 1200,
            });
        } catch (e) {
            console.warn('[MeetingSystem] AI 调用失败:', e.message);
        }

        // 构建会议记录
        let responses;
        let directive;

        if (aiResult && aiResult.responses && Array.isArray(aiResult.responses)) {
            responses = aiResult.responses;
            directive = aiResult.directive || this.extractDirective(topic);
        } else {
            // 降级：生成预设回应
            console.log('[MeetingSystem] AI 降级，使用预设回应');
            responses = this.generateFallbackResponses(topic);
            directive = this.extractDirective(topic);
        }

        // 组装会议对象
        const meeting = {
            id: Date.now(),
            topic,
            day: this.state.totalDays,
            dayLabel: `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天`,
            hour: this.state.time.hour,
            responses: responses.map(r => {
                const v = this.state.villagers.find(v => v.name === r.name);
                return {
                    villagerId: v?.id || '',
                    name: r.name,
                    avatar: v?.avatar || '👤',
                    response: r.response,
                    attitude: r.attitude || 'neutral',
                };
            }),
            directive,
            validUntil: this.state.totalDays + DIRECTIVE_DURATION,
        };

        // 保存会议记录
        this.saveMeeting(meeting);
        this._todayMeetingCount++;

        // 日志
        this.state.addLog('📢', `村会召开：${directive}`, 'info');
        this.bus.emit('meetingHeld', { meeting });
        this.bus.emit('showToast', {
            message: `📢 村会结束，工作指示已下达（有效${DIRECTIVE_DURATION}天）`,
            type: 'success',
        });

        // 注入到每个村民的记忆中
        this.injectMeetingToMemory(meeting);

        console.log(`[MeetingSystem] 村会完成，指示: "${directive}"，有效至第${meeting.validUntil}天`);
        return { success: true, meeting };
    }

    // ===== Prompt 构建 =====

    /** 构建村会 AI Prompt */
    buildMeetingPrompt(topic) {
        const villagers = this.state.villagers;
        const villagersInfo = villagers.map(v => {
            const moodDesc = v.mood >= Math.round(MAX_MOOD * 0.7) ? '心情不错' :
                            v.mood >= Math.round(MAX_MOOD * 0.4) ? '心情一般' : '心情不好';
            const staminaRatio = v.maxStamina ? (v.stamina / v.maxStamina) : 0;
            const staminaDesc = staminaRatio >= 0.6 ? '精力充沛' :
                               staminaRatio >= 0.3 ? '有点累' : '很疲惫';

            return `- ${v.avatar||'👤'}${v.name}（性格：${v.traits.join('·')}，特长：${v.specialty}，口癖："${v.quirk}"，${moodDesc}，${staminaDesc}）`;
        }).join('\n');

        // 政策上下文
        const policies = this.state.policies;
        const wh = WORK_HOURS_POLICIES[policies.workHours];
        const policyBrief = wh ? `当前工时：${wh.name}` : '';

        // 之前的指示
        const prevDirective = this.getActiveDirective();
        const prevContext = prevDirective
            ? `上次村会指示（第${prevDirective.day}天）：「${prevDirective.directive}」`
            : '（这是第一次开村会）';

        // 村庄环境
        const env = `${this.state.seasonName}季，粮食${this.state.resources.food}🌾，金币${this.state.resources.gold}💰，木材${this.state.resources.wood}🪵，石料${this.state.resources.stone}🪨`;

        return `你是《治村物语》的村会系统。村长召集全体村民开会。

【参会村民】
${villagersInfo}

【村庄状况】
${env}
${policyBrief}
${prevContext}

━━━━━━━━━━━━━━
村长在会上说："${topic}"
━━━━━━━━━━━━━━

请为每位村民生成一句会议回应（15-40字），必须体现该村民的独特性格和口癖。

【性格回应指南】
• 勤劳：积极响应，表示马上行动
• 懒惰：有些犹豫，想偷懒但不敢直接拒绝
• 听话：完全服从，表态坚决
• 叛逆：提出质疑或不同意见，但不是完全抵抗
• 聪明：分析利弊，可能提出补充建议
• 愚笨：似懂非懂，可能理解偏了
• 乐观：积极乐观，给大家打气
• 悲观：担忧困难，但也会执行
• 健壮：表示体力没问题
• 体弱：担心体力能否跟上

【attitude 字段说明】
support = 支持，hesitant = 犹豫，question = 质疑，confused = 困惑

还需要将村长的话提炼为一句简短的"工作指示"（10-25字），作为接下来几天的行动纲领。

请直接输出JSON：
{
  "responses": [
    {"name": "${villagers[0]?.name || '村民'}", "response": "该村民的回应（带口癖）", "attitude": "support/hesitant/question/confused"}${villagers.length > 1 ? `,
    {"name": "${villagers[1]?.name || '村民'}", "response": "...", "attitude": "..."}` : ''}${villagers.length > 2 ? `,
    {"name": "${villagers[2]?.name || '村民'}", "response": "...", "attitude": "..."}` : ''}${villagers.length > 3 ? `,
    {"name": "${villagers[3]?.name || '村民'}", "response": "...", "attitude": "..."}` : ''}
  ],
  "directive": "提炼的工作指示（10-25字简短总结）"
}`;
    }

    // ===== 降级处理 =====

    /** 生成预设降级回应 */
    generateFallbackResponses(topic) {
        return this.state.villagers.map(v => {
            let response = '';
            let attitude = 'support';

            if (v.traits.includes('勤劳')) {
                response = `好的村长！我这就去准备，${v.quirk}`;
                attitude = 'support';
            } else if (v.traits.includes('懒惰')) {
                response = `啊...好吧...${v.quirk}`;
                attitude = 'hesitant';
            } else if (v.traits.includes('叛逆')) {
                response = `嗯...我觉得可以再想想，${v.quirk}`;
                attitude = 'question';
            } else if (v.traits.includes('聪明')) {
                response = `明白了，我来想想怎么安排最合理，${v.quirk}`;
                attitude = 'support';
            } else if (v.traits.includes('愚笨')) {
                response = `啊？好...好的？我尽量，${v.quirk}`;
                attitude = 'confused';
            } else if (v.traits.includes('乐观')) {
                response = `没问题！大家加油！${v.quirk}`;
                attitude = 'support';
            } else if (v.traits.includes('悲观')) {
                response = `唉...希望能顺利吧...${v.quirk}`;
                attitude = 'hesitant';
            } else {
                response = `收到，村长！${v.quirk}`;
                attitude = 'support';
            }

            return { name: v.name, response, attitude };
        });
    }

    /** 从玩家发言中提取核心指示（降级用） */
    extractDirective(topic) {
        // 简单截断
        if (topic.length <= 25) return topic;
        return topic.slice(0, 22) + '...';
    }

    // ===== 数据管理 =====

    /** 保存会议记录到 GameState */
    saveMeeting(meeting) {
        if (!this.state.meetings) {
            this.state.meetings = { history: [] };
        }
        // 新会议插入最前面
        this.state.meetings.history.unshift(meeting);
        // 保留最近 N 条
        if (this.state.meetings.history.length > MAX_MEETING_HISTORY) {
            this.state.meetings.history.pop();
        }
    }

    /** 将会议内容注入村民记忆（供后续对话引用） */
    injectMeetingToMemory(meeting) {
        this.state.villagers.forEach(v => {
            if (!v.memory?.currentSeason) return;
            v.memory.currentSeason.events.push({
                type: 'meeting',
                text: `村长在村会上说：「${meeting.topic}」，你的回应：「${meeting.responses.find(r => r.villagerId === v.id)?.response || '...'}」`,
                day: this.state.time.day,
                directive: meeting.directive,
            });
        });
    }

    // ===== 上下文构建（供其他模块调用） =====

    /**
     * 构建会议指示上下文（注入到 NPC Prompt 中）
     * @param {object} [villager] - 可选，传入具体村民以获取个性化上下文
     * @returns {string} 可直接拼入 Prompt 的上下文文本
     */
    buildMeetingContext(villager = null) {
        const active = this.getActiveDirective();
        if (!active) return '';

        const daysLeft = active.validUntil - this.state.totalDays;
        const lines = [
            `【村长近期指示（村会决议，${daysLeft > 0 ? `还有${daysLeft}天有效` : '即将过期'}）】`,
            `村长在第${active.day}天的村会上说："${active.topic}"`,
            `核心指示：${active.directive}`,
        ];

        // 个性化：该村民在会上的回应
        if (villager) {
            const myResponse = active.responses?.find(r =>
                r.villagerId === villager.id || r.name === villager.name
            );
            if (myResponse) {
                lines.push(`你在会上的回应："${myResponse.response}"（态度：${myResponse.attitude}）`);
            }

            // 性格决定遵从程度提示
            const complianceHint = this.getComplianceHint(villager);
            if (complianceHint) {
                lines.push(complianceHint);
            }
        }

        lines.push('→ 你在安排行动计划和日常行为时应参考村长的指示，但也要结合自己的性格和当前状况做出判断。');

        return lines.join('\n');
    }

    /** 根据性格生成遵从程度提示 */
    getComplianceHint(villager) {
        const traits = villager.traits || [];
        if (traits.includes('听话')) {
            return '你非常听村长的话，会尽力按照指示执行。';
        }
        if (traits.includes('勤劳')) {
            return '你积极响应村长号召，会主动把指示落实到行动中。';
        }
        if (traits.includes('叛逆')) {
            return '你对村长的指示有自己的看法，可能只会部分执行，或者按自己的方式来。';
        }
        if (traits.includes('懒惰')) {
            return '你嘴上答应了村长的指示，但实际执行时可能会偷懒或拖延。';
        }
        if (traits.includes('愚笨')) {
            return '你可能没完全理解村长的指示，执行时可能会有偏差。';
        }
        return null;
    }

    /**
     * 构建简短指示摘要（用于调度 Prompt 的精简版）
     * @returns {string}
     */
    getDirectiveBrief() {
        const active = this.getActiveDirective();
        if (!active) return '';
        return `村长指示：${active.directive}`;
    }
}
