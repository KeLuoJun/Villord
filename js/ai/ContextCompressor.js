/**
 * ContextCompressor - AI 上下文压缩器
 * 季末将大量对话/事件/市场/天气历史压缩为摘要
 * 保留最近4个季度记忆
 */
import { SPECIAL_WEATHER_EVENTS } from '../config/weather.js';
import {
    WORK_HOURS_POLICIES,
    DISTRIBUTION_POLICIES,
    REWARD_POLICIES,
    HOLIDAY_POLICIES,
} from '../config/policies.js';

export class ContextCompressor {
    constructor(aiService, gameState, eventBus) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;

        this.bus.on('seasonChange', () => this.compressSeasonMemory());
    }

    /** 季末压缩 */
    async compressSeasonMemory() {
        console.log('[ContextCompressor] 季末上下文压缩...');

        // 1. 压缩每个村民的记忆
        for (const villager of this.state.villagers) {
            await this.compressVillagerMemory(villager);
        }

        // 2. G2: 压缩市场历史（含统计摘要）
        this.compressMarketHistory();

        // 3. G1: 压缩天气历史（含分布统计）
        this.compressWeatherHistory();

        // 4. G3: 生成村庄季末编年史
        await this.generateChronicle();

        console.log('[ContextCompressor] 压缩完成');
    }

    /** 压缩村民记忆 */
    async compressVillagerMemory(villager) {
        const memory = villager.memory;
        if (!memory?.currentSeason) return;

        const seasonData = memory.currentSeason;
        const dialogueCount = seasonData.dialogues?.length || 0;
        const eventCount = seasonData.events?.length || 0;

        if (dialogueCount === 0 && eventCount === 0) return;

        // AI LOGIC - 压缩本季对话和事件为3-5句摘要
        let summary = '';

        const dialogueTexts = (seasonData.dialogues || [])
            .map(d => `村长: "${d.playerInput}" → ${villager.name}: "${d.reply}"`)
            .join('\n');

        const eventTexts = (seasonData.events || []).map(e => e.text || e).join('\n');

        if (this.ai.enabled && (dialogueCount > 3 || eventCount > 2)) {
            const prompt = `请将以下村民 ${villager.name}（性格：${villager.traits.join('、')}）本季度的对话和事件压缩为3-5句核心摘要。保留重要信息，去掉日常寒暄。

## 对话记录（共${dialogueCount}条）
${dialogueTexts.slice(0, 2000) || '无'}

## 事件记录（共${eventCount}条）
${eventTexts.slice(0, 500) || '无'}

## 要求
- 3-5句话概括
- 保留关键决策和情绪变化
- 第三人称
- 直接输出文本，不要JSON

## 摘要：`;

            const result = await this.ai.chatRaw(prompt, { temperature: 0.5, maxTokens: 300 });
            if (result) {
                summary = result;
            }
        }

        // 降级：直接截取
        if (!summary) {
            const parts = [];
            if (dialogueCount > 0) parts.push(`共进行了${dialogueCount}次对话`);
            if (eventCount > 0) parts.push(`经历了${eventCount}个事件`);
            summary = `${villager.name}本季${parts.join('，')}。`;
        }

        // 保存压缩后的记忆
        if (!memory.previousSeasons) memory.previousSeasons = [];
        memory.previousSeasons.push({
            season: this.state.seasonName,
            year: this.state.time.year,
            summary,
        });

        // 最多保留4个季度
        if (memory.previousSeasons.length > 4) {
            memory.previousSeasons.shift();
        }

        // 重置当前季度
        memory.currentSeason = { dialogues: [], events: [] };

        // 清理对话历史
        villager.dialogueHistory = villager.dialogueHistory.slice(-3);

        console.log(`[ContextCompressor] ${villager.name} 记忆压缩: ${dialogueCount}对话+${eventCount}事件 → ${summary.length}字摘要`);
    }

    /** G2: 压缩市场历史（含统计摘要） */
    compressMarketHistory() {
        const market = this.state.market;

        // 为每个商品生成统计摘要（保留7天详细 + 旧数据统计）
        if (!market.seasonalSummaries) market.seasonalSummaries = [];

        const summary = {};
        const prices = market.prices || {};
        const items = window.MARKET_ITEMS || {};

        for (const [id, config] of Object.entries(items)) {
            if (config.category === 'seed') continue;

            const currentPrice = prices[id] || config.basePrice;
            const history = market.priceHistory?.[id] || [];

            if (history.length > 0) {
                const priceValues = history.map(h => h.price || h);
                const avg = priceValues.reduce((s, p) => s + p, 0) / priceValues.length;
                const max = Math.max(...priceValues);
                const min = Math.min(...priceValues);
                const trend = priceValues.length >= 2
                    ? (priceValues[priceValues.length - 1] - priceValues[0]) / priceValues[0]
                    : 0;

                summary[id] = {
                    name: config.name,
                    avg: Math.round(avg * 100) / 100,
                    max: Math.round(max * 100) / 100,
                    min: Math.round(min * 100) / 100,
                    current: Math.round(currentPrice),
                    trendPercent: Math.round(trend * 100),
                };
            }
        }

        market.seasonalSummaries.push({
            season: this.state.seasonName,
            year: this.state.time.year,
            priceStats: summary,
        });

        // 最多保留4个季度摘要
        if (market.seasonalSummaries.length > 4) {
            market.seasonalSummaries.shift();
        }

        // 保留最近7天详细数据
        if (market.priceHistory) {
            Object.keys(market.priceHistory).forEach(key => {
                const hist = market.priceHistory[key];
                if (Array.isArray(hist) && hist.length > 168) {
                    market.priceHistory[key] = hist.slice(-168);
                }
            });
        }

        console.log('[ContextCompressor] 市场历史统计摘要已生成');
    }

    /** G1: 压缩天气历史（含分布统计） */
    compressWeatherHistory() {
        const weather = this.state.weather;

        // 统计本季天气分布
        if (!weather.seasonalStats) weather.seasonalStats = [];

        const eventLog = weather.eventLog || [];
        const stats = {
            season: this.state.seasonName,
            year: this.state.time.year,
            totalDays: this.state.time.day,
            weatherCounts: {},
            extremeEvents: [],
        };

        // 统计各天气出现次数
        eventLog.forEach(entry => {
            const name = entry.weatherName || entry.name || 'unknown';
            stats.weatherCounts[name] = (stats.weatherCounts[name] || 0) + 1;
        });

        // 记录极端天气事件
        const schedule = weather.schedule || [];
        schedule.forEach(s => {
            const evt = SPECIAL_WEATHER_EVENTS[s.eventId];
            if (evt) {
                stats.extremeEvents.push({
                    name: evt.name,
                    icon: evt.icon,
                    day: s.triggerDay,
                    duration: evt.duration,
                });
            }
        });

        weather.seasonalStats.push(stats);

        // 最多保留4个季度统计
        if (weather.seasonalStats.length > 4) {
            weather.seasonalStats.shift();
        }

        // 清理旧的 eventLog，只保留最近的
        if (eventLog.length > 30) {
            weather.eventLog = eventLog.slice(-30);
        }

        // 清理过去的天气预报计划
        weather.schedule = (weather.schedule || []).filter(s =>
            s.triggerDay >= this.state.totalDays
        );

        // 清理事件日志
        if (this.state.eventLog && this.state.eventLog.length > 50) {
            this.state.eventLog = this.state.eventLog.slice(-50);
        }

        console.log('[ContextCompressor] 天气历史统计已生成:', stats.extremeEvents.length, '个极端事件');
    }

    /** G3: 生成村庄季末编年史 */
    async generateChronicle() {
        if (!this.state.chronicles) this.state.chronicles = [];

        const villagerNames = this.state.villagers.map(v => v.name).join('、');
        const buildingCount = this.state.buildings.length;
        const plotCount = this.state.plots.length;
        const gold = this.state.resources.gold;
        const food = this.state.resources.food;
        const prosperity = this.state.prosperity || 0;

        // 收集本季重要事件
        const recentLogs = (this.state.eventLog || []).slice(-20);
        const importantLogs = recentLogs
            .filter(l => l.level === 'success' || l.level === 'danger' || l.level === 'warning')
            .map(l => `${l.icon} ${l.text}`)
            .slice(0, 10);

        let chronicle = '';

        if (this.ai.enabled) {
            const prompt = `请为村庄经营游戏编写一段简短的季末编年史（50-100字）。

## 村庄信息
- 季节：${this.state.seasonName}（第${this.state.time.year}年）
- 村民：${villagerNames}（共${this.state.villagers.length}人）
- 建筑：${buildingCount}座，农田：${plotCount}块
- 金币：${gold}💰，粮食：${food}🌾
- 繁荣度：${prosperity}/100

## 本季施行政策
${this.getPolicyBrief()}

## 本季重要事件
${importantLogs.join('\n') || '平安无事'}

## 要求
- 用简短古风叙事风格
- 像史书一样客观记录
- 50-100字
- 直接输出文本`;

            const result = await this.ai.chatRaw(prompt, { temperature: 0.7, maxTokens: 200 });
            if (result) {
                chronicle = result;
            }
        }

        // 降级：自动生成
        if (!chronicle) {
            chronicle = `${this.state.seasonName}（第${this.state.time.year}年）：桃源村有村民${this.state.villagers.length}人，建筑${buildingCount}座，农田${plotCount}块。金库${gold}金，粮仓${food}石。繁荣度${prosperity}。`;
        }

        this.state.chronicles.push({
            season: this.state.seasonName,
            year: this.state.time.year,
            text: chronicle,
        });

        // 最多保留8个季度编年史
        if (this.state.chronicles.length > 8) {
            this.state.chronicles.shift();
        }

        this.state.addLog('📜', `季末编年史：${chronicle}`, 'info');
        console.log(`[ContextCompressor] 村庄编年史: ${chronicle}`);
    }

    /** 获取当前政策的简短描述（用于编年史/压缩 prompt） */
    getPolicyBrief() {
        const policies = this.state.policies;
        if (!policies) return '无特殊政策';

        const parts = [];
        const wh = WORK_HOURS_POLICIES[policies.workHours];
        if (wh) parts.push(`工时${wh.name}`);

        const dist = DISTRIBUTION_POLICIES[policies.distribution];
        if (dist) parts.push(`分配${dist.name}`);

        const rwd = REWARD_POLICIES[policies.reward];
        if (rwd) parts.push(`奖惩${rwd.name}`);

        const hol = HOLIDAY_POLICIES[policies.holiday];
        if (hol) parts.push(`休假${hol.name}`);

        return parts.join('，') || '无特殊政策';
    }
}
