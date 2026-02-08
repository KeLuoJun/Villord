/**
 * FishingPanel - 钓鱼面板 UI（增强版）
 * 2.5D Canvas 鱼塘渲染 + 钓鱼小游戏交互
 * 增强：粒子系统、屏幕震动、鱼跃动画、拉力条机制、视觉反馈
 */

import { FISH_TYPES, RARITY, POND_LEVELS, BAIT_TYPES, FISHING_TIMING, getWeatherMod } from '../config/fishing.js';

// ===== roundRect polyfill =====
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (typeof r === 'number') r = [r, r, r, r];
        const [tl, tr, br, bl] = r;
        this.moveTo(x + tl, y);
        this.lineTo(x + w - tr, y);
        this.quadraticCurveTo(x + w, y, x + w, y + tr);
        this.lineTo(x + w, y + h - br);
        this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
        this.lineTo(x + bl, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - bl);
        this.lineTo(x, y + tl);
        this.quadraticCurveTo(x, y, x + tl, y);
        this.closePath();
        return this;
    };
}

// ===== 小游戏状态枚举 =====
const STATE = {
    IDLE: 'idle',
    CASTING: 'casting',
    WAITING: 'waiting',
    NIBBLE: 'nibble',
    BITING: 'biting',
    REELING: 'reeling',         // 拉力条阶段
    CATCH_SUCCESS: 'catch_success',
    CATCH_FAIL: 'catch_fail',
    RESULT: 'result',
    NOT_BUILT: 'not_built',
};

export class FishingPanel {
    constructor(gameState, eventBus, fishingSystem) {
        this.state = gameState;
        this.bus = eventBus;
        this.fishingSystem = fishingSystem;

        // Canvas
        this.canvas = null;
        this.ctx = null;
        this.W = 600;
        this.H = 500;

        // 渲染循环
        this.animFrame = null;
        this.isActive = false;
        this.time = 0;
        this.lastTime = 0;

        // 小游戏状态
        this.gameState_ = STATE.NOT_BUILT;
        this.stateTimer = 0;
        this.waitDuration = 0;
        this.biteWindowTimer = 0;

        // 时机条（BITING阶段）
        this.pointerPos = 0;
        this.pointerDir = 1;
        this.timingResult = null;

        // 拉力条（REELING阶段）
        this.tensionValue = 0.5;       // 当前拉力 0-1（0=顶部松弛，1=底部绷紧）
        this.tensionVelocity = 0;      // 拉力变化速度（带惯性）
        this.isHolding = false;        // 是否按住
        this.reelProgress = 0;         // 收杆进度 0-1
        this.fishTarget = 0.5;         // 鱼想把拉力拉到的目标位置
        this.fishTargetTimer = 0;      // 鱼切换目标的计时
        this.fishTargetSpeed = 0;      // 鱼向目标移动的速度
        this.dangerTimer = 0;          // 在危险区停留的时间

        // 当前钓到的鱼
        this.currentFish = null;
        this.catchResult = null;
        this.resultTimer = 0;
        this.resultAnimProgress = 0;   // 结果卡片动画进度

        // 鱼影系统
        this.fishShadows = [];
        this.initFishShadows();

        // 水波纹
        this.ripples = [];

        // 粒子系统
        this.particles = [];

        // 气泡系统（等待阶段）
        this.bubbles = [];
        this.bubbleTimer = 0;

        // 屏幕震动
        this.shakeIntensity = 0;
        this.shakeDecay = 0.9;
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;

        // 鱼跃动画
        this.jumpingFish = null;       // { x, y, vy, rotation, rotSpeed, icon, size, alpha }

        // 连击视觉
        this.comboFlameTime = 0;

        // 光柱效果
        this.lightPillar = null;       // { alpha, color, duration }

        // 浮标位置
        this.floatX = 0;
        this.floatY = 0;

        // 钓鱼竿参数
        this.rodBaseX = 0;
        this.rodBaseY = 0;
        this.rodTipX = 0;
        this.rodTipY = 0;

        // 竿弯曲度（0-1，鱼拉扯时增大）
        this.rodBend = 0;

        // 反馈文字动画
        this.feedbackTexts = [];

        // 容器引用
        this.rootEl = null;

        // 绑定方法
        this._onCanvasClick = this._onCanvasClick.bind(this);
        this._onCanvasDown = this._onCanvasDown.bind(this);
        this._onCanvasUp = this._onCanvasUp.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._renderLoop = this._renderLoop.bind(this);
    }

    // ===== 面板接口 =====

    onActivate() {
        this.isActive = true;
        this._ensureDOM();

        if (this.fishingSystem.isPondBuilt) {
            if (this.gameState_ === STATE.NOT_BUILT) {
                this.gameState_ = STATE.IDLE;
            }
        } else {
            this.gameState_ = STATE.NOT_BUILT;
        }

        // 重新适配尺寸（切换标签页后容器可能变化）
        if (this._resizeObserver && this.rootEl) {
            this._resizeObserver.observe(this.rootEl);
        }
        this._resizeCanvas();

        this._startRenderLoop();
        this._updateInfoBar();
    }

    update() {
        if (!this.isActive) return;
        this._updateInfoBar();
        this._updateUpgradeBtn();
    }

    onDeactivate() {
        this.isActive = false;
        this.isHolding = false;
        if (this.animFrame) {
            cancelAnimationFrame(this.animFrame);
            this.animFrame = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
    }

    // ===== DOM 初始化 =====

    _ensureDOM() {
        this.rootEl = document.getElementById('fishing-panel-root');
        if (!this.rootEl) return;

        if (this.rootEl.querySelector('.fishing-canvas-wrap')) return;

        this.rootEl.innerHTML = `
            <h3 style="margin-bottom:var(--spacing-md);display:flex;align-items:center;justify-content:space-between;">
                <span>🎣 钓鱼</span>
                <span class="fishing-info-bar" id="fishing-info-bar"></span>
            </h3>
            <div class="fishing-canvas-wrap">
                <canvas id="fishing-canvas" width="${this.W}" height="${this.H}"></canvas>
                <div class="fishing-hud" id="fishing-hud"></div>
            </div>
            <div class="fishing-controls" id="fishing-controls"></div>
            <div class="fishing-toolbar">
                <div class="toolbar-group" id="fishing-bait-bar"></div>
                <span class="toolbar-divider"></span>
                <div class="toolbar-group">
                    <button class="fishing-tool-btn" id="fishing-upgrade-btn"></button>
                    <button class="fishing-tool-btn" id="fishing-collection-btn">📖 图鉴</button>
                    <button class="fishing-tool-btn" id="fishing-help-btn">❓ 说明</button>
                </div>
            </div>
        `;

        this.canvas = document.getElementById('fishing-canvas');
        this.ctx = this.canvas.getContext('2d');

        // 动态适配容器宽度
        this._resizeCanvas();
        this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
        this._resizeObserver.observe(this.rootEl);

        this.canvas.addEventListener('click', this._onCanvasClick);
        this.canvas.addEventListener('mousedown', this._onCanvasDown);
        this.canvas.addEventListener('mouseup', this._onCanvasUp);
        this.canvas.addEventListener('mouseleave', this._onCanvasUp);
        // 触摸支持
        this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._onCanvasDown(e); });
        this.canvas.addEventListener('touchend', (e) => { e.preventDefault(); this._onCanvasUp(e); });

