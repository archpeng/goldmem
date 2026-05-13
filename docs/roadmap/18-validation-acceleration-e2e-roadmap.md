# 18. Validation Acceleration E2E Roadmap

本文定义下一阶段的加速验证方案。目标不是把长期理解飞轮一次性建完，而是用高密度、多角度、可重复的 E2E 测试快速回答：

```text
Graphiti 长期关系层是否真的带来产品级增益？
老人端“生活记忆秘书”是否有真实使用支点？
隐私协助是否能保留安全价值而不破坏尊严？
```

## 1. 验证原则

### 先证伪核心假设

当前最重要的假设：

- 老人端任务体验能形成持续使用，而不是一次性新鲜感。
- Graphiti enabled 在关系型问题上明显优于 disabled。
- 家人端最小协助不会伤害使用者隐私感。
- 后台化 Graphiti 不影响即时记录体验。

如果这些假设不成立，不应继续扩大 Correction Loop、Nightly Consolidation、复杂 curated episode 投入。

### 用压缩时间制造长期数据

真实长期数据需要数周甚至数月。E2E 阶段可以用“压缩时间”的方式生成高密度数据：

```text
多个虚拟老人 profile
连续多天生活事件
多次改期、纠错、家人确认、风险升级
统一 query battery
Graphiti enabled / disabled 对照
```

这不是替代真实试点，而是先验证系统机制是否值得继续投入。

### 只通过 Kernel 写业务 truth

测试生成正常业务数据时必须走 `POST /elder/turn`、reminder/family/correction Kernel command 等路径。

允许直接写数据库的情况只有：

- memory lint 脏数据 fixture。
- migration/backfill 验证 fixture。
- 明确标记的低层 store test。

Graphiti、pgvector、前端或测试脚本不得绕过 Kernel 写正常业务 truth。

## 2. 两段式验证节奏

### Stage A: 6 周验证门

目标：

- 判断产品与 Graphiti 假设是否成立。
- 建最小 safety net。
- 不启动大规模长期飞轮。

工作包：

| 工作包 | 输出 | 不做什么 |
|---|---|---|
| Graphiti A/B 高密度 E2E | 分场景胜率、evidence 对齐率、失败样例 | 不做复杂自动修复 |
| Memory Lint v1 + triage | lint report、review task、suppression | 不自动改 truth |
| 老人端试点 instrumentation | 7 日使用、确认、查询、隐私反馈 | 不扩展家人 dashboard |
| 性能基线 | source ack、background completion、provider timing | 不把 Graphiti 放回实时阻塞链路 |

继续投入标准：

- Graphiti enabled 在关系型 query 上明显优于 disabled。
- temporal evidence provenance 对齐稳定。
- source/draft ack 不被 Graphiti sidecar 影响。
- 隐私协助 DTO 零 raw transcript/audio/full evidence 泄露。
- 真实试点用户存在持续任务输入和长期查询行为。

### Stage B: 长期飞轮建设

只有 Stage A 通过后再启动：

- Curated Graphiti Episode v1。
- Query-to-Correction Loop。
- Event-triggered / Nightly Consolidation。
- 长期趋势摘要产品化。

## 3. 高密度 Profile 设计

每个 profile 是一个压缩时间的老人生活样本。推荐先做 7 个 profile。

| Profile | 输入密度 | 核心链路 | 关键问题 |
|---|---:|---|---|
| 复查改期型 | 40-60 turns | 预约、改期、家人确认 | “现在到底哪天复查？” |
| 用药变化型 | 30-50 turns | 医嘱、误导、确认 | “这个药后来改了吗？” |
| 诈骗风险型 | 30-50 turns | 补贴、身份证、验证码、转账 | “这是不是有风险？” |
| 模糊指代型 | 30-40 turns | 上次那个、刚才那个、小敏说的 | “这和哪件事有关？” |
| 长期趋势型 | 40-60 turns | 头晕、忘记、睡眠差 | “最近是不是经常这样？” |
| 隐私协助型 | 30-40 turns | private 日常、高风险协助 | “家人能看到什么？” |
| 纠错型 | 30-40 turns | 错误回答、用户纠正、复查 | “纠正后是否按新证据回答？” |

每个 profile 至少包含：

- 20 条普通低价值记录，用来验证 Graphiti 不被滥用。
- 10 条高价值关系记录，用来验证 Graphiti 应入队。
- 5 条 query battery，用来验证 enabled / disabled 差异。
- 2 条用户纠正，用来验证 correction 不覆盖旧 truth。
- 2 条家人协助，用来验证隐私 DTO。
- 1 条无证据查询，用来验证不编造。

## 4. Query Battery

所有 profile 使用统一问题集，便于横向比较：

```text
后来改了吗？
现在到底哪个说法有效？
这和上次那个是不是同一件事？
这件事有风险吗？
最近是不是经常出现这种情况？
我刚才说的不对，应该是...
有没有可靠记录？
```

每个 query 需要记录：

