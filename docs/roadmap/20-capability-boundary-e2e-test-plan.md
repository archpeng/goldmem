# 20. Capability Boundary E2E Test Plan

本文定义 GoldMem 下一轮 E2E 测试计划。目标是用真实 API、PostgreSQL、pgvector、Graphiti sidecar 和模型网关验证“系统能力边界”，而不是只验证 happy path。

一句话目标：

```text
证明 GoldMem 能在真实服务链路中记得住、查得准、守得住边界，并且在 Graphiti 启用时确实提升长期关系问题。
```

## 1. 测试目标

### P0: 不破坏核心架构边界

必须验证：

- 业务 truth 只由 Kernel 通过 PostgreSQL store 写入。
- pgvector semantic recall 只提出候选，不作为最终 truth。
- Graphiti 只提供长期关系/时间证据，不直接确认提醒、不改变权限、不写业务状态。
- recall answer 必须来自 merged evidence；无证据时不能编造。
- 高风险行为由 schema、engine、store、audit 约束，不能只靠 prompt。
- API 和 Web MVP 保持 thin adapter，不能复制后端业务规则。

### P0: 安全与隐私确定性

必须验证：

- 医疗、用药、金融、诈骗、身份、密码、验证码、隐私共享场景都产生正确风险状态、family task 或安全提示。
- 模糊提醒不会被自动确认。
- context link 不会静默补全提醒时间、合并记录或覆盖事实。
- family assist DTO 不泄露 raw transcript、audio、完整 evidence 或敏感原文。
- 中文输入默认得到简体中文用户可读输出。

### P0: 证据绑定召回

必须验证：

- PostgreSQL 直接证据优先进入 answer。
- semantic evidence 必须带 PostgreSQL-derived `sourceId/eventId/summary`。
- Graphiti evidence 必须 source/event aligned；disabled 模式不得出现 temporal evidence。
- 查询无 evidence 时返回“不确定/没找到”，不能给确定答案。
- eventTypes 只能影响 ranking，不能变成 hard filter 或 keyword special case。

### P1: Graphiti 产品增益

必须验证：

- Graphiti enabled 在关系型 query 上优于 disabled，尤其是改期链、用药变化链、诈骗风险链、同一事项判断、长期症状趋势。
- Graphiti write 是后台化能力，不阻塞 source/draft 首屏确认。
- Graphiti sidecar 慢、失败或缺失时，不污染 PostgreSQL truth，失败必须 audit-visible。

### P1: 运行可靠性

必须验证：

- 高密度 seed 下 background memory processing 不留下 dead job。
- provider JSON completion 失败不会吞掉错误，重试/失败可见。
- 重复 client turn 不创建重复 source 或重复 business truth。
- e2e 输出能定位失败：traceId、sourceId、eventId、evidence source、timing、job status。

## 2. 测试分层

### Gate 0: Preflight

用途：确认环境值得跑长测试。

命令：

```bash
pnpm typecheck
pnpm test
pnpm test:postgres
pnpm test:graphiti
pnpm architecture:check
```

通过标准：

- PostgreSQL、pgvector、Graphiti sidecar 健康。
- `architecture:check` 没有违反 memory-kernel、Graphiti、semantic recall 边界。
- 不需要真实高密度数据。

### Gate 1: MVP Smoke

用途：验证最短用户链路。

命令：

```bash
pnpm mvp:smoke
```

覆盖：

- `/health`
- 记录文本
- ingest ready
- reminder list/confirm
- recall query

通过标准：

- source/draft 可见。
- 至少一条 reminder 可读回。
- recall answer 有 evidence。

### Gate 2: Golden Capability Boundary

用途：验证能力边界，不只验证召回准确。

测试入口：

```text
e2e/golden-capability-boundary.json
pnpm e2e:p0
```

等价命令：

```bash
GOLDEN_E2E_FIXTURE=e2e/golden-capability-boundary.json GOLDEN_E2E_GRAPHITI_MODE=required pnpm e2e:golden
```

最小场景集：

| 场景 | 输入链 | 核心断言 |
|---|---|---|
| 普通记录与召回 | 买菜、物品位置、日常事项 | answer evidence 来自 PostgreSQL/semantic，中文输出 |
| 无证据查询 | 查询未记录事项 | 不编造，confidence 低，safetyNote 明确 |
| 模糊提醒 | “下周提醒我去一下” | 不 auto-confirm，requiresConfirmation=true |
| 医疗/用药 | 医嘱、陌生电话让停药、后续确认 | 不给直接医疗建议，risk/family task/audit 可见 |
| 诈骗/验证码 | 补贴、验证码、转账、身份证 | fraud/identity/password 风险可见，隐私不泄露 |
| 改期链 | 周三复查 -> 改周五 -> 家人确认 | 当前有效说法正确，旧说法作为历史证据 |
| 同一事项判断 | “那个提醒”和“复查”是否一回事 | 可以表达可能相关/不能确定，不能合并 truth |
| 隐私协助 | private 日常 + 高风险协助 | private 不进入 family DTO，高风险只给最小摘要 |
| 语义召回边界 | 模糊问法、跨语言问法、无关键词映射 | broad recall + ranking，禁止 keyword special case |

通过标准：

- 所有 query 都有 `traceId` 和 debug trace。
- 所有 final evidence 的 `retrievalSource` 合法。
- Graphiti evidence 只在 source/event aligned 后进入 answer。
- 高风险场景无 raw transcript 泄露。
- 没有 ambiguous reminder 被 scheduled/confirmed。

### Gate 3: Graphiti A/B Density

用途：判断 Graphiti 是否值得继续投入。

现有 fixture 和脚本：

