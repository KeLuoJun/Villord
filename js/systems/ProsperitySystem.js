/**
 * ProsperitySystem - 繁荣度与通关系统
 * 计算村庄繁荣度评分（目标100分）
 * 生成季末回顾
 */

export class ProsperitySystem {
    constructor(gameState, eventBus) {
        this.state = gameState;
        this.bus = eventBus;

        this.bus.on('newDay', () => this.updateProsperity());
        this.bus.on('seasonChange', () => this.seasonReview());
    }

    /** 计算繁荣度 */
    updateProsperity() {
        let score = 0;

        // 1. 村民数量（每人10分，满4人=40分）
        score += this.state.villagers.length * 10;

        // 2. 建筑多样性（每种建筑类型5分，最多20分）
        const buildingTypes = new Set(this.state.buildings.map(b => b.type));
        score += Math.min(20, buildingTypes.size * 5);

        // 3. 农田数量（每块5分，最多15分）
        score += Math.min(15, this.state.plots.length * 5);

        // 4. 资源充裕度（最多15分）
        if (this.state.resources.gold >= 200) score += 5;
        if (this.state.resources.food >= 20) score += 5;
        if (this.state.resources.wood >= 10 && this.state.resources.stone >= 10) score += 5;

        // 5. 村民幸福度（平均心情>60得5分，>80得10分）
        if (this.state.villagers.length > 0) {
            const avgMood = this.state.villagers.reduce((s, v) => s + v.mood, 0) / this.state.villagers.length;
            if (avgMood >= 80) score += 10;
            else if (avgMood >= 60) score += 5;
        }

        this.state.prosperity = Math.min(100, score);

        // 通关检测
        if (this.state.prosperity >= 100 && !this._winShown) {
            this._winShown = true;
            this.bus.emit('autoPause', { reason: '[通关] 🎉 繁荣度达到100！' });
            this.state.addLog('🏆', '恭喜！村庄繁荣度达到100，你是一位优秀的村长！', 'success');
            this.bus.emit('gameWin', { prosperity: 100 });
        }
    }

    /** 季末回顾 */
    seasonReview() {
        const seasonName = this.state.seasonName;
        const villagers = this.state.villagers;
        const vilagerNames = villagers.map(v => v.name).join('、') || '无';
        const avgMood = villagers.length > 0
            ? Math.round(villagers.reduce((s, v) => s + v.mood, 0) / villagers.length)
            : 0;

        const review = `📜 ${seasonName}季回顾：村民${vilagerNames}，` +
            `平均心情${avgMood}，繁荣度${this.state.prosperity}，` +
            `金币${this.state.resources.gold}💰，粮食${this.state.resources.food}🌾`;

        this.state.addLog('📜', review, 'info');
    }
}