- answer。
- evidence list。
- evidence source type。
- Graphiti enabled/disabled。
- temporal evidence count。
- aligned evidence count。
- unsupported certainty。
- safety note。
- privacy leak count。
- timing。

## 5. A/B 执行模式

每个 profile 跑四种模式：

```text
Mode A: Graphiti disabled
Mode B: Graphiti enabled, normal sidecar
Mode C: Graphiti enabled, delayed sidecar
Mode D: Graphiti enabled, sidecar failing
```

核心断言：

- Mode B 在关系型 query 上优于 Mode A。
- Mode C/D 不影响 source/draft 首屏响应。
- Mode D 不污染 PostgreSQL truth。
- disabled 模式不得出现 temporal evidence。
- enabled 模式的 temporal evidence 必须能对齐 PostgreSQL source/event/reminder。

## 6. 评分指标

### Graphiti 增益

- `graphiti_answer_lift`
- `latest_effective_fact_accuracy`
- `same_matter_resolution_rate`
- `conflict_chain_explained_rate`
- `long_term_pattern_detected_rate`
- `temporal_evidence_count`
- `aligned_evidence_rate`
- `unsupported_certainty_rate`

### 安全与隐私

- `privacy_leak_count`
- `raw_transcript_leak_count`
- `auto_confirmed_ambiguous_reminder_count`
- `medical_direct_advice_count`
- `family_required_miss_count`
- `no_evidence_hallucination_count`

### 交互与性能

- `source_ack_p50_ms`
- `source_ack_p95_ms`
- `draft_visible_p95_ms`
- `reminder_visible_p95_ms`
- `graphiti_job_success_rate`
- `graphiti_job_p95_ms`
- `duplicate_source_count`
- `provider_timeout_count_by_chain`

## 7. Memory Lint 验证设计

Memory Lint 不只输出 report，还必须有 triage 闭环。

脏数据 fixture：

- confirmed reminder 仍然 `confirmationRequired=true`。
- semantic memory 缺 `metadata.sourceId` 或 `metadata.summary`。
- Graphiti evidence 无法对齐 PostgreSQL。
- family assist DTO 含 raw transcript/audio/full evidence。
- context link 引用不存在 event。
- financial/fraud event visibility 不是 `family_required`。
- 长期 pending family assist task 未处理。

断言：

- lint 找到全部 high severity finding。
- finding 包含 `severity/entityType/entityId/reason/owner/suggestedAction`。
- high severity finding 创建 review task 或阻断 gate。
- lint 不直接修改 truth。
- 重复 finding 被聚合。
- accepted risk 必须有过期时间。

## 8. 老人端真实试点指标

工程 E2E 只能证明机制，不能证明产品价值。6 周内需要同步小范围真实试点。

最小观察指标：

- 7 日内真实输入次数。
- 语音输入占比。
- 任务确认率。
- 查询长期记忆次数。
- 改期/当前有效说法类问题次数。
- 用户纠错次数。
- 隐私提示理解度。
- 对家人协助的接受/拒绝比例。
- 家人协助是否让老人减少使用。

试点判断：

- 如果用户只用作普通备忘录，很少问长期关系问题，需要降低 Graphiti 投入。
- 如果隐私顾虑明显，需要继续削弱家人端，而不是加强 dashboard。
- 如果“后来改了吗 / 到底哪个有效”是真实高频问题，Graphiti 投入有产品支点。

## 9. 建议测试文件

第一阶段先使用一个聚合 fixture，便于一次生成跨 profile 的统一 A/B 报告；后续如果单个 profile 过大，再拆成独立文件。

```text
e2e/golden-graphiti-density.json
e2e/fixtures/memory-lint-dirty-state.json

scripts/graphiti-comparison-e2e.ts
scripts/memory-lint.ts
scripts/memory-lint-fixture-e2e.ts
scripts/privacy-e2e.ts
scripts/performance-baseline-e2e.ts
apps/web-mvp/e2e/elder-trust-flow.spec.ts
```

建议命令：

```bash
pnpm e2e:graphiti:density
pnpm e2e:graphiti:compare
pnpm e2e:memory-lint
pnpm e2e:privacy
pnpm e2e:performance
pnpm e2e:web
```

## 10. 决策门

Stage A 结束后必须做一次明确决策：

```text
继续投入 Graphiti 飞轮
或
收缩为 PostgreSQL + pgvector 的强备忘录产品
```

继续投入条件：

- Graphiti A/B 有稳定正向差异。
- 真实试点中长期关系 query 真实出现。
- privacy assist 没有明显伤害信任。
- lint finding 可被 triage 消化。
- 性能基线证明 Graphiti 后台化不影响老人端首屏体验。

如果不满足，不应继续堆 Correction Loop 和 Nightly Consolidation。应先回到老人端任务体验、提醒可靠性、隐私信任感。

一句话：

```text
先用高密度 E2E 和真实试点证明“长期关系值得做”，再把它做成飞轮。
```
