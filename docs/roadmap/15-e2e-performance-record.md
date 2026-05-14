# 15. E2E Performance Record

Date: 2026-05-12

## Environment

- API: `http://localhost:3000`
- Model: `gpt-5.4-mini` in the latest run
- OpenAI timeout: `120000ms` in the latest run
- Semantic recall: `pgvector`
- Embedding model: `text-embedding-3-small`
- Graphiti: `http://localhost:8890`
- Graphiti timeout: `60000ms` in the latest run

## Completed Runs

| Fixture | Mode | Result | Wall time | Coverage |
|---|---|---:|---:|---|
| `e2e/golden-retrieval.json` | Graphiti enabled | Pass | 123.66s | 5 seeds, 4 queries, 4 semantic evidence queries |
| `e2e/golden-family-collaboration.json` | Graphiti enabled | Pass | 33.17s | 2 seeds, 1 query, fraud family task, semantic evidence |
| `e2e/golden-context-links.json` | Graphiti disabled | Pass | 107.82s | 6 seeds, 3 queries, semantic + context_link evidence |

## Failed / Diagnostic Runs

| Fixture | Mode | Result | Wall time | Root cause |
|---|---|---:|---:|---|
| `e2e/golden-context-links.json` | Graphiti enabled, 5s Graphiti timeout | Fail | 113.14s | `OpenAI JSON completion failed` during seed ingest |
| `e2e/golden-context-links.json` | Graphiti enabled, 30s Graphiti timeout | Fail | 190.89s | Fixture expects no `graphiti` evidence, but Graphiti evidence entered `semantic-disambiguation-link` |
| `e2e/golden-context-links.json` | No `.env` in runner | Fail | 184.57s | Semantic judge missing `OPENAI_API_KEY` |
| `e2e/golden-graphiti.json` | Graphiti enabled, 5s timeout | Fail | 16.87s | First seed returned `temporalMemory.status=failed`; audit shows `graphiti_enqueue_failed: The operation was aborted due to timeout` |
| `e2e/golden-graphiti.json` | Graphiti enabled, 30s timeout | Fail | 177.83s | `fraud-risk-chain` was routed as `clarify`, so `/elder/turn` returned no answer |
| `e2e/golden-graphiti.json` | After safety recall prompt update | Fail | 135.13s | `fraud-chain` seed was routed as `recall`, so seed returned no `ingestResult` |
| `e2e/golden-graphiti.json` | After record-vs-recall prompt tightening | Fail | 156.28s | `medication-current-instruction` answer passed semantic judge, but evidence text missed required hint `早饭后` |
| `e2e/golden-context-links.json` | Graphiti required, `gpt-5.4-mini`, 60s model timeout | Fail | seed phase | `generateMemoryPlan` timed out at 60000ms during `hospital-distractor` seed |
| `e2e/golden-context-links.json` | Graphiti required, `gpt-5.4-mini`, 120s model timeout | Fail | 259.7s seed turn sum | All 6 seed ingests completed, but `hospital-distractor` produced `events=1 reminders=0`; fixture expected reminder containing `社区医院` |

## Latest Graphiti Context Run Node Timings

Fixture: `e2e/golden-context-links.json`
Mode: Graphiti required
Elder id: `golden-e2e-1778545649723`
Result: failed after seed phase because `hospital-distractor` had no reminder candidate.

Full ingest chain:

```text
golden seed request
-> /elder/turn
-> planElderTurn
-> ingestText
-> buildContext
-> semantic candidate search
-> generateMemoryPlan
-> schema validation
-> risk guard
-> permission visibility
-> applyPlan
   -> event writes
   -> reminder writes
   -> family/risk/context writes
   -> semantic index writes
-> Graphiti episode write
-> audit
-> response
```

Aggregate seed timings:

| Metric | Value |
|---|---:|
| Seeds | 6 |
| Avg `/elder/turn` total | 43.3s |
| Max `/elder/turn` total | 58.8s |
| Avg `planElderTurn` | 3.3s |
| Avg `generateMemoryPlan` | 28.4s |
| Max `generateMemoryPlan` | 45.3s |
| Avg Graphiti write | 10.0s |
| Max Graphiti write | 13.9s |
| Avg semantic candidate search | 0.6s |
| Avg applyPlan | 1.0s |

Per-seed timing:

