# Karpathy LLM Wiki 对 GoldMem 的启发

来源：<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>

阅读日期：2026-05-13

## 1. 原文核心思想

Karpathy 的 gist 提出一种不同于普通 RAG 的个人知识库模式：

- Raw sources 是不可变的来源。
- LLM 不只在查询时临时检索 chunk，而是持续维护一个结构化、互相关联的 wiki。
- 每次 ingest 新资料时，LLM 会更新已有页面、实体页、主题页、矛盾点和索引。
- 查询产生的高价值分析也可以回写到知识库中，让探索结果继续复利。
- schema 或 agent instruction 是关键，它约束 LLM 如何维护知识库，而不是让 LLM 随意聊天。
- index 和 log 很重要：index 负责内容导航，log 负责时间线和变更记录。
- 定期 lint 知识库，查找矛盾、陈旧结论、孤立页面、缺失链接和待补资料。

最重要的启发：

```text
不要每次查询都从零开始重新理解。
要把理解过程沉淀成可持续维护、可追溯、会复利的中间资产。
```

## 2. 和 GoldMem 的映射

Karpathy 的 wiki pattern 和 GoldMem 当前架构高度相似，但 GoldMem 的领域更高风险，不能直接照搬 markdown wiki。

| LLM Wiki 概念 | GoldMem 对应层 |
|---|---|
| Raw sources | `memory_sources`，原始语音/文字输入 |
| Wiki pages | MemoryEvent summaries、Graphiti temporal facts、未来的 elder-facing memory pages |
| Schema | `AGENTS.md`、`architecture.md`、prompts/capability packs、Zod schema |
| Index | pgvector semantic recall index、event metadata、Graphiti group/entity/fact index |
| Log | audit logs、memory processing jobs、temporal memory jobs |
| Ingest | `/elder/turn` record -> source -> MemoryPlan -> PostgreSQL truth -> semantic/Graphiti |
| Query | PostgreSQL + pgvector + Graphiti evidence merge -> answer |
| Lint | golden e2e、architecture check、future memory consistency audit |

GoldMem 已经不是简单 RAG。它已经有：

- PostgreSQL truth。
- pgvector semantic recall index。
- Graphiti 长期关系记忆。
- audit log。
- MemoryPlan schema。
- relation enrichment signal。
- background processing。

但还需要补上 Karpathy 模式里最关键的“持续维护中间资产”意识。

## 3. 对老人端产品的启发

老人端不应该只是：

```text
你说一句话 -> 系统存一条记录 -> 下次搜索
```

而应该逐渐变成：

```text
你说一句话 -> 系统先记下 -> 后台整理成长期生活记忆 -> 以后越用越懂你的生活脉络
```

这能直接支持 GoldMem 的核心差异化：

- 不是只记“明天去医院”。
- 而是知道“这次医院复查后来改过时间”。
- 不是只记“医保卡在抽屉”。
- 而是知道“医保卡和社区医院复查有关”。
- 不是只记“有人要验证码”。
- 而是知道“补贴、验证码、身份证号多次共同出现，是风险链”。

因此老人端交互要表达的是：

```text
我先帮你记下。
我还会继续帮你整理。
等你想不起来时，我能按最新、最可靠的记录帮你找。
```

不要把“后台整理长期关系”暴露成技术状态。老人只需要感知到：

- 已记下。
- 正在整理。
- 我找到了最新说法。
- 我找到这件事后来改过。
- 我不确定是不是同一件事，需要你确认。

## 4. 对 Graphiti 的启发

Karpathy 的 wiki 是 LLM 持续维护的 interlinked knowledge base。GoldMem 的长期关系层不应重新发明 markdown wiki，而应把 Graphiti 作为更适合时间关系的“长期记忆维护层”。

Graphiti 应该承担：

- 事实变化链。
- 有效时间窗口。
- 同一事项关联。
- 冲突和替代关系。
- 风险演化。
- 人物、地点、事项之间的长期关系。

但 Graphiti 不应成为业务 truth：

- 不确认提醒。
- 不修改 PostgreSQL event。
- 不直接通知家人。
- 不决定 visibility。
- 不直接回答用户。

Graphiti 的正确位置：

```text
PostgreSQL truth 写完之后
-> Kernel 判断是否有长期关系价值
-> Graphiti 后台整理
-> 查询时作为 temporal evidence
-> Kernel 对齐 provenance 并融合答案
```

## 5. 对后台整理机制的启发

Karpathy 强调 ingest、query、lint 三种操作。GoldMem 可以对应建设三条后台能力。

### Ingest Consolidation

每条高价值记录写入后，后台整理：

- 是否和旧事件是同一事项。
- 是否替代旧时间、地点、用药方案。
- 是否形成风险链。
- 是否值得进入长期记忆。

当前已有：

- MemoryPlan。
- relationEnrichmentSignals。
- temporalMemoryJob。
- Graphiti episode。

下一步应该增强：

