/**
 * GameRulesHelper - 游戏助手「小村助」
 * 回答玩家关于游戏规则的问题，并根据当前游戏状态给出建议
 */

// ===== 详细游戏规则知识库 =====
export const GAME_RULES_KNOWLEDGE = `
# 治村物语 完整游戏规则手册

## 一、游戏基础

### 1.1 游戏目标
你是桃源村的新村长，目标是将小村庄建设成繁荣的社区。核心指标是「繁荣度」，共10个等级，最高为「👑 传说桃源」。

### 1.2 时间系统
- 1 Tick = 1 游戏小时 = 现实 3 秒（1倍速）
- 1 天 = 24 Tick = 现实 72 秒
- 1 季 = 5 天（春→夏→秋→冬循环）
- 1 年 = 4 季 = 20 天
- 游戏速度可调：0.5x / 1x / 1.5x
- 重要事件发生时游戏会自动暂停

### 1.3 资源类型
- 💰 金币：通用货币，用于建造、招募、购买
- 🌾 小麦：村民每日消耗的粮食（每人每天消耗1单位）
- 🪵 木材：建造材料
- 🪨 石料：高级建筑材料
- 🌱 种子：种植作物所需（萝卜/小麦/土豆/南瓜/棉花/葡萄）

## 二、村民系统（详细）

### 2.1 村民属性
- **体力**：基础10点（健壮12点，体弱8点），每日自然恢复
- **心情**：0-10分，影响工作效率和服从度
- **性格**：随机2-3个，影响行为模式
- **特长**：种植能手/采集好手/加工巧匠

### 2.2 性格特征详解
| 性格 | 效果 |
|------|------|
| 勤劳 | 工作速度+30%，倾向排满工作 |
| 懒惰 | 工作速度-40%，可能偷懒不执行计划 |
| 聪明 | 任务执行准确率100% |
| 愚笨 | 任务执行准确率70%（可能做错事） |
| 听话 | 严格遵守指令 |
| 叛逆 | 心情低时可能拒绝执行指令 |
| 健壮 | 体力上限12，体力消耗-10% |
| 体弱 | 体力上限8，体力消耗+15% |
| 乐观 | 心情恢复更快 |
| 悲观 | 心情容易下降 |

### 2.3 村民行动与消耗
| 行动 | 耗时 | 体力消耗 | 说明 |
|------|------|----------|------|
| 种植 plant | 2小时 | 2 | 需要种子，在空田使用 |
| 浇水 water | 1小时 | 1 | 每日需浇水才能正常生长 |
| 施肥 fertilize | 1小时 | 1 | 产量+30%，每茬只能施一次 |
| 收获 harvest | 2小时 | 2 | 作物成熟后使用 |
| 伐木 chop | 2小时 | 2 | 需要伐木场，产出2木材 |
| 采石 mine | 2小时 | 3 | 需要采石场，产出2石料 |
| 加工 process | 3小时 | 2 | 需要磨坊/面包房 |
| 交易 trade | 1小时 | 1 | 市场营业时间9:00-18:00 |
| 休息 rest | 2小时 | 0 | 恢复4点体力 |
| 吃饭 eat | 1小时 | 0 | 恢复3点体力 |
| 闲逛 idle | 1小时 | 0 | 恢复1点心情 |
| 聊天 chat | 1小时 | 0 | 恢复1点心情 |

### 2.4 招募与管理
- 招募费用：50💰
- 需要空余房屋
- 招募是盲抽机制，性格随机
- 解雇村民返还20💰
- 村民每日消耗1🌾粮食，缺粮会心情下降

### 2.5 作息时间
- 7:00 起床
- 8:00 开始执行计划（受工时政策影响）
- 22:00 睡觉
- AI 每天 7:00 为村民生成当日行动计划

## 三、农业系统（详细）

### 3.1 作物数据
| 作物 | 种子价 | 生长期 | 产量 | 售价 | 可种季节 |
|------|--------|--------|------|------|----------|
| 🥕萝卜 | 5💰 | 2天 | 3 | 10💰 | 全季节 |
| 🌾小麦 | 10💰 | 3天 | 4 | 20💰 | 春夏秋 |
| 🥔土豆 | 8💰 | 2天 | 3 | 15💰 | 春秋 |
| 🎃南瓜 | 25💰 | 5天 | 2 | 50💰 | 仅秋季 |
| 🧵棉花 | 20💰 | 4天 | 3 | 35💰 | 仅夏季 |
| 🍇葡萄 | 40💰 | 6天 | 2 | 80💰 | 夏秋 |

### 3.2 种植规则
- 每块农田只能种一茬作物
- 需要每日浇水，否则生长停滞
- 施肥可增产30%，但每茬只能施一次
- 作物受天气影响（如干旱导致未浇水作物枯萎）
- 成熟后需及时收获

### 3.3 加工系统
- 3小麦 → 2面粉（需磨坊）
- 2面粉 → 1面包（需面包房）
- 加工品价值更高：小麦20💰 → 面粉15💰/个 → 面包22.5💰/个

## 四、钓鱼系统（详细）

### 4.1 基础规则
- 需建造鱼塘才能钓鱼
- **仅限玩家亲自操作**，村民无法钓鱼
- 操作：点击抛竿 → 等待咬钩 → 时机点击 → 拉杆搏斗

### 4.2 鱼种与价格
| 稀有度 | 概率 | 鱼种 | 基础价格 | 出现季节 |
|--------|------|------|----------|----------|
| 普通(60%) | 🐟鲫鱼 | 8💰 | 全季节 |
| 普通(60%) | 🐟草鱼 | 12💰 | 春夏秋 |
| 优质(25%) | 🐠鲤鱼 | 15💰 | 春夏 |
| 优质(25%) | 🐠鲢鱼 | 18💰 | 夏秋 |
| 稀有(12%) | 🐡鳜鱼 | 30💰 | 仅秋季 |
| 稀有(12%) | 🐡黑鱼 | 35💰 | 夏秋 |
| 传说(3%) | 🎏锦鲤 | 100💰 | 春秋 |
| 传说(3%) | 🐉金龙鱼 | 200💰 | 仅夏季 |

### 4.3 鱼塘升级
| 等级 | 名称 | 鱼群容量 | 升级费用 |
|------|------|----------|----------|
| 0 | 简易鱼塘 | 5 | - |
| 1 | 标准鱼塘 | 8 | 50💰+10🪵 |
| 2 | 高级鱼塘 | 12 | 80💰+15🪵+5🪨 |

### 4.4 连击与技巧
- 连续成功不跑鱼触发连击
- 3连击: 售价×1.1
- 5连击: 售价×1.2
- 10连击: 售价×1.5
- Perfect时机命中：售价×1.5

## 五、市场经济（详细）

### 5.1 市场规则
- 营业时间：9:00 - 18:00
- 价格实时波动，受供需、季节、天气影响
- 每天 5:00 发布早报（AI分析师预测）
- 每天 19:00 发布晚报（回顾+点评）

### 5.2 价格影响因素
- 季节：秋季收获季粮价下跌，冬季粮价上涨
- 天气：干旱导致粮价上涨15-20%
- 交易行为：大量买入推高价格，大量卖出压低价格

### 5.3 交易策略
- 低买高卖，关注早报预测
- 特殊天气前囤货或清仓
- 鱼类价格随季节波动，注意最佳出售时机

## 六、建设系统（详细）

### 6.1 建筑列表
| 建筑 | 费用 | 功能 |
|------|------|------|
| 🏚️住宅 | 35💰+15🪵 | 容纳1村民，可升级 |
| 🌾农田 | 50💰+10🪵 | 种植作物 |
| 🪓伐木场 | 70💰+20🪵 | 解锁伐木，产出2🪵/次 |
| ⛏️采石场 | 70💰+15🪵 | 解锁采石，产出2🪨/次 |
| 🎣鱼塘 | 80💰+15🪵 | 解锁钓鱼（限建1个） |
| 🏭磨坊 | 160💰+25🪵+20🪨 | 加工面粉 |
| 🍞面包房 | 230💰+30🪵+30🪨 | 加工面包 |
| 📦仓库升级 | 100💰+20🪵 | 扩大存储上限 |
| 🪣水井 | 45💰+10🪨 | 减少浇水需求 |

### 6.2 住宅升级
| 等级 | 名称 | 容量 | 升级费用 |
|------|------|------|----------|
| 0 | 🏚️茅草屋 | 1人 | - |
| 1 | 🏠木屋 | 2人 | 60💰+25🪵 |
| 2 | 🏡石屋 | 3人 | 120💰+20🪵+50🪨（需采石场）|

## 七、政策系统（详细）

### 7.1 工时制度
| 政策 | 工作时间 | 产出 | 每日心情 | 体力恢复 |
|------|----------|------|----------|----------|
| 🏢朝八晚六 | 8:00-18:00 | ×1.0 | 0 | ×1.0 |
| 🔥996 | 8:00-21:00 | ×1.35 | -1 | ×0.7 |
| 🧘佛系模式 | 10:00-16:00 | ×0.65 | +1 | ×1.3 |

### 7.2 分配制度
| 政策 | 入库率 | 效率 | 心情 | 特殊 |
|------|--------|------|------|------|
| 🏛️产出归公 | 100% | ×0.85 | -1 | - |
| ⚖️按劳分配 | 80% | ×1.1 | 0 | 技能成长×1.5 |
| 🏪自由市场 | 70% | ×1.0 | +1 | 8%倒爷风险 |

### 7.3 奖惩机制
| 政策 | 每日成本 | 听话加成 | 叛逆偏差 | 懒惰偏差 |
|------|----------|----------|----------|----------|
| 😐无奖惩 | 0 | ×1.0 | ×1.0 | ×1.0 |
| 💰绩效奖金 | 5💰/人 | ×2.0 | ×0.5 | ×0.6 |
| ⚡偷懒处罚 | 0 | ×1.0 | ×1.8 | ×1.5 |

### 7.4 休假制度
| 政策 | 休息日 | 特殊规则 |
|------|--------|----------|
| 🚫无休息 | 无 | 连续工作>3天后疲劳惩罚 |
| 📅单休 | 每季第5天 | 休息日心情+1，体力全恢复 |
| 🏖️双休 | 每季第4-5天 | 休息日心情+1，体力全恢复 |

### 7.5 政策影响邻村好感
- 996：邻村好感度-2
- 双休：邻村好感度+1

## 八、天气系统（详细）

### 8.1 每季特殊天气（各3种）
**春季**：
- 🌧️春雨连绵(2天)：自动浇水，作物+30%，体力+10%
- 🐛虫害爆发(2天)：未除虫产量-50%，种子+15%
- 🧊倒春寒(1天)：生长停止，幼苗20%冻死

**夏季**：
- ⛈️暴风雨(1天)：禁止外出，30%作物受损
- 🔥持续干旱(3天)：未浇水作物枯萎，粮价+20%
- 🌡️酷暑高温(2天)：体力+50%，心情-1，作物-20%

**秋季**：
- 🌀秋台风(1天)：禁止外出，40%作物+建筑受损
- 🌫️浓雾弥漫(2天)：愚笨村民效率-30%
- 🌈丰收祥雨(2天)：作物+50%，体力-20%，粮价-10%

**冬季**：
- ❄️暴雪封路(3天)：禁止外出，每天+2🪵消耗
- 💨寒潮来袭(2天)：体力+80%，体弱村民30%生病
- 🌤️冬日暖阳(2天)：作物恢复生长，心情+1

## 九、邻村往来（详细）

### 9.1 三个邻村
- 🌾丰谷村：农业村，农产品便宜
- ⛏️铁岭镇：矿业镇，建材便宜
- 🏮云水乡：商贸乡，杂货便宜

### 9.2 好感度机制
- 初始好感度：25
- 好感度≥30：解锁村际贸易
- 好感度≥35：邻村可能送礼（每季每村最多1次）
- 超过5天不互动：好感度缓慢下降

### 9.3 互动方式
- 对话：通过「💬拜访村长」自由对话
- 赠礼：每村每天最多2次，提升好感度
- 贸易：好感度≥30后解锁，各村物价有差异
- 援助：帮助邻村求援可提升好感度和声望

### 9.4 偷窃机制（慎用）
- 每村每季最多1次
- 35%概率被发现，好感度大幅下降
- 村长会记住偷窃记录，影响后续对话

## 十、繁荣度系统（详细）

### 10.1 每日自动增长
繁荣度每天根据以下因素自动增长：
- 村民数量
- 建筑数量
- 农田数量
- 村民平均幸福度
- 资源状况

### 10.2 额外加分事件
- 建造建筑：+5
- 招募村民：+10
- 收获作物：+2

### 10.3 衰减因素
- 村民心情低迷：-1~-2
- 饥荒（缺粮）：-2
- 金币耗尽：-1
- 无村民：-1
- 农田荒废：-1

### 10.4 等级与奖励
每达到新等级可领取金币奖励，共10个等级。

## 十一、快捷键
- Ctrl+S：存档
- Ctrl+L：读档
- 空格：钓鱼操作
`;

