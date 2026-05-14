# 17. Long-Term Understanding Gap Roadmap

本文记录当前 mem 架构距离最终“持续维护长期理解层”的缺口。当前方向已经正确：不是普通 RAG，也不是简单备忘录，而是 `PostgreSQL truth + pgvector recall + Graphiti temporal memory + Kernel evidence-bound synthesis`。但最终产品能力还没有完全成熟。

## 0. 节奏修正

当前风险不是方向错误，而是节奏偏激进。

Graphiti 已经进入生产路径，但还不能被默认当作成熟飞轮支柱。用户端留存、Graphiti A/B 增益、隐私协助接受度都还属于假设。因此下一阶段应先做 6 周验证门：

```text
Memory Lint v1 最小闭环
+ Graphiti A/B 高密度黄金测试
+ 用户端真实留存/信任试点
```

只有这些验证成立后，再启动 Curated Episode、Query-to-Correction Loop、Event-triggered / Nightly Consolidation。

这样做的原因：

- 如果用户端真实留存不成立，长期理解层没有产品支点。
- 如果 Graphiti enabled 不明显优于 disabled，继续投入 curated episode 和 consolidation 的收益不足。
- 如果 Memory Lint 没有 triage 闭环，lint 会变成告警噪音。
- 如果隐私协助破坏信任，家人端越强，用户端越弱。

本文件后续的缺口仍然成立，但推荐顺序必须先验证，再飞轮化。

## 1. 当前已具备的结构

当前系统已经对齐 LLM Wiki / 持续维护知识层的基本架构：

```text
Raw source
-> LLM structured understanding
-> PostgreSQL truth
-> pgvector semantic recall index
-> Graphiti long-term relationship memory
-> Kernel evidence-bound answer
-> audit/debug
```

对应实现：

- `memory_sources` 保存原始输入。
- `MemoryPlan` 把模型理解结构化。
- PostgreSQL 保存 source/event/reminder/risk/family task/context link/feedback/audit。
- pgvector 提供 semantic recall candidate。
- Graphiti 提供 temporal relationship evidence。
- Kernel 负责 guardrails、persistence、evidence merge、answer safety。
- audit / debug trace 记录链路。

因此当前架构形状是正确的。

## 2. 缺口一：Graphiti 还不是完整长期整理系统

当前 Graphiti 已经能：

- 后台入队。
- 写 temporal episode。
- 查询 temporal evidence。
- 做 provenance 对齐。
- 支撑部分改期、关系、风险链查询。

但还缺：

- curated episode 质量不够稳定。
- facts 的有效时间、替代关系、当前有效说法表达还不够强。
- same-matter / supersession / conflict chain 还需要更稳定的生成和验证。
- nightly consolidation 尚未成为核心日常机制。
- Graphiti enabled vs disabled 的 A/B 还需要覆盖更多真实高价值场景。
- 长期趋势摘要尚未产品化。

阶段判断：

```text
Graphiti 当前是“长期关系层的生产路径”，不是“成熟长期记忆维护层”。
```

短期目标：

```text
先证明 Graphiti enabled 在关系型问题上显著优于 disabled。
再投资 curated episode 和 consolidation。
```

验收：

- 改期链、用药变化链、诈骗风险链、长期症状趋势、同一事项关联都能通过 golden case。
- Graphiti evidence 必须 source/event aligned。
- Graphiti 失败不影响即时记录和 PostgreSQL truth。
- 查询答案能解释“为什么这是当前有效说法”。

## 3. 缺口二：Memory Lint 尚未系统化

当前已有：

- Zod schema validation。
- architecture check。
- golden e2e。
- audit log。
- Graphiti A/B tests。

但还缺一套面向长期记忆健康的 deterministic memory lint。

应该检查：

- 同一事项是否存在多个未解决时间。
- 已确认提醒是否仍 `confirmationRequired=true`。
- medical / financial / fraud / sensitive visibility 是否合规。
- family assist task 是否只暴露最小摘要。
- Graphiti fact 是否能对齐 PostgreSQL source/event/episode。
- semantic recall row 是否有 `metadata.sourceId` 和 `metadata.summary`。
- context link 是否 orphan。
- 是否存在长期未处理 family assist task。
- 是否存在 Graphiti/PostgreSQL/pgvector 互相冲突但未进入 review 的情况。

实现原则：

- 优先 deterministic checks。
- LLM 只负责解释、归纳和建议，不负责判定 truth。
- lint 结果进入 audit/debug report，并在 high severity 时创建 review task。
- lint finding 必须有 owner、severity、entityId、reason、处理状态。
- 重复 finding 必须聚合，避免每天生成重复告警。
- 低风险、可接受 finding 必须能限时 suppression。
- 高风险 lint failure 应该进入 regression test 或 golden fixture。

Triage 路径：

```text
lint finding
-> severity
-> owner
-> review task / report
-> resolved / accepted risk / regression fixture
```

验收：

- 新增 `memory-lint` 脚本或 Kernel diagnostic command。
- 至少覆盖 reminder、visibility、semantic metadata、Graphiti provenance 四类检查。
- lint 输出可被 CI 或人工 review 使用。
- high severity finding 不只停留在日志，必须进入 review 消化路径。

## 4. 缺口三：Query-to-Correction Loop 不完整

