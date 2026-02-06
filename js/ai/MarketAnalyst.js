/**
 * MarketAnalyst - AI 市场分析师
 * 6:00 早报：今日物价走势预测与买卖建议
 * 16:00 晚报：今日交易回顾与玩家操作点评（表扬/嘲讽）
 */
import { MARKET_ITEMS } from '../config/marketItems.js';
import { SPECIAL_WEATHER_EVENTS } from '../config/weather.js';
import { MARKET_OPEN_HOUR, MARKET_CLOSE_HOUR } from '../market/MarketEngine.js';

export class MarketAnalyst {
    constructor(aiService, gameState, eventBus, marketEngine) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;
        this.market = marketEngine;

        // 监听 tick
        this.bus.on('tick', (data) => {
            if (data.hour === 6) {
                this.generateMorningReport();
            }
            if (data.hour === 16) {
                this.generateEveningReport();
            }
        });
    }

    // ===== 早报（6:00）：走势预测 =====

    /** 生成早报 */
    async generateMorningReport() {
        console.log('[MarketAnalyst] 生成早报...');

        const prompt = this.buildMorningPrompt();
        const result = await this.ai.chat(prompt, { temperature: 0.8, maxTokens: 400 });

        if (result && result.broadcast) {
            this.state.market.dailyReport = result;
            this.state.market.morningReport = result;
            this.updateBroadcast(`☀️ 早报 | ${result.broadcast}`);

            // 市场早报不自动暂停（后台AI调用不影响游戏流程）
            console.log('[MarketAnalyst] 早报生成成功');
        } else {
            const fallback = this.getMorningFallback();
            this.state.market.dailyReport = fallback;
            this.state.market.morningReport = fallback;
            this.updateBroadcast(`☀️ 早报 | ${fallback.broadcast}`);
            console.log('[MarketAnalyst] 使用降级早报');
        }
    }

    /** 早报 Prompt */
    buildMorningPrompt() {
        const priceInfo = [];
        Object.entries(MARKET_ITEMS).forEach(([id, config]) => {
            if (config.category === 'seed') return;
            const price = this.market.getPrice(id);
            const trend = this.market.getTrend(id, 24);
            const trendStr = trend > 0.03 ? '↑涨' : trend < -0.03 ? '↓跌' : '→平';
            priceInfo.push(`${config.name}: ${price}💰(基准${config.basePrice}) ${trendStr}`);
        });

        let weatherInfo = '正常';
        const w = this.state.weather;
        if (w.activeEvent) {
            const evt = window.SPECIAL_WEATHER_EVENTS?.[w.activeEvent];
            weatherInfo = evt ? `${evt.icon} ${evt.name}（${evt.effectSummary}）` : '特殊天气';
        }

        let upcomingWeatherInfo = '未来无特殊天气预报';
        const schedule = this.state.weather.schedule || [];
        const futureEvents = schedule.filter(s => s.triggerDay > this.state.totalDays);
        if (futureEvents.length > 0) {
            upcomingWeatherInfo = futureEvents.slice(0, 3).map(s => {
                const evt = SPECIAL_WEATHER_EVENTS[s.eventId];
                if (!evt) return '';
                const daysUntil = s.triggerDay - this.state.totalDays;
                return `${daysUntil}天后: ${evt.icon}${evt.name}（${evt.effectSummary}）`;
            }).filter(Boolean).join('\n');
        }

        return `# 任务：生成今日市场早报
你是村庄经营游戏中的AI市场分析师。现在是早上6:00，市场${MARKET_OPEN_HOUR}:00开门。
请分析今日物价走势并给出买卖建议。

## 今日数据
- 季节：${this.state.seasonName}
- 天气：${weatherInfo}
- 粮食库存：${this.state.resources.food}
- 各商品价格与走势：
${priceInfo.join('\n')}

## 未来天气预报
${upcomingWeatherInfo}

## 要求
1. 口语化、简短（50字以内）
2. 重点分析2-3种商品的今日走势预测
3. 给出明确买入/卖出/持有建议
4. 提醒市场${MARKET_OPEN_HOUR}:00-${MARKET_CLOSE_HOUR}:00开放

# 输出格式（严格JSON）
\`\`\`json
{
  "broadcast": "简报主播报（口语化，50字以内）",
  "highlights": [
    { "item": "商品名", "action": "buy|sell|hold", "reason": "原因" }
  ],
  "weatherImpact": "天气对市场的简要影响"
}
\`\`\``;
    }

    /** 早报降级 */
    getMorningFallback() {
        let maxRise = { id: null, trend: 0 };
        let maxFall = { id: null, trend: 0 };

        Object.entries(MARKET_ITEMS).forEach(([id, config]) => {
            if (config.category === 'seed') return;
            const trend = this.market.getTrend(id, 24);
            if (trend > maxRise.trend) maxRise = { id, name: config.name, trend };
            if (trend < maxFall.trend) maxFall = { id, name: config.name, trend };
        });

        let broadcast = `今日市场平稳，${MARKET_OPEN_HOUR}:00开门~`;
        if (maxRise.trend > 0.05) {
            broadcast = `${maxRise.name}持续走高，有货赶紧${MARKET_OPEN_HOUR}点来卖！`;
        } else if (maxFall.trend < -0.05) {
            broadcast = `${maxFall.name}跌了不少，可以趁低价买入~`;
        }

        return { broadcast, highlights: [], weatherImpact: '天气正常' };
    }

    // ===== 晚报（16:00）：交易回顾与点评 =====

    /** 生成晚报 */
    async generateEveningReport() {
        console.log('[MarketAnalyst] 生成晚报...');

        const prompt = this.buildEveningPrompt();
        const result = await this.ai.chat(prompt, { temperature: 0.9, maxTokens: 500 });

        if (result && result.broadcast) {
            this.state.market.eveningReport = result;
            this.updateBroadcast(`🌙 晚报 | ${result.broadcast}`);

            this.state.addLog('📻', `市场晚报：${result.broadcast}`, 'info');
            if (result.playerComment) {
                this.state.addLog('🧠', `分析师点评：${result.playerComment}`, result.playerRating === 'good' ? 'success' : result.playerRating === 'bad' ? 'warning' : 'info');
            }

            console.log('[MarketAnalyst] 晚报生成成功');
        } else {
            const fallback = this.getEveningFallback();
            this.state.market.eveningReport = fallback;
            this.updateBroadcast(`🌙 晚报 | ${fallback.broadcast}`);
            console.log('[MarketAnalyst] 使用降级晚报');
        }
    }

    /** 晚报 Prompt */
    buildEveningPrompt() {
        const priceInfo = [];
        Object.entries(MARKET_ITEMS).forEach(([id, config]) => {
            if (config.category === 'seed') return;
            const price = this.market.getPrice(id);
            const trend = this.market.getTrend(id, 24);
            const trendStr = trend > 0.03 ? '↑涨' : trend < -0.03 ? '↓跌' : '→平';
            priceInfo.push(`${config.name}: ${price}💰(基准${config.basePrice}) ${trendStr}`);
        });

        // 获取今日玩家交易记录
        const todayTrades = this.market.recentTrades.filter(t => {
            // 过去24小时内的交易
            return (Date.now() - t.time) < 24 * 60 * 60 * 1000;
        });
        let tradesDesc = '今日无交易记录';
        if (todayTrades.length > 0) {
            tradesDesc = todayTrades.map(t =>
                `${t.isBuy ? '买入' : '卖出'} ${t.quantity}个${t.itemName} @${t.price}💰 (基准${t.basePrice}💰, 偏离${Math.round(t.deviation * 100)}%)`
            ).join('\n');
        }

        return `# 任务：生成市场晚报
你是村庄经营游戏中的AI市场分析师，性格毒舌但专业。现在是16:00，市场刚关门。
请回顾今日市场情况并点评玩家的交易操作。

## 今日市场数据
- 季节：${this.state.seasonName}
- 各商品收盘价与走势：
${priceInfo.join('\n')}

## 玩家今日交易记录
${tradesDesc}

## 要求
1. 先用50字内概括今日市场走势
2. 如果玩家有交易记录，要给出点评：
   - 交易精明（低买高卖/抓准时机）→ 用夸张的表扬语气
   - 交易一般 → 给出中性评价
   - 交易很亏（高买低卖/逆势操作）→ 用毒舌嘲讽语气
3. 如果没有交易 → 嘲讽玩家"今天连市场都不去"
4. 给出明日展望

# 输出格式（严格JSON）
\`\`\`json
{
  "broadcast": "晚报主播报（口语化，50字以内）",
  "playerComment": "对玩家交易的点评（2-3句，有表扬或嘲讽）",
  "playerRating": "good 或 neutral 或 bad",
  "tomorrowOutlook": "明日市场展望（1句话）"
}
\`\`\``;
    }

    /** 晚报降级 */
    getEveningFallback() {
        const todayTrades = this.market.recentTrades.filter(t => (Date.now() - t.time) < 24 * 60 * 60 * 1000);

        let playerComment = '';
        let playerRating = 'neutral';
        if (todayTrades.length === 0) {
            playerComment = '今天一笔交易都没做？村长大人，您是在度假吗？';
            playerRating = 'bad';
        } else {
            const avgDeviation = todayTrades.reduce((s, t) => {
                return s + (t.isBuy ? -t.deviation : t.deviation);
            }, 0) / todayTrades.length;

            if (avgDeviation > 0.05) {
                playerComment = '今天的交易不错，赚了点差价，继续保持！';
                playerRating = 'good';
            } else if (avgDeviation < -0.05) {
                playerComment = '今天的操作……怎么说呢，建议明天先看看行情再动手。';
                playerRating = 'bad';
            } else {
                playerComment = '今天的交易中规中矩，没亏但也没赚多少。';
                playerRating = 'neutral';
            }
        }

        return {
            broadcast: '今日市场已收盘，各商品价格波动不大。',
            playerComment,
            playerRating,
            tomorrowOutlook: '明日市场预计平稳运行。',
        };
    }

    /** 更新简报UI */
    updateBroadcast(text) {
        const el = document.getElementById('market-broadcast');
        if (el) {
            el.innerHTML = `<span class="broadcast-icon">📻</span><span>${text}</span>`;
        }
    }
}
