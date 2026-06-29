# AI 编程知识库索引

快速查找任务模板、技能、Prompt 框架、算法选择和设计原则。

---

## 任务场景

### T01: 需求澄清
**适用**：需求模糊、验收标准缺失、范围边界不清

- Prompt 模板：`.agents/prompts/T01-Requirement-Clarification.md`
- 主技能：`product-spec-builder`
- 框架建议：CRISPE、ICIO
- 知识来源：`ai-prompt/01-Requirement-Clarification`、`algorithms/start-here`

### T02: 功能实现
**适用**：需求和计划已清楚，需要落代码

- Prompt 模板：`.agents/prompts/T02-Feature-Implementation.md`
- 主技能：`dev-builder`
- 框架建议：CRISPE、BROKE
- 核心检查：SOLID、复杂度、边界条件、验证证据

### T03: Bug 诊断
**适用**：异常、回归、根因不清

- Prompt 模板：`.agents/prompts/T03-Bug-Reproduction.md`
- 主技能：`bug-fixer`
- 框架建议：ICIO、Chain-of-Thought
- 核心检查：现象、重现、环境、日志、根因、回归验证

### T04: 安全重构
**适用**：行为不变前提下改善结构、降复杂度、清技术债

- Prompt 模板：`.agents/prompts/T04-Refactor-With-Safety.md`
- 主技能：`dev-builder` + `code-review`
- 框架建议：CRISPE
- 核心检查：行为保持、职责拆分、依赖方向、重复消除

### T05: 单元测试生成
**适用**：新功能、修复回归、提高覆盖

- Prompt 模板：`.agents/prompts/T05-Unit-Test-Generation.md`
- 主技能：参考 `dev-builder`，遵守 TDD
- 框架建议：BROKE
- 核心检查：失败先行、主路径、边界、异常、断言真实性

### T06: 集成测试计划
**适用**：模块联调、流程验收、上线前系统验证

- Prompt 模板：`.agents/prompts/T06-Integration-Test-Plan.md`
- 主技能：`dev-planner`
- 框架建议：CRISPE
- 核心检查：接口契约、数据流、依赖、错误传播、环境准备

### T07: 代码审查
**适用**：功能完成后独立审查需求正确性和工程质量

- Prompt 模板：`.agents/prompts/T07-Code-Review.md`
- 主技能：`code-review`
- 框架建议：BROKE、CRISPE
- 核心检查：需求正确性、架构边界、SOLID、安全、性能、测试真实性

### T08: 架构决策
**适用**：技术选型、架构设计、重大拆分和模式决策

- Prompt 模板：`.agents/prompts/T08-Architecture-Decision.md`
- 主技能：`dev-planner`
- 框架建议：ROBOTIC、CRISPE
- 核心检查：问题驱动、候选方案、权衡、风险、验证方式

### T09: API 契约设计
**适用**：定义接口、错误码、版本兼容和数据契约

- Prompt 模板：`.agents/prompts/T09-API-Contract-Design.md`
- 主技能：`product-spec-builder` 或 `dev-planner`
- 框架建议：CRISPE
- 核心检查：资源模型、输入输出、错误语义、兼容策略

### T10: SQL 查询优化
**适用**：慢查询、索引问题、执行计划异常

- Prompt 模板：`.agents/prompts/T10-SQL-Query-Optimization.md`
- 主技能：`bug-fixer` 或 `dev-builder`
- 框架建议：Chain-of-Thought
- 核心检查：复杂度、索引、执行计划、N+1、IO 成本

### T11: 安全审查
**适用**：上线前安全检查、依赖风险、权限边界确认

- Prompt 模板：`.agents/prompts/T11-Security-Review.md`
- 主技能：`code-review`
- 框架建议：CRISPE
- 核心检查：注入、越权、敏感信息、认证授权、依赖漏洞

### T12: 性能优化
**适用**：响应慢、吞吐不够、资源浪费

- Prompt 模板：`.agents/prompts/T12-Performance-Optimization.md`
- 主技能：`dev-builder` 或 `bug-fixer`
- 框架建议：Chain-of-Thought、CRISPE
- 核心检查：测量、瓶颈、复杂度、缓存、并发、验证数据

### T13: 遗留代码理解
**适用**：接手旧代码、逻辑混乱、依赖不清