/**
 * 游戏规则助手类
 */
export class GameRulesHelper {
    constructor(gameState, aiService, eventBus) {
        this.state = gameState;
        this.ai = aiService;
        this.bus = eventBus;
        this.chatHistory = [];
    }

    /**
     * 生成当前游戏状态摘要
     */
    getGameStateSummary() {
        const s = this.state;
        const villagerCount = s.villagers.length;
        const buildingCount = s.buildings.length;
        const plotCount = s.plots.length;

        // 村民状态
        const villagerInfo = s.villagers.map(v => {
            const traits = v.traits.join('、');
            return `${v.name}(${traits}, 体力${v.stamina}/${v.maxStamina}, 心情${v.mood}/10)`;
        }).join('; ') || '无村民';

        // 建筑统计
        const buildingTypes = {};
        s.buildings.forEach(b => {
            buildingTypes[b.type] = (buildingTypes[b.type] || 0) + 1;
        });
        const buildingInfo = Object.entries(buildingTypes)
            .map(([type, count]) => `${type}×${count}`)
            .join(', ') || '无建筑';

        // 农田状态
        const emptyPlots = s.plots.filter(p => p.stage === 'empty').length;
        const growingPlots = s.plots.filter(p => p.crop && p.stage !== 'ready' && p.stage !== 'empty').length;
        const readyPlots = s.plots.filter(p => p.stage === 'ready').length;

        // 政策
        const policies = s.policies || {};

        // 繁荣度
        const prosperity = s.prosperity || 0;

        return `
【当前游戏状态】
- 时间: 第${s.time.year}年·${s.seasonName} 第${s.time.day}天 ${s.time.hour}:00
- 金币: ${s.resources.gold}💰
- 小麦库存: ${s.inventory.wheat || 0}🌾
- 木材: ${s.resources.wood}🪵
- 石料: ${s.resources.stone}🪨
- 繁荣度: ${prosperity}
- 村民(${villagerCount}人): ${villagerInfo}
- 建筑: ${buildingInfo}
- 农田(${plotCount}块): 空闲${emptyPlots}块, 生长中${growingPlots}块, 可收获${readyPlots}块
- 当前政策: 工时=${policies.workHours || 'standard'}, 分配=${policies.distribution || 'public'}, 奖惩=${policies.reward || 'none'}, 休假=${policies.holiday || 'one'}
`;
    }