| Seed | Turn total | Turn plan | MemoryPlan | Semantic candidates | Apply plan | Graphiti write | Plan reminders | Written reminders |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 下周一准备出门吃当地特色面条 | 35.7s | 3.4s | 23.9s | 0.7s | 1.3s | 6.4s | 1 | 1 |
| 大约下午三点提醒出门吃面条 | 41.3s | 3.0s | 30.0s | 0.5s | 1.2s | 6.6s | 1 | 1 |
| 下周三老街面馆吃本地特色面 | 49.3s | 3.0s | 33.2s | 0.9s | 1.0s | 11.2s | 1 | 1 |
| 下周三社区医院复查血压 | 31.0s | 2.5s | 13.2s | 0.4s | 0.9s | 13.9s | 0 | 0 |
| 周末城里买生活用品 | 43.7s | 5.1s | 24.6s | 0.7s | 0.7s | 12.6s | 1 | 1 |
| 下午三点去老字号吃饭 | 58.8s | 3.0s | 45.3s | 0.4s | 0.9s | 9.1s | 1 | 1 |

Provider timings:

| Operation | Model | Range |
|---|---|---:|
| `generateMemoryPlan` | `gpt-5.4-mini` | 13.2s - 45.3s |
| `embedText` | `text-embedding-3-small` | 0.4s - 1.2s |

Performance conclusion:

- `generateMemoryPlan` is the dominant node: about 65% of average turn time.
- Graphiti write is the second dominant node: about 23% of average turn time.
- PostgreSQL writes, schema validation, risk guard, permission, and local merge logic are not material bottlenecks in this run.
- Product failure and performance risk overlap: the slowest `MemoryPlan` call still can omit a required reminder candidate, so increasing timeout improves completion but not correctness.

## Latest Graphiti Context Query Timings

Reference elder id: `golden-e2e-1778544980225`
This run reached all 3 queries and proves Graphiti can enter the context-link relationship query path.

Full query chain:

```text
golden query request
-> /elder/turn
-> planElderTurn
-> queryMemory
-> buildContext
-> parseMemoryQuery
-> PostgreSQL event search
-> semantic embedding + pgvector search
-> Graphiti temporal search when relationship gate matches
-> Graphiti source/event alignment
-> evidence merge
-> context link expansion
-> generateMemoryAnswer
-> audit
-> response
```

Per-query timing:

| Query | Turn total | Turn plan | QueryMemory | Parse query | PostgreSQL | Semantic | Graphiti search | Answer | Graphiti evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 下周一出门吃面条有说几点吗 | 13.7s | 2.7s | 11.0s | 4.8s | 0.01s | 0.7s | 0.0s | 5.5s | 0 |
| 下午三点要去吃什么 | 20.9s | 5.3s | 15.6s | 7.8s | 0.01s | 0.6s | 0.0s | 7.2s | 0 |
| 吃饭提醒和医院复查是一回事吗 | 22.7s | 4.9s | 17.8s | 8.1s | 0.02s | 0.9s | 1.0s | 7.7s | 6 |

Query performance conclusion:

- Query latency is dominated by model calls: `planElderTurn`, `parseMemoryQuery`, and `generateMemoryAnswer`.
- Graphiti search itself was about 1.0s on the relationship query and was not the dominant query bottleneck.
- PostgreSQL and pgvector retrieval are sub-second and not currently material bottlenecks.
- Graphiti relationship evidence entered the third query with 6 aligned items: 2 raw Graphiti and 4 provenance fallback.

## Findings

1. `e2e:context` is now a Graphiti-enabled fixture.
   It must run against an API whose `/health` reports `graphiti: "ok"`, so context-link behavior is validated together with Graphiti temporal evidence.

2. Graphiti golden requires a longer write timeout.
   With the default `GRAPHITI_TIMEOUT_MS=5000`, seed writes frequently fail. `GRAPHITI_TIMEOUT_MS=30000` allows seed writes to complete in the tested run.

3. `planElderTurn` remains a source of model variance.
   Risk/safety utterances can flip between `record`, `recall`, and `clarify`. The prompt was tightened during this run, but Graphiti golden still needs a regression gate or deterministic Kernel-side routing rule for high-risk safety queries.

4. Graphiti evidence recall is still incomplete for change-history questions.
   The latest Graphiti run answered the medication change correctly, but merged evidence did not include the original `早饭后` hint required by the fixture. This suggests Graphiti/PostgreSQL evidence expansion should pull both previous and current facts for change-chain queries.

## Current Status

- Retrieval E2E: green
- Family collaboration E2E: green
- Context-link E2E: Graphiti-required mode is not green yet because reminder extraction remains unstable
- Graphiti E2E: not green

## Next Fix Targets

1. Add MemoryPlan action decisions and completeness gate so every event has an explicit model decision for reminder/action handling.
2. Move Graphiti write out of the synchronous user-facing seed path or record it as async enrichment; current average is about 10s per seed.
3. Make Graphiti golden run with `GRAPHITI_TIMEOUT_MS>=30000` or move Graphiti write out of the synchronous seed requirement.
4. Add deterministic turn routing for safety/history questions:
   - new risky statement -> `record`
   - explicit safety/history question -> `recall`
5. Expand Graphiti change-chain evidence so both old and new facts are included in retrieved evidence.
