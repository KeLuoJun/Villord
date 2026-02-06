/**
 * TutorialSystem - 新手引导系统
 * 新游戏开局：暂停状态下依次展示教程，每步需玩家确认，全部完成后自动开始
 * 第2天+：后续引导通过tick触发
 */

export class TutorialSystem {
    constructor(gameState, eventBus, uiManager) {
        this.state = gameState;
        this.bus = eventBus;
        this.ui = uiManager;

        this.completedSteps = new Set();
        this.initialTutorialDone = false; // 开局教程是否已完成

        this.bus.on('tick', (data) => this.onTick(data));
        this.bus.on('cropHarvested', () => this.checkHarvestGuide());
        this.bus.on('buildingBuilt', () => this.checkBuildGuide());
    }

    /**
     * 新游戏开局教程序列（在游戏暂停状态下执行）
     * 每个提示需要玩家确认后才展示下一个
     * 全部完成后调用 onComplete 回调（用于自动开始时间）
     */
    showInitialTutorial(onComplete) {
        const steps = [
            {
                id: 'welcome',
                title: '🏘️ 欢迎来到桃源村！',
                content: `
                    <p>你好，新村长！我是系统助手。</p>
                    <p>桃源村现在只有<b>1块农田</b>、<b>1座茅草屋</b>和一位村民<b>小青</b>。</p>
                    <hr class="divider">
                    <p>你的目标是将这个小村庄建设成繁荣社区，<b>繁荣度达到100</b>即为通关！</p>
                `,
                buttonText: '了解！继续 →',
                step: '1/5',
            },
            {
                id: 'layout_intro',
                title: '📋 界面说明',
                content: `
                    <p>👈 <b>左侧面板</b>：资源状态、市场价格、村民一览</p>
                    <p>📋 <b>中央区域</b>：建设/村民/农场/市场/事件 五大标签页</p>
                    <p>👉 <b>右侧面板</b>：村庄概况、天气预报、近期事件</p>
                    <p>💬 <b>底部栏</b>：选择村民进行对话，安排任务</p>
                    <hr class="divider">
                    <p>📦 每种资源都有<b>仓库容量上限</b>，注意不要堆满！可以通过升级仓库扩大容量。</p>
                `,
                buttonText: '明白了 →',
                step: '2/5',
            },
            {
                id: 'time_control',
                title: '⏰ 时间与操作',
                content: `
                    <p>游戏以 <b>Tick</b> 为单位推进时间，1 Tick = 1 游戏小时 = 现实 3 秒（1倍速），1天 = 24小时。</p>
                    <p><b>1季 = 9天</b>，春→夏→秋→冬循环，<b>1年 = 4季 = 36天</b>。</p>
                    <hr class="divider">
                    <p>⏸ <b>空格键</b> — 暂停/恢复游戏</p>
                    <p>⏩ <b>右上角按钮</b> — 调整速度（0.5x / 1x / 1.2x）</p>
                    <p>💾 <b>Ctrl+S</b> 存档　<b>Ctrl+L</b> 读档</p>
                    <hr class="divider">
                    <p>⚡ 重要事件会<b>自动暂停</b>游戏，让你有时间做决策。</p>
                `,
                buttonText: '记住了 →',
                step: '3/5',
            },
            {
                id: 'weather_intro',
                title: '🌤️ 天气与市场',
                content: `
                    <p>🌸 每天早上 <b>5:00</b> 会有天气播报，不同天气影响作物和村民。</p>
                    <p>📅 AI 天气预报员会预测未来 14 天的天气。</p>
                    <hr class="divider">
                    <p>🏪 <b>市场开放时间：9:00 - 15:00</b>，非营业时间无法交易。</p>
                    <p>🛒 市场价格随<b>供需、季节、天气</b>波动。</p>
                    <p>☀️ 每天 <b>6:00</b> AI 分析师发布<b>早报</b>（走势预测）</p>
                    <p>🌙 每天 <b>16:00</b> 发布<b>晚报</b>（交易回顾 + 毒舌点评）</p>
                    <p>💡 低买高卖，把握商机！</p>
                `,
                buttonText: '了解 →',
                step: '4/5',
            },
            {
                id: 'first_action',
                title: '🌱 第一步行动',
                content: `
                    <p>准备好了吗？以下是你的第一步行动建议：</p>
                    <hr class="divider">
                    <p>1️⃣ 点击「<b>🌾 农场</b>」标签，在农田里种下<b>萝卜</b>（最快3天成熟）</p>
                    <p>2️⃣ 通过<b>底部对话栏</b>与村民小青交流，安排她去浇水</p>
                    <p>3️⃣ 等萝卜成熟后去「<b>🛒 市场</b>」卖掉赚金币</p>
                    <p>4️⃣ 攒够金币后建造房屋，招募更多村民！</p>
                    <hr class="divider">
                    <p>🎮 教程结束，游戏即将开始！祝你好运，村长！</p>
                `,
                buttonText: '🚀 开始游戏！',
                step: '5/5',
            },
        ];

        // 按序展示每个步骤
        let currentIndex = 0;
        const showNext = () => {
            if (currentIndex >= steps.length) {
                // 所有教程完成
                this.initialTutorialDone = true;
                // 标记所有初始步骤为已完成
                steps.forEach(s => this.completedSteps.add(s.id));
                if (onComplete) onComplete();
                return;
            }

            const step = steps[currentIndex];
            currentIndex++;
            this.showSequentialGuide(step, showNext);
        };

        showNext();
    }

