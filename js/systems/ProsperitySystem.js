/**
 * ProsperitySystem - 繁荣度系统
 * 繁荣度为累计制，可增可减，无上限（最低为0）
 * 分10个等级区间，达到相应等级可领取金币奖励
 * 每日根据村庄状态获得繁荣度增长，同时负面状态会导致繁荣度衰减
 * 衰减力度相对增长力度较小
 */
import { MAX_MOOD } from '../config/villagers.js';

// 繁荣度等级配置：10级
const PROSPERITY_LEVELS = [
    { level: 1,  name: '荒芜村落',   threshold: 0,    reward: 0,    icon: '🏚️' },
    { level: 2,  name: '初建小村',   threshold: 20,   reward: 50,   icon: '🏠' },
    { level: 3,  name: '安宁村庄',   threshold: 60,   reward: 100,  icon: '🏡' },
    { level: 4,  name: '朝气小镇',   threshold: 120,  reward: 200,  icon: '🌱' },
    { level: 5,  name: '繁忙集市',   threshold: 200,  reward: 300,  icon: '🛒' },
    { level: 6,  name: '富饶之地',   threshold: 300,  reward: 500,  icon: '🌾' },
    { level: 7,  name: '兴旺村镇',   threshold: 450,  reward: 800,  icon: '🏘️' },
    { level: 8,  name: '锦绣乡里',   threshold: 650,  reward: 1200, icon: '🌸' },
    { level: 9,  name: '四海升平',   threshold: 900,  reward: 2000, icon: '🏛️' },
    { level: 10, name: '传说桃源',   threshold: 1200, reward: 3000, icon: '👑' },
];

export { PROSPERITY_LEVELS };

const MOOD_BONUS_THRESHOLD_1 = Math.round(MAX_MOOD * 0.6); // 10 -> 6
const MOOD_BONUS_THRESHOLD_2 = Math.round(MAX_MOOD * 0.8); // 10 -> 8
const MOOD_DECAY_THRESHOLD_1 = Math.round(MAX_MOOD * 0.3); // 10 -> 3
const MOOD_DECAY_THRESHOLD_2 = Math.max(1, Math.round(MAX_MOOD * 0.15)); // 10 -> 2

