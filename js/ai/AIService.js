/**
 * AIService - LLM API 调用封装
 * 使用 Gemini API，支持重试、超时、降级
 * 重试策略：指数退避 + JSON解析失败也可重试（最多1次）
 */

export class AIService {
    constructor(config) {
        this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        this.apiKey = config.apiKey || '';
        this.model = config.model || 'gemini-2.5-flash';
        this.proxyUrl = config.proxyUrl || '';
        this.timeout = config.timeout || 20000;
        this.maxRetries = 3;
        this.enabled = !!this.apiKey && this.apiKey !== 'YOUR_API_KEY_HERE';

        // 调用统计（用于调试）
        this._stats = { total: 0, success: 0, failed: 0, retried: 0 };

        if (!this.enabled) {
            console.warn('[AIService] ⚠️ API Key 未配置，AI 功能将降级为预设模式');
        } else {
            console.log(`[AIService] ✅ 已配置 model=${this.model}`);
        }
    }

    /** 获取调用统计 */
    getStats() { return { ...this._stats }; }

    /**
     * 调用 LLM 生成文本，返回解析后的 JSON
     * @param {string} prompt - 完整 prompt
     * @param {object} options - { temperature, maxTokens }
     * @returns {object|null} 解析后的 JSON 对象，失败返回 null
     */
    async chat(prompt, options = {}) {
        if (!this.enabled) {
            console.log('[AIService] AI 未启用，返回 null（降级）');
            return null;
        }

        this._stats.total++;
        let jsonRetried = false; // JSON 解析失败允许额外重试1次

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const result = await this._callAPI(prompt, options);

                console.log(`[AIService] chat 成功 (第${attempt}次)`, {
                    promptLength: prompt.length,
                    responseLength: JSON.stringify(result).length,
                });

                this._stats.success++;
                return result;

            } catch (error) {
                const isJsonError = (error.message || '').includes('JSON') || (error.message || '').includes('提取');
                let isRetryable = this._isRetryableError(error);

                // JSON 解析失败：允许额外重试1次（可能是 LLM 输出格式不稳定）
                if (isJsonError && !jsonRetried) {
                    jsonRetried = true;
                    isRetryable = true;
                    console.warn(`[AIService] JSON解析失败，额外重试1次`);
                }

                const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 8000); // 最大退避8秒

                console.warn(`[AIService] chat 失败 (第${attempt}/${this.maxRetries}次)`, {
                    error: error.message,
                    retryable: isRetryable,
                    nextDelay: isRetryable && attempt < this.maxRetries ? `${delay}ms` : 'N/A',
                });

                if (!isRetryable || attempt >= this.maxRetries) {
                    console.error(`[AIService] ❌ chat 最终失败，使用降级方案`);
                    this._stats.failed++;
                    return null;
                }

