# 🏘️ 治村物语Villord

![游戏封面](assets/cover.png)

> **核心理念**：AI 驱动的村庄经营管理模拟 — 用对话治理村庄，用智慧经营未来

## 游戏简介

你是桃源村的新村长，通过**自然语言对话**指挥 AI 村民种地、伐木、建设、交易。每个村民都有独特性格和自主意志——他们可能勤劳肯干，也可能偷懒摸鱼、拒绝指令。你还可以亲自钓鱼赚钱、拜访邻村村长拓展外交。在有限资源下权衡决策，带领小村从荒芜走向繁荣。

### 游戏演示

<video src="assets/demo_video.mp4" width="100%" controls></video>

### 核心玩法

- 🗣️ **对话驱动** — 用自然语言与村民交流，安排任务、了解心情、化解矛盾
- 🧠 **AI 自主行动** — 村民每隔一天自动规划全天行动，多村民时智能分工不重复
- 📢 **村会系统** — 召集全村开会，发布工作指示，村民会根据性格给出不同反馈
- 🌾 **农业经营** — 种植、浇水、施肥（+30%产量）、收获，作物受季节和天气影响
- 🎣 **钓鱼系统** — 建造鱼塘后解锁，8种鱼+连击特效，仅限玩家亲自操作
- 🛒 **动态市场** — 实时价格波动 + AI 市场分析师每日发布早报/晚报
- 🏘️ **邻村往来** — 与3个AI邻村村长对话、赠礼、贸易、互助，好感度影响资源和繁荣度
- 🌤️ **天气系统** — AI 天气预报员预测未来天气，特殊天气影响全局
- 📜 **政策管理** — 工时/分配/奖惩/休假四大政策，各有 trade-off，也影响邻村好感
- ⭐ **繁荣度系统** — 10个等级，多维度增长/衰减，持续经营不断提升

### 核心创新

| 维度 | 传统经营游戏 | 本游戏 |
|:---:|:---:|:---:|
| 操作方式 | 点击拖拽 | 自然语言对话指挥 |
| NPC | 固定脚本 | AI 个性化，会偷懒/拒绝/做错事 |
| 经济 | 固定价格 | 实时市场波动 + AI 分析师 |
| 天气 | 随机修饰 | AI 天气预报，影响农业/市场/村民 |
| 管理 | 简单资源加减 | 体力/心情/性格/技能多维管理 |
| 外交 | 无 | 3个AI邻村，对话/贸易/互助/声望 |
| 玩家操作 | 全自动 | 钓鱼小游戏（抛竿→咬钩→拉杆搏斗） |

## 技术栈

- **前端**：HTML5 + CSS3 + JavaScript (ES6+ Modules)
- **渲染**：DOM 面板式 UI + Canvas（钓鱼场景、价格走势图）
- **AI**：兼容 OpenAI API 格式的大语言模型（推荐 Gemini 2.5 Flash）
- **音频**：BGM + 13种场景音效（含7种钓鱼音效），独立音量控制
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
| 暂停 / 恢复 | 点击顶栏 ▶/⏸ 按钮 |
| 游戏速度 | 点击 `0.5x` / `1x` / `1.5x` |
| 手动存档 | `Ctrl + S` 或点击 💾 |
| 读取存档 | `Ctrl + L` |
| 与村民对话 | 点击右下角 💬 气泡，选择村民 |
| 钓鱼操作 | 空格键（抛竿/咬钩/拉杆） |
| 拜访邻村 | 切换到「🏘️ 邻村」标签页，点击「💬 拜访村长」 |
| 音量调节 | 点击顶栏 🎵 按钮，分别调节音乐/音效 |
| 游戏规则 | 点击顶栏 ❓ 按钮查看完整玩法介绍 |

## 新手攻略

1. **建鱼塘**（80💰 + 15🪵）— 钓鱼到市场卖出，换取启动资金
2. **建伐木场**（70💰 + 20🪵）— 村民就能帮你伐木了
3. **扩建房屋** — 攒够资源后建房，招募村民壮大队伍
4. **建采石场** — 解锁石材产出，为升级建筑做准备
5. **拜访邻村** — 与邻村村长对话/赠礼提升好感度，解锁贸易和互助

> 📌 繁荣度达到新等级可领取金币奖励；金币不够时随时可以钓鱼卖鱼！

## 目录结构

```
Villord/
├── index.html              # 入口页面
├── config.example.json     # AI 配置模板
├── package.json
├── assets/
│   └── sounds/             # 音频资源
│       ├── click.mp3       # 点击音效
│       ├── coin.mp3        # 金币音效
│       ├── harvest.mp3     # 收获音效
│       ├── recruit.mp3     # 招募音效
│       ├── notify.mp3      # 通知音效
│       ├── season.mp3      # 季节变更
│       ├── gbm.mp3         # 背景音乐
│       └── fish/           # 钓鱼音效（7种）
├── css/
│   ├── theme-pastoral.css  # 田园主题变量
│   ├── main.css            # 全局基础样式
│   ├── layout.css          # 布局与顶栏
│   ├── panels.css          # 面板样式
│   ├── cards.css           # 卡片组件
│   ├── dialogue.css        # 对话框与村会
│   ├── fishing.css         # 钓鱼界面
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
│   │   ├── VillagerScheduler.js  # AI 村民行动调度（含农活分工）
│   │   ├── FarmSystem.js         # 农田与作物
│   │   ├── BuildingSystem.js     # 建筑建造（住宅可升级）
│   │   ├── FishingSystem.js      # 钓鱼系统
│   │   ├── NeighborSystem.js     # 邻村往来（对话/贸易/互助/声望）
│   │   ├── EconomySystem.js      # 经济与食物消耗
│   │   ├── WeatherSystem.js      # 天气与季节
│   │   ├── PolicySystem.js       # 四大政策
│   │   ├── EventSystem.js        # 随机事件
│   │   ├── ProsperitySystem.js   # 繁荣度与等级
│   │   ├── PersonalitySystem.js  # 性格行为偏差
│   │   ├── NPCChatSystem.js      # NPC 自由聊天
│   │   ├── MeetingSystem.js      # 村会系统
│   │   ├── DailySummary.js       # 每日总结
│   │   └── TutorialSystem.js     # 新手教程（支持跳过）
│   ├── ai/
│   │   ├── AIService.js          # AI API 封装（含重试/降级）
│   │   ├── VillagerAI.js         # 村民对话 AI
│   │   ├── MarketAnalyst.js      # 市场分析师 AI
│   │   ├── WeatherForecaster.js  # 天气预报员 AI
│   │   └── ContextCompressor.js  # 季末记忆压缩（含邻村对话）
│   ├── market/
│   │   ├── MarketEngine.js       # 市场引擎与交易
│   │   └── PriceChart.js         # 价格走势图（Canvas）
│   ├── ui/
│   │   ├── UIManager.js          # UI 总管理
│   │   ├── DialogueBox.js        # 对话框
│   │   ├── FishingPanel.js       # 钓鱼界面（Canvas 2.5D）
│   │   └── RecruitReveal.js      # 招募揭示动画
│   └── config/
│       ├── villagers.js    # 村民属性与费用
│       ├── crops.js        # 作物数据
│       ├── buildings.js    # 建筑数据（含住宅升级等级）
│       ├── fishing.js      # 钓鱼配置（鱼种/稀有度/鱼塘等级）
│       ├── neighbors.js    # 邻村配置（3村/声望/事件/贸易）
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
