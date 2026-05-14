# 21. P1 Graphiti Technical Test Startup

本文是 P1 测试启动文档。目标是把 Graphiti 产品增益、后台可靠性、性能和失败边界相关的测试入口集中起来，方便下次继续跑、定位和补 fixture。

## 1. P1 技术目标

P1 不再重复证明 P0 的安全边界，而是回答一个产品和架构问题：

```text
Graphiti enabled 是否在长期关系问题上明显优于 disabled，并且不会拖慢或污染 PostgreSQL truth？
```

具体目标：

- 关系型 query 有增益：改期链、用药变化链、诈骗风险链、同一事项判断、长期趋势。
- Graphiti evidence 进入 final answer 时必须 source/event aligned。
- disabled API 不得返回 temporal evidence。
- Graphiti 写入后台化，不拖慢 source/draft 首屏确认。
- Graphiti slow/failing/missing 时，PostgreSQL truth 不被污染，失败 audit-visible。
- 高密度运行不产生 dead memory processing job。

## 2. 现有测试入口

| 目标 | 命令 | 主要文件 | 说明 |
|---|---|---|---|
| Graphiti write/search smoke | `pnpm test:graphiti` | `scripts/test-graphiti.ts` | 真实 sidecar 写入和 readback gate。 |
| Graphiti direct smoke | `pnpm graphiti:smoke` | `scripts/graphiti-smoke.ts` | 绕过 API 验证 sidecar contract。 |
| Graphiti golden | `pnpm e2e:graphiti` | `e2e/golden-graphiti.json`, `scripts/golden-e2e.ts` | 单 API Graphiti-required golden。 |
| Graphiti core A/B | `pnpm e2e:graphiti:compare` | `e2e/golden-graphiti-core.json`, `scripts/graphiti-comparison-e2e.ts` | enabled vs disabled，对比核心长期关系能力。 |
| Graphiti density A/B | `pnpm e2e:graphiti:density` | `e2e/golden-graphiti-density.json`, `scripts/graphiti-comparison-e2e.ts` | 高密度多 profile，对比 coverage 和可靠性。 |
| Relation enrichment | `pnpm e2e:relation` | `e2e/golden-relation-enrichment.json` | relation signal / temporal enqueue / query evidence。 |
| Context relationship | `pnpm e2e:context` | `e2e/golden-context-links.json` | context link 不作为 answer evidence，Graphiti 参与关系查询。 |
| Performance baseline | `pnpm e2e:performance` | `scripts/performance-baseline-e2e.ts` | source ack、ingest ready、query timing。 |
| Memory lint | `pnpm e2e:memory-lint` | `scripts/memory-lint-fixture-e2e.ts`, `scripts/memory-lint.ts` | Graphiti provenance、semantic metadata、risk visibility 等健康检查。 |

## 3. 推荐启动顺序

### Step 0: 环境确认

```bash
set -a
source .env
set +a
docker compose -f infra/docker-compose.yml --profile graphiti up -d postgres graphiti-neo4j graphiti-sidecar
pnpm db:migrate
```

启动 enabled API：

```bash
pnpm dev:api:env
```

如果要跑 A/B，需要另起 disabled API，使用同一 schema 但不同数据库，并且不设置 `GRAPHITI_BASE_URL`。`scripts/graphiti-comparison-e2e.ts` 需要：

```bash
GRAPHITI_E2E_ENABLED_BASE_URL=http://127.0.0.1:3000
GRAPHITI_E2E_DISABLED_BASE_URL=http://127.0.0.1:3001
DATABASE_URL=...
GRAPHITI_BASE_URL=http://localhost:8890
```

### Step 1: 低成本确认

```bash
pnpm test:graphiti
pnpm graphiti:smoke
pnpm e2e:graphiti
```

失败时先看：

- `/health` 的 `graphiti` 是否为 `ok`。
- `temporal_memory_jobs` 是否有 `failed/dead`。
- `graphiti_episode_provenance` 是否写入 source/event metadata。
- sidecar `/health` 是否返回 ok。

### Step 2: Core A/B

```bash
pnpm e2e:graphiti:compare
```

判定重点：

- enabled query 必须出现 temporal evidence。
- disabled query 不得出现 `graphiti` 或 `graphiti_provenance`。
- enabled answer 要能解释“当前有效说法”和“历史旧说法”。
- raw Graphiti evidence 不足时，记录 query id 和 retrieval debug counts。

### Step 3: Density A/B

```bash
pnpm e2e:graphiti:density
```

判定重点：

- raw Graphiti query 覆盖率。
- `graphitiRawAlignedCount` 和 `graphitiRawEvidenceCount`。
- `memory_processing_jobs.dead` 必须为 0。
- provider JSON failure 次数。
- enabled/disabled answer 差异是否是正向增益，而不是随机多证据。

## 4. 关键 fixture

### `e2e/golden-graphiti-core.json`

核心链路：

- 降压药从早饭后一片改成晚饭后一片。
- 社区医院复查改期。
- 补贴/身份证/验证码风险链。
- 同一时间的吃面和医院复查是否同一事项。

适合用于 P1 最小 A/B。

### `e2e/golden-graphiti-density.json`

高密度 profile：

- appointment current effective。
- medication current effective。
- fraud risk chain。
- same matter bank/hospital。
- trend dizzy/sleep。
- privacy raw-not-shared。
- correction current date/card items。

适合用于判断 Graphiti 是否有产品级增益。

## 5. 当前已知缺口

来自 2026-05-13 density run：

- appointment reschedule 没稳定进入 raw `graphiti` final evidence。
- same-matter bank/hospital 没稳定进入 raw `graphiti` final evidence。
- correction 和 privacy 部分 query 依赖 provenance fallback，raw coverage 不足。
- provider JSON completion failure 仍可能让 background job 进入 dead。
- disabled API 可返回 temporal queued status，表达上应区分 disabled/not_needed。

这些缺口进入下一轮 P1 优先级：

1. 提高 appointment/same-matter/correction/privacy 的 raw Graphiti retrieval coverage。
2. 处理 provider JSON failure 的 retry/dead job 问题。
3. 修正 Graphiti disabled 的 temporal status 表达。
4. 明确哪些场景允许 `graphiti_provenance` 作为 fallback，哪些必须 raw `graphiti`。

## 6. 报告字段

每次 P1 运行至少保存：

- command。
- fixture。
- model。
- enabled/disabled base URL。
- elderId。
- seed count。
- query count。
- raw Graphiti query count。
- temporal evidence query count。
- graphiti job succeeded/failed/dead。
- memory processing pending/running/failed/dead。
- failed query ids。
- top failure reason。

推荐落地位置：

```text
docs/roadmap/<date>-p1-graphiti-e2e-run-report.md
```

## 7. P1 完成定义

P1 不是“脚本跑过”，而是：

- `e2e:graphiti:compare` 绿色。
- `e2e:graphiti:density` 绿色或失败项全部有已记录 owner/原因。
- enabled 在关系型 query 上有稳定正向差异。
- final Graphiti evidence 100% source/event aligned。
- disabled temporal evidence count = 0。
- Graphiti failure 不污染 PostgreSQL truth。
- 性能数据证明 Graphiti 后台化不影响 source/draft 首屏体验。