- episode 内容更像 curated memory note，而不是简单 dump。
- episode metadata 必须稳定携带 sourceId/eventId/reminderId/riskFlagId。
- ordinary one-off task 不进入 Graphiti。

### Query Filing

Karpathy 提到查询结果也可以沉淀。GoldMem 可以谨慎引入：

- 用户明确纠正后的答案，进入 feedback。
- 多证据综合出的稳定结论，进入 PostgreSQL/Graphiti consolidation。
- 不能把一次模型回答直接当 truth。

适合回写的内容：

- 家人确认后的复查时间。
- 老人确认后的改期结果。
- 多次记录共同形成的趋势摘要。
- 高风险事件处理结果。

不适合回写的内容：

- 没有证据的模型推测。
- 单次 query answer。
- Graphiti 未对齐 provenance 的 raw fact。

### Memory Lint

GoldMem 需要类似 wiki lint 的长期健康检查：

- 同一事项是否有多个未解决时间。
- 已确认提醒是否仍标记 `confirmationRequired=true`。
- medical/financial/fraud event 是否 visibility 合规。
- Graphiti fact 是否能对齐 PostgreSQL source/event。
- semantic recall row 是否有 metadata.sourceId + metadata.summary。
- 是否存在 orphan context link。
- 是否存在长期未处理 family assist task。

这些 lint 不应该只靠 LLM judge。应优先使用 deterministic checks，再让 LLM 辅助生成解释和修复建议。

## 6. 对前端交互的启发

LLM Wiki 的用户体验不是“每次都问搜索引擎”，而是“浏览一个持续维护的知识结构”。GoldMem 老人端可以转译为：

- 首页仍是任务列表，不变复杂。
- 查询答案里轻量展示“依据”和“最新说法”。
- 隐私状态要可见。
- 长期关系不要用图谱 UI 展示给老人。
- Graphiti 价值通过自然语言表达。

推荐交互文案：

- `我找到这件事后来改过。`
- `按最新记录看，是这个时间。`
- `这两条可能是同一件事，但我还不能确定。`
- `我没有找到可靠记录。`
- `这条和之前那条说法不一致，先不要直接照做。`

不推荐：

- `Graphiti evidence found`
- `temporal relation detected`
- `semantic candidate`
- `confidence 0.72`
- `family_required`

## 7. 不应直接照搬的地方

Karpathy 的场景偏个人知识管理，GoldMem 面向老人生活、用药、金融、诈骗和隐私，风险更高。

不能照搬：

- 不能让 LLM 自由改写 truth。
- 不能用 markdown wiki 作为业务状态。
- 不能把 query answer 自动写成事实。
- 不能让家人浏览完整 wiki。
- 不能把“维护得很丰富”置于“使用者尊严和隐私”之上。

GoldMem 的约束更强：

```text
LLM 可以维护理解层。
Kernel 必须约束业务层。
PostgreSQL 必须保存 truth。
Graphiti 只能提供长期关系 evidence。
家人端只能看到最小必要摘要。
```

## 8. 建议落地路线

### E1: Memory Lint

新增 deterministic memory lint：

- reminder 状态一致性。
- visibility 合规性。
- semantic metadata 完整性。
- Graphiti provenance 对齐。
- orphan context link。
- stale family assist task。

输出进入 audit 或 debug report。

### E2: Curated Temporal Episode

优化 Graphiti episode builder：

- 更明确地表达“事件、变化、当前有效说法、证据来源”。
- 减少 raw transcript 依赖。
- 强化 source/event/reminder/risk metadata。

### E3: Elder-Facing Memory Digest

为老人端生成低频摘要，不做 dashboard：

- 最近整理出的重要变化。
- 最近需要确认的事项。
- 最近高风险提醒。
- 最近长期趋势。

文案必须是第二人称秘书语气。

### E4: Query-to-Feedback Loop

查询答案如果被用户纠正：

- 写 feedback。
- 触发后台 correction processing。
- 必要时更新 event/reminder 或生成新 Graphiti episode。

### E5: Memory Workbench

先做内部 debug/admin，不给老人和家人：

- source -> MemoryPlan -> PostgreSQL writes -> semantic row -> Graphiti episode -> query evidence -> final answer。
- 用于排查和评估，不作为产品 UI。

## 9. 最终判断

Karpathy 的 gist 对 GoldMem 最大启发是：

```text
真正有黏性的记忆系统，不是检索更多 raw data，
而是持续维护一个会复利的理解层。
```

GoldMem 应把这个理解层实现为：

```text
PostgreSQL truth
+ pgvector semantic recall
+ Graphiti temporal relationship memory
+ Kernel evidence-bound synthesis
+ deterministic memory lint
```

老人端不需要看到这个复杂系统。老人只需要感受到：

```text
我说的话不会丢。
它会慢慢帮我整理清楚。
以后我想不起来时，它能按最新、最可靠的记录帮我找。
```
