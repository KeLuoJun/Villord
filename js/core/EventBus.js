/**
 * EventBus - 全局事件总线（发布/订阅模式）
 * 用于解耦各系统之间的通信
 */
export class EventBus {
    constructor() {
        this.listeners = {};
    }

    /**
     * 注册事件监听
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     */
    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    /**
     * 移除事件监听
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     */
    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    /**
     * 发布事件
     * @param {string} event - 事件名
     * @param {*} data - 事件数据
     */
    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(cb => {
            try {
                cb(data);
            } catch (err) {
                console.error(`[EventBus] 事件 "${event}" 处理出错:`, err);
            }
        });
    }

    /**
     * 注册一次性事件监听（触发一次后自动移除）
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     */
    once(event, callback) {
        const wrapper = (data) => {
            callback(data);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
    }
}

// 全局单例
export const eventBus = new EventBus();
