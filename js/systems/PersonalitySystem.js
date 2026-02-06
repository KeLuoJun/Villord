/**
 * PersonalitySystem - 完整性格系统
 * 处理执行偏差、村民自主行为、性格对调度的影响
 */
import { MAX_MOOD } from '../config/villagers.js';

const MOOD_REBEL_THRESHOLD = Math.round(MAX_MOOD * 0.4); // 20 -> 8
const MOOD_GOOD_THRESHOLD = Math.round(MAX_MOOD * 0.7);  // 20 -> 14
const MOOD_LOW_THRESHOLD = Math.round(MAX_MOOD * 0.4);   // 20 -> 8

export class PersonalitySystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        this.bus.on('tick', (data) => this.onTick(data));
    }

    /** 每 Tick 检查性格驱动行为 */
    onTick(data) {
        this.state.villagers.forEach(villager => {
            // 只在有任务时检查偏差
            if (villager.currentTask) {
                this.checkExecutionDeviation(villager, data);
            }

            // 自主行为检查（空闲时）
            if (!villager.currentTask || villager.currentAction?.includes('空闲')) {
                this.checkAutonomousBehavior(villager, data);
            }
        });
    }

    /**
     * 执行偏差系统
     * 根据性格特征，村民在执行任务时可能出偏差
     */
    checkExecutionDeviation(villager, data) {
        const task = villager.currentTask;
        if (!task) return;

        // 懒惰：拖延（20%概率本小时不干活）
        if (villager.traits.includes('懒惰') && Math.random() < 0.2) {
            villager.currentAction = '🚶 在磨洋工...';
            return;
        }

        // 愚笨：做错事（15%概率执行错误行动）
        if (villager.traits.includes('愚笨') && Math.random() < 0.15) {
            const wrongActions = ['idle', 'water', 'plant'];
            const wrong = wrongActions[Math.floor(Math.random() * wrongActions.length)];
            if (wrong !== task.action) {
                this.state.addLog('😅', `${villager.name}搞错了，明明应该${task.action}却在${wrong}`, 'warning');
            }
        }

        // 叛逆：拒绝执行（心情<40时10%概率拒绝）— E: 触发自动暂停
        if (villager.traits.includes('叛逆') && villager.mood < MOOD_REBEL_THRESHOLD && Math.random() < 0.1) {
            villager.currentAction = '😤 拒绝干活';
            this.state.addLog('😤', `${villager.name}拒绝执行任务："我不想干了！"`, 'warning');
            this.bus.emit('autoPause', { reason: `[村民] ${villager.name}拒绝执行任务` });
            return;
        }

        // 体弱：半途而废（体力<20%时30%概率中断）
        if (villager.traits.includes('体弱') && villager.stamina < villager.maxStamina * 0.2) {
            if (Math.random() < 0.3) {
                villager.currentAction = '💤 累瘫了';
                villager.currentTask = null;
                this.state.addLog('💫', `${villager.name}体力不支，停下来休息了`, 'info');
            }
        }
    }

    /**
     * 自主行为系统
     * 空闲时村民根据性格自发行动
     */
    checkAutonomousBehavior(villager, data) {
        // 每小时只有20%概率触发自主行为
        if (Math.random() > 0.2) return;

        const behaviors = [];

        // 勤劳：主动干活
        if (villager.traits.includes('勤劳') && villager.maxStamina && (villager.stamina / villager.maxStamina) > 0.6) {
            behaviors.push({
                action: '主动干活',
                weight: 3,
                execute: () => {
                    // 找需要浇水的农田
                    const plot = this.state.plots.find(p => p.crop && !p.watered);
                    if (plot) {
                        villager.currentAction = '💧 主动浇水';
                        this.state.addLog('💪', `${villager.name}闲不住，主动去浇水了`, 'info');
                    }
                },
            });
        }

        // 懒惰：闲逛
        if (villager.traits.includes('懒惰')) {
            behaviors.push({
                action: '闲逛',
                weight: 4,
                execute: () => {
                    villager.currentAction = '🚶 在村里闲逛';
                    villager.mood = Math.min(MAX_MOOD, villager.mood + 1);
                },
            });
        }

        // 乐观：提建议 / 帮同伴 — E: 触发自动暂停（村民主动发起对话）
        if (villager.traits.includes('乐观') && villager.mood >= MOOD_GOOD_THRESHOLD) {
            behaviors.push({
                action: '帮同伴',
                weight: 2,
                execute: () => {
                    const others = this.state.villagers.filter(v => v.id !== villager.id && v.mood < MOOD_LOW_THRESHOLD);
                    if (others.length > 0) {
                        const target = others[0];
                        target.mood = Math.min(MAX_MOOD, target.mood + 1);
                        villager.currentAction = `💬 安慰${target.name}`;
                        this.state.addLog('😊', `${villager.name}主动安慰了${target.name}`, 'info');
                    }
                },
            });
        }

        // 悲观：抱怨
        if (villager.traits.includes('悲观') && villager.mood < MOOD_LOW_THRESHOLD) {
            behaviors.push({
                action: '抱怨',
                weight: 3,
                execute: () => {
                    villager.currentAction = '😮‍💨 在抱怨';
                    // 影响附近村民心情
                    this.state.villagers.forEach(v => {
                        if (v.id !== villager.id) {
                            v.mood = Math.max(0, v.mood - 1);
                        }
                    });
                },
            });
        }

        // 聪明：提建议
        if (villager.traits.includes('聪明')) {
            behaviors.push({
                action: '思考',
                weight: 2,
                execute: () => {
                    villager.currentAction = '🤔 在思考';
                },
            });
        }

        // 通用：休息
        if (villager.stamina < villager.maxStamina * 0.5) {
            behaviors.push({
                action: '休息',
                weight: 3,
                execute: () => {
                    villager.currentAction = '💤 自行休息';
                    villager.stamina = Math.min(villager.maxStamina, villager.stamina + 3);
                },
            });
        }

        // 加权随机选择
        if (behaviors.length === 0) return;
        const totalWeight = behaviors.reduce((sum, b) => sum + b.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const behavior of behaviors) {
            roll -= behavior.weight;
            if (roll <= 0) {
                behavior.execute();
                return;
            }
        }
    }
}
