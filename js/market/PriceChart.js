/**
 * PriceChart - Canvas 价格走势图
 * 折线图显示商品价格历史（1天/3天/7天/30天视图）
 * 绿色=高于基准，红色=低于基准
 */

export class PriceChart {
    constructor(containerId) {
        this.containerId = containerId;
        this.canvas = null;
        this.ctx = null;
        this.currentItem = null;
        this.viewDays = 7;
        this.marketEngine = null;

        this.colors = {
            grid: '#E2DDD4',
            axis: '#7A6E5D',
            base: '#A69E8E',
            up: '#52A852',
            down: '#D04848',
            text: '#7A6E5D',
            bg: '#FFFFFF',
        };
    }

    /** 初始化 */
    init(marketEngine) {
        this.marketEngine = marketEngine;
    }

    /**
     * 渲染价格走势图
     * @param {string} itemId - 商品ID
     * @param {number} viewDays - 查看天数
     */
    render(itemId, viewDays = 7) {
        this.currentItem = itemId;
        this.viewDays = viewDays;

        const container = document.getElementById(this.containerId);
        if (!container) return;

        // 创建 Canvas
        container.innerHTML = '';

        const chartDiv = document.createElement('div');
        chartDiv.className = 'chart-container';

        this.canvas = document.createElement('canvas');
        this.canvas.width = 600;
        this.canvas.height = 200;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '200px';
        this.ctx = this.canvas.getContext('2d');

        chartDiv.appendChild(this.canvas);

        // 时间控制按钮
        const controls = document.createElement('div');
        controls.className = 'chart-controls';
        [1, 3, 7, 30].forEach(d => {
            const btn = document.createElement('button');
            btn.className = `chart-btn ${d === viewDays ? 'active' : ''}`;
            btn.textContent = `${d}天`;
            btn.addEventListener('click', () => this.render(itemId, d));
            controls.appendChild(btn);
        });

        chartDiv.appendChild(controls);
        container.appendChild(chartDiv);

        // 绘制
        this.draw(itemId, viewDays);
    }

    /** 绘制图表 */
    draw(itemId, viewDays) {
        if (!this.ctx || !this.marketEngine) return;

        const history = this.marketEngine.history[itemId];
        if (!history || history.length < 2) {
            this.drawEmpty();
            return;
        }

        const config = this.marketEngine.constructor === Object ?
            null : (window.MARKET_ITEMS || {})[itemId];
        const basePrice = config?.basePrice || history[0].price;

        // 获取时间窗口内的数据点
        const ticksPerDay = 24;
        const maxTicks = viewDays * ticksPerDay;
        const data = history.slice(-maxTicks);

        if (data.length < 2) {
            this.drawEmpty();
            return;
        }

        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        const chartW = W - padding.left - padding.right;
        const chartH = H - padding.top - padding.bottom;

        // 清空
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, W, H);

        // 求价格范围
        const prices = data.map(d => d.price);
        let minPrice = Math.min(...prices, basePrice * 0.9);
        let maxPrice = Math.max(...prices, basePrice * 1.1);
        const range = maxPrice - minPrice || 1;

        // 绘制网格 + Y轴标签
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 0.5;
        ctx.font = '10px monospace';
        ctx.fillStyle = this.colors.text;
        ctx.textAlign = 'right';

        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartH * i / 4);
            const val = maxPrice - (range * i / 4);

            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(W - padding.right, y);
            ctx.stroke();

            ctx.fillText(val.toFixed(1), padding.left - 5, y + 3);
        }

        // 基准线
        const baseY = padding.top + (1 - (basePrice - minPrice) / range) * chartH;
        ctx.strokeStyle = this.colors.base;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padding.left, baseY);
        ctx.lineTo(W - padding.right, baseY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = this.colors.base;
        ctx.textAlign = 'left';
        ctx.fillText(`基准 ${basePrice}`, W - padding.right + 2, baseY + 3);

        // 绘制折线（分段着色）
        ctx.lineWidth = 2;

        for (let i = 1; i < data.length; i++) {
            const x1 = padding.left + ((i - 1) / (data.length - 1)) * chartW;
            const x2 = padding.left + (i / (data.length - 1)) * chartW;
            const y1 = padding.top + (1 - (data[i - 1].price - minPrice) / range) * chartH;
            const y2 = padding.top + (1 - (data[i].price - minPrice) / range) * chartH;

            const isAboveBase = data[i].price >= basePrice;
            ctx.strokeStyle = isAboveBase ? this.colors.up : this.colors.down;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        // X轴标签（天数）
        ctx.fillStyle = this.colors.text;
        ctx.textAlign = 'center';
        ctx.font = '10px monospace';

        const tickInterval = Math.max(1, Math.floor(data.length / 6));
        for (let i = 0; i < data.length; i += tickInterval) {
            const x = padding.left + (i / (data.length - 1)) * chartW;
            const day = Math.floor(i / ticksPerDay) + 1;
            ctx.fillText(`D${day}`, x, H - 5);
        }

        // 图标标题
        ctx.fillStyle = this.colors.axis;
        ctx.textAlign = 'left';
        ctx.font = '12px sans-serif';
        const itemName = config?.name || itemId;
        ctx.fillText(`${itemName} 价格走势（${viewDays}天）`, padding.left, 14);
    }

    /** 空数据提示 */
    drawEmpty() {
        const ctx = this.ctx;
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = this.colors.text;
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无足够数据绘制图表', this.canvas.width / 2, this.canvas.height / 2);
    }
}