export class ProsperitySystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        // 初始化繁荣度状态（如果存档中没有）
        if (!this.state.prosperityData) {
            this.state.prosperityData = {
                total: 0,               // 累计繁荣度
                claimedLevels: [],       // 已领取奖励的等级列表
                todayGain: 0,            // 今日获得（增长量）
                todayDecay: 0,           // 今日衰减量
                todayNet: 0,             // 今日净变化
            };
        }

        this.bus.on('newDay', () => this.dailyProsperityUpdate());
        this.bus.on('seasonChange', () => this.seasonReview());

        // 特殊事件加成
        this.bus.on('buildingBuilt', () => this.addBonus(5, '建造新建筑'));
        this.bus.on('villagerRecruited', () => this.addBonus(10, '招募新村民'));
        this.bus.on('cropHarvested', () => this.addBonus(2, '收获作物'));

        // 特殊事件扣减
        this.bus.on('villagerLeft', () => this.addPenalty(5, '村民离开'));
        this.bus.on('cropWithered', () => this.addPenalty(1, '作物枯萎'));
    }

    /** 每日繁荣度更新（增长 + 衰减） */
    dailyProsperityUpdate() {
        const data = this.state.prosperityData;
        const oldLevel = this.getCurrentLevel().level;

        // ===== 增长部分 =====
        let gain = 0;

        // 1. 基础增长：每个村民每天贡献 1 点
        gain += this.state.villagers.length;

        // 2. 建筑加成：每座建筑每天 0.5 点
        gain += Math.floor(this.state.buildings.length * 0.5);

        // 3. 农田加成：每块有作物的农田每天 0.5 点
        const activePlots = this.state.plots.filter(p => p.crop).length;
        gain += Math.floor(activePlots * 0.5);

        // 4. 幸福度加成：平均心情 > 0.6 +1，> 0.8 +2
        const avgMood = this.getAverageMood();
        if (avgMood >= MOOD_BONUS_THRESHOLD_2) gain += 2;
        else if (avgMood >= MOOD_BONUS_THRESHOLD_1) gain += 1;

        // 5. 资源充裕加成：金币>200 +1，小麦>20 +1
        if (this.state.resources.gold >= 200) gain += 1;
        if ((this.state.inventory.wheat || 0) >= 20) gain += 1;

        // 最少获得 1 点（有村民的情况下）
        if (this.state.villagers.length > 0) {
            gain = Math.max(1, gain);
        }

        // ===== 衰减部分（力度较小） =====
        let decay = 0;
        const decayReasons = [];

        // 1. 村民心情低迷：平均心情 < 0.3 → -1/天，< 0.15 → -2/天
        if (this.state.villagers.length > 0) {
            if (avgMood < MOOD_DECAY_THRESHOLD_2) {
                decay += 2;
                decayReasons.push('民怨沸腾(心情极低)');
            } else if (avgMood < MOOD_DECAY_THRESHOLD_1) {
                decay += 1;
                decayReasons.push('士气低落(心情偏低)');
            }
        }

        // 2. 饥荒：小麦为 0 → -2/天
        if ((this.state.inventory.wheat || 0) <= 0 && this.state.villagers.length > 0) {
            decay += 2;
            decayReasons.push('饥荒(小麦耗尽)');
        }

        // 3. 财政困难：金币为 0 → -1/天
        if (this.state.resources.gold <= 0) {
            decay += 1;
            decayReasons.push('财政困难(金币耗尽)');
        }

        // 4. 人口流失：无村民 → -1/天
        if (this.state.villagers.length === 0) {
            decay += 1;
            decayReasons.push('人口空虚(无村民)');
        }

        // 5. 农田荒废：有农田但全部空闲 → -1/天
        if (this.state.plots.length > 0 && activePlots === 0) {
            decay += 1;
            decayReasons.push('田地荒废(无作物)');
        }

        // ===== 计算净变化 =====
        const net = gain - decay;
        data.total = Math.max(0, data.total + net); // 繁荣度最低为 0
        data.todayGain = gain;
        data.todayDecay = decay;
        data.todayNet = net;

        // 更新兼容字段
        this.state.prosperity = data.total;

        // 衰减日志（仅在有衰减时提示）
        if (decay > 0) {
            const reasonText = decayReasons.join('、');
            this.state.addLog('📉', `繁荣度衰减 -${decay}（${reasonText}），今日净变化 ${net >= 0 ? '+' : ''}${net}`, 'warning');
        }

        // 检查是否达到新等级
        this.checkLevelUp();

        // 检查是否降级
        const newLevel = this.getCurrentLevel().level;
        if (newLevel < oldLevel) {
            this.state.addLog('⚠️', `繁荣度降至 ${data.total}，等级降为「${this.getCurrentLevel().icon} ${this.getCurrentLevel().name}」`, 'warning');
        }
    }

    /** 获取村民平均心情 */
    getAverageMood() {
        if (this.state.villagers.length === 0) return Math.round(MAX_MOOD * 0.5); // 无村民时返回中性值
        return this.state.villagers.reduce((s, v) => s + v.mood, 0) / this.state.villagers.length;
    }

    /** 增加繁荣度（事件触发） */
    addBonus(amount, reason) {
        this.state.prosperityData.total += amount;
        this.state.prosperity = this.state.prosperityData.total;
        // 不需要log每次小加成，避免刷屏
    }

    /** 扣减繁荣度（负面事件触发） */
    addPenalty(amount, reason) {
        const data = this.state.prosperityData;
        data.total = Math.max(0, data.total - amount);
        this.state.prosperity = data.total;
        this.state.addLog('📉', `繁荣度 -${amount}（${reason}）`, 'warning');
    }

    /** 检查是否达到新等级并提示 */
    checkLevelUp() {
        const data = this.state.prosperityData;
        const currentLevel = this.getCurrentLevel();

        // 如果该等级奖励未领取且等级 > 1，提示玩家
        if (currentLevel.level >= 2 && !data.claimedLevels.includes(currentLevel.level)) {
            // 检查是否有任何未领取的等级
            const unclaimedLevels = PROSPERITY_LEVELS.filter(
                l => l.level >= 2 && l.threshold <= data.total && !data.claimedLevels.includes(l.level)
            );
            if (unclaimedLevels.length > 0) {
                const highest = unclaimedLevels[unclaimedLevels.length - 1];
                this.state.addLog('⭐', `繁荣度达到 ${data.total}，已升至「${highest.icon} ${highest.name}」！点击右侧繁荣度领取奖励`, 'success');
            }
        }
    }

    /** 获取当前等级 */
    getCurrentLevel() {
        const total = this.state.prosperityData?.total || 0;
        let current = PROSPERITY_LEVELS[0];
        for (const level of PROSPERITY_LEVELS) {
            if (total >= level.threshold) {
                current = level;
            }
        }
        return current;
    }

    /** 获取下一等级 */
    getNextLevel() {
        const current = this.getCurrentLevel();
        const nextIdx = PROSPERITY_LEVELS.findIndex(l => l.level === current.level) + 1;
        return nextIdx < PROSPERITY_LEVELS.length ? PROSPERITY_LEVELS[nextIdx] : null;
    }

    /** 领取等级奖励 */
    claimReward(level) {
        const data = this.state.prosperityData;
        const levelConfig = PROSPERITY_LEVELS.find(l => l.level === level);
        if (!levelConfig) return { success: false, reason: '无效等级' };
        if (data.claimedLevels.includes(level)) return { success: false, reason: '已领取' };
        if (data.total < levelConfig.threshold) return { success: false, reason: '繁荣度不足' };

        // 发放金币
        this.state.resources.gold += levelConfig.reward;
        data.claimedLevels.push(level);

        this.state.addLog('🎁', `领取了「${levelConfig.icon} ${levelConfig.name}」奖励：${levelConfig.reward}💰`, 'success');

        // 最高等级（10级）触发通关
        if (level === 10) {
            this.bus.emit('autoPause', { reason: '[通关] 🎉 繁荣度达到传说桃源！' });
            this.state.addLog('🏆', '恭喜！桃源村已成为传说中的桃源！你是最伟大的村长！', 'success');
            this.bus.emit('gameWin', { prosperity: data.total });
        }

        return { success: true, reward: levelConfig.reward };
    }

    /** 显示繁荣度详情弹窗 */
    showProsperityModal() {
        const data = this.state.prosperityData;
        const currentLevel = this.getCurrentLevel();
        const nextLevel = this.getNextLevel();

        // 移除已有弹窗
        const existing = document.querySelector('.prosperity-modal-overlay');
        if (existing) existing.remove();

        // 构建等级列表
        let levelsHtml = '';
        for (const lv of PROSPERITY_LEVELS) {
            const reached = data.total >= lv.threshold;
            const claimed = data.claimedLevels.includes(lv.level);
            const isCurrent = lv.level === currentLevel.level;
            const canClaim = reached && !claimed && lv.level >= 2;

            let statusHtml = '';
            if (lv.level === 1) {
                statusHtml = '<span style="color:var(--text-secondary);font-size:12px;">—</span>';
            } else if (claimed) {
                statusHtml = '<span style="color:var(--text-secondary);font-size:12px;">✅ 已领取</span>';
            } else if (canClaim) {
                statusHtml = `<button class="btn btn-sm btn-gold prosperity-claim-btn" data-level="${lv.level}" style="font-size:12px;padding:2px 10px;">领取 ${lv.reward}💰</button>`;
            } else {
                statusHtml = `<span style="color:var(--text-secondary);font-size:12px;">🔒 需要 ${lv.threshold}</span>`;
            }

            levelsHtml += `
                <div class="prosperity-level-row ${isCurrent ? 'current' : ''} ${reached ? 'reached' : 'locked'}" style="
                    display:flex;align-items:center;justify-content:space-between;
                    padding:8px 12px;border-radius:8px;
                    ${isCurrent ? 'background:var(--bg-input);border:1px solid var(--accent);' : ''}
                    ${!reached ? 'opacity:0.5;' : ''}
                    margin-bottom:4px;
                ">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:20px;">${lv.icon}</span>
                        <div>
                            <div style="font-weight:${isCurrent ? '700' : '500'};font-size:13px;">
                                Lv.${lv.level} ${lv.name}
                                ${isCurrent ? '<span style="font-size:11px;color:var(--accent);margin-left:4px;">◀ 当前</span>' : ''}
                            </div>
                            <div style="font-size:11px;color:var(--text-secondary);">
                                需要 ${lv.threshold} 繁荣度${lv.level >= 2 ? `　奖励 ${lv.reward}💰` : ''}
                            </div>
                        </div>
                    </div>
                    <div>${statusHtml}</div>
                </div>
            `;
        }

        // 进度条
        let progressHtml = '';
        if (nextLevel) {
            const progressPct = Math.min(100, Math.round(
                ((data.total - currentLevel.threshold) / (nextLevel.threshold - currentLevel.threshold)) * 100
            ));
            progressHtml = `
                <div style="margin:12px 0;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:4px;">
                        <span>${currentLevel.icon} ${currentLevel.name}</span>
                        <span>${nextLevel.icon} ${nextLevel.name}</span>
                    </div>
                    <div style="width:100%;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;">
                        <div style="width:${progressPct}%;height:100%;background:var(--accent);border-radius:4px;transition:width 0.3s;"></div>
                    </div>
                    <div style="text-align:center;font-size:12px;color:var(--text-secondary);margin-top:4px;">
                        ${data.total} / ${nextLevel.threshold}（还需 ${nextLevel.threshold - data.total}）
                    </div>
                </div>
            `;
        } else {
            progressHtml = `<div style="text-align:center;color:var(--accent);font-size:14px;margin:12px 0;">👑 已达最高等级！</div>`;
        }

        // 增长与衰减明细
        const gainDetail = `
            <div style="background:var(--bg-input);border-radius:8px;padding:10px 12px;margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.8;">
                <div style="font-weight:600;color:#2e7d32;margin-bottom:4px;">📈 每日增长来源</div>
                <div>👥 每名村民：+1/天</div>
                <div>🏗️ 每座建筑：+0.5/天</div>
                <div>🌾 每块活跃农田：+0.5/天</div>
                <div>😊 平均心情≥60：+1/天　≥80：+2/天</div>
                <div>💰 金币≥200：+1/天　🌾 小麦≥20：+1/天</div>
                <div style="margin-top:4px;border-top:1px dashed var(--border);padding-top:4px;">
                    🏗️ 建造建筑：+5　👥 招募村民：+10　🌾 收获作物：+2
                </div>
            </div>
            <div style="background:var(--bg-input);border-radius:8px;padding:10px 12px;margin-top:8px;font-size:12px;color:var(--text-secondary);line-height:1.8;">
                <div style="font-weight:600;color:#c62828;margin-bottom:4px;">📉 每日衰减因素（力度较小）</div>
                <div>😞 村民平均心情＜30：-1/天</div>
                <div>😡 村民平均心情＜15：-2/天</div>
                <div>🌾 小麦耗尽(饥荒)：-2/天</div>
                <div>💸 金币耗尽(财政困难)：-1/天</div>
                <div>👻 无村民(人口空虚)：-1/天</div>
                <div>🏜️ 农田全部荒废：-1/天</div>
                <div style="margin-top:4px;border-top:1px dashed var(--border);padding-top:4px;">
                    💔 村民离开：-5　🥀 作物枯萎：-1
                </div>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay prosperity-modal-overlay';
        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:480px;max-height:85vh;overflow-y:auto;">
                <div class="modal-title" style="display:flex;align-items:center;gap:8px;">
                    <span>⭐ 繁荣度</span>
                    <span style="font-size:22px;font-weight:700;color:var(--accent);">${data.total}</span>
                    <span style="font-size:12px;color:var(--text-secondary);">今日 ${(data.todayNet || 0) >= 0 ? '+' : ''}${data.todayNet || 0}（↑${data.todayGain || 0} ↓${data.todayDecay || 0}）</span>
                </div>
                <div class="modal-body">
                    ${progressHtml}
                    <div style="font-weight:600;font-size:13px;margin-bottom:8px;">🏅 等级与奖励</div>
                    ${levelsHtml}
                    ${gainDetail}
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary prosperity-close">关闭</button>
                </div>
            </div>
        `;

        // 绑定关闭
        overlay.querySelector('.prosperity-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // 绑定领取按钮
        overlay.querySelectorAll('.prosperity-claim-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const level = parseInt(btn.dataset.level);
                const result = this.claimReward(level);
                if (result.success) {
                    this.bus.emit('uiUpdate', {});
                    // 重新渲染弹窗
                    overlay.remove();
                    this.showProsperityModal();
                }
            });
        });

        document.body.appendChild(overlay);
    }

    /** 季末回顾 */
    seasonReview() {
        const seasonName = this.state.seasonName;
        const villagers = this.state.villagers;
        const vilagerNames = villagers.map(v => v.name).join('、') || '无';
        const avgMood = villagers.length > 0
            ? Math.round(villagers.reduce((s, v) => s + v.mood, 0) / villagers.length)
            : 0;
        const data = this.state.prosperityData;

        const review = `📜 ${seasonName}季回顾：村民${vilagerNames}，` +
            `平均心情${avgMood}，繁荣度${data.total}（${this.getCurrentLevel().name}），` +
            `金币${this.state.resources.gold}💰，小麦${this.state.inventory.wheat || 0}🌾`;

        this.state.addLog('📜', review, 'info');
    }
}