                this._stats.retried++;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        this._stats.failed++;
        return null;
    }

    /** 实际 API 调用 */
    async _callAPI(prompt, options = {}) {
        const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const body = {
            contents: [
                { role: 'user', parts: [{ text: prompt }] }
            ],
            generationConfig: {
                temperature: options.temperature ?? 0.8,
                maxOutputTokens: options.maxTokens ?? 500,
                // 强制 Gemini 输出 JSON，大幅减少解析失败
                responseMimeType: 'application/json',
            },
        };

        console.log(`[AIService] 发起请求: model=${this.model}, prompt长度=${prompt.length}`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const text = await response.text().catch(() => '(无法读取响应)');
                throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
            }

            const data = await response.json();
            const content = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';

            if (!content) {
                throw new Error('API 返回空内容');
            }

            // 提取 JSON（Gemini responseMimeType=json 时通常直接返回 JSON）
            return this._extractJSON(content);
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /** 从 LLM 输出中提取 JSON */
    _extractJSON(content) {
        // 第1步：直接尝试解析（responseMimeType=json 时通常直接返回纯 JSON）
        try {
            return JSON.parse(content.trim());
        } catch (e) {
            // 不是纯 JSON，继续尝试
        }

        // 第2步：尝试匹配 ```json ... ```
        const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
            try {
                return JSON.parse(jsonBlockMatch[1].trim());
            } catch (e) {
                console.warn('[AIService] JSON block 解析失败，尝试裸JSON匹配');
            }
        }

        // 第3步：尝试匹配裸 JSON 对象（处理可能的前后缀文字）
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e) {
                // 第4步：尝试修复常见的 JSON 错误（尾部逗号、单引号等）
                try {
                    const fixed = jsonMatch[0]
                        .replace(/,\s*([}\]])/g, '$1')  // 移除尾部逗号
                        .replace(/'/g, '"');              // 单引号换双引号
                    return JSON.parse(fixed);
                } catch (e2) {
                    throw new Error(`JSON解析失败: ${e.message}，原始内容: ${content.slice(0, 200)}`);
                }
            }
        }

        throw new Error(`无法从AI输出中提取JSON，原始内容: ${content.slice(0, 200)}`);
    }

    /**
     * 调用 LLM 生成文本，返回原始文本（不做 JSON 解析）
     * 用于天气播报等纯文本场景
     * @param {string} prompt
     * @param {object} options
     * @returns {string|null}
     */
    async chatRaw(prompt, options = {}) {
        if (!this.enabled) return null;

        this._stats.total++;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);

                const body = {
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: options.temperature ?? 0.8,
                        maxOutputTokens: options.maxTokens ?? 200,
                    },
                };

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        signal: controller.signal,
                    });
                    clearTimeout(timeoutId);

                    if (!response.ok) throw new Error(`API ${response.status}`);

                    const data = await response.json();
                    const content = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
                    if (!content) throw new Error('API 返回空内容');

                    console.log(`[AIService] chatRaw 成功 (第${attempt}次), 长度=${content.length}`);
                    this._stats.success++;
                    return content.trim();
                } catch (error) {
                    clearTimeout(timeoutId);
                    throw error;
                }
            } catch (error) {
                const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 8000);
                console.warn(`[AIService] chatRaw 失败 (第${attempt}/${this.maxRetries}次): ${error.message}`);

                if (!this._isRetryableError(error) || attempt >= this.maxRetries) {
                    this._stats.failed++;
                    return null;
                }
                this._stats.retried++;
                await new Promise(r => setTimeout(r, delay));
            }
        }
        this._stats.failed++;
        return null;
    }

    /** 判断错误是否可重试 */
    _isRetryableError(error) {
        const msg = error.message || '';
        // 网络/超时
        if (error.name === 'AbortError') return true;
        if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) return true;
        // 5xx 服务端错误
        if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return true;
        // 限流
        if (msg.includes('429')) return true;
        // API 返回空内容（可能是临时问题）
        if (msg.includes('空内容')) return true;
        // JSON 解析失败 - 默认不重试（由 chat() 层处理额外重试）
        if (msg.includes('JSON') || msg.includes('提取')) return false;
        // 4xx 客户端错误不重试
        if (msg.match(/API 4\d\d/)) return false;

        return true;
    }

    // ========== 关键 LLM 调用（游戏体验依赖，失败需暂停+重试+通知） ==========

    /**
     * 设置事件总线引用（由 main.js 初始化后调用）
     * 用于关键调用中暂停/恢复游戏和发送通知
     */
    setEventBus(eventBus) {
        this._bus = eventBus;
    }

    /** 发送 Toast 通知 */
    _notify(message, type = 'info') {
        if (this._bus) {
            this._bus.emit('showToast', { message, type });
        }
    }

    /** 暂停游戏时间 */
    _pauseGame(reason) {
        if (this._bus) {
            this._bus.emit('aiPauseGame', { reason });
        }
    }

    /** 恢复游戏时间 */
    _resumeGame() {
        if (this._bus) {
            this._bus.emit('aiResumeGame', {});
        }
    }

    /** 显示严重警告弹窗 */
    _showWarningModal(title, message) {
        if (this._bus) {
            this._bus.emit('aiWarningModal', { title, message });
        }
    }

    /**
     * 关键 LLM 调用（JSON 模式）
     * 特性：超时自动暂停游戏、最多重试3次、每次重试都通知玩家、最终失败弹窗警告
     * @param {string} prompt
     * @param {object} options - { temperature, maxTokens }
     * @param {object} meta - { label: '显示名称', deadlineHour: 最迟完成的游戏小时 }
     * @returns {object|null}
     */
    async criticalChat(prompt, options = {}, meta = {}) {
        const label = meta.label || 'AI 任务';
        const MAX_RETRIES = 3;

        if (!this.enabled) {
            console.log(`[AIService] [关键] ${label}: AI 未启用，降级`);
            return null;
        }

        this._stats.total++;
        this._notify(`⏳ ${label} 生成中...`, 'info');

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const result = await this._callAPI(prompt, options);

                console.log(`[AIService] [关键] ${label} 成功 (第${attempt}次)`);
                this._stats.success++;

                if (attempt > 1) {
                    this._notify(`✅ ${label} 生成成功（重试${attempt - 1}次后）`, 'success');
                    this._resumeGame();
                }
                return result;

            } catch (error) {
                console.warn(`[AIService] [关键] ${label} 失败 (第${attempt}/${MAX_RETRIES}次): ${error.message}`);

                if (attempt < MAX_RETRIES) {
                    // 暂停游戏等待重试
                    this._pauseGame(`${label} 生成失败，正在重试(${attempt}/${MAX_RETRIES})...`);
                    this._notify(`⚠️ ${label} 生成失败，正在重试(${attempt}/${MAX_RETRIES})...`, 'warning');
                    this._stats.retried++;

                    // 退避等待
                    const delay = Math.min(Math.pow(2, attempt - 1) * 2000, 10000);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    // 全部重试失败
                    this._stats.failed++;
                    this._showWarningModal(
                        `⚠️ ${label} 生成失败`,
                        `已重试 ${MAX_RETRIES} 次仍然失败。\n可能原因：网络不稳定、API 额度不足、服务暂时不可用。\n\n游戏将使用降级方案继续，部分AI功能可能受限。\n\n请检查网络连接和 API 配置后，游戏会在下次调度时自动重试。`
                    );
                    this._resumeGame(); // 恢复游戏让降级方案生效
                    return null;
                }
            }
        }

        this._stats.failed++;
        return null;
    }

    /**
     * 关键 LLM 调用（纯文本模式）
     * 与 criticalChat 相同的暂停/重试/通知机制，但不做 JSON 解析
     */
    async criticalChatRaw(prompt, options = {}, meta = {}) {
        const label = meta.label || 'AI 任务';
        const MAX_RETRIES = 3;

        if (!this.enabled) return null;

        this._stats.total++;
        this._notify(`⏳ ${label} 生成中...`, 'info');

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);

                const body = {
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: options.temperature ?? 0.8,
                        maxOutputTokens: options.maxTokens ?? 200,
                    },
                };

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                if (!response.ok) throw new Error(`API ${response.status}`);
                const data = await response.json();
                const content = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
                if (!content) throw new Error('API 返回空内容');

                this._stats.success++;
                if (attempt > 1) {
                    this._notify(`✅ ${label} 生成成功`, 'success');
                    this._resumeGame();
                }
                return content.trim();

            } catch (error) {
                console.warn(`[AIService] [关键] ${label} 失败 (第${attempt}/${MAX_RETRIES}次): ${error.message}`);

                if (attempt < MAX_RETRIES) {
                    this._pauseGame(`${label} 生成失败，正在重试(${attempt}/${MAX_RETRIES})...`);
                    this._notify(`⚠️ ${label} 生成失败，正在重试(${attempt}/${MAX_RETRIES})...`, 'warning');
                    this._stats.retried++;
                    const delay = Math.min(Math.pow(2, attempt - 1) * 2000, 10000);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    this._stats.failed++;
                    this._showWarningModal(
                        `⚠️ ${label} 生成失败`,
                        `已重试 ${MAX_RETRIES} 次仍然失败。\n游戏将使用降级方案继续。\n请检查网络连接和 API 配置。`
                    );
                    this._resumeGame();
                    return null;
                }
            }
        }

        this._stats.failed++;
        return null;
    }
}
