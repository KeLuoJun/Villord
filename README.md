# 🏘️ 治村物语 — AI 村长模拟器

> **项目代号**：Villord  
> **核心理念**：AI 驱动的村庄经营管理模拟 — 用对话治理村庄，用智慧经营未来

## 游戏简介

你是一名村长，通过自然语言对话指挥 AI 村民种地、建设、交易。每个村民都有独特性格和自主意志，你需要在有限资源下做出最优决策，带领小村走向繁荣。

## 技术栈

- **前端**：HTML5 + CSS3 + JavaScript (ES6+ Modules)
- **渲染**：DOM 面板式 UI（仅价格走势图使用 Canvas）
- **AI**：Gemini 2.5 Flash API
- **存储**：localStorage

## 启动方式

```bash
cd Villord
npm install
npm start
```

浏览器会自动打开 `http://localhost:8080`。

## AI 配置

编辑 `config.json`，填入你的 API 密钥：

```json
{
  "proxyUrl": "http://127.0.0.1:7890",
  "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
  "apiKey": "你的API密钥",
  "model": "gemini-2.5-flash"
}
```

> AI 功能不可用时，游戏会自动降级为预设对话模式。

## 目录结构

```
Villord/
├── index.html          # 入口页面
├── config.json         # AI 配置
├── css/                # 样式文件
├── js/
│   ├── main.js         # 入口
│   ├── core/           # 核心系统（EventBus, GameState, TimeSystem）
│   ├── systems/        # 游戏系统（Village, Farm, Building, etc.）
│   ├── ai/             # AI 模块（AIService, VillagerAI, etc.）
│   ├── market/         # 市场系统（MarketEngine, PriceHistory）
│   ├── ui/             # UI 控制（UIManager, DialogueBox, etc.）
│   └── config/         # 配置数据（作物、建筑、天气等）
└── README.md
```