    /**
     * 构建规则助手的 Prompt
     */
    buildPrompt(userQuestion) {
        const stateSummary = this.getGameStateSummary();
        
        return `你是「治村物语」游戏的规则小助手，名叫"小村助"。你需要：
1. 回答玩家关于游戏规则的问题（参考下方规则手册）
2. 根据玩家当前的游戏状态给出针对性建议

【角色设定】
- 语气亲切友好，像一个热心的游戏老玩家
- 回答简洁明了，不要过于冗长
- 给建议时要具体、可操作
- 可以使用emoji让回答更生动

${stateSummary}

【游戏规则手册摘要】
${GAME_RULES_KNOWLEDGE}

【对话历史】
${this.chatHistory.slice(-6).map(h => `${h.role === 'user' ? '玩家' : '小村助'}: ${h.content}`).join('\n')}

【玩家提问】
${userQuestion}

请用中文回答，简洁友好，150字以内。如果是关于策略建议的问题，请结合当前游戏状态给出具体建议。`;
    }

    /**
     * 回答玩家问题
     */
    async askQuestion(question) {
        // 添加用户问题到历史
        this.chatHistory.push({ role: 'user', content: question });
        
        // 如果 AI 不可用，使用本地规则匹配
        if (!this.ai?.enabled) {
            const answer = this.getLocalAnswer(question);
            this.chatHistory.push({ role: 'assistant', content: answer });
            return answer;
        }

        try {
            const prompt = this.buildPrompt(question);
            const response = await this.ai.chatRaw(prompt, { 
                temperature: 0.7, 
                maxTokens: 300 
            });
            
            const answer = response || this.getLocalAnswer(question);
            this.chatHistory.push({ role: 'assistant', content: answer });
            return answer;
        } catch (e) {
            console.warn('[GameRulesHelper] AI 请求失败，使用本地回答', e);
            const answer = this.getLocalAnswer(question);
            this.chatHistory.push({ role: 'assistant', content: answer });
            return answer;
        }
    }