当前系统已有：

- query answer。
- evidence-bound answer。
- answer feedback。
- audit。

但还没有完整闭环：

```text
用户指出答案不对
-> feedback
-> 后台 correction processing
-> PostgreSQL truth update / new corrective event
-> semantic recall rebuild
-> Graphiti consolidation episode
-> 后续查询使用修正后的长期记忆
```

必须避免：

- 不能把一次 query answer 直接写成 truth。
- 不能让模型自行改旧事件。
- 不能让 Graphiti raw fact 直接替代 PostgreSQL 状态。

适合回写的内容：

- 用户明确纠正。
- 家人确认后的时间、地点、事项。
- 已确认的提醒变更。
- 高风险事件处理结果。
- 多次记录共同形成、并经过 evidence 对齐的趋势摘要。

验收：

- `feedback_created` 后可以触发后台 correction job。
- correction job 只能通过 Kernel command 写 truth。
- 每次修正都可 audit。
- 修正前后的查询有 regression case。

## 5. 缺口四：用户端还没有充分表达“长期整理感”

当前用户端主要是任务列表和即时输入，方向正确，但长期关系能力还没有充分产品化。

需要让用户感受到：

- 我说的话不会丢。
- 系统会继续帮我整理。
- 系统知道这件事后来改过。
- 系统能按最新记录回答。
- 系统不确定时会明确说不确定。
- 原话不会默认给家人看。

推荐产品表达：

- `我找到这件事后来改过。`
- `按最新记录看，是这个时间。`
- `这两条可能是同一件事，但我还不能确定。`
- `这条和之前那条说法不一致，先不要直接照做。`
- `我没有找到可靠记录。`
- `原话不会给家人看。`

不应暴露：

- Graphiti
- temporal evidence
- semantic candidate
- confidence score
- family_required
- queued / processing 等技术状态

验收：

- 查询结果先结论后依据。
- 结果里能表达“最新说法 / 可能相关 / 不确定”。
- 任务卡可展示隐私状态。
- 风险场景文案不恐吓、不评价使用者。

## 6. 缺口五：Nightly Consolidation 尚未成为核心飞轮

当前已有 memory processing jobs 和 temporal jobs，但 nightly consolidation 还没有形成稳定产品能力。

目标：

- 每日从 PostgreSQL truth 生成 curated temporal episodes。
- 整理同一事项链。
- 整理冲突和替代关系。
- 整理长期趋势。
- 生成需要人工确认的 review task。
- 生成 eval/golden 候选。

节奏修正：

- 第一版不一定做每天全量 wiki-style consolidation。
- 优先做 event-triggered consolidation：改期、冲突、风险升级、家人确认、用户纠错才触发整理。
- 夜间任务只做补偿、聚合、lint、eval candidate，不做大规模自由改写。

注意：

- consolidation 不能覆盖 PostgreSQL truth。
- consolidation 不能自动确认提醒。
- consolidation 不能扩大分享范围。
- Graphiti 只接收 curated episode，不接管业务动作。

验收：

- daily consolidation 可幂等运行。
- 输出 Graphiti episode 带稳定 source/event/reminder/risk metadata。
- consolidation 发现冲突时创建 review，而不是直接改事实。
- 失败可 retry，可 audit。

## 7. 推荐推进顺序

```text
1. Graphiti A/B 高密度黄金测试。
2. Memory Lint v1 + triage 闭环。
3. 用户端 6 周真实留存/信任试点。
4. 根据证据决定是否优化 Graphiti curated episode builder。
5. 再建 Query-to-Correction Loop。
6. 最后建 Event-triggered / Nightly Consolidation。
7. 同步在用户端表达“长期整理感”。
```

原因：

- Graphiti A/B 先回答“这个长期关系层值不值得继续加码”。
- Memory Lint 先建立长期记忆健康边界，但必须带 triage 闭环。
- 用户端试点回答“长期理解层有没有真实产品支点”。
- Curated episode 决定 Graphiti 质量上限，但应在 A/B 有信号后加大投入。
- Correction loop 和 consolidation 会扩大写入面，必须等 provenance 和 lint 稳定。
- 前端表达让用户感知长期记忆价值，但不能超前承诺系统还没验证的能力。

不建议并行启动全部组件。当前阶段只允许并行验证：

```text
Agent A: Graphiti A/B fixture 和 runner
Agent B: Memory Lint + triage report
Agent C: 用户端试点 instrumentation
Main: 汇总证据，决定是否进入长期飞轮建设
```

## 8. 最终验收标准

mem 达到最终长期理解层能力时，应满足：

- 普通任务可以即时记录，不等待长期整理。
- 高价值事件可以进入 Graphiti 后台关系整理。
- 查询时可以回答“后来改了吗 / 现在哪个有效 / 和哪件事有关”。
- 没证据时不编造。
- 用户纠正可以形成可审计的长期修正。
- memory lint 能发现长期记忆健康问题。
- 家人端只保留最小必要协助。
- 用户端能感受到系统可靠、克制、保护隐私。

一句话：

```text
当前项目已经具备正确架构骨架。
下一阶段要把 Graphiti、lint、correction、consolidation 和用户端表达
合成一个会持续复利的长期生活记忆系统。
```
