/**
 * WeatherSystem - 天气系统
 * 管理季节默认天气 + 特殊天气事件
 * AI 预测由 WeatherForecaster（AI层）处理，本模块负责状态管理和效果应用
 */
import { SEASON_DEFAULT, SPECIAL_WEATHER_EVENTS, getSeasonEvents } from '../config/weather.js';

export class WeatherSystem {
    constructor(gameState, eventBus, aiService) {
        this.state = gameState;
        this.bus = eventBus;
        this.ai = aiService;

        this.bus.on('newDay', (data) => this.onNewDay(data));
        this.bus.on('seasonChange', (data) => this.onSeasonChange(data));
    }

    /** 初始化天气系统 */
    init() {
        this.state.weather.current = 'spring_default';
        this.state.weather.activeEvent = null;
        this.state.weather.activeEventRemaining = 0;
        this.state.weather.schedule = [];
        this.state.weather.lastEventEndDay = -5;
    }

    /** 获取当前天气效果 */
    getCurrentEffects() {
        if (this.state.weather.activeEvent) {
            return SPECIAL_WEATHER_EVENTS[this.state.weather.activeEvent] || SEASON_DEFAULT[this.state.season];
        }
        return SEASON_DEFAULT[this.state.season] || SEASON_DEFAULT.spring;
    }

    /** 获取当前天气显示名 */
    getCurrentWeatherName() {
        if (this.state.weather.activeEvent) {
            const e = SPECIAL_WEATHER_EVENTS[this.state.weather.activeEvent];
            if (e) return `${e.icon} ${e.name}（还剩${this.state.weather.activeEventRemaining}天）`;
        }
        const d = SEASON_DEFAULT[this.state.season];
        return d ? `${d.icon} ${d.name}` : '🌸 和风';
    }

    /** 每日更新 */
    onNewDay(data) {
        const w = this.state.weather;

        // 1. 特殊天气倒计时
        if (w.activeEvent) {
            w.activeEventRemaining--;
            if (w.activeEventRemaining <= 0) {
                const ended = SPECIAL_WEATHER_EVENTS[w.activeEvent];
                w.lastEventEndDay = this.state.totalDays;
                w.activeEvent = null;
                w.activeEventRemaining = 0;

                this.state.addLog(ended?.icon || '🌤️', `${ended?.name || '特殊天气'}结束了`, 'info');
                this.bus.emit('weatherEventEnd', { event: ended });
                this.bus.emit('weatherChanged', { weather: SEASON_DEFAULT[this.state.season] });
            }
        }

        // 2. 检查今天是否有预定的特殊天气
        if (!w.activeEvent) {
            const today = this.state.totalDays;
            const scheduled = w.schedule.find(s => s.triggerDay === today);

            if (scheduled) {
                const evt = SPECIAL_WEATHER_EVENTS[scheduled.eventId];
                if (evt && (today - w.lastEventEndDay >= 3)) {
                    w.activeEvent = scheduled.eventId;
                    w.activeEventRemaining = evt.duration;

                    this.state.addLog(evt.icon, `${evt.name}来袭！${evt.effectSummary}`, 'warning');
                    this.bus.emit('weatherEventStart', { event: evt });
                    this.bus.emit('weatherChanged', { weather: evt, isSpecial: true });
                    this.bus.emit('showToast', { message: `${evt.icon} ${evt.name}来袭！${evt.effectSummary}`, type: 'warning' });
                }
            }
        }
    }

    /** 季节切换 */
    onSeasonChange(data) {
        this.state.weather.activeEvent = null;
        this.state.weather.activeEventRemaining = 0;
        this.state.weather.schedule = [];

        this.state.addLog('🌿', `${data.season === 'spring' ? '春' : data.season === 'summer' ? '夏' : data.season === 'autumn' ? '秋' : '冬'}季到来了`, 'info');
        this.bus.emit('weatherChanged', { weather: SEASON_DEFAULT[data.season] });
    }

    /**
     * 设置天气预测时间表（由 AI 模块调用）
     * @param {Array} predictions - [{eventId, triggerDay, reason}]
     */
    setSchedule(predictions) {
        // 验证硬约束
        const season = this.state.season;
        const seasonEventIds = getSeasonEvents(season).map(e => e.id);
        const valid = [];
        let lastDay = this.state.weather.lastEventEndDay;

        for (const p of predictions.slice(0, 2)) {
            if (!seasonEventIds.includes(p.eventId)) continue;
            if (p.triggerDay < this.state.totalDays + 1) continue;
            if (p.triggerDay > this.state.totalDays + 10) continue; // 最多10天内（适配9天季节）
            if (p.triggerDay - lastDay < 3) continue; // 间隔至少3天（从5天改为3天适配短季节）

            valid.push(p);
            lastDay = p.triggerDay + (SPECIAL_WEATHER_EVENTS[p.eventId]?.duration || 1);
        }

        // 合并而非覆盖：保留尚未触发的已有预测
        const existingFuture = this.state.weather.schedule.filter(s => s.triggerDay > this.state.totalDays);
        const newIds = valid.map(v => v.eventId);
        const merged = existingFuture.filter(s => !newIds.includes(s.eventId)).concat(valid);
        this.state.weather.schedule = merged.sort((a, b) => a.triggerDay - b.triggerDay);

        console.log('[WeatherSystem] 天气预测更新:', this.state.weather.schedule.length, '个事件');
    }

    /** 降级预测（AI不可用时） */
    fallbackPrediction() {
        const seasonEvents = getSeasonEvents(this.state.season);
        if (seasonEvents.length === 0) return;

        const pick = seasonEvents[Math.floor(Math.random() * seasonEvents.length)];
        const triggerDay = this.state.totalDays + 2 + Math.floor(Math.random() * 4); // 2-5天内

        // 同样用合并方式
        const existing = this.state.weather.schedule.filter(s => s.triggerDay > this.state.totalDays);
        existing.push({
            eventId: pick.id,
            triggerDay,
            reason: '天气系统预判',
        });
        this.state.weather.schedule = existing.sort((a, b) => a.triggerDay - b.triggerDay);
    }
}
