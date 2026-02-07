# 🏘️ 治村物语Villord

![游戏封面](assets/cover.png)

> **核心理念**：AI 驱动的村庄经营管理模拟 — 用对话治理村庄，用智慧经营未来

## 游戏简介

你是桃源村的新村长，通过**自然语言对话**指挥 AI 村民种地、伐木、建设、交易。每个村民都有独特性格和自主意志——他们可能勤劳肯干，也可能偷懒摸鱼、拒绝指令。你需要在有限资源下权衡决策，带领小村从荒芜走向繁荣，最终达成「传说桃源」的终极目标。

### 游戏演示

<video src="assets/demo_video.mp4" width="100%" controls></video>

### 核心玩法

- 🗣️ **对话驱动** — 用自然语言与村民交流，安排任务、了解心情、化解矛盾
- 🧠 **AI 自主行动** — 村民每隔一天自动规划全天行动，性格影响计划风格
- 📢 **村会系统** — 召集全村开会，发布工作指示，村民会根据性格给出不同反馈
- 🌾 **农业经营** — 种植、浇水、施肥、收获，作物受季节和天气影响
- 🛒 **动态市场** — 实时价格波动 + AI 市场分析师每日发布早报/晚报
- 🌤️ **天气系统** — AI 天气预报员预测未来天气，特殊天气影响全局
- 📜 **政策管理** — 工时制度、分配制度、奖惩机制、休假制度四大政策，各有 trade-off
- ⭐ **繁荣度系统** — 10 个等级，每级解锁奖励，达到最高等级即通关

### 核心创新

| 维度 | 传统经营游戏 | 本游戏 |
|:---:|:---:|:---:|
| 操作方式 | 点击拖拽 | 自然语言对话指挥 |
| NPC | 固定脚本 | AI 个性化，会偷懒/拒绝/做错事 |
| 经济 | 固定价格 | 实时市场波动 + AI 分析师 |
| 天气 | 随机修饰 | AI 天气预报，影响农业/市场/村民 |
| 管理 | 简单资源加减 | 体力/心情/性格/技能多维管理 |

## 技术栈

- **前端**：HTML5 + CSS3 + JavaScript (ES6+ Modules)
- **渲染**：DOM 面板式 UI（价格走势图使用 Canvas）
- **AI**：兼容 OpenAI API 格式的大语言模型（推荐 Gemini 2.5 Flash）
- **音频**：BGM + 6 种场景音效，独立音量控制
- **存储**：localStorage（自动存档 + 手动存档）

## 快速开始

### 1. 安装依赖

```bash
cd Villord
npm install
```

### 2. 配置 AI 服务

复制 `config.example.json` 为 `config.json`，填入你的 API 密钥：

```json
{
  "proxyUrl": "",
  "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
  "apiKey": "你的API密钥",
  "model": "gemini-2.5-flash"
}
```

> 也可以在游戏内通过 ⚙️ 设置按钮配置，配置保存在浏览器本地。

### 3. 启动游戏

```bash
npm start
```

浏览器会自动打开 `http://localhost:3000`。

> **AI 降级**：若 AI 服务不可用，游戏会自动降级为预设对话模式，核心经营玩法不受影响。

## 操作指南

| 操作 | 方式 |
|:---|:---|
| 暂停 / 恢复 | `空格键` 或点击 ▶/⏸ 按钮 |
| 游戏速度 | 点击 `0.5x` / `1x` / `1.5x` |
| 手动存档 | `Ctrl + S` 或点击 💾 |
| 读取存档 | `Ctrl + L` |
| 与村民对话 | 点击右下角 💬 气泡，选择村民 |
| 音量调节 | 点击顶栏 🎵 按钮，分别调节音乐/音效 |

## 目录结构

```
Villord/
├── index.html              # 入口页面
├── config.example.json     # AI 配置模板
├── package.json
├── assets/
│   └── sounds/             # 音频资源（BGM + 音效）
├── css/
│   ├── theme-pastoral.css  # 田园主题变量
│   ├── main.css            # 全局基础样式
│   ├── layout.css          # 布局与顶栏
│   ├── panels.css          # 面板样式
│   ├── cards.css           # 卡片组件
│   ├── dialogue.css        # 对话框与村会
│   └── responsive.css      # 响应式适配
├── js/
│   ├── main.js             # 入口，初始化所有系统
│   ├── core/
│   │   ├── EventBus.js     # 全局事件总线
│   │   ├── GameState.js    # 游戏状态管理
│   │   ├── TimeSystem.js   # 时间系统（Tick 驱动）
│   │   ├── SaveSystem.js   # 存档/读档
│   │   └── SoundManager.js # 音效管理器
│   ├── systems/
│   │   ├── VillagerSystem.js     # 村民招募/解雇
│   │   ├── VillagerScheduler.js  # AI 村民行动调度
│   │   ├── FarmSystem.js         # 农田与作物
│   │   ├── BuildingSystem.js     # 建筑建造
│   │   ├── EconomySystem.js      # 经济与食物消耗
│   │   ├── WeatherSystem.js      # 天气与季节
│   │   ├── PolicySystem.js       # 四大政策
│   │   ├── EventSystem.js        # 随机事件
│   │   ├── ProsperitySystem.js   # 繁荣度与等级
│   │   ├── PersonalitySystem.js  # 性格行为偏差
│   │   ├── NPCChatSystem.js      # NPC 自言自语
│   │   ├── MeetingSystem.js      # 村会系统
│   │   ├── DailySummary.js       # 每日总结
│   │   └── TutorialSystem.js     # 新手教程
│   ├── ai/
│   │   ├── AIService.js          # AI API 封装（含重试/降级）
│   │   ├── VillagerAI.js         # 村民对话 AI
│   │   ├── MarketAnalyst.js      # 市场分析师 AI
│   │   ├── WeatherForecaster.js  # 天气预报员 AI
│   │   └── ContextCompressor.js  # 季末记忆压缩
│   ├── market/
│   │   ├── MarketEngine.js       # 市场引擎与交易
│   │   └── PriceChart.js         # 价格走势图（Canvas）
│   ├── ui/
│   │   ├── UIManager.js          # UI 总管理
│   │   ├── DialogueBox.js        # 对话框
│   │   └── RecruitReveal.js      # 招募揭示动画
│   └── config/
│       ├── villagers.js    # 村民属性与费用配置
│       ├── crops.js        # 作物数据
│       ├── buildings.js    # 建筑数据
│       ├── weather.js      # 天气与季节
│       ├── policies.js     # 政策选项
│       └── marketItems.js  # 市场商品
└── README.md
```

## 游戏时间

| 现实时间 | 游戏时间 |
|:---:|:---:|
| 3 秒 | 1 小时（1 Tick） |
| 72 秒 | 1 天（24 Tick） |
| 6 分钟 | 1 季（5 天） |
| 24 分钟 | 1 年（4 季 × 5 天） |

> 以上为 1x 速度下的时间，支持 0.5x / 1.5x 变速。
