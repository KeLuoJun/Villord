/**
 * MarketAnalyst - AI 市场分析师
 * 每日清晨 6:00 生成市场简报
 */
import { MARKET_ITEMS } from '../config/marketItems.js';
import { SPECIAL_WEATHER_EVENTS } from '../config/weather.js';

export class MarketAnalyst {
    constructor(aiService, gameState, eventBus, marketEngine) {
        this.ai = aiService;
        this.state = gameState;
        this.bus = eventBus;
        this.market = marketEngine;

        // 监听 tick，在6:00触发
        this.bus.on('tick', (data) => {
            if (data.hour === 6) {
                this.generateReport();
            }
        });
    }

    /** 生成每日市场简报 */
    async generateReport() {
        console.log('[MarketAnalyst] 开始生成市场简报...');

        const prompt = this.buildPrompt();

        // AI LOGIC - 生成简报
        const result = await this.ai.chat(prompt, { temperature: 0.8, maxTokens: 400 });

        if (result && result.broadcast) {
            this.state.market.dailyReport = result;
            this.updateBroadcast(result.broadcast);

            // 只有在极端市场变化时暂停（减少频繁暂停）
            const hasExtreme = (result.highlights || []).some(h => {
                const reason = (h.reason || '').toLowerCase();
                return reason.includes('暴') || reason.includes('崩') || reason.includes('急');
            });
            if (hasExtreme && result.weatherImpact && result.weatherImpact !== '天气正常，暂无特殊影响') {
                this.bus.emit('autoPause', { reason: `[市场] ${result.broadcast}` });
            }

            console.log('[MarketAnalyst] 简报生成成功');
        } else {
            // 降级
            const fallback = this.getFallbackReport();
            this.state.market.dailyReport = fallback;
            this.updateBroadcast(fallback.broadcast);
            console.log('[MarketAnalyst] 使用降级简报');
        }
    }

    /** 构建分析 Prompt */
    buildPrompt() {
        const priceInfo = [];
        Object.entries(MARKET_ITEMS).forEach(([id, config]) => {
            if (config.category === 'seed') return;
            const price = this.market.getPrice(id);
            const trend = this.market.getTrend(id, 24);
            const trendStr = trend > 0.03 ? '↑涨' : trend < -0.03 ? '↓跌' : '→平';
            priceInfo.push(`${config.name}: ${price}💰(基准${config.basePrice}) ${trendStr}`);
        });

        // 获取天气信息
        let weatherInfo = '正常';
        const w = this.state.weather;
        if (w.activeEvent) {
            const evt = window.SPECIAL_WEATHER_EVENTS?.[w.activeEvent];
            weatherInfo = evt ? `${evt.icon} ${evt.name}（${evt.effectSummary}）` : '特殊天气';
        }

        // D2: 添加14天天气预报对市场的影响
        let upcomingWeatherInfo = '未来无特殊天气预报';
        const schedule = this.state.weather.schedule || [];
        const futureEvents = schedule.filter(s => s.triggerDay > this.state.totalDays);
        if (futureEvents.length > 0) {
            upcomingWeatherInfo = futureEvents.map(s => {
                const evt = SPECIAL_WEATHER_EVENTS[s.eventId];
                if (!evt) return '';
                const daysUntil = s.triggerDay - this.state.totalDays;
                return `${daysUntil}天后: ${evt.icon}${evt.name}（${evt.effectSummary}）`;
            }).filter(Boolean).join('\n');
        }

        return `# 任务：生成今日市场简报
你是村庄经营游戏中的AI市场分析师，需要生成一段口语化的市场简报。

## 今日数据
- 季节：${this.state.seasonName}
- 天气：${weatherInfo}
- 粮食库存：${this.state.resources.food}
- 各商品价格与走势：
${priceInfo.join('\n')}

## 未来天气预报（可能影响市场）
${upcomingWeatherInfo}

## 要求
1. 口语化、简短（50字以内主播报）
2. 只提2-3种最值得关注的商品
3. 给出买入或卖出建议
4. 分析天气对市场的影响（含即将到来的特殊天气）

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

    /** 降级简报 */
    getFallbackReport() {
        // 找涨幅/跌幅最大的商品
        let maxRise = { id: null, trend: 0 };
        let maxFall = { id: null, trend: 0 };

        Object.entries(MARKET_ITEMS).forEach(([id, config]) => {
            if (config.category === 'seed') return;
            const trend = this.market.getTrend(id, 24);
            if (trend > maxRise.trend) maxRise = { id, name: config.name, trend };
            if (trend < maxFall.trend) maxFall = { id, name: config.name, trend };
        });

        let broadcast = '📻 今日市场平稳运行，暂无特别推荐~';

        if (maxRise.trend > 0.05) {
            broadcast = `📻 ${maxRise.name}价格持续走高，有货的可以考虑出手！`;
        } else if (maxFall.trend < -0.05) {
            broadcast = `📻 ${maxFall.name}价格下跌中，可以趁低价买入~`;
        }

        return {
            broadcast,
            highlights: [],
            weatherImpact: '天气正常，暂无特殊影响',
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