```text
e2e/golden-graphiti-density.json
scripts/graphiti-comparison-e2e.ts
```

命令：

```bash
pnpm e2e:graphiti:density
```

运行模式：

- Enabled API: Graphiti healthy。
- Disabled API: Graphiti missing config。
- 同一 fixture、不同 elderId、相同 query battery。

通过标准：

- disabled run temporal evidence count = 0。
- enabled final Graphiti evidence 100% source/event aligned。
- enabled 在关系型 query 上有稳定增益。
- `raw graphiti` evidence 不应只出现在少数偶然 query；初始门槛建议 >= 60% 关系型 query，成熟门槛 >= 80%。
- Graphiti jobs 不出现 dead；失败必须 audit-visible。
- source/draft ack p95 不被 Graphiti 写入拖慢。

当前已知缺口来自 2026-05-13 density run：

- appointment reschedule、same-matter、correction、privacy 部分 query 没稳定拿到 raw Graphiti evidence。
- provider JSON completion 失败会让 background job 进入 dead。
- disabled API temporal status 表达可能误导，需要区分 disabled/not_needed。

### Gate 4: Failure Mode E2E

用途：验证系统失败时是否守边界。

建议新增或扩展脚本：

```text
scripts/capability-boundary-failure-e2e.ts
```

模式：

- Graphiti sidecar missing。
- Graphiti sidecar slow。
- Graphiti write timeout。
- model JSON completion failure。
- memory processing retry exhaustion。
- duplicate clientTurnId replay。

通过标准：

- PostgreSQL truth 不回滚、不污染。
- 失败进入 audit/debug/status。
- 不出现 silent success。
- 用户侧回答保持 evidence-bound，不把缺失证据说成事实。

### Gate 5: Web MVP Trust Flow

用途：验证真实 UI 不复制规则、不泄露信息。

建议新增：

```text
apps/web-mvp/e2e/elder-trust-flow.spec.ts
```

覆盖：

- 记录一条普通记忆。
- 记录一条高风险记忆。
- 查看提醒和 family task。
- 查询当前有效说法。
- 查看 debug/trust evidence copy。

通过标准：

- Web 只通过 `apps/web-mvp/src/lib/api.ts` 调 API。
- UI 文案默认简体中文。
- 不展示 raw transcript/audio/full evidence。
- 风险提示不恐吓、不替用户做决定。

## 3. 指标

### 正确性

- `answer_evidence_present_rate`
- `no_evidence_hallucination_count`
- `latest_effective_fact_accuracy`
- `same_matter_resolution_rate`
- `ambiguous_reminder_auto_confirm_count`
- `unsupported_claim_count`

### 边界

- `semantic_unaligned_evidence_count`
- `graphiti_unaligned_evidence_count`
- `disabled_temporal_evidence_count`
- `context_link_truth_mutation_count`
- `provider_truth_write_count`
- `api_direct_memory_write_count`

### 安全与隐私

- `medical_direct_advice_count`
- `fraud_family_task_miss_count`
- `identity_password_visibility_violation_count`
- `raw_transcript_leak_count`
- `family_dto_full_evidence_leak_count`
- `private_memory_shared_count`

### 可靠性与性能

- `source_ack_p50_ms`
- `source_ack_p95_ms`
- `ingest_ready_p95_ms`
- `graphiti_job_success_rate`
- `graphiti_job_p95_ms`
- `memory_processing_dead_job_count`
- `provider_json_failure_count`
- `duplicate_source_count`

## 4. 执行节奏

### 本周目标

1. 固化 `golden-capability-boundary` fixture。
2. 让 `pnpm e2e:golden` 覆盖 P0 能力边界。
3. 将失败样例写入 fixture，而不是临时人工查询。
4. 修复或标注 density run 中的 raw Graphiti evidence 缺口。

### 两周目标

1. 跑通 enabled/disabled A/B density，并输出稳定 JSON report。
2. 增加 failure mode E2E。
3. 将 memory lint high severity finding 接到 review/triage 输出。
4. 建立 Web MVP trust flow 的第一条 Playwright 用例。

### 六周决策门

继续投入 Graphiti 飞轮的条件：

- Graphiti enabled 在关系型 query 上稳定优于 disabled。
- final Graphiti evidence source/event alignment 稳定。
- 真实试点出现长期关系 query。
- privacy assist 没有明显伤害用户信任。
- 性能证明 Graphiti 后台化不会拖慢首屏记录。

不满足时，应收缩为：

```text
PostgreSQL truth + pgvector semantic recall 的强备忘录/提醒产品
```

并暂停扩大 Query-to-Correction Loop、Nightly Consolidation 和复杂 curated episode 投入。

## 5. 不作为 E2E 解决的问题

这些问题应该由 focused unit/integration test 先覆盖，再进入 E2E：

- 单个 schema 字段校验。
- risk-engine 的单规则分类。
- reminder-engine 状态机细节。
- store adapter SQL 映射。
- model normalizer 的格式兼容。

E2E 只验证跨边界结果：

```text
用户输入
-> API
-> Kernel
-> PostgreSQL truth
-> semantic recall / Graphiti evidence
-> merged answer / reminder / task / audit
-> 用户或家人可见结果
```

## 6. 完成定义

本计划完成的定义不是“脚本跑过一次”，而是：

- 每个 P0 目标至少有一个 golden case。
- 每个 high-risk 真实失败都有 regression fixture。
- 每次 E2E 输出可追踪到 traceId/sourceId/eventId。
- 失败原因能归类为模型、Kernel、store、Graphiti、fixture 或环境。
- 新增能力必须先补对应 golden/eval case，再宣称能力已完成。
