---
name: Code Review & Debug
description: This skill should be used when the user encounters "API response truncated", "JSON parse error", "network fetch failed", "ECONNRESET", "port already in use", "UI content overflow/hidden", "LLM output incomplete", or needs guidance on debugging web applications, fixing common JavaScript/CSS issues, or reviewing code quality.
version: 1.0.0
---

# Code Review & Debug Skill

快速定位和修复 Web 应用中常见问题的实用指南。

## API & LLM 相关问题

### 1. LLM 响应截断

**症状**: AI 返回的 JSON 不完整，`finishReason: MAX_TOKENS`

**诊断步骤**:
1. 检查服务端日志中的 `finishReason`
2. 对比请求的 `maxOutputTokens` 与实际响应长度

**解决方案**:
```javascript
// 中文约 2-3 tokens/字符，需要足够大的 maxTokens
// 推荐值：65536（Gemini 2.5 Flash 支持）
const config = {
    maxOutputTokens: 65536,  // 不要用 1000-8000 这种小值
    temperature: 0.9
};
```

**关键点**: 中文 token 消耗远高于英文，`maxTokens: 8000` 实际只能生成约 3000-4000 中文字符。

### 2. JSON 解析失败

**症状**: `Unterminated string in JSON`, `Unexpected end of JSON`

**解决方案**: 实现容错的 JSON 解析器

```javascript
function safeParseJSON(text) {
    // 1. 提取 JSON（支持 markdown code block）
    let json = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) json = jsonMatch[1];
    
    // 2. 直接解析
    try {
        return JSON.parse(json.trim());
    } catch (e) {
        // 3. 尝试修复未闭合的括号
        let fixed = json.trim();
        const opens = (fixed.match(/\{/g) || []).length;
        const closes = (fixed.match(/\}/g) || []).length;
        fixed += '}'.repeat(Math.max(0, opens - closes));
        
        try {
            return JSON.parse(fixed);
        } catch (e2) {
            console.warn('[safeParseJSON] 修复失败:', e2.message);
            return null;
        }
    }
}
```

### 3. 网络请求失败

**症状**: `ECONNRESET`, `fetch failed`, `socket disconnected`

**解决方案**: 实现带重试的 fetch

```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fetch(url, options);
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = Math.pow(2, i) * 1000;  // 指数退避
            console.log(`重试 ${i + 1}/${maxRetries}，等待 ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}
```

## 服务器 & 端口问题

### 端口被占用

**症状**: `EADDRINUSE: address already in use :::3007`

**解决方案** (Windows PowerShell):
```powershell
# 查找占用端口的进程
netstat -ano | findstr :3007

# 强制终止进程
taskkill /PID <PID> /F
```

**解决方案** (Linux/Mac):
```bash
lsof -i :3007
kill -9 <PID>
```

## CSS & UI 问题

### 内容被遮挡/溢出

**症状**: 底部选项显示不全，内容被截断

**诊断**: 检查 `max-height`, `overflow`, `padding-bottom`

**解决方案**:
```css
.container {
    max-height: 320px;      /* 增大容器高度 */
    overflow-y: auto;       /* 允许滚动 */
    padding-bottom: 1.5rem; /* 底部留白 */
}

/* 父容器需要为子元素留出空间 */
.parent {
    padding-bottom: 280px;  /* 适应子元素高度 */
}
```

### 加载状态缺失

**症状**: 异步操作时无反馈，用户体验差

**解决方案**: 添加加载动画

```javascript
// 显示加载状态
function showLoading(container) {
    container.innerHTML = `
        <div class="loading">
            <div class="loading-dots">
                <span></span><span></span><span></span>
            </div>
            <span>加载中...</span>
        </div>
    `;
}

// 调用前显示，完成后隐藏
showLoading(container);
const result = await asyncOperation();
container.innerHTML = renderResult(result);
```

```css
.loading-dots span {
    animation: bounce 1.4s ease-in-out infinite;
}
.loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.loading-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-6px); }
}
```

## 调试检查清单

### API 问题排查
- [ ] 检查 `maxOutputTokens` 是否足够大
- [ ] 检查 `finishReason` 是否为 `STOP`（正常）而非 `MAX_TOKENS`
- [ ] 检查代理设置是否正确
- [ ] 添加详细日志：请求参数、响应长度、完成原因

### JSON 问题排查
- [ ] 检查原始响应是否被截断
- [ ] 检查是否有 markdown code block 包裹
- [ ] 尝试手动修复未闭合的括号

### 网络问题排查
- [ ] 确认代理服务正常运行
- [ ] 检查 API 密钥是否有效
- [ ] 实现重试机制处理瞬态错误

### UI 问题排查
- [ ] 使用浏览器开发者工具检查元素布局
- [ ] 检查 `overflow` 属性设置
- [ ] 检查父子元素的高度和 padding

## 代码质量要点

### 添加新功能时
1. **在多处调用的地方都要修改** - 搜索函数/方法的所有调用位置
2. **配置文件要同步更新** - `constants.js`, `config.json` 等
3. **UI 和逻辑要同步** - HTML 选项、CSS 样式、JS 处理逻辑

### 日志最佳实践
```javascript
console.log(`[模块名] 操作: ${关键变量}`);
console.log(`[CaseGenerator] AI 响应长度: ${response.length} 字符`);
console.log(`[Server] 完成原因: ${finishReason}`);
```

### 配置外部化
```javascript
// 硬编码 ❌
const maxTokens = 8000;

// 配置文件 ✅
const config = loadConfig('llm-config.json');
const maxTokens = config.options?.maxTokens || 65536;
```

## 快速参考

| 问题 | 关键词 | 解决方向 |
|------|--------|----------|
| JSON 截断 | `MAX_TOKENS`, `Unterminated` | 增大 maxOutputTokens |
| 网络失败 | `ECONNRESET`, `fetch failed` | 添加重试机制 |
| 端口占用 | `EADDRINUSE` | netstat + taskkill |
| 内容遮挡 | 显示不全、被截断 | 检查 max-height/overflow |
| 无反馈 | 卡顿、无响应 | 添加加载状态 |
