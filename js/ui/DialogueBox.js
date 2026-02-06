/**
 * DialogueManager - 对话框管理
 * 处理对话 UI 的显示、消息收发、快捷选项
 */

export class DialogueManager {
    constructor(gameState, eventBus, villagerAI, uiManager) {
        this.state = gameState;
        this.bus = eventBus;
        this.villagerAI = villagerAI;
        this.ui = uiManager;
        this.timeSystem = null; // 由 main.js 注入

        this.currentVillager = null;
        this.isLoading = false;
        this.wasPausedBeforeDialogue = false; // 记录对话前是否已暂停

        // 监听事件
        this.bus.on('openDialogue', (data) => this.open(data.villagerId));
        this.bus.on('playerChat', (data) => this.handleChat(data.villagerId, data.text));
        this.bus.on('showToast', (data) => this.ui.showToast(data.message, data.type));
    }

    /** 注入 TimeSystem */
    setTimeSystem(timeSystem) {
        this.timeSystem = timeSystem;
    }

    /** 关闭对话框并恢复游戏 */
    closeDialogue(overlay) {
        // 如果有待处理的消息（AI还在回复中），先保存玩家消息到历史
        if (this._pendingPlayerMessage && this.currentVillager) {
            if (!Array.isArray(this.currentVillager.dialogueHistory)) {
                this.currentVillager.dialogueHistory = [];
            }
            this.currentVillager.dialogueHistory.push({
                player: this._pendingPlayerMessage,
                villager: '（等待回复中被关闭）',
                time: `第${this.state.time.day}天 ${String(this.state.time.hour).padStart(2, '0')}:00`,
                dateLabel: `第${this.state.time.year}年·${this.state.seasonName} 第${this.state.time.day}天`,
            });
            this._pendingPlayerMessage = null;
            // 触发自动存档
            this.bus.emit('dialogueSaved', { villagerId: this.currentVillager.id });
        }

        if (overlay && overlay.parentNode) overlay.remove();
        this.currentVillager = null;
        // 只有对话前游戏不是暂停状态时才自动恢复
        if (!this.wasPausedBeforeDialogue && this.timeSystem) {
            this.timeSystem.resume();
        }
    }

    /** 打开对话框 */
    open(villagerId) {
        const villager = this.state.villagers.find(v => v.id === villagerId);
        if (!villager) return;

        this.currentVillager = villager;

        // 记录对话前的暂停状态，然后暂停游戏
        this.wasPausedBeforeDialogue = this.state.time.isPaused;
        if (this.timeSystem && !this.state.time.isPaused) {
            this.timeSystem.pause();
        }

        // 移除已有对话框
        const existing = document.querySelector('.dialogue-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'dialogue-overlay';
        overlay.innerHTML = this.renderDialogueBox(villager);

        // 绑定事件 - 关闭时恢复游戏
        overlay.querySelector('.close-btn').addEventListener('click', () => this.closeDialogue(overlay));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeDialogue(overlay);
        });

        // 输入框
        const input = overlay.querySelector('.dialogue-input input');
        const sendBtn = overlay.querySelector('.dialogue-input .send-btn');

        const send = () => {
            const text = input.value.trim();
            if (!text || this.isLoading) return;
            input.value = '';
            this.sendMessage(villager, text, overlay);
        };