    /**
     * 本地规则匹配（AI 不可用时的降级方案）
     */
    getLocalAnswer(question) {
        const q = question.toLowerCase();
        const s = this.state;

        // 建议类问题
        if (q.includes('建议') || q.includes('怎么办') || q.includes('该做什么') || q.includes('下一步')) {
            return this.getStrategySuggestion();
        }

        // 新手问题
        if (q.includes('新手') || q.includes('开局') || q.includes('刚开始')) {
            return '🌟 新手建议：1️⃣ 先建鱼塘，钓鱼卖钱赚启动资金；2️⃣ 攒够材料建伐木场；3️⃣ 建房招村民；4️⃣ 扩建农田种小麦保粮。记住：缺钱就去钓鱼！';
        }

        // 村民相关
        if (q.includes('村民') || q.includes('招募')) {
            return '👥 村民系统：招募需50💰+空房。每个村民有随机性格和特长。体力10点，心情10分。每天消耗1🌾粮食。通过对话可以指挥村民干活哦！';
        }

        // 钓鱼相关
        if (q.includes('钓鱼') || q.includes('鱼塘')) {
            return '🎣 钓鱼系统：建鱼塘后解锁，仅限玩家操作！共8种鱼，传说鱼可卖100-200💰。连击可加成售价。鱼塘可升级3级增加容量。';
        }

        // 市场相关
        if (q.includes('市场') || q.includes('价格') || q.includes('交易') || q.includes('买卖')) {
            return '🛒 市场系统：营业时间9:00-18:00。价格随季节/天气波动。每天5:00有AI早报预测，19:00有晚报回顾。低买高卖是关键！';
        }

        // 农业相关
        if (q.includes('农田') || q.includes('种植') || q.includes('作物') || q.includes('种子')) {
            return '🌾 农业系统：种植需种子+每日浇水。施肥+30%产量。萝卜最快(2天)，葡萄最贵(80💰)。小麦是粮食来源，优先保障！';
        }

        // 政策相关
        if (q.includes('政策') || q.includes('工时') || q.includes('休假')) {
            return '📜 政策系统：4种政策各有trade-off。996高产出但村民累；双休开心但产出少；绩效奖金花钱但激励强。根据情况灵活调整！';
        }

        // 天气相关
        if (q.includes('天气') || q.includes('预报')) {
            return '🌤️ 天气系统：每季3种特殊天气。春有虫害/倒春寒，夏有干旱/暴风雨，秋有台风/丰收雨，冬有暴雪/寒潮。关注预报提前准备！';
        }

        // 邻村相关
        if (q.includes('邻村') || q.includes('好感')) {
            return '🏘️ 邻村系统：3个邻村，好感≥30开贸易，≥35可能送礼。多对话多赠礼提升好感。超5天不互动会掉好感哦！';
        }

        // 繁荣度相关
        if (q.includes('繁荣') || q.includes('等级')) {
            return '⭐ 繁荣度：累计制，每天自动增长。建筑+5，招募+10，收获+2。村民不开心或缺粮会扣分。共10级，每级有金币奖励！';
        }

        // 默认回答
        return '🤔 抱歉，我不太理解你的问题。你可以问我关于村民、农业、钓鱼、市场、政策、天气、邻村等任何游戏规则，或者问我"现在该怎么办"获取建议！';
    }

