/**
 * SoundManager - 游戏音效管理器
 * 负责加载、播放、音量控制所有短音效（SFX）
 * 使用 Audio 对象池避免重叠播放问题
 */
export class SoundManager {
    /**
     * @param {object} options
     * @param {number} [options.volume=60]  - 初始音量 0-100
     * @param {boolean} [options.muted=false] - 是否静音
     * @param {number} [options.poolSize=4]  - 每个音效的对象池大小
     */
    constructor(options = {}) {
        this.volume = options.volume ?? 60;
        this.muted = options.muted ?? false;
        this.poolSize = options.poolSize ?? 4;

        /** @type {Map<string, HTMLAudioElement[]>} 音效对象池 */
        this._pools = new Map();

        /** @type {Map<string, string>} 音效名 → 文件路径 */
        this._registry = new Map();

        // 从 localStorage 恢复偏好
        const savedVol = localStorage.getItem('villord_sfx_volume');
        const savedMuted = localStorage.getItem('villord_sfx_muted');
        if (savedVol !== null) this.volume = parseInt(savedVol, 10);
        if (savedMuted !== null) this.muted = savedMuted === 'true';
    }

    /**
     * 注册一个音效
     * @param {string} name - 音效名（如 'click'）
     * @param {string} path - 文件路径（如 './assets/sounds/click.mp3'）
     */
    register(name, path) {
        this._registry.set(name, path);
        // 预创建对象池
        const pool = [];
        for (let i = 0; i < this.poolSize; i++) {
            const audio = new Audio(path);
            audio.preload = 'auto';
            audio.volume = this.volume / 100;
            pool.push(audio);
        }
        this._pools.set(name, pool);
    }

    /**
     * 批量注册音效
     * @param {Record<string, string>} map - { name: path, ... }
     */
    registerAll(map) {
        for (const [name, path] of Object.entries(map)) {
            this.register(name, path);
        }
    }

    /**
     * 播放音效
     * @param {string} name - 已注册的音效名
     */
    play(name) {
        if (this.muted) return;

        const pool = this._pools.get(name);
        if (!pool) {
            console.warn(`[SoundManager] 未注册的音效: ${name}`);
            return;
        }

        // 从池中找一个空闲（已结束或未播放）的 Audio
        const audio = pool.find(a => a.paused || a.ended) || pool[0];
        audio.volume = this.volume / 100;
        audio.currentTime = 0;
        audio.play().catch(() => {
            // 浏览器可能阻止播放，静默忽略
        });
    }

    /**
     * 设置音量
     * @param {number} val - 0-100
     */
    setVolume(val) {
        this.volume = Math.max(0, Math.min(100, Math.round(val)));
        localStorage.setItem('villord_sfx_volume', this.volume);

        // 自动取消静音
        if (this.volume > 0 && this.muted) {
            this.muted = false;
            localStorage.setItem('villord_sfx_muted', 'false');
        }
        if (this.volume === 0) {
            this.muted = true;
            localStorage.setItem('villord_sfx_muted', 'true');
        }

        // 更新所有池中的音量
        for (const pool of this._pools.values()) {
            for (const audio of pool) {
                audio.volume = this.volume / 100;
            }
        }
    }

    /** 切换静音 */
    toggleMute() {
        this.muted = !this.muted;
        localStorage.setItem('villord_sfx_muted', String(this.muted));
    }

    /** 获取当前音量 */
    getVolume() {
        return this.volume;
    }

    /** 获取静音状态 */
    isMuted() {
        return this.muted;
    }
}