    /** 显示单个序列教程弹窗，确认后调用 onConfirm */
    showSequentialGuide(config, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '10000';
        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:500px;">
                <div class="modal-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>${config.title}</span>
                    ${config.step ? `<span style="font-size:12px;color:var(--text-secondary);font-weight:400;">${config.step}</span>` : ''}
                </div>
                <div class="modal-body" style="line-height:1.8;">${config.content}</div>
                <div class="modal-actions">
                    <button class="btn btn-primary guide-confirm" style="min-width:140px;">${config.buttonText || '下一步'}</button>
                </div>
            </div>
        `;

        overlay.querySelector('.guide-confirm').addEventListener('click', () => {
            overlay.remove();
            if (onConfirm) onConfirm();
        });

        // 序列教程不允许点击背景关闭
        document.body.appendChild(overlay);
    }

    /** 每 Tick 检查引导步骤（第2天+的后续引导） */
    onTick(data) {
        const day = this.state.time.day;
        const hour = data.hour;

        // 第1天的引导已在开局教程中完成，跳过
        if (day === 1) {
            // 第1天 8:00 - 如果还没种植，给个 toast 提示
            if (hour === 8 && !this.completedSteps.has('plant_hint')) {
                const hasPlanted = this.state.plots.some(p => p.crop);
                if (!hasPlanted) {
                    this.ui.showToast('💡 提示：去农场标签页种植萝卜吧！', 'info');
                    this.completedSteps.add('plant_hint');
                }
            }
            return;
        }

        // === 第2天 ===

        // 第2天 - 提示对话系统
        if (day === 2 && hour === 7 && !this.completedSteps.has('chat_hint')) {
            this.showGuide('chat_hint', {
                title: '💬 与村民对话',
                content: `
                    <p>你可以通过<b>底部对话栏</b>与村民交流！</p>
                    <p>选择村民后输入文字，小青会根据自己的性格回应你。</p>
                    <hr class="divider">
                    <p>🎯 试试跟小青说："今天去浇水吧"</p>
                    <p>小青的性格是<b>勤劳·乐观</b>，会积极响应哦！</p>
                    <hr class="divider">
                    <p>💡 凌晨0-4点对话可以直接安排村民明天的计划！</p>
                `,
                buttonText: '好的，去聊聊',
            });
        }

        // === 第3天 ===

        // 第3天 - 市场提示 + 萝卜可能成熟
        if (day === 3 && hour === 7 && !this.completedSteps.has('market_hint')) {
            this.showGuide('market_hint', {
                title: '🛒 市场开放了！',
                content: `
                    <p>市场可以交易了！<b>营业时间 9:00 - 15:00</b></p>
                    <p>你可以<b>买入种子</b>和<b>卖出收获的作物</b>来赚取金币。</p>
                    <hr class="divider">
                    <p>📈 市场价格会根据供需变化波动</p>
                    <p>☀️ 每天6点有<b>早报</b>（预测走势），16点有<b>晚报</b>（回顾点评）</p>
                    <p>💡 低买高卖是致富之道！</p>
                `,
                buttonText: '去看看市场',
            });
        }

        // === 第4-5天 ===

        // H: 第4天 - 经济介绍（市场分析报告解读）
        if (day === 4 && hour === 8 && !this.completedSteps.has('economy_intro')) {
            this.showGuide('economy_intro', {
                title: '📊 经济系统说明',
                content: `
                    <p>村庄经济是这个游戏的核心之一！</p>
                    <hr class="divider">
                    <p>🏪 <b>市场营业</b>：9:00 - 15:00 开放交易</p>
                    <p>☀️ <b>早报</b>（6:00）：AI分析师预测今日走势和买卖建议</p>
                    <p>🌙 <b>晚报</b>（16:00）：回顾市场+点评你的交易操作</p>
                    <p>📈 <b>价格波动</b>：受供需、季节、天气和虚拟交易者影响</p>
                    <p>💰 <b>金币管理</b>：建造/招募需要金币，卖作物是主要收入</p>
                    <hr class="divider">
                    <p>💡 关注早报预测，在市场开放时间内把握交易时机！</p>
                `,
                buttonText: '了解了',
            });
        }

        // H: 第5天 - 资源管理提示
        if (day === 5 && hour === 8 && !this.completedSteps.has('resource_hint')) {
            this.showGuide('resource_hint', {
                title: '🌾 资源管理',
                content: `
                    <p>别忘了管理好村庄的资源！</p>
                    <hr class="divider">
                    <p>🌾 <b>粮食</b>：每个村民每天消耗1单位，粮食耗尽村民会挨饿。</p>
                    <p>🪵 <b>木材</b>：冬天需要额外木材取暖，建造也需要。</p>
                    <p>🪨 <b>石料</b>：高级建筑需要石料。</p>
                    <hr class="divider">
                    <p>💡 提前储备粮食和木材，为冬天做好准备！</p>
                `,
                buttonText: '记住了',
            });
        }

        // === 第6-7天 ===

        // 第6天 - 扩张引导
        if (day === 6 && hour === 7 && !this.completedSteps.has('expand_hint')) {
            this.showGuide('expand_hint', {
                title: '🏗️ 是时候扩建了！',
                content: `
                    <p>村庄已经运作了几天，是时候考虑扩建了！</p>
                    <hr class="divider">
                    <p>🏠 <b>建造房屋</b> → 才能招募更多村民</p>
                    <p>🌾 <b>扩建农田</b> → 种更多作物</p>
                    <p>🪓 <b>建伐木场/采石场</b> → 每日获取木材/石料</p>
                    <hr class="divider">
                    <p>💡 去「建设」标签页看看吧！</p>
                `,
                buttonText: '开始扩建',
            });
        }

        // H: 第7天 - 招募引导
        if (day === 7 && hour === 7 && !this.completedSteps.has('recruit_hint')) {
            const hasExtraHouse = this.state.buildings.filter(b => b.type === 'house' || b.type === 'thatchHouse').length >= 2;
            if (hasExtraHouse) {
                this.showGuide('recruit_hint', {
                    title: '👥 招募新村民',
                    content: `
                        <p>你已经有了额外的房屋，可以招募新村民了！</p>
                        <hr class="divider">
                        <p>🎲 招募是<b>盲抽</b>机制 — 你无法提前知道村民的性格和特长。</p>
                        <p>💰 每次招募需要<b>50金币</b>。</p>
                        <p>🎭 每个村民都有独特的性格组合，会影响工作表现和对话风格。</p>
                        <hr class="divider">
                        <p>💡 去村民管理页面试试招募吧！</p>
                    `,
                    buttonText: '去看看',
                });
            } else {
                // 没有额外房屋，提示先建房
                this.ui.showToast('💡 提示：建造房屋后就能招募新村民了！', 'info');
                this.completedSteps.add('recruit_hint');
            }
        }
    }

    /** 收获引导 */
    checkHarvestGuide() {
        if (this.completedSteps.has('first_harvest')) return;
        this.completedSteps.add('first_harvest');

        this.ui.showToast('🎉 第一次收获！去市场卖了赚钱吧！', 'success');
    }

    /** 建造引导 */
    checkBuildGuide() {
        if (this.completedSteps.has('first_build')) return;
        if (this.state.buildings.length <= 2) return; // 初始的2个不算

        this.completedSteps.add('first_build');
        this.ui.showToast('🏗️ 村庄在壮大！继续加油！', 'success');
    }

    /** 显示引导弹窗（不暂停游戏） */
    showGuide(stepId, config) {
        if (this.completedSteps.has(stepId)) return;
        this.completedSteps.add(stepId);

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal fade-in" style="max-width:480px;">
                <div class="modal-title">${config.title}</div>
                <div class="modal-body" style="line-height:1.8;">${config.content}</div>
                <div class="modal-actions">
                    <button class="btn btn-primary guide-ok">${config.buttonText || '知道了'}</button>
                </div>
            </div>
        `;

        overlay.querySelector('.guide-ok').addEventListener('click', () => overlay.remove());

        document.body.appendChild(overlay);
    }
}