    /**
     * 根据当前状态生成策略建议
     */
    getStrategySuggestion() {
        const s = this.state;
        const suggestions = [];

        // 检查金币
        if (s.resources.gold < 50) {
            suggestions.push('💰 金币紧张！建议去钓鱼赚钱，或者卖掉库存农产品');
        }

        // 检查粮食
        if ((s.inventory.wheat || 0) < s.villagers.length * 3) {
            suggestions.push('🌾 粮食告急！优先种植小麦，或去市场购买');
        }

        // 检查村民数量
        if (s.villagers.length === 0) {
            suggestions.push('👥 还没有村民！先建房再招募吧');
        }

        // 检查鱼塘
        const hasPond = s.buildings.some(b => b.type === 'fishPond' || b.type === 'pond');
        if (!hasPond && s.resources.gold >= 80) {
            suggestions.push('🎣 建议建造鱼塘！钓鱼是稳定的收入来源');
        }

        // 检查伐木场
        const hasLumber = s.buildings.some(b => b.type === 'lumberYard');
        if (!hasLumber && s.villagers.length > 0) {
            suggestions.push('🪓 没有伐木场，村民无法伐木。建议优先建造！');
        }

        // 检查可收获作物
        const readyPlots = s.plots.filter(p => p.stage === 'ready').length;
        if (readyPlots > 0) {
            suggestions.push(`🌟 有${readyPlots}块农田可收获！别忘了安排村民去收割`);
        }

        // 检查心情
        const lowMoodVillagers = s.villagers.filter(v => v.mood < 4);
        if (lowMoodVillagers.length > 0) {
            suggestions.push(`😟 ${lowMoodVillagers.length}名村民心情低落，考虑调整政策或让他们休息`);
        }

        if (suggestions.length === 0) {
            suggestions.push('✨ 目前状态不错！继续发展村庄，扩建农田、招募村民吧');
        }

        return suggestions.slice(0, 3).join('\n');
    }

    /**
     * 清空对话历史
     */
    clearHistory() {
        this.chatHistory = [];
    }
}