        // 键盘支持
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);

        document.getElementById('fishing-collection-btn')?.addEventListener('click', () => this._showCollectionModal());
        document.getElementById('fishing-upgrade-btn')?.addEventListener('click', () => this._handleUpgrade());
        document.getElementById('fishing-help-btn')?.addEventListener('click', () => this._showHelpModal());

        // 首次进入钓鱼面板自动弹出玩法说明
        if (!localStorage.getItem('villord_fishing_help_shown')) {
            setTimeout(() => this._showHelpModal(), 300);
            localStorage.setItem('villord_fishing_help_shown', '1');
        }

        this._updateControls();
        this._updateBaitBar();
        this._updateUpgradeBtn();
        this._computeLayout();
    }

    _resizeCanvas() {
        const wrap = this.rootEl?.querySelector('.fishing-canvas-wrap');
        if (!wrap || !this.canvas) return;

        const containerW = wrap.clientWidth;
        if (containerW <= 0) return;

        // 动态计算：用面板总高度减去标题、控制区、工具栏的高度
        const tabContent = document.getElementById('tab-content');
        const totalH = tabContent ? tabContent.clientHeight : 600;
        // 预留空间：标题(~36px) + 控制区(~10px) + 工具栏(~44px) + 间距(~24px)
        const reservedH = 114;
        const availableH = totalH - reservedH;

        this.W = containerW;
        this.H = Math.max(250, Math.min(availableH, Math.round(containerW * 0.6)));

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.W * dpr;
        this.canvas.height = this.H * dpr;
        this.canvas.style.width = this.W + 'px';
        this.canvas.style.height = this.H + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this._computeLayout();
        // 重新生成鱼影到正确位置
        this.initFishShadows();
    }

    _computeLayout() {
        this.pondCX = this.W / 2;
        this.pondCY = this.H * 0.40;
        this.pondRX = this.W * 0.38;
        this.pondRY = this.W * 0.19;    // 2:1 扁率，更强的 2.5D 俯视感

        this.rodBaseX = this.W * 0.55;
        this.rodBaseY = this.H * 0.95;
        this.rodTipX = this.pondCX + this.pondRX * 0.1;
        this.rodTipY = this.pondCY - this.pondRY * 0.15;

        this.floatX = this.pondCX + this.pondRX * 0.05;
        this.floatY = this.pondCY + this.pondRY * 0.15;
    }

    // ===== 渲染循环 =====

    _startRenderLoop() {
        this.lastTime = performance.now();
        this._renderLoop(this.lastTime);
    }

    _renderLoop(timestamp) {
        if (!this.isActive) return;

        const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05); // cap dt
        this.lastTime = timestamp;
        this.time += dt;

        this._updateGameState(dt);
        this._draw(dt);

        this.animFrame = requestAnimationFrame(this._renderLoop);
    }

    // ===== 屏幕震动 =====

    _triggerShake(intensity) {
        this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    }

    _updateShake(dt) {
        if (this.shakeIntensity > 0.1) {
            this.shakeOffsetX = (Math.random() - 0.5) * this.shakeIntensity * 2;
            this.shakeOffsetY = (Math.random() - 0.5) * this.shakeIntensity * 2;
            this.shakeIntensity *= Math.pow(this.shakeDecay, dt * 60);
        } else {
            this.shakeIntensity = 0;
            this.shakeOffsetX = 0;
            this.shakeOffsetY = 0;
        }
    }

    // ===== 粒子系统 =====

    _addParticles(x, y, count, config) {
        for (let i = 0; i < count; i++) {
            const angle = config.angleMin + Math.random() * (config.angleMax - config.angleMin);
            const speed = config.speedMin + Math.random() * (config.speedMax - config.speedMin);
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: config.gravity || 0,
                size: config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin),
                color: config.colors[Math.floor(Math.random() * config.colors.length)],
                alpha: 1.0,
                life: config.lifeMin + Math.random() * (config.lifeMax - config.lifeMin),
                maxLife: config.lifeMax,
                shape: config.shape || 'circle',  // 'circle' | 'star' | 'text'
                text: config.text || '',
                shrink: config.shrink !== false,
            });
        }
    }

    _addSplash(x, y) {
        this._addParticles(x, y, 15, {
            angleMin: -Math.PI * 0.9,
            angleMax: -Math.PI * 0.1,
            speedMin: 40,
            speedMax: 120,
            gravity: 200,
            sizeMin: 2,
            sizeMax: 5,
            colors: ['#fff', '#b3e5fc', '#81d4fa', '#4fc3f7'],
            lifeMin: 0.4,
            lifeMax: 0.9,
        });
    }

    _addCoinBurst(x, y) {
        this._addParticles(x, y, 8, {
            angleMin: -Math.PI * 0.8,
            angleMax: -Math.PI * 0.2,
            speedMin: 60,
            speedMax: 150,
            gravity: 250,
            sizeMin: 6,
            sizeMax: 10,
            colors: ['#ffd700', '#ffb300', '#ff8f00'],
            lifeMin: 0.8,
            lifeMax: 1.4,
            shape: 'text',
            text: '💰',
        });
    }

    _addStarBurst(x, y, color) {
        this._addParticles(x, y, 20, {
            angleMin: 0,
            angleMax: Math.PI * 2,
            speedMin: 30,
            speedMax: 100,
            gravity: 0,
            sizeMin: 2,
            sizeMax: 6,
            colors: [color, '#fff', '#ffd54f'],
            lifeMin: 0.6,
            lifeMax: 1.2,
            shape: 'star',
        });
    }

    _addFireParticles(x, y) {
        this._addParticles(x, y, 3, {
            angleMin: -Math.PI * 0.7,
            angleMax: -Math.PI * 0.3,
            speedMin: 20,
            speedMax: 50,
            gravity: -30,
            sizeMin: 4,
            sizeMax: 8,
            colors: ['#ff5722', '#ff9800', '#ffeb3b', '#f44336'],
            lifeMin: 0.3,
            lifeMax: 0.6,
            shrink: true,
        });
    }

    _updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += p.gravity * dt;
            p.life -= dt;
            p.alpha = Math.max(0, p.life / p.maxLife);
            if (p.shrink) p.size *= (1 - dt * 1.5);
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    _drawParticles(ctx) {
        ctx.save();
        for (const p of this.particles) {
            ctx.globalAlpha = p.alpha;
            if (p.shape === 'text') {
                ctx.font = `${Math.round(p.size * 2)}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(p.text, p.x, p.y);
            } else if (p.shape === 'star') {
                this._drawStar(ctx, p.x, p.y, p.size, p.color);
            } else {
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    _drawStar(ctx, x, y, r, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
            const px = x + Math.cos(angle) * r;
            const py = y + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    }

    // ===== 气泡系统（等待阶段） =====

    _updateBubbles(dt) {
        // 在等待和试探阶段生成气泡
        if (this.gameState_ === STATE.WAITING || this.gameState_ === STATE.NIBBLE) {
            this.bubbleTimer -= dt;
            const rate = this.gameState_ === STATE.NIBBLE ? 0.15 : 0.5;
            if (this.bubbleTimer <= 0) {
                this.bubbleTimer = rate + Math.random() * rate;
                const offsetX = (Math.random() - 0.5) * 30;
                const offsetY = (Math.random() - 0.5) * 10;
                this.bubbles.push({
                    x: this.floatX + offsetX,
                    y: this.floatY + offsetY,
                    size: 2 + Math.random() * 4,
                    alpha: 0.6,
                    vy: -15 - Math.random() * 20,
                    life: 0.8 + Math.random() * 0.5,
                    wobble: Math.random() * Math.PI * 2,
                });
            }
        }

        for (let i = this.bubbles.length - 1; i >= 0; i--) {
            const b = this.bubbles[i];
            b.y += b.vy * dt;
            b.x += Math.sin(this.time * 3 + b.wobble) * 0.5;
            b.life -= dt;
            b.alpha = Math.max(0, b.life) * 0.6;
            b.size *= (1 + dt * 0.3);
            if (b.life <= 0) this.bubbles.splice(i, 1);
        }
    }

    _drawBubbles(ctx) {
        ctx.save();
        // 裁剪到鱼塘
        ctx.beginPath();
        ctx.ellipse(this.pondCX, this.pondCY, this.pondRX - 2, this.pondRY - 2, 0, 0, Math.PI * 2);
        ctx.clip();

        for (const b of this.bubbles) {
            ctx.globalAlpha = b.alpha;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
            ctx.stroke();
            // 小高光
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.beginPath();
            ctx.arc(b.x - b.size * 0.3, b.y - b.size * 0.3, b.size * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // ===== 鱼跃动画 =====

    _startFishJump(fishIcon) {
        this.jumpingFish = {
            x: this.floatX,
            y: this.floatY,
            vy: -200,
            vx: 15 + Math.random() * 20,
            rotation: 0,
            rotSpeed: 4 + Math.random() * 4,
            icon: fishIcon,
            size: 36,
            alpha: 1.0,
            life: 1.5,
        };
        // 大水花
        this._addSplash(this.floatX, this.floatY);
        this._addSplash(this.floatX, this.floatY);
    }

    _updateJumpingFish(dt) {
        if (!this.jumpingFish) return;
        const f = this.jumpingFish;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 350 * dt; // 重力
        f.rotation += f.rotSpeed * dt;
        f.life -= dt;
        if (f.life < 0.5) f.alpha = f.life / 0.5;
        if (f.life <= 0) this.jumpingFish = null;
    }

    _drawJumpingFish(ctx) {
        if (!this.jumpingFish) return;
        const f = this.jumpingFish;
        ctx.save();
        ctx.globalAlpha = f.alpha;
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rotation);
        ctx.font = `${f.size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.icon, 0, 0);
        ctx.restore();
    }

    // ===== 光柱效果 =====

    _triggerLightPillar(color, duration) {
        this.lightPillar = { alpha: 1.0, color, duration, maxDuration: duration };
    }

    _updateLightPillar(dt) {
        if (!this.lightPillar) return;
        this.lightPillar.duration -= dt;
        this.lightPillar.alpha = Math.max(0, this.lightPillar.duration / this.lightPillar.maxDuration);
        if (this.lightPillar.duration <= 0) this.lightPillar = null;
    }

    _drawLightPillar(ctx) {
        if (!this.lightPillar) return;
        ctx.save();
        ctx.globalAlpha = this.lightPillar.alpha * 0.3;
        const grad = ctx.createLinearGradient(this.floatX, 0, this.floatX, this.H);
        grad.addColorStop(0, this.lightPillar.color);
        grad.addColorStop(0.4, this.lightPillar.color);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(this.floatX - 20, 0, 40, this.H);
        ctx.restore();
    }

    // ===== 小游戏状态更新 =====

    _updateGameState(dt) {
        this.stateTimer += dt;

        this._updateFishShadows(dt);
        this._updateRipples(dt);
        this._updateFeedbackTexts(dt);
        this._updateParticles(dt);
        this._updateBubbles(dt);
        this._updateShake(dt);
        this._updateJumpingFish(dt);
        this._updateLightPillar(dt);

        // 连击火焰粒子
        if (this.state.fishing.combo >= 3 && (this.gameState_ === STATE.IDLE || this.gameState_ === STATE.RESULT)) {
            this.comboFlameTime -= dt;
            if (this.comboFlameTime <= 0) {
                this.comboFlameTime = 0.08;
                const comboX = this.W / 2 + (Math.random() - 0.5) * 60;
                this._addFireParticles(comboX, this.H * 0.84);
            }
        }

        switch (this.gameState_) {
            case STATE.CASTING:
                // 竿弯曲动画
                this.rodBend = Math.min(this.stateTimer / 0.3, 1) * 0.3;
                if (this.stateTimer > 0.6) {
                    this._addSplash(this.floatX, this.floatY);
                    this._addRipple(this.floatX, this.floatY);
                    this._addRipple(this.floatX + 5, this.floatY + 3);
                    this.rodBend = 0.1;
                    this._changeState(STATE.WAITING);
                    this.waitDuration = FISHING_TIMING.waitMin / 1000
                        + Math.random() * (FISHING_TIMING.waitMax - FISHING_TIMING.waitMin) / 1000;
                }
                break;

            case STATE.WAITING:
                this.rodBend = 0.05 + Math.sin(this.time * 1.5) * 0.02;
                // 快到时间时加速冒泡
                if (this.stateTimer > this.waitDuration * 0.7) {
                    this.bubbleTimer = Math.min(this.bubbleTimer, 0.2);
                }
                if (this.stateTimer > this.waitDuration) {
                    this._changeState(STATE.NIBBLE);
                }
                break;

            case STATE.NIBBLE:
                // 竿尖小幅抖动，增加紧张感
                this.rodBend = 0.15 + Math.sin(this.time * 8) * 0.05;
                if (this.stateTimer > FISHING_TIMING.nibbleDuration / 1000) {
                    this._changeState(STATE.BITING);
                    this.pointerPos = 0;
                    this.pointerDir = 1;
                    this.biteWindowTimer = FISHING_TIMING.biteWindowDuration / 1000;
                    this._triggerShake(3);
                }
                break;

            case STATE.BITING:
                this.rodBend = 0.3 + Math.sin(this.time * 15) * 0.1;
                // 指针左右移动
                this.pointerPos += this.pointerDir * FISHING_TIMING.pointerSpeed * dt * 5;
                if (this.pointerPos >= 1) { this.pointerPos = 1; this.pointerDir = -1; }
                if (this.pointerPos <= 0) { this.pointerPos = 0; this.pointerDir = 1; }

                // 周期性小震动
                if (Math.sin(this.time * 10) > 0.8) this._triggerShake(1.5);

                this.biteWindowTimer -= dt;
                if (this.biteWindowTimer <= 0) {
                    this.timingResult = 'miss';
                    this._onFishMiss();
                }
                break;

            case STATE.REELING:
                this._updateReeling(dt);
                break;

            case STATE.CATCH_SUCCESS:
                this.rodBend = Math.max(0, this.rodBend - dt * 0.5);
                if (this.stateTimer > 1.5) {
                    this._changeState(STATE.RESULT);
                    this.resultTimer = 4.0;
                    this.resultAnimProgress = 0;
                }
                break;

            case STATE.CATCH_FAIL:
                this.rodBend = Math.max(0, this.rodBend - dt * 0.8);
                if (this.stateTimer > 1.0) {
                    this._changeState(STATE.RESULT);
                    this.resultTimer = 2.0;
                    this.resultAnimProgress = 0;
                }
                break;

            case STATE.RESULT:
                this.resultTimer -= dt;
                this.resultAnimProgress = Math.min(this.resultAnimProgress + dt * 3, 1);
                if (this.resultTimer <= 0) {
                    this._changeState(STATE.IDLE);
                    this._updateControls();
                    this._updateInfoBar();
                }
                break;
        }
    }

    // ===== 拉力条机制 =====

    _updateReeling(dt) {
        // --- 难度参数（根据鱼稀有度） ---
        const rarityIdx = this.currentFish
            ? ['common', 'uncommon', 'rare', 'legendary'].indexOf(this.currentFish.rarity)
            : 0;
        // 普通鱼温和，传说鱼凶猛
        const fishStrength = 0.5 + rarityIdx * 0.18;       // 鱼的拉力强度（增强）
        const fishSwitchRate = 1.2 - rarityIdx * 0.2;      // 切换目标间隔（更频繁）
        const fishTargetRange = 0.35 + rarityIdx * 0.12;   // 目标偏移幅度（更大）

        // --- 鱼的行为：平滑地在不同目标间移动 ---
        this.fishTargetTimer -= dt;
        if (this.fishTargetTimer <= 0) {
            this.fishTargetTimer = fishSwitchRate * (0.6 + Math.random() * 0.8);
            // 新目标：在安全区附近波动，偶尔冲向边缘
            const isLunge = Math.random() < 0.20 + rarityIdx * 0.08; // 猛冲概率（提高）
            if (isLunge) {
                // 猛冲：目标跑到边缘
                this.fishTarget = Math.random() > 0.5 ? 0.85 + Math.random() * 0.1 : 0.05 + Math.random() * 0.1;
                this.fishTargetSpeed = fishStrength * 2.5;
                if (rarityIdx >= 2) this._triggerShake(2.5);
            } else {
                // 普通挣扎：在中间范围来回
                this.fishTarget = 0.5 + (Math.random() - 0.5) * fishTargetRange * 2;
                this.fishTarget = Math.max(0.15, Math.min(0.85, this.fishTarget));
                this.fishTargetSpeed = fishStrength * (0.8 + Math.random() * 0.6);
            }
        }

        // 鱼的力量：平滑地将拉力推向目标（弹簧阻尼模型）
        const fishForce = (this.fishTarget - this.tensionValue) * this.fishTargetSpeed;

        // --- 玩家控制力（带惯性，不是瞬间切换） ---
        // 按住 = 持续向上施力（减小tension），松开 = 自然下沉（重力）
        const playerForce = this.isHolding ? -1.0 : 0.25;

        // --- 物理更新（惯性+阻尼） ---
        const totalForce = fishForce + playerForce;
        const damping = 3.5;  // 阻尼系数：越大越不弹，操控越"实"

        // 速度更新：力驱动 + 阻尼消耗
        this.tensionVelocity += totalForce * dt;
        this.tensionVelocity *= Math.max(0, 1 - damping * dt); // 阻尼

        // 位置更新
        this.tensionValue += this.tensionVelocity * dt;

        // 边界碰撞（弹回而非贴墙）
        if (this.tensionValue <= 0.02) {
            this.tensionValue = 0.02;
            this.tensionVelocity = Math.abs(this.tensionVelocity) * 0.3; // 弹回
        }
        if (this.tensionValue >= 0.98) {
            this.tensionValue = 0.98;
            this.tensionVelocity = -Math.abs(this.tensionVelocity) * 0.3;
        }

        // --- 竿弯曲视觉 ---
        this.rodBend = 0.15 + this.tensionValue * 0.35;

        // --- 安全区判定（0.25-0.75，比之前更窄）---
        const safeMin = 0.25;
        const safeMax = 0.75;
        const inSafeZone = this.tensionValue >= safeMin && this.tensionValue <= safeMax;

        if (inSafeZone) {
            // 在安全区：进度推进（稍慢，需要更长的控制时间）
            this.reelProgress += dt * 0.28;
            this.dangerTimer = Math.max(0, this.dangerTimer - dt * 1.5); // 恢复稍慢

            // 水花效果
            if (Math.random() < dt * 2) {
                this._addRipple(this.floatX + (Math.random() - 0.5) * 10, this.floatY);
            }
        } else {
            // 在危险区：进度倒退更快 + 累积危险时间
            this.reelProgress = Math.max(0, this.reelProgress - dt * 0.15);
            this.dangerTimer += dt;

            // 视觉警告
            if (Math.sin(this.time * 8) > 0.5) this._triggerShake(1);
        }

        // --- 胜利判定 ---
        if (this.reelProgress >= 1) {
            this._onReelSuccess();
            return;
        }

        // --- 失败判定：在危险区持续停留超过2秒才断线 ---
        if (this.dangerTimer > 2.0) {
            this._onFishMiss();
        }
    }

    _changeState(newState) {
        if (newState === STATE.IDLE || newState === STATE.RESULT) {
            for (const shadow of this.fishShadows) {
                shadow.attracted = false;
                shadow.targetX = null;
                shadow.targetY = null;
            }
        }

        // 状态切换 → 触发音效事件
        switch (newState) {
            case STATE.CASTING:
                this.bus.emit('fishingCast');
                break;
            case STATE.WAITING:
                this.bus.emit('fishingSplash');
                break;
            case STATE.BITING:
                this.bus.emit('fishingBite');
                break;
            case STATE.REELING:
                this.bus.emit('fishingReel');
                break;
            case STATE.CATCH_SUCCESS:
                this.bus.emit('fishingSuccess');
                break;
            case STATE.CATCH_FAIL:
                this.bus.emit('fishingFail');
                break;
        }

        this.gameState_ = newState;
        this.stateTimer = 0;
        this._updateHUD();
    }

    // ===== 点击/按压处理 =====

    _onCanvasClick(e) {
        switch (this.gameState_) {
            case STATE.IDLE:
                this._startFishing();
                break;

            case STATE.BITING:
                this._attemptCatch();
                break;

            case STATE.RESULT:
                this._changeState(STATE.IDLE);
                this._updateControls();
                this._updateInfoBar();
                break;
        }
    }

    _onCanvasDown(e) {
        if (this.gameState_ === STATE.REELING) {
            this.isHolding = true;
        }
    }

    _onCanvasUp(e) {
        this.isHolding = false;
    }

    _onKeyDown(e) {
        if (!this.isActive) return;
        // 空格键：钓鱼各阶段通用操作键
        if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
            e.preventDefault();
            e.stopPropagation();

            switch (this.gameState_) {
                case STATE.IDLE:
                    this._startFishing();
                    break;
                case STATE.BITING:
                    this._attemptCatch();
                    break;
                case STATE.REELING:
                    this.isHolding = true;
                    break;
                case STATE.RESULT:
                    this._changeState(STATE.IDLE);
                    this._updateControls();
                    this._updateInfoBar();
                    break;
            }
        }
    }

    _onKeyUp(e) {
        if (!this.isActive) return;
        if (e.code === 'Space') {
            e.preventDefault();
            this.isHolding = false;
        }
    }

    _startFishing() {
        const check = this.fishingSystem.canFish();
        if (!check.ok) {
            this._addFeedbackText(check.reason, this.W / 2, this.H * 0.7, '#c62828');
            return;
        }

        this.fishingSystem.consumeFishStock();
        this.currentFish = this.fishingSystem.determineCatch();
        this.catchResult = null;

        this._changeState(STATE.CASTING);
        this._updateControls();
        this._updateInfoBar();

        // 派一条鱼影靠近浮标
        if (this.fishShadows.length > 0) {
            const shadow = this.fishShadows[0];
            shadow.targetX = this.floatX;
            shadow.targetY = this.floatY;
            shadow.attracted = true;
        }
    }

    _attemptCatch() {
        const pos = this.pointerPos;
        const zones = FISHING_TIMING.zones;
        const perfectStart = 0.5 - zones.perfect / 2;
        const perfectEnd = 0.5 + zones.perfect / 2;
        const goodStart = perfectStart - zones.good / 2;
        const goodEnd = perfectEnd + zones.good / 2;

        if (pos >= perfectStart && pos <= perfectEnd) {
            this.timingResult = 'perfect';
        } else if (pos >= goodStart && pos <= goodEnd) {
            this.timingResult = 'good';
        } else {
            this.timingResult = 'miss';
        }

        if (this.timingResult === 'miss') {
            this._onFishMiss();
        } else {
            // 进入拉力条阶段
            this._changeState(STATE.REELING);
            this.tensionValue = 0.5;
            this.tensionVelocity = 0;
            this.reelProgress = 0;
            this.isHolding = false;
            this.fishTargetTimer = 0.5; // 给玩家半秒反应时间
            this.fishTarget = 0.5;
            this.fishTargetSpeed = 0;
            this.dangerTimer = 0;
            this._triggerShake(4);

            if (this.timingResult === 'perfect') {
                this._addFeedbackText('✨ Perfect!', this.W / 2, this.H * 0.25, '#ff9800', 32);
                this.reelProgress = 0.3; // Perfect 奖励30%初始进度
            } else {
                this._addFeedbackText('Good!', this.W / 2, this.H * 0.25, '#4caf50', 26);
            }
        }

        this._updateInfoBar();
    }

    _onReelSuccess() {
        const quality = this.timingResult;
        this.catchResult = this.fishingSystem.onCatchSuccess(this.currentFish.id, quality);
        this._changeState(STATE.CATCH_SUCCESS);

        // 鱼跃出水面
        this._startFishJump(this.currentFish.icon);

        // 屏幕震动（稀有度越高震动越强）
        const rarityShake = { common: 3, uncommon: 5, rare: 8, legendary: 12 };
        this._triggerShake(rarityShake[this.currentFish.rarity] || 3);

        // 金币粒子
        this._addCoinBurst(this.floatX, this.floatY - 30);

        // 稀有及以上：星光爆发 + 光柱
        const rarityConfig = RARITY[this.currentFish.rarity];
        if (this.currentFish.rarity === 'rare' || this.currentFish.rarity === 'legendary') {
            this._addStarBurst(this.floatX, this.floatY - 20, rarityConfig.color);
            this._triggerLightPillar(rarityConfig.color, 2.0);
        }
        if (this.currentFish.rarity === 'legendary') {
            // 传说鱼：二次爆发
            setTimeout(() => {
                this._addStarBurst(this.W / 2, this.H * 0.35, '#ffd700');
                this._triggerShake(15);
            }, 300);
        }

        // 连击火焰提示
        const combo = this.state.fishing.combo;
        if (combo >= 3) {
            this.bus.emit('fishingCombo');
            this._addFeedbackText(`🔥 ${combo}连击！`, this.W / 2, this.H * 0.18, '#ff5722', 22);
        }

        this.fishingSystem.checkCollectionRewards();
        this._updateInfoBar();
    }

    _onFishMiss() {
        this.fishingSystem.onCatchFail();
        this.catchResult = null;
        this._changeState(STATE.CATCH_FAIL);
        this._addFeedbackText('💨 跑鱼了！', this.W / 2, this.H * 0.3, '#c62828', 24);
        this._addRipple(this.floatX, this.floatY);
        this._addSplash(this.floatX, this.floatY);
        this._triggerShake(4);
        this.rodBend = 0;
    }

    // ===== Canvas 绘制 =====

    _draw(dt) {
        const ctx = this.ctx;
        ctx.save();

        // 屏幕震动偏移
        ctx.translate(this.shakeOffsetX, this.shakeOffsetY);

        ctx.clearRect(-10, -10, this.W + 20, this.H + 20);

        this._drawBackground(ctx);
        this._drawPondEdge(ctx);
        this._drawWater(ctx);
        this._drawFishShadows(ctx);
        this._drawBubbles(ctx);
        this._drawRipples(ctx);

        if (this.gameState_ !== STATE.NOT_BUILT && this.gameState_ !== STATE.IDLE) {
            this._drawFloat(ctx);
        }

        this._drawRod(ctx);

        if (this.gameState_ !== STATE.NOT_BUILT && this.gameState_ !== STATE.IDLE) {
            this._drawLine(ctx);
        }

        this._drawJumpingFish(ctx);
        this._drawLightPillar(ctx);
        this._drawParticles(ctx);
        this._drawTimingBar(ctx);
        this._drawTensionBar(ctx);
        this._drawFeedbackTexts(ctx);
        this._drawResultOverlay(ctx);
        this._drawIdlePrompt(ctx);
        this._drawNotBuiltOverlay(ctx);
        this._drawFishStock(ctx);

        ctx.restore();
    }

    _drawBackground(ctx) {
        const W = this.W, H = this.H;

        // 天空：上浅蓝 → 下淡绿过渡
        const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.50);
        skyGrad.addColorStop(0, '#b3ddf0');
        skyGrad.addColorStop(0.7, '#c8e6c9');
        skyGrad.addColorStop(1, '#a5d6a7');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, H);

        // 地面（大面积绿色，从远到近由浅到深）
        const groundGrad = ctx.createLinearGradient(0, H * 0.28, 0, H);
        groundGrad.addColorStop(0, '#8bc34a');
        groundGrad.addColorStop(0.3, '#7cb342');
        groundGrad.addColorStop(0.7, '#6faa35');
        groundGrad.addColorStop(1, '#5d9a28');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, H * 0.28, W, H * 0.72);

        // 远处地平线柔化带
        ctx.save();
        ctx.globalAlpha = 0.3;
        const horizGrad = ctx.createLinearGradient(0, H * 0.26, 0, H * 0.36);
        horizGrad.addColorStop(0, '#c8e6c9');
        horizGrad.addColorStop(1, 'rgba(139,195,74,0)');
        ctx.fillStyle = horizGrad;
        ctx.fillRect(0, H * 0.26, W, H * 0.1);
        ctx.restore();

        // 草地光影斑（微妙的明暗变化）
        ctx.save();
        ctx.globalAlpha = 0.06;
        const spotSeeds = [0.12, 0.35, 0.58, 0.78, 0.25, 0.65, 0.88, 0.45];
        for (let i = 0; i < spotSeeds.length; i++) {
            const sx = W * spotSeeds[i];
            const sy = H * (0.45 + spotSeeds[(i + 3) % spotSeeds.length] * 0.45);
            ctx.fillStyle = i % 2 === 0 ? '#fff' : '#33691e';
            ctx.beginPath();
            ctx.ellipse(sx, sy, 35 + i * 8, 20 + i * 4, 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // 树木（远景小，近景大，分布在池塘左右两侧）
        // 远景树（小，浅色）
        this._drawTree(ctx, W * 0.06, H * 0.26, 0.55, true);
        this._drawTree(ctx, W * 0.94, H * 0.24, 0.50, true);
        // 中景树
        this._drawTree(ctx, W * 0.14, H * 0.36, 0.75, false);
        this._drawTree(ctx, W * 0.88, H * 0.34, 0.80, false);
        // 近景树（大，深色）
        this._drawTree(ctx, W * 0.04, H * 0.52, 0.95, false);
        this._drawTree(ctx, W * 0.96, H * 0.50, 0.90, false);

        // 云朵
        ctx.save();
        ctx.globalAlpha = 0.55;
        const co = (this.time * 6) % (W + 300);
        this._drawCloud(ctx, -120 + co, H * 0.06, 1.1);
        this._drawCloud(ctx, W * 0.5 + co * 0.4, H * 0.10, 0.75);
        ctx.restore();

        // 池塘投影（地面上的大椭圆阴影）
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = '#2e5a1e';
        ctx.beginPath();
        ctx.ellipse(this.pondCX, this.pondCY + this.pondRY * 0.2, this.pondRX + 30, this.pondRY + 20, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _drawTree(ctx, x, y, scale, isFar) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);

        // 树干
        ctx.fillStyle = isFar ? '#8d6e63' : '#6d4c41';
        ctx.beginPath();
        ctx.roundRect(-5, -2, 10, 35, 3);
        ctx.fill();

        // 树冠（低多边形三角叠层）
        const baseG = isFar ? ['#66bb6a', '#4caf50', '#43a047'] : ['#43a047', '#388e3c', '#2e7d32'];
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = baseG[i];
            ctx.beginPath();
            ctx.moveTo(0, -60 + i * 16);
            ctx.lineTo(-22 - i * 5, -14 + i * 16);
            ctx.lineTo(22 + i * 5, -14 + i * 16);
            ctx.closePath();
            ctx.fill();
        }

        // 树冠高光
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(-2, -58);
        ctx.lineTo(-16, -18);
        ctx.lineTo(4, -18);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    _drawCloud(ctx, x, y, scale) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI * 2);
        ctx.arc(22, -4, 22, 0, Math.PI * 2);
        ctx.arc(44, 0, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _drawPondEdge(ctx) {
        ctx.save();

        const cx = this.pondCX;
        const cy = this.pondCY;
        const rx = this.pondRX;
        const ry = this.pondRY;
        const rimW = Math.max(14, rx * 0.08);
        const rimDepth = Math.max(18, ry * 0.18);   // 立体厚度

        // === 1. 外圈地面投影 ===
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + rimDepth * 0.6, rx + rimW + 10, ry + rimW * 0.6 + 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // === 2. 边缘立体侧面（下半圈可见的厚度部分） ===
        const sideGrad = ctx.createLinearGradient(0, cy, 0, cy + rimDepth * 1.2);
        sideGrad.addColorStop(0, '#cec4b8');
        sideGrad.addColorStop(0.5, '#b5aa9d');
        sideGrad.addColorStop(1, '#9a8f82');
        ctx.fillStyle = sideGrad;
        ctx.beginPath();
        ctx.ellipse(cx, cy + rimDepth * 0.55, rx + rimW + 2, ry + rimW * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();

        // 侧面暗部（底缘阴影线）
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy + rimDepth * 0.6, rx + rimW, ry + rimW * 0.55, 0, 0.1, Math.PI * 0.9);
        ctx.stroke();

        // === 3. 边缘顶面（米白色石质环形，外减内） ===
        const topGrad = ctx.createLinearGradient(cx - rx, cy - rimW, cx + rx, cy + rimW);
        topGrad.addColorStop(0, '#e5ddd5');
        topGrad.addColorStop(0.25, '#f2ede8');
        topGrad.addColorStop(0.5, '#f7f3ef');
        topGrad.addColorStop(0.75, '#eee7e0');
        topGrad.addColorStop(1, '#e0d8d0');
        ctx.fillStyle = topGrad;
        ctx.beginPath();
        // 外圈顺时针
        ctx.ellipse(cx, cy, rx + rimW, ry + rimW * 0.55, 0, 0, Math.PI * 2);
        // 内圈逆时针（形成环形镂空）
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2, true);
        ctx.fill('evenodd');

        // === 4. 内缘阴影（水面与石边的交界线） ===
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx + rimW, ry + rimW * 0.55, 0, 0, Math.PI * 2);
        ctx.clip();
        // 内侧阴影渐变
        for (let i = 3; i >= 0; i--) {
            ctx.globalAlpha = 0.04 * (4 - i);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx + i, ry + i * 0.5, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        // === 5. 顶面高光弧（左上方光泽） ===
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy - 1, rx + rimW - 5, ry + rimW * 0.5 - 3, 0, Math.PI * 1.05, Math.PI * 1.85);
        ctx.stroke();
        ctx.restore();

        // 右下方暗线（增加立体感）
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 1, rx + rimW - 3, ry + rimW * 0.5 - 2, 0, 0.05, Math.PI * 0.95);
        ctx.stroke();
        ctx.restore();

        ctx.restore();
    }

    _drawWater(ctx) {
        ctx.save();

        const cx = this.pondCX;
        const cy = this.pondCY;
        const rx = this.pondRX;
        const ry = this.pondRY;

        // 裁剪到水面椭圆
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();

        // 水面基底（清澈蓝色径向渐变）
        const waterGrad = ctx.createRadialGradient(
            cx - rx * 0.15, cy - ry * 0.25, rx * 0.05,
            cx, cy + ry * 0.1, rx * 1.1
        );
        waterGrad.addColorStop(0, '#6dcff6');
        waterGrad.addColorStop(0.3, '#4db8e8');
        waterGrad.addColorStop(0.65, '#3198d4');
        waterGrad.addColorStop(1, '#2478b0');
        ctx.fillStyle = waterGrad;
        ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

        // 天空倒影高光（左上大面积）
        ctx.globalAlpha = 0.28 + Math.sin(this.time * 1.0) * 0.06;
        const hlGrad = ctx.createRadialGradient(
            cx - rx * 0.28, cy - ry * 0.32, 0,
            cx - rx * 0.1, cy - ry * 0.05, rx * 0.55
        );
        hlGrad.addColorStop(0, 'rgba(255,255,255,0.55)');
        hlGrad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
        hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hlGrad;
        ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

        // 同心涟漪（中心偏移，自然扩散）
        ctx.globalAlpha = 1;
        for (let i = 0; i < 4; i++) {
            const phase = this.time * 0.4 + i * 1.5;
            const scale = 0.12 + i * 0.2 + Math.sin(phase) * 0.025;
            const alpha = 0.07 - i * 0.012;
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(cx + 5, cy - 3, rx * scale, ry * scale, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 边缘渐暗（池底深处）
        ctx.globalAlpha = 0.15;
        const edgeDark = ctx.createRadialGradient(cx, cy, rx * 0.6, cx, cy, rx);
        edgeDark.addColorStop(0, 'rgba(0,0,0,0)');
        edgeDark.addColorStop(1, 'rgba(0,40,80,1)');
        ctx.fillStyle = edgeDark;
        ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

        ctx.restore();
    }

    // ===== 鱼影系统 =====

    initFishShadows() {
        this.fishShadows = [];
        for (let i = 0; i < 5; i++) {
            this.fishShadows.push(this._createFishShadow(i));
        }
    }

    _createFishShadow(index = 0) {
        const angle = (index / 5) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 0.2 + Math.random() * 0.5;
        const cx = this.pondCX || 300;
        const cy = this.pondCY || 190;
        const rx = this.pondRX || 230;
        const ry = this.pondRY || 115;
        return {
            x: cx + Math.cos(angle) * rx * dist,
            y: cy + Math.sin(angle) * ry * dist,
            angle,
            speed: 12 + Math.random() * 20,
            size: 14 + Math.random() * 16,    // 更大，更醒目
            phase: Math.random() * Math.PI * 2,
            dist,
            targetX: null,
            targetY: null,
            attracted: false,
            wanderAngle: angle,
            wanderTimer: 0,
            depth: 0.45 + Math.random() * 0.35,   // 更高不透明度
        };
    }

    _updateFishShadows(dt) {
        for (const fish of this.fishShadows) {
            if (fish.attracted && fish.targetX !== null) {
                const dx = fish.targetX - fish.x;
                const dy = fish.targetY - fish.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 5) {
                    fish.x += (dx / dist) * fish.speed * 1.5 * dt;
                    fish.y += (dy / dist) * fish.speed * 1.5 * dt;
                    fish.angle = Math.atan2(dy, dx);
                }
            } else {
                fish.wanderTimer -= dt;
                if (fish.wanderTimer <= 0) {
                    fish.wanderAngle += (Math.random() - 0.5) * 1.5;
                    fish.wanderTimer = 1 + Math.random() * 3;
                }

                const tx = this.pondCX + Math.cos(fish.wanderAngle) * this.pondRX * 0.6;
                const ty = this.pondCY + Math.sin(fish.wanderAngle) * this.pondRY * 0.6;
                const dx = tx - fish.x;
                const dy = ty - fish.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 2) {
                    fish.x += (dx / dist) * fish.speed * dt;
                    fish.y += (dy / dist) * fish.speed * dt;
                    fish.angle = Math.atan2(dy, dx);
                }
            }

            const relX = (fish.x - this.pondCX) / this.pondRX;
            const relY = (fish.y - this.pondCY) / this.pondRY;
            if (relX * relX + relY * relY > 0.85) {
                fish.wanderAngle = Math.atan2(this.pondCY - fish.y, this.pondCX - fish.x);
            }
        }
    }

    _drawFishShadows(ctx) {
        ctx.save();

        ctx.beginPath();
        ctx.ellipse(this.pondCX, this.pondCY, this.pondRX - 2, this.pondRY - 2, 0, 0, Math.PI * 2);
        ctx.clip();

        for (const fish of this.fishShadows) {
            ctx.save();
            ctx.translate(fish.x, fish.y);
            ctx.rotate(fish.angle);

            const s = fish.size;
            const tailWag = Math.sin(this.time * 5 + fish.phase) * s * 0.25;

            // 鱼身阴影（柔和模糊）
            ctx.globalAlpha = fish.depth * 0.3;
            ctx.fillStyle = '#0d2933';
            ctx.beginPath();
            ctx.ellipse(2, 2, s * 1.1, s * 0.45, 0, 0, Math.PI * 2);
            ctx.fill();

            // 鱼身主体（深蓝灰色，更自然）
            ctx.globalAlpha = fish.depth * 0.85;
            const bodyGrad = ctx.createLinearGradient(-s, -s * 0.4, -s, s * 0.4);
            bodyGrad.addColorStop(0, '#2c5364');
            bodyGrad.addColorStop(0.5, '#1a3a4a');
            bodyGrad.addColorStop(1, '#203a43');
            ctx.fillStyle = bodyGrad;
            ctx.beginPath();
            ctx.ellipse(0, 0, s, s * 0.38, 0, 0, Math.PI * 2);
            ctx.fill();

            // 鱼尾（流线型，带摆动）
            ctx.beginPath();
            ctx.moveTo(-s * 0.85, 0);
            ctx.quadraticCurveTo(-s * 1.2, tailWag - s * 0.15, -s * 1.5, -s * 0.35 + tailWag);
            ctx.lineTo(-s * 1.3, tailWag);
            ctx.lineTo(-s * 1.5, s * 0.35 + tailWag);
            ctx.quadraticCurveTo(-s * 1.2, tailWag + s * 0.15, -s * 0.85, 0);
            ctx.closePath();
            ctx.fill();

            // 背鳍
            ctx.globalAlpha = fish.depth * 0.6;
            ctx.beginPath();
            ctx.moveTo(s * 0.15, -s * 0.35);
            ctx.quadraticCurveTo(0, -s * 0.6, -s * 0.25, -s * 0.35);
            ctx.closePath();
            ctx.fill();

            // 胸鳍（小）
            ctx.beginPath();
            ctx.moveTo(s * 0.3, s * 0.15);
            ctx.quadraticCurveTo(s * 0.45, s * 0.35, s * 0.15, s * 0.3);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }
        ctx.restore();
    }

    // ===== 水波纹 =====

    _addRipple(x, y) {
        this.ripples.push({
            x, y,
            radius: 3,
            maxRadius: 30 + Math.random() * 15,
            alpha: 0.6,
            speed: 28,
        });
    }

    _updateRipples(dt) {
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const r = this.ripples[i];
            r.radius += r.speed * dt;
            r.alpha -= dt * 0.7;
            if (r.alpha <= 0 || r.radius >= r.maxRadius) {
                this.ripples.splice(i, 1);
            }
        }
    }

    _drawRipples(ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(this.pondCX, this.pondCY, this.pondRX - 2, this.pondRY - 2, 0, 0, Math.PI * 2);
        ctx.clip();

        for (const r of this.ripples) {
            ctx.globalAlpha = r.alpha;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(r.x, r.y, r.radius, r.radius * 0.5, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    // ===== 钓鱼竿（带弯曲度） =====

    _drawRod(ctx) {
        ctx.save();

        const baseX = this.rodBaseX;
        const baseY = this.rodBaseY;
        let tipX = this.rodTipX;
        let tipY = this.rodTipY;

        // 弯曲：根据 rodBend 使竿尖下沉
        tipY += this.rodBend * 60;
        tipX -= this.rodBend * 10;

        // 咬钩/拉扯时抖动
        if (this.gameState_ === STATE.BITING) {
            const shake = 4;
            tipX += Math.sin(this.time * 20) * shake;
            tipY += Math.cos(this.time * 25) * shake * 0.6;
        } else if (this.gameState_ === STATE.NIBBLE) {
            tipX += Math.sin(this.time * 8) * 1.5;
            tipY += Math.cos(this.time * 10) * 1;
        } else if (this.gameState_ === STATE.REELING) {
            const shake = this.isHolding ? 2 : 0.5;
            tipX += Math.sin(this.time * 12) * shake;
            tipY += Math.cos(this.time * 15) * shake * 0.5;
        }

        // 竿身贝塞尔
        const midX = (baseX + tipX) / 2 + 15 - this.rodBend * 20;
        const midY = (baseY + tipY) / 2 - 20 + this.rodBend * 30;

        // 竿把（粗）
        ctx.strokeStyle = '#5d4037';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(midX, midY, tipX, tipY);
        ctx.stroke();

        // 竿身（细、渐变色）
        ctx.strokeStyle = '#795548';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(midX, midY, tipX, tipY);
        ctx.stroke();

        // 竿身高光
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(baseX + 2, baseY - 1);
        ctx.quadraticCurveTo(midX + 2, midY - 1, tipX, tipY);
        ctx.stroke();

        // 竿尖
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
        ctx.fill();

        // 把手缠绳
        ctx.strokeStyle = '#4e342e';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
            const t = 0.85 + i * 0.035;
            const hx = baseX + (tipX - baseX) * t * 0.3;
            const hy = baseY + (tipY - baseY) * t * 0.3;
            ctx.beginPath();
            ctx.arc(hx, hy, 5, 0, Math.PI * 2);
            ctx.stroke();
        }

        this._dynTipX = tipX;
        this._dynTipY = tipY;

        ctx.restore();
    }

    // ===== 鱼线 =====

    _drawLine(ctx) {
        ctx.save();

        const tipX = this._dynTipX || this.rodTipX;
        const tipY = this._dynTipY || this.rodTipY;
        let targetX = this.floatX;
        let targetY = this.floatY;

        if (this.gameState_ === STATE.CATCH_SUCCESS) {
            const t = Math.min(this.stateTimer / 0.8, 1);
            targetX = tipX + (this.floatX - tipX) * (1 - t);
            targetY = tipY + (this.floatY - tipY) * (1 - t);
        }

        if (this.gameState_ === STATE.BITING || this.gameState_ === STATE.REELING) {
            targetX += Math.sin(this.time * 15) * 3;
            targetY += Math.cos(this.time * 18) * 2;
        }

        const cpX = (tipX + targetX) / 2 - 10;
        const cpY = Math.min(tipY, targetY) - 15 + Math.sin(this.time * 2) * 3;

        // 鱼线阴影
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tipX + 1, tipY + 1);
        ctx.quadraticCurveTo(cpX + 1, cpY + 1, targetX + 1, targetY + 1);
        ctx.stroke();

        // 鱼线本体
        ctx.strokeStyle = 'rgba(220,220,220,0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.quadraticCurveTo(cpX, cpY, targetX, targetY);
        ctx.stroke();

        // 拉力条阶段：线紧绷度视觉
        if (this.gameState_ === STATE.REELING && this.isHolding) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(targetX, targetY); // 直线 = 紧绷
            ctx.stroke();
        }

        ctx.restore();
    }

    // ===== 浮标 =====

    _drawFloat(ctx) {
        ctx.save();

        let fX = this.floatX;
        let fY = this.floatY;

        fY += Math.sin(this.time * 2) * 2;

        if (this.gameState_ === STATE.BITING) {
            fY += 8 + Math.sin(this.time * 14) * 5;
            fX += Math.sin(this.time * 17) * 3;
        } else if (this.gameState_ === STATE.NIBBLE) {
            fY += Math.sin(this.time * 7) * 4;
        } else if (this.gameState_ === STATE.REELING) {
            fY += 4 + Math.sin(this.time * 10) * 3;
            fX += Math.sin(this.time * 8) * 2;
        }

        // 浮标本体（更精致）
        // 上半白
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(fX, fY - 2, 4, 6, 0, -Math.PI, 0);
        ctx.fill();
        // 下半红
        ctx.fillStyle = '#f44336';
        ctx.beginPath();
        ctx.ellipse(fX, fY - 2, 4, 6, 0, 0, Math.PI);
        ctx.fill();

        // 浮标杆
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fX, fY - 8);
        ctx.lineTo(fX, fY - 16);
        ctx.stroke();

        // 杆顶小球
        ctx.fillStyle = '#ff5722';
        ctx.beginPath();
        ctx.arc(fX, fY - 16, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    // ===== 时机条（BITING） =====

    _drawTimingBar(ctx) {
        if (this.gameState_ !== STATE.BITING) return;

        ctx.save();

        const barW = 300;
        const barH = 24;
        const barX = (this.W - barW) / 2;
        const barY = this.H * 0.72;
        const zones = FISHING_TIMING.zones;

        // 扁平化背景
        ctx.fillStyle = 'rgba(30, 30, 30, 0.6)';
        ctx.beginPath();
        ctx.roundRect(barX - 6, barY - 28, barW + 12, barH + 52, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 进度槽背景
        ctx.fillStyle = '#424242';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, 4);
        ctx.fill();

        // Good（黄）
        const goodStart = barW * (0.5 - zones.perfect / 2 - zones.good / 2);
        const goodWidth = barW * (zones.perfect + zones.good);
        ctx.fillStyle = '#ffa726';
        ctx.fillRect(barX + goodStart, barY, goodWidth, barH);

        // Perfect（绿，更亮）
        const perfStart = barW * (0.5 - zones.perfect / 2);
        const perfWidth = barW * zones.perfect;
        ctx.fillStyle = '#66bb6a';
        ctx.fillRect(barX + perfStart, barY, perfWidth, barH);
        
        // Perfect 区域高光
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(barX + perfStart, barY, perfWidth, barH/2);

        // 指针
        const pointerX = barX + this.pointerPos * barW;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(pointerX, barY - 4);
        ctx.lineTo(pointerX - 6, barY - 12);
        ctx.lineTo(pointerX + 6, barY - 12);
        ctx.closePath();
        ctx.fill();
        
        // 指针竖线
        ctx.fillStyle = '#fff';
        ctx.fillRect(pointerX - 1.5, barY, 3, barH);
        ctx.shadowBlur = 0;

        // 标签
        ctx.fillStyle = '#a5d6a7';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PERFECT', barX + perfStart + perfWidth / 2, barY + barH + 12);

        // 提示
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('🎣 点击 或 空格 收杆！', this.W / 2, barY + barH + 32);

        // 倒计时
        const remaining = Math.max(0, this.biteWindowTimer).toFixed(1);
        ctx.fillStyle = this.biteWindowTimer < 0.8 ? '#ef5350' : '#fff';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`${remaining}s`, this.W / 2, barY - 16);

        ctx.restore();
    }

    // ===== 拉力条（REELING） =====

    _drawTensionBar(ctx) {
        if (this.gameState_ !== STATE.REELING) return;

        ctx.save();

        // 拉力条（纵向，右侧）
        const barW = 24;
        const barH = 200;
        const barX = this.W - 60;
        const barY = (this.H - barH) / 2 - 10;

        // 背景面板
        ctx.fillStyle = 'rgba(30,30,30,0.6)';
        ctx.beginPath();
        ctx.roundRect(barX - 12, barY - 28, barW + 24, barH + 56, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 标题
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('张力', barX + barW / 2, barY - 10);

        // 条背景（渐变）
        const barGrad = ctx.createLinearGradient(0, barY, 0, barY + barH);
        barGrad.addColorStop(0, '#ef5350');     // 顶部红
        barGrad.addColorStop(0.2, '#66bb6a');   // 安全区绿
        barGrad.addColorStop(0.8, '#66bb6a');   // 安全区绿
        barGrad.addColorStop(1, '#ef5350');     // 底部红

        ctx.fillStyle = barGrad;
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, 4);
        ctx.fill();

        // 安全区指示线（虚线）
        const safeTopY = barY + barH * 0.2;
        const safeBotY = barY + barH * 0.8;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(barX, safeTopY);
        ctx.lineTo(barX + barW, safeTopY);
        ctx.moveTo(barX, safeBotY);
        ctx.lineTo(barX + barW, safeBotY);
        ctx.stroke();

        // 鱼目标指示（小鱼标记）
        const fishY = barY + this.fishTarget * barH;
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'right';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 2;
        ctx.fillText('🐟', barX - 4, fishY + 6);
        ctx.shadowBlur = 0;

        // 当前拉力指针
        const pointerY = barY + this.tensionValue * barH;
        const inSafe = this.tensionValue >= 0.2 && this.tensionValue <= 0.8;

        // 指针滑块
        ctx.fillStyle = inSafe ? '#fff' : '#ffcdd2';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.roundRect(barX - 4, pointerY - 5, barW + 8, 10, 4);
        ctx.fill();
        ctx.shadowBlur = 0;

        // 危险计时警告
        if (this.dangerTimer > 0.3) {
            const urgency = Math.min(this.dangerTimer / 2.0, 1);
            ctx.globalAlpha = 0.6 + Math.sin(this.time * 12) * 0.4;
            ctx.fillStyle = '#ff5252';
            ctx.font = `bold ${12 + urgency * 2}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('⚠ 危险！', barX + barW / 2, barY + barH + 18);
            ctx.globalAlpha = 1;
        }

        // === 进度条（底部水平） ===
        const progBarW = 200;
        const progBarH = 14;
        const progBarX = (this.W - progBarW) / 2 - 30;
        const progBarY = this.H * 0.83;

        // 进度背景
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.roundRect(progBarX - 4, progBarY - 4, progBarW + 8, progBarH + 8, 10);
        ctx.fill();

        ctx.fillStyle = '#424242';
        ctx.beginPath();
        ctx.roundRect(progBarX, progBarY, progBarW, progBarH, 6);
        ctx.fill();

        // 进度填充
        const progPct = this.reelProgress;
        if (progPct > 0) {
            const progColor = progPct > 0.8 ? '#66bb6a' : '#29b6f6';
            ctx.fillStyle = progColor;
            ctx.beginPath();
            ctx.roundRect(progBarX, progBarY, progBarW * progPct, progBarH, 6);
            ctx.fill();
            
            // 高光
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.beginPath();
            ctx.roundRect(progBarX, progBarY, progBarW * progPct, progBarH/2, 6);
            ctx.fill();
        }

        // 进度文字
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(progPct * 100)}%`, progBarX + progBarW / 2, progBarY + progBarH / 2 + 4);

        // 操作提示
        ctx.font = '13px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const holdTip = this.isHolding
            ? (inSafe ? '🎣 很好！保持住！' : '⚠ 拉力过大，松开！')
            : (this.tensionValue > 0.6 ? '👆 按住鼠标/空格 拉杆！' : '✋ 稍等，让鱼线松一下');
        ctx.fillText(holdTip, this.W / 2 - 30, progBarY + progBarH + 24);

        ctx.restore();
    }

    // ===== 空闲提示 =====

    _drawIdlePrompt(ctx) {
        if (this.gameState_ !== STATE.IDLE) return;

        ctx.save();

        // 呼吸动画
        const breathe = 1 + Math.sin(this.time * 2) * 0.03;

        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = `bold ${Math.round(18 * breathe)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('🎣 点击 或 按空格 开始钓鱼', this.W / 2, this.H * 0.72);

        const stock = this.state.fishing.fishStock;
        const cap = this.fishingSystem.pondCapacity;
        ctx.font = '14px sans-serif';
        ctx.fillStyle = stock > 0 ? 'rgba(0,0,0,0.4)' : '#c62828';
        ctx.fillText(`鱼塘存量：${stock}/${cap}`, this.W / 2, this.H * 0.77);

        // 连击显示（带火焰效果区域）
        if (this.state.fishing.combo > 0) {
            ctx.fillStyle = '#ff5722';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(`🔥 连击 ×${this.state.fishing.combo}`, this.W / 2, this.H * 0.83);
        }

        ctx.restore();
    }

    // ===== 未建造 =====

    _drawNotBuiltOverlay(ctx) {
        if (this.gameState_ !== STATE.NOT_BUILT) return;

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, this.W, this.H);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🎣 尚未建造鱼塘', this.W / 2, this.H * 0.4);

        ctx.font = '15px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('请先在「建设」面板中建造鱼塘（80💰 + 15🪵）', this.W / 2, this.H * 0.48);

        ctx.restore();
    }

    // ===== 结果覆盖层（增强动画） =====

    _drawResultOverlay(ctx) {
        if (this.gameState_ !== STATE.RESULT) return;

        ctx.save();

        // 动画进度
        const t = this.resultAnimProgress;
        const easeOut = 1 - Math.pow(1 - Math.min(t, 1), 3);  // cubic ease out
        const bounce = t < 1 ? (1 + Math.sin(t * Math.PI * 3) * (1 - t) * 0.15) : 1;

        if (this.catchResult && this.currentFish) {
            const fish = this.currentFish;
            const result = this.catchResult;
            const rarity = result.rarityConfig;

            // 背景渐变暗
            ctx.globalAlpha = easeOut * 0.5;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, this.W, this.H);
            ctx.globalAlpha = 1;

            // 稀有度背景光环
            if (fish.rarity !== 'common') {
                ctx.globalAlpha = easeOut * 0.2;
                const glowSize = 100 + easeOut * 50 + Math.sin(this.time * 3) * 10;
                const glowGrad = ctx.createRadialGradient(this.W / 2, this.H * 0.4, 0, this.W / 2, this.H * 0.4, glowSize);
                glowGrad.addColorStop(0, rarity.color);
                glowGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = glowGrad;
                ctx.fillRect(0, 0, this.W, this.H);
                ctx.globalAlpha = 1;
            }

            // 卡片
            const cardW = 280;
            const cardH = 200;
            const cardX = (this.W - cardW) / 2;
            const cardY = (this.H - cardH) / 2 - 20;
            const scale = easeOut * bounce;

            ctx.save();
            ctx.translate(this.W / 2, this.H / 2 - 20);
            ctx.scale(scale, scale);
            ctx.translate(-this.W / 2, -(this.H / 2 - 20));

            // 卡片阴影
            ctx.shadowColor = rarity.color;
            ctx.shadowBlur = fish.rarity === 'legendary' ? 40 : fish.rarity === 'rare' ? 25 : 12;
            ctx.fillStyle = 'rgba(255,255,255,0.96)';
            ctx.beginPath();
            ctx.roundRect(cardX, cardY, cardW, cardH, 14);
            ctx.fill();
            ctx.shadowBlur = 0;

            // 边框（动态发光）
            ctx.strokeStyle = rarity.color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.roundRect(cardX, cardY, cardW, cardH, 14);
            ctx.stroke();

            // 鱼图标（大号+呼吸）
            const iconScale = 1 + Math.sin(this.time * 3) * 0.05;
            ctx.font = `${Math.round(52 * iconScale)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(fish.icon, this.W / 2, cardY + 58);

            // 鱼名
            ctx.fillStyle = '#333';
            ctx.font = 'bold 22px sans-serif';
            ctx.fillText(fish.name, this.W / 2, cardY + 90);

            // 稀有度徽章
            ctx.fillStyle = rarity.color;
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(`★ ${rarity.name} ★`, this.W / 2, cardY + 112);

            // 描述
            ctx.fillStyle = '#888';
            ctx.font = '12px sans-serif';
            ctx.fillText(fish.description || '', this.W / 2, cardY + 132);

            // 价值（金色）— 基准参考价，实际售价取决于市场
            ctx.fillStyle = '#ff8f00';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(`基准价 ${result.estimatedValue}💰（实际售价看市场）`, this.W / 2, cardY + 160);

            // 新发现
            if (result.isNewDiscovery) {
                ctx.fillStyle = '#ff9800';
                ctx.font = 'bold 14px sans-serif';
                const newY = cardY + 182;
                ctx.fillText('📖 NEW! 图鉴新发现！', this.W / 2, newY);
            }

            ctx.restore();

            // 连击（卡片外）
            if (result.combo >= 3) {
                ctx.globalAlpha = easeOut;
                ctx.fillStyle = '#ff5722';
                ctx.font = 'bold 18px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`🔥 ${result.combo} 连击！`, this.W / 2, cardY + cardH + 35);
            }

        } else {
            // 失败
            ctx.globalAlpha = easeOut * 0.4;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, this.W, this.H);

            ctx.globalAlpha = easeOut;
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'center';
            const failScale = easeOut * bounce;
            ctx.save();
            ctx.translate(this.W / 2, this.H * 0.43);
            ctx.scale(failScale, failScale);
            ctx.fillText('💨 鱼跑了...', 0, 0);
            ctx.restore();

            ctx.globalAlpha = easeOut * 0.7;
            ctx.font = '14px sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText('点击继续', this.W / 2, this.H * 0.53);
        }

        ctx.restore();
    }

    // ===== 鱼存量 =====

    _drawFishStock(ctx) {
        if (this.gameState_ === STATE.NOT_BUILT) return;

        ctx.save();
        const stock = this.state.fishing.fishStock;
        const cap = this.fishingSystem.pondCapacity;

        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.roundRect(10, 10, 130, 36, 8);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`🐟 ${stock}/${cap}`, 20, 33);

        const barX = 78;
        const barY = 22;
        const barW = 52;
        const barH = 8;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, 3);
        ctx.fill();
        ctx.fillStyle = stock > 2 ? '#66bb6a' : stock > 0 ? '#ffa726' : '#ef5350';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW * (stock / cap), barH, 3);
        ctx.fill();

        ctx.restore();
    }

    // ===== 反馈文字 =====

    _addFeedbackText(text, x, y, color = '#fff', size = 20) {
        this.feedbackTexts.push({
            text, x, y, color, size,
            alpha: 1.0,
            vy: -40,
            life: 1.8,
            maxLife: 1.8,
            scale: 1.5, // 从大缩小
        });
    }

    _updateFeedbackTexts(dt) {
        for (let i = this.feedbackTexts.length - 1; i >= 0; i--) {
            const ft = this.feedbackTexts[i];
            ft.y += ft.vy * dt;
            ft.vy *= 0.95; // 减速
            ft.life -= dt;
            ft.alpha = Math.max(0, ft.life / ft.maxLife);
            ft.scale = 1 + (ft.life / ft.maxLife) * 0.3; // 缩放动画
            if (ft.life <= 0) this.feedbackTexts.splice(i, 1);
        }
    }

    _drawFeedbackTexts(ctx) {
        ctx.save();
        ctx.textAlign = 'center';
        for (const ft of this.feedbackTexts) {
            ctx.globalAlpha = ft.alpha;
            ctx.save();
            ctx.translate(ft.x, ft.y);
            ctx.scale(ft.scale, ft.scale);
            // 文字描边
            ctx.strokeStyle = 'rgba(0,0,0,0.5)';
            ctx.lineWidth = 3;
            ctx.font = `bold ${ft.size}px sans-serif`;
            ctx.strokeText(ft.text, 0, 0);
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, 0, 0);
            ctx.restore();
        }
        ctx.restore();
    }

    // ===== DOM 控制区 =====

    _updateControls() {
        const controls = document.getElementById('fishing-controls');
        if (!controls) return;

        if (this.gameState_ === STATE.NOT_BUILT) {
            controls.innerHTML = `
                <p class="text-muted" style="text-align:center;padding:8px;">
                    请先在「🏗️ 建设」面板中建造鱼塘
                </p>
            `;
            return;
        }
        controls.innerHTML = '';
    }

    _updateHUD() {
        const hud = document.getElementById('fishing-hud');
        if (!hud) return;

        switch (this.gameState_) {
            case STATE.WAITING:
                hud.innerHTML = '<div class="fishing-hud-text">🎣 等待鱼上钩...</div>';
                break;
            case STATE.NIBBLE:
                hud.innerHTML = '<div class="fishing-hud-text fishing-hud-alert">⚡ 有动静了！</div>';
                break;
            case STATE.BITING:
                hud.innerHTML = '<div class="fishing-hud-text fishing-hud-urgent">🔥 鱼咬钩了！快点击！</div>';
                break;
            case STATE.REELING:
                hud.innerHTML = '<div class="fishing-hud-text fishing-hud-alert">🎣 按住拉杆！保持绿区！</div>';
                break;
            default:
                hud.innerHTML = '';
        }
    }

    _updateInfoBar() {
        const bar = document.getElementById('fishing-info-bar');
        if (!bar) return;

        if (!this.fishingSystem.isPondBuilt) {
            bar.innerHTML = '<span class="text-muted">未建造鱼塘</span>';
            return;
        }

        const fishing = this.state.fishing;
        const pondConfig = this.fishingSystem.currentPondConfig;
        const combo = fishing.combo;
        const total = fishing.totalCaught;
        const collection = this.fishingSystem.getCollectionProgress();

        bar.innerHTML = `
            <span>🏷️ ${pondConfig.name}</span>
            <span>🐟 ${fishing.fishStock}/${this.fishingSystem.pondCapacity}</span>
            <span>📖 ${collection.discovered}/${collection.total}</span>
            ${combo > 0 ? `<span class="fishing-combo">🔥 ×${combo}</span>` : ''}
            <span>🎣 累计${total}条</span>
        `;
    }

    _updateBaitBar() {
        const bar = document.getElementById('fishing-bait-bar');
        if (!bar) return;

        const baits = this.fishingSystem.getBaitList();
        bar.innerHTML = baits.map(bait => `
            <button class="fishing-bait-btn ${bait.active ? 'active' : ''} ${!bait.unlocked ? 'locked' : ''}"
                    data-bait="${bait.id}" title="${bait.description}${!bait.unlocked ? '\n' + bait.unlockCondition : ''}">
                ${bait.icon} ${bait.name}
                ${!bait.unlocked ? '🔒' : ''}
            </button>
        `).join('');

        bar.querySelectorAll('.fishing-bait-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const baitId = btn.dataset.bait;
                if (this.fishingSystem.setBait(baitId)) {
                    this._updateBaitBar();
                }
            });
        });
    }

    // ===== 图鉴弹窗 =====

    _showCollectionModal() {
        const details = this.fishingSystem.getCollectionDetails();
        const progress = this.fishingSystem.getCollectionProgress();
        const rewards = this.fishingSystem.getAvailableRewards();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '10001';

        const fishCards = details.map(fish => `
            <div class="collection-card ${fish.discovered ? 'discovered' : 'undiscovered'}"
                 style="border-color: ${fish.discovered ? fish.rarityConfig.color : '#ccc'}">
                <div class="collection-icon">${fish.discovered ? fish.icon : '❓'}</div>
                <div class="collection-name">${fish.discovered ? fish.name : '???'}</div>
                ${fish.discovered ? `
                    <div class="collection-rarity" style="color:${fish.rarityConfig.color}">
                        ${fish.rarityConfig.name}
                    </div>
                    <div class="collection-count">×${fish.count}</div>
                ` : `
                    <div class="collection-rarity">未发现</div>
                `}
            </div>
        `).join('');

        const rewardRows = rewards.map(r => `
            <div class="collection-reward ${r.claimed ? 'claimed' : r.unlocked ? 'unlocked' : 'locked'}">
                <span>${r.icon}</span>
                <span>${r.threshold}种</span>
                <span>${r.name}</span>
                <span>${r.reward}</span>
                <span>${r.claimed ? '✅ 已领取' : r.unlocked ? '🎁 可领取' : '🔒'}</span>
            </div>
        `).join('');

        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:550px;max-height:80vh;overflow-y:auto;">
                <div class="modal-title">📖 鱼类图鉴</div>
                <div class="modal-body">
                    <div class="collection-progress">
                        收集进度：${progress.discovered}/${progress.total}（${progress.percentage}%）
                    </div>
                    <div class="collection-grid">${fishCards}</div>
                    <hr class="divider">
                    <h4 style="margin:8px 0;">🏆 图鉴奖励</h4>
                    <div class="collection-rewards">${rewardRows}</div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary collection-close">关闭</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('.collection-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelectorAll('.collection-reward.unlocked:not(.claimed)').forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                this.fishingSystem.checkCollectionRewards();
                overlay.remove();
                this._showCollectionModal();
            });
        });
    }

    // ===== 玩法说明 =====

    _showHelpModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '10001';

        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:520px;max-height:80vh;overflow-y:auto;">
                <div class="modal-title">🎣 钓鱼玩法说明</div>
                <div class="modal-body" style="line-height:1.9;text-align:left;">

                    <h4 style="margin:0 0 6px;">📌 基本流程</h4>
                    <p>钓鱼分为三个阶段，支持<b>鼠标点击</b>和<b>空格键</b>操作：</p>

                    <div style="background:var(--surface,#f5f5f5);border-radius:10px;padding:12px 14px;margin:8px 0 14px;">
                        <div style="margin-bottom:10px;">
                            <b>① 抛竿</b> — 点击画面 或 按<kbd style="background:#eee;padding:1px 6px;border-radius:3px;border:1px solid #ccc;font-size:12px;">空格</kbd><br>
                            <span style="color:var(--text-secondary,#666);font-size:13px;">
                                鱼线抛入水中，浮标入水后开始等待。<br>
                                水面会冒出气泡，气泡越密集说明鱼越近！
                            </span>
                        </div>
                        <div style="margin-bottom:10px;">
                            <b>② 收杆时机</b> — 鱼咬钩后点击画面 或 按<kbd style="background:#eee;padding:1px 6px;border-radius:3px;border:1px solid #ccc;font-size:12px;">空格</kbd><br>
                            <span style="color:var(--text-secondary,#666);font-size:13px;">
                                浮标剧烈下沉时，屏幕下方出现<b style="color:#43a047;">时机条</b>。<br>
                                指针在条上左右移动，点击画面收杆：<br>
                                · 命中 <b style="color:#43a047;">绿色区（PERFECT）</b>→ 收获加成 +50%，初始进度 30%<br>
                                · 命中 <b style="color:#f9a825;">黄色区（GOOD）</b>→ 正常收获<br>
                                · 命中 <b style="color:#d32f2f;">红色区（MISS）</b>→ 鱼跑了！
                            </span>
                        </div>
                        <div>
                            <b>③ 拉杆搏斗</b> — 按住/松开 控制拉力<br>
                            <span style="color:var(--text-secondary,#666);font-size:13px;">
                                收杆成功后进入搏斗阶段！右侧出现<b style="color:#43a047;">拉力条</b>：<br>
                                · <b>按住</b>鼠标/屏幕 或 <b>按住</b><kbd style="background:#eee;padding:1px 6px;border-radius:3px;border:1px solid #ccc;font-size:11px;">空格</kbd> = 拉紧鱼线（指针上移）<br>
                                · <b>松开</b> = 鱼线放松（指针下沉）<br>
                                · 保持指针在 <b style="color:#43a047;">绿色安全区</b> 内，底部进度条逐渐填满<br>
                                · 观察 🐟 鱼标记可预判鱼的挣扎方向<br>
                                · 在红色区停留过久会断线（有倒计时警告）<br>
                                · 提示文字会告诉你该拉还是该松<br>
                                · 进度条 100% → 钓鱼成功！
                            </span>
                        </div>
                    </div>

                    <hr class="divider">
                    <h4 style="margin:0 0 6px;">💡 技巧提示</h4>
                    <p style="font-size:13px;">
                        · <b>连击</b>：连续成功不跑鱼，连击数越高视觉特效越酷炫<br>
                        · <b>鱼饵</b>：收集更多鱼种可解锁高级鱼饵，提高稀有鱼概率<br>
                        · <b>天气</b>：雨天鱼更活跃（上钩快+稀有率↑），暴风雨/暴风雪无法钓鱼<br>
                        · <b>季节</b>：不同季节出现不同鱼种，秋季限定「鳜鱼」很值钱！<br>
                        · <b>鱼塘</b>：每次钓鱼消耗 1 条存量，每条鱼需 2 天恢复，升级鱼塘可增加容量<br>
                        · <b>卖鱼</b>：钓到的鱼自动进入仓库，可在「市场」面板出售赚钱
                    </p>

                    <hr class="divider">
                    <h4 style="margin:0 0 6px;">🐟 稀有度一览</h4>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:13px;">
                        <span style="padding:3px 10px;border-radius:12px;background:#e0e0e0;">⬜ 普通 60%</span>
                        <span style="padding:3px 10px;border-radius:12px;background:#bbdefb;color:#1565c0;">🟦 优质 25%</span>
                        <span style="padding:3px 10px;border-radius:12px;background:#e1bee7;color:#7b1fa2;">🟪 稀有 12%</span>
                        <span style="padding:3px 10px;border-radius:12px;background:#ffe0b2;color:#e65100;">🟨 传说 3%</span>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary fishing-help-close">知道了，开始钓鱼！</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('.fishing-help-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    // ===== 升级鱼塘 =====

    _updateUpgradeBtn() {
        const btn = document.getElementById('fishing-upgrade-btn');
        if (!btn) return;

        if (!this.fishingSystem.isPondBuilt) {
            btn.textContent = '⬆️ 升级鱼塘';
            btn.disabled = true;
            return;
        }

        const next = this.fishingSystem.nextPondConfig;
        if (!next) {
            btn.innerHTML = '✅ 满级';
            btn.disabled = true;
            return;
        }

        const r = this.state.resources;
        const cost = next.upgradeCost;
        const canAfford = r.gold >= (cost.gold || 0) && r.wood >= (cost.wood || 0) && r.stone >= (cost.stone || 0);

        const costParts = [];
        if (cost.gold) costParts.push(`<span style="color:${r.gold >= cost.gold ? 'inherit' : 'var(--color-danger)'}">${cost.gold}💰</span>`);
        if (cost.wood) costParts.push(`<span style="color:${r.wood >= cost.wood ? 'inherit' : 'var(--color-danger)'}">${cost.wood}🪵</span>`);
        if (cost.stone) costParts.push(`<span style="color:${r.stone >= cost.stone ? 'inherit' : 'var(--color-danger)'}">${cost.stone}🪨</span>`);

        const current = this.fishingSystem.currentPondConfig;
        btn.innerHTML = `⬆️ 升级 ${current.capacity}→${next.capacity} ${costParts.join('+')}`;
        btn.disabled = !canAfford;
    }

    _handleUpgrade() {
        const result = this.fishingSystem.upgradePond();
        if (!result.success) {
            this._addFeedbackText(result.reason, this.W / 2, this.H * 0.6, '#c62828');
        } else {
            this._addFeedbackText('⬆️ 鱼塘升级成功！', this.W / 2, this.H * 0.4, '#4caf50', 24);
            this._addStarBurst(this.W / 2, this.H * 0.4, '#4caf50');
            this._triggerShake(5);
        }
        this._updateInfoBar();
        this._updateUpgradeBtn();
    }
}