- Prompt 模板：`.agents/prompts/T13-Legacy-Code-Understanding.md`
- 主技能：`bug-fixer`、`dev-planner`
- 框架建议：ICIO
- 核心检查：调用链、状态流、依赖图、重构机会

### T14: 文档生成
**适用**：需要补 API、架构、部署、排障或使用文档

- Prompt 模板：`.agents/prompts/T14-Documentation-Generation.md`
- 主技能：`product-spec-builder`、`dev-planner`
- 框架建议：BROKE、CRISPE
- 核心检查：受众、结构、示例、同步维护、版本信息

---

## Prompt 框架

### CRISPE
适合结构化任务说明、功能实现、需求澄清、计划和文档。

### BROKE
适合快速生成标准化输出，如代码、测试、文档草稿。

### ROBOTIC
适合架构设计、多轮执行、复杂问题拆解。

### ICIO
适合诊断、排查、一步步收缩问题空间。

### Chain-of-Thought
适合算法设计、复杂度分析、性能推理、SQL 优化。

### RTF
适合角色化写作、演练式沟通、场景模拟。

### CO-STAR
适合内容生成，不作为主要工程框架。

---

## 算法与数据结构

**参考**：`algorithms`

### 常见选择
- 线性查找：O(n)，适合小规模或一次性扫描
- 二分查找：O(log n)，适合有序数据
- 哈希表：均摊 O(1)，适合频繁查找和去重
- 堆：适合 Top K、优先级队列
- BFS/DFS：适合树图遍历
- Dijkstra/A*：适合带权路径搜索
- 动态规划：适合重叠子问题
- 贪心：适合局部决策可证明最优的问题

### 决策记录要求
- 数据规模
- 目标复杂度
- 数据结构选择理由
- 最坏情况
- 验证方式

---

## 设计原则与模式

**参考**：`design-patterns`

### SOLID
- S：单一职责
- O：开闭原则
- L：里氏替换
- I：接口隔离
- D：依赖倒置

### 常见模式
- 创建型：Factory、Abstract Factory、Builder、Prototype、Singleton
- 结构型：Adapter、Bridge、Composite、Decorator、Facade、Proxy
- 行为型：Strategy、Observer、Template Method、Command、State、Chain of Responsibility

### 架构思想
- MVC / MVP / MVVM
- DDD
- 分层架构
- 组合优于继承

---

## Skill 结构

**参考**：`ai-skills`

一个合格的 `SKILL.md` 至少要有：

- 触发条件
- 输入
- 产出
- 执行规则
- 示例
- 完成标准

Skill 是“可复用的过程知识”，不是一次性工作记录。

---

## 快速路由

| 问题 | 模板 | 技能 |
| --- | --- | --- |
| 需求不清 | T01 | `product-spec-builder` |
| 做功能 | T02 | `dev-builder` |
| 修 Bug | T03 | `bug-fixer` |
| 要重构 | T04 | `dev-builder` + `code-review` |
| 补测试 | T05 | `dev-builder` |
| 做计划 | T06 | `dev-planner` |
| 做审查 | T07 | `code-review` |
| 定架构 | T08 | `dev-planner` |
| 设计接口 | T09 | `product-spec-builder` / `dev-planner` |
| SQL 慢 | T10 | `bug-fixer` |
| 查安全 | T11 | `code-review` |
| 查性能 | T12 | `dev-builder` / `bug-fixer` |
| 看旧代码 | T13 | `bug-fixer` / `dev-planner` |
| 写文档 | T14 | `product-spec-builder` / `dev-planner` |

---

## 检查清单

### 功能开发
- [ ] 需求明确
- [ ] 方案明确
- [ ] 数据结构和复杂度合理
- [ ] 代码符合 SOLID
- [ ] 有测试或验证证据
- [ ] 已通过审查

### 架构决策
- [ ] 问题和约束写清
- [ ] 至少比较 2 个方案
- [ ] 记录权衡和风险
- [ ] 给出验证方式

### Prompt / Skill
- [ ] 模板与场景匹配
- [ ] 框架选择合理
- [ ] Skill 的输入和产出清楚
- [ ] 不引用不存在的模板或技能

### 性能 / 安全
- [ ] 有测量或日志证据
- [ ] 有复杂度或执行计划说明
- [ ] 有边界和异常路径说明
- [ ] 有安全风险检查