        sendBtn.addEventListener('click', send);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') send();
        });

        document.body.appendChild(overlay);
        input.focus();

        // 渲染历史消息
        this.renderHistory(villager, overlay);
    }

    /** 渲染对话框 HTML */
    renderDialogueBox(villager) {
        const moodEmoji = villager.mood >= 12 ? '😊' : villager.mood >= 6 ? '😐' : '😟';
        const staminaPercent = Math.round((villager.stamina / villager.maxStamina) * 100);

        return `
            <div class="dialogue-box fade-in">
                <div class="dialogue-header">
                    <span class="dialogue-title">${villager.avatar || '👤'} 与 ${villager.name} 对话</span>
                    <button class="close-btn">✕</button>
                </div>
                <div class="dialogue-status">
                    <span class="status-item">👤 ${villager.name}</span>
                    <span class="status-item">${moodEmoji} <span class="status-value">${villager.mood}</span></span>
                    <span class="status-item">💪 <span class="status-value">${villager.stamina}/${villager.maxStamina}</span></span>
                    <span class="status-item">🎯 ${Math.round(villager.accuracy * 100)}%</span>
                    <span class="status-item">⚡ ${Math.round(villager.workSpeed * 100)}%</span>
                </div>
                <div class="dialogue-status" style="font-size:12px;color:var(--text-secondary);">
                    性格：${villager.traits.join(' · ')}　特长：${villager.specialty}
                </div>
                <div class="dialogue-messages" id="dialogue-messages">
                    <!-- 消息由 JS 动态添加 -->
                </div>
                <div class="dialogue-options" id="dialogue-options">
                    <!-- 快捷选项 -->
                </div>
                <div class="dialogue-input">
                    <input type="text" placeholder="输入你想对${villager.name}说的话..." />
                    <button class="send-btn">发送</button>
                </div>
            </div>
        `;
    }

    /** 渲染历史消息（含日期分隔线） */
    renderHistory(villager, overlay) {
        const container = overlay.querySelector('#dialogue-messages');

        // 安全检查：确保 dialogueHistory 存在
        if (!Array.isArray(villager.dialogueHistory)) {
            villager.dialogueHistory = [];
        }

        const recent = villager.dialogueHistory.slice(-20);

        if (recent.length === 0) {
            this.addSystemMessage(container, `这是你第一次与${villager.name}对话`);
            return;
        }

        let lastDateLabel = '';
        recent.forEach(d => {
            // 插入日期分隔线（当日期变化时）
            const dateLabel = d.dateLabel || d.time?.split(' ')[0] || '';
            if (dateLabel && dateLabel !== lastDateLabel) {
                this.addDateSeparator(container, dateLabel);
                lastDateLabel = dateLabel;
            }
            this.addMessageBubble(container, d.player, 'player');
            this.addMessageBubble(container, d.villager, 'villager', villager.name);
        });

        container.scrollTop = container.scrollHeight;
    }

    /** 添加日期分隔线 */
    addDateSeparator(container, dateText) {
        const sep = document.createElement('div');
        sep.className = 'message-date-separator';
        sep.innerHTML = `<span>${dateText}</span>`;
        sep.style.cssText = 'display:flex;align-items:center;justify-content:center;margin:12px 0 8px;gap:8px;font-size:11px;color:var(--text-muted, #999);';
        // 左右横线
        const line = 'flex:1;height:1px;background:var(--border, #ddd);';
        sep.innerHTML = `<span style="${line}"></span><span style="padding:0 10px;white-space:nowrap;">${dateText}</span><span style="${line}"></span>`;
        container.appendChild(sep);
    }

    /** 发送消息并获取 AI 回复 */
    async sendMessage(villager, text, overlay) {
        if (this.isLoading) return;

        const container = overlay.querySelector('#dialogue-messages');
        const optionsContainer = overlay.querySelector('#dialogue-options');

        // 添加玩家消息
        this.addMessageBubble(container, text, 'player');

        // 记录待发送消息（防止关闭对话框时丢失）
        this._pendingPlayerMessage = text;

        // 显示加载
        this.isLoading = true;
        const loadingMsg = this.addMessageBubble(container, '正在思考...', 'loading', villager.name);
        container.scrollTop = container.scrollHeight;

        try {
            // AI LOGIC - 调用村民 AI
            const response = await this.villagerAI.handlePlayerChat(villager, text);

            // 清除待发送标记
            this._pendingPlayerMessage = null;

            // 移除加载消息（如果对话框仍存在）
            if (loadingMsg.parentNode) loadingMsg.remove();
            this.isLoading = false;

            // 如果对话框已被关闭，跳过 UI 更新（消息已通过 VillagerAI.saveDialogue 保存）
            if (!overlay.parentNode) return;

            // 添加村民回复（流式逐字显示）
            const replyMsg = this.addMessageBubble(container, '', 'villager', villager.name);
            await this.typewriterEffect(replyMsg.querySelector('.message-bubble'), response.reply);
            container.scrollTop = container.scrollHeight;

            // 更新快捷选项
            optionsContainer.innerHTML = '';
            if (response.options && response.options.length > 0) {
                response.options.forEach(opt => {
                    const btn = document.createElement('button');
                    btn.className = 'option-btn';
                    btn.textContent = `💬 "${opt.text}"`;
                    btn.addEventListener('click', () => {
                        optionsContainer.innerHTML = '';
                        this.sendMessage(villager, opt.text, overlay);
                    });
                    optionsContainer.appendChild(btn);
                });
            }

            // 更新状态显示
            this.updateDialogueStatus(villager, overlay);

            // 通知 UI 更新
            this.bus.emit('uiUpdate', {});
        } catch (err) {
            console.error('[DialogueBox] 发送消息失败:', err);
            this._pendingPlayerMessage = null;
            if (loadingMsg.parentNode) loadingMsg.remove();
            this.isLoading = false;

            // 如果对话框仍存在，显示错误提示
            if (overlay.parentNode) {
                this.addSystemMessage(container, '⚠️ 回复失败，请重试');
                container.scrollTop = container.scrollHeight;
            }
        }
    }

    /** 添加消息气泡 */
    addMessageBubble(container, text, type, name = '') {
        const msg = document.createElement('div');
        msg.className = `message ${type}`;

        const villagerAvatar = this.currentVillager?.avatar || '👤';
        const avatar = type === 'player' ? '🏠' :
                       type === 'loading' ? '💭' : villagerAvatar;

        msg.innerHTML = `
            <span class="message-avatar">${avatar}</span>
            <div class="message-bubble">${text}</div>
        `;

        container.appendChild(msg);
        return msg;
    }

    /** 流式逐字显示效果 */
    async typewriterEffect(element, text, speed = 30) {
        element.textContent = '';
        for (let i = 0; i < text.length; i++) {
            element.textContent += text[i];
            // 标点符号短暂停顿
            const delay = '，。！？、'.includes(text[i]) ? speed * 3 : speed;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    /** 添加系统消息 */
    addSystemMessage(container, text) {
        const msg = document.createElement('div');
        msg.className = 'message system';
        msg.innerHTML = `<div class="message-bubble">${text}</div>`;
        container.appendChild(msg);
    }

    /** 更新对话框状态 */
    updateDialogueStatus(villager, overlay) {
        const moodEmoji = villager.mood >= 12 ? '😊' : villager.mood >= 6 ? '😐' : '😟';
        const statusItems = overlay.querySelectorAll('.dialogue-status .status-value');
        if (statusItems[0]) statusItems[0].textContent = villager.mood;
        if (statusItems[1]) statusItems[1].textContent = `${villager.stamina}/${villager.maxStamina}`;
    }

    /** 通过底部栏发起对话 */
    async handleChat(villagerId, text) {
        const villager = this.state.villagers.find(v => v.id === villagerId);
        if (!villager) return;

        // 如果对话框未打开，先打开
        if (!document.querySelector('.dialogue-overlay')) {
            this.open(villagerId);
            // 短暂等待 DOM 渲染
            await new Promise(r => setTimeout(r, 100));
        }

        const overlay = document.querySelector('.dialogue-overlay');
        if (overlay) {
            this.sendMessage(villager, text, overlay);
        }
    }
}
