/**
 * AIService - LLM API 调用封装
 * 使用 Gemini API，支持重试、超时、降级
 */

export class AIService {
    constructor(config) {
        this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        this.apiKey = config.apiKey || '';
        this.model = config.model || 'gemini-2.5-flash';
        this.proxyUrl = config.proxyUrl || '';
        this.timeout = config.timeout || 15000;
        this.maxRetries = 3;
        this.enabled = !!this.apiKey && this.apiKey !== 'YOUR_API_KEY_HERE';

        if (!this.enabled) {
            console.warn('[AIService] ⚠️ API Key 未配置，AI 功能将降级为预设模式');
        } else {
            console.log(`[AIService] ✅ 已配置 model=${this.model}`);
        }
    }

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

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const result = await this._callAPI(prompt, options);

                // AI LOGIC - 完整日志
                console.log(`[AIService] 调用成功 (第${attempt}次)`, {
                    promptLength: prompt.length,
                    responseLength: JSON.stringify(result).length,
                });

                return result;

            } catch (error) {
                const isRetryable = this._isRetryableError(error);
                const delay = Math.pow(2, attempt - 1) * 1000; // 指数退避

                console.warn(`[AIService] 调用失败 (第${attempt}/${this.maxRetries}次)`, {
                    error: error.message,
                    retryable: isRetryable,
                    nextDelay: isRetryable && attempt < this.maxRetries ? `${delay}ms` : 'N/A',
                });

                if (!isRetryable || attempt >= this.maxRetries) {
                    console.error(`[AIService] ❌ 最终失败，使用降级方案`);
                    return null;
                }

                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

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

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
        }

        const data = await response.json();
        const content = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';

        if (!content) {
            throw new Error('API 返回空内容');
        }

        // 提取 JSON
        return this._extractJSON(content);
    }

    /** 从 LLM 输出中提取 JSON */
    _extractJSON(content) {
        // 尝试匹配 ```json ... ```
        const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
            return JSON.parse(jsonBlockMatch[1].trim());
        }

        // 尝试匹配裸 JSON 对象
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        throw new Error('无法从 AI 输出中提取 JSON');
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
                return content.trim();
            } catch (error) {
                if (!this._isRetryableError(error) || attempt >= this.maxRetries) return null;
                await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
            }
        }
        return null;
    }

    /** 判断错误是否可重试 */
    _isRetryableError(error) {
        const msg = error.message || '';
        // 网络/超时
        if (error.name === 'AbortError') return true;
        if (msg.includes('fetch') || msg.includes('network')) return true;
        // 5xx 服务端错误
        if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return true;
        // 限流
        if (msg.includes('429')) return true;
        // JSON 解析失败不重试（Prompt 问题）
        if (msg.includes('JSON')) return false;
        // 4xx 客户端错误不重试
        if (msg.match(/API 4\d\d/)) return false;

        return true;
    }
}
