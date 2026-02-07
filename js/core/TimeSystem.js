/**
 * TimeSystem - 时间系统
 * 管理游戏时间推进（Tick循环）、速度控制、日/季/年事件
 * 1 Tick = 游戏内 1 小时 = 现实 3 秒（1倍速）
 * 24 Tick = 1 天, 5 天 = 1 季, 4 季 = 1 年 (20天/年)
 * 倍速选项：0.5x / 1x / 1.5x
 */

// 速度配置：speed -> 毫秒间隔（1x = 3秒/Tick）
const SPEED_INTERVALS = {
    0.5: 6000,    // 0.5倍速：6秒/Tick
    1: 3000,      // 1倍速：3秒/Tick（默认）
    1.5: 2000,    // 1.5倍速：2秒/Tick
};

export const DAYS_PER_SEASON = 5;
export const SEASONS_PER_YEAR = 4;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS_PER_YEAR; // 20

const SEASON_IDS_LIST = ['spring', 'summer', 'autumn', 'winter'];

export class TimeSystem {
    /**
     * @param {object} gameState - GameState 引用
     * @param {import('./EventBus.js').EventBus} eventBus - 事件总线
     */
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;
        this.timer = null;
        this.BASE_INTERVAL = 3000; // 1x 速度下 3秒 = 1游戏小时
    }

    /** 启动时间循环 */
    start() {
        this.state.time.isPaused = false;
        this.scheduleNextTick();
        console.log('[TimeSystem] 时间系统启动');
    }

    /** 调度下一次 Tick */
    scheduleNextTick() {
        if (this.state.time.isPaused) return;

        const interval = this.BASE_INTERVAL / this.state.time.speed;
        this.timer = setTimeout(() => {
            this.tick();
            this.scheduleNextTick();
        }, interval);
    }

    /** 执行一次 Tick（推进1小时） */
    tick() {
        const time = this.state.time;
        time.totalTicks++;
        time.hour++;

        // 发射每小时事件
        this.bus.emit('tick', {
            hour: time.hour,
            day: time.day,
            month: time.month,
            year: time.year,
            totalTicks: time.totalTicks,
        });

        // 跨天
        if (time.hour >= 24) {
            time.hour = 0;
            time.day++;

            const oldMonth = time.month; // month 即季节序号 (1-4)

            // 跨季（每季5天）
            if (time.day > DAYS_PER_SEASON) {
                time.day = 1;
                time.month++;

                // 跨年（4季一年）
                if (time.month > SEASONS_PER_YEAR) {
                    time.month = 1;
                    time.year++;
                    this.bus.emit('newYear', { year: time.year });
                }

                // 季节变化
                const oldSeason = SEASON_IDS_LIST[(oldMonth - 1) % 4];
                const newSeason = SEASON_IDS_LIST[(time.month - 1) % 4];
                if (oldSeason !== newSeason) {
                    this.bus.emit('seasonChange', { season: newSeason, month: time.month });
                }

                this.bus.emit('newMonth', { month: time.month });
            }

            this.bus.emit('newDay', {
                day: time.day,
                month: time.month,
                year: time.year,
                totalDays: this.state.totalDays,
            });

            // 重置每日追踪
            this.state.resetDailyChanges();
        }
    }

    /** 暂停 */
    pause() {
        this.state.time.isPaused = true;
        clearTimeout(this.timer);
        this.timer = null;
        this.bus.emit('gamePaused', {});
    }

    /** 恢复 */
    resume() {
        if (!this.state.time.isPaused) return;
        this.state.time.isPaused = false;
        this.scheduleNextTick();
        this.bus.emit('gameResumed', {});
    }

    /** 切换暂停/恢复 */
    togglePause() {
        if (this.state.time.isPaused) {
            this.resume();
        } else {
            this.pause();
        }
    }

    /**
     * 设置游戏速度
     * @param {number} speed - 速度倍率（0.5/1/1.5）
     */
    setSpeed(speed) {
        if (!SPEED_INTERVALS[speed]) {
            console.warn(`[TimeSystem] 不支持的速度: ${speed}`);
            return;
        }
        this.state.time.speed = speed;
        clearTimeout(this.timer);
        this.timer = null;
        if (!this.state.time.isPaused) {
            this.scheduleNextTick();
        }
        this.bus.emit('speedChanged', { speed });
    }

    /** 获取当前时间的格式化字符串 */
    getTimeString() {
        const t = this.state.time;
        return `第${t.year}年·${this.state.seasonName} 第${t.day}天 ${String(t.hour).padStart(2, '0')}:00`;
    }

    /** 获取时段描述 */
    getTimeOfDay() {
        const hour = this.state.time.hour;
        if (hour >= 4 && hour < 6) return '凌晨';
        if (hour >= 6 && hour < 8) return '清晨';
        if (hour >= 8 && hour < 12) return '上午';
        if (hour >= 12 && hour < 14) return '午间';
        if (hour >= 14 && hour < 18) return '下午';
        if (hour >= 18 && hour < 21) return '傍晚';
        return '夜晚';
    }
}
