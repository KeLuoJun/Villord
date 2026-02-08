/**
 * MarketAnalyst - AI 市场分析师
 * 5:00 早报：今日物价走势预测与买卖建议
 * 19:00 晚报：今日交易回顾与玩家操作点评（表扬/嘲讽）
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

        this._isGeneratingMorning = false;

        // 监听 tick
        this.bus.on('tick', (data) => {
            if (data.hour === 5) {
                this._isGeneratingMorning = true;
                this.generateMorningReport().finally(() => { this._isGeneratingMorning = false; });
            }
            // Deadline 检查：如果 7:00 了早报还没生成完，暂停等待（因为 7:00 要生成村民计划依赖早报）
            if (data.hour === 7 && this._isGeneratingMorning) {
                this.bus.emit('aiPauseGame', { reason: '市场早报仍在生成中，等待完成...' });
                this.bus.emit('showToast', { message: '⏳ 市场早报尚未生成完毕，暂停等待...', type: 'warning' });
            }
            if (data.hour === 19) {
                this.generateEveningReport(); // 晚报是非关键调用，不暂停
            }
        });
    }

    // ===== 早报（5:00）：走势预测 =====

    /** 生成早报（关键调用：07:00 前生成村民计划需要依赖早报） */
    async generateMorningReport() {
        console.log('[MarketAnalyst] 生成早报...');

        const prompt = this.buildMorningPrompt();
        const result = await this.ai.criticalChat(prompt, { temperature: 0.8, maxTokens: 600 }, {
            label: '☀️ 市场早报',
        });

        if (result && result.broadcast) {
            this.state.market.dailyReport = result;
            this.state.market.morningReport = result;
            this.updateBroadcast(`☀️ 早报 | ${result.broadcast}`);
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
            const deviation = price / config.basePrice - 1;
            const trendStr = trend > 0.03 ? '📈涨' : trend < -0.03 ? '📉跌' : '➡️平';
            const devStr = deviation > 0 ? `高于基准${Math.round(deviation * 100)}%` : deviation < 0 ? `低于基准${Math.round(Math.abs(deviation) * 100)}%` : '接近基准';
            priceInfo.push(`${config.name}: 当前${price}💰（基准${config.basePrice}💰，${devStr}），近期趋势${trendStr}`);
        });

        let weatherInfo = '正常天气';
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
            }).filter(Boolean).join('；');
        }

        return `你是村庄经营游戏《治村物语》的市场分析师。你专业、风趣、说话有分析师范儿。

现在是早上5:00，市场将在${MARKET_OPEN_HOUR}:00开门，${MARKET_CLOSE_HOUR}:00关门。请根据以下数据生成今日早间市场简报。

【今日数据】
季节：${this.state.seasonName}
天气：${weatherInfo}
未来天气：${upcomingWeatherInfo}
村庄金币：${this.state.resources.gold}💰，小麦：${this.state.inventory.wheat || 0}🌾

【各商品行情】
${priceInfo.join('\n')}

【你的任务】
写一段市场早报，包含：
1. broadcast：用一段话概括今日市场整体形势，80-120字左右，要有分析深度。指出哪些商品值得关注，给出买/卖/持有建议，简要说明原因。如果天气会影响市场，也提一下。语气像一个老练的股票分析师在做早间点评。
2. highlights：列出2-3种值得操作的商品及建议。
3. weatherImpact：天气对今日市场的影响预判。

请直接输出JSON：
{
  "broadcast": "今日市场早报正文（80-120字，专业分析+建议）",
  "highlights": [
    {"item": "商品名", "action": "buy或sell或hold", "reason": "简短原因"}
  ],
  "weatherImpact": "天气影响分析（1句话）"
}`;
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

    // ===== 晚报（19:00）：交易回顾与点评 =====

    /** 生成晚报 */
    async generateEveningReport() {
        console.log('[MarketAnalyst] 生成晚报...');

        const prompt = this.buildEveningPrompt();
        const result = await this.ai.chat(prompt, { temperature: 0.9, maxTokens: 700 });

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
            const deviation = price / config.basePrice - 1;
            const trendStr = trend > 0.03 ? '📈涨' : trend < -0.03 ? '📉跌' : '➡️平';
            priceInfo.push(`${config.name}: 收盘${price}💰（基准${config.basePrice}💰，偏离${deviation > 0 ? '+' : ''}${Math.round(deviation * 100)}%），今日${trendStr}`);
        });

        // 获取今日玩家交易记录
        const todayTrades = this.market.recentTrades.filter(t => {
            return (Date.now() - t.time) < 24 * 60 * 60 * 1000;
        });

        let tradesDesc = '【今日无任何交易记录】';
        let tradeAnalysis = '';
        if (todayTrades.length > 0) {
            tradesDesc = todayTrades.map(t => {
                const profitHint = t.isBuy
                    ? (t.deviation < -0.05 ? '✅低价买入' : t.deviation > 0.1 ? '⚠️高价买入' : '普通买入')
                    : (t.deviation > 0.05 ? '✅高价卖出' : t.deviation < -0.1 ? '⚠️低价卖出' : '普通卖出');
                return `${t.isBuy ? '🛒买入' : '💰卖出'} ${t.quantity}个${t.itemName} @${t.price}💰（基准${t.basePrice}💰，偏离${Math.round(t.deviation * 100)}%）${profitHint}`;
            }).join('\n');

            const goodTrades = todayTrades.filter(t => t.isBuy ? t.deviation < -0.05 : t.deviation > 0.05).length;
            const badTrades = todayTrades.filter(t => t.isBuy ? t.deviation > 0.1 : t.deviation < -0.1).length;
            tradeAnalysis = `共${todayTrades.length}笔交易，其中${goodTrades}笔精明操作，${badTrades}笔值得商榷。`;
        }

        return `你是《治村物语》的毒舌市场分析师。你专业过硬，但性格特别毒舌——看到好操作会极力吹捧，看到烂操作会疯狂嘲讽。

现在是19:00，市场刚关门。请做今日市场收盘总结和玩家操作点评。

【今日各商品收盘数据】
季节：${this.state.seasonName}
${priceInfo.join('\n')}

【玩家今日交易明细】
${tradesDesc}
${tradeAnalysis}

【你的任务】
1. broadcast：用80-120字概括今日市场走势，哪些商品涨了跌了，有什么值得注意的行情变化。
2. playerComment：根据玩家的交易记录给出2-3句犀利点评：
   - 如果操作精明（低买高卖）：用"不得不说"、"这波可以"之类夸张表扬，让人飘起来
   - 如果操作一般：中性评价，但带点"说你行也不太行"的语气
   - 如果操作很烂（高买低卖/追涨杀跌）：毒舌嘲讽，"这钱花得真潇洒"、"你是在做慈善吗"之类
   - 如果今天没做任何交易：嘲讽"市场都关门了你还没来过？钱放着会生锈的"之类
3. playerRating：good/neutral/bad
4. tomorrowOutlook：基于今日走势给出明日展望和建议（1-2句话）。

请直接输出JSON：
{
  "broadcast": "今日市场总结（80-120字，有数据有分析）",
  "playerComment": "对玩家交易的犀利点评（2-3句）",
  "playerRating": "good或neutral或bad",
  "tomorrowOutlook": "明日展望和建议（1-2句话）"
}`;
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
