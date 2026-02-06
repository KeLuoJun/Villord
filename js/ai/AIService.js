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

            // 提取 JSON
            return this._extractJSON(content);
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    /** 从 LLM 输出中提取 JSON */
    _extractJSON(content) {
        // 尝试匹配 ```json ... ```
        const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
            try {
                return JSON.parse(jsonBlockMatch[1].trim());
            } catch (e) {
                // json block 找到了但解析失败，继续尝试其他方式
                console.warn('[AIService] JSON block 解析失败，尝试裸JSON匹配');
            }
        }

        // 尝试匹配裸 JSON 对象
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e) {
                throw new Error(`JSON解析失败: ${e.message}，原始内容: ${content.slice(0, 100)}`);
            }
        }

        throw new Error(`无法从AI输出中提取JSON，原始内容: ${content.slice(0, 100)}`);
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
}
