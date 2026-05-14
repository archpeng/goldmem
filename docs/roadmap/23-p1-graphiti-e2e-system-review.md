# 23. P1 Graphiti E2E and System Review

Date: 2026-05-14

## 1. Executive Conclusion

P1 core is green. The current `e2e:graphiti:compare` run proves the minimal enabled-vs-disabled Graphiti path:

- Graphiti enabled returns temporal evidence for all core relationship queries.
- Graphiti disabled does not leak Graphiti or Graphiti provenance evidence into final answers.
- The current model setting, `deepseek-v4-flash`, is sufficient for the core P0/P1 path that was exercised.

P1 density is not complete. The density run should be recorded as a useful failure report, not as a green capability gate. The observed failures fall into three buckets:

1. Chain evidence coverage is not yet stable enough under density.
2. Provider long-tail latency and JSON failures still affect background processing and answer generation.
3. The density fixture's ordinary distractor expectations are too strong for a Graphiti value test.

This does not invalidate the project direction. The main architecture remains correct:

```text
Models understand; Kernel constrains; PostgreSQL owns truth.
```

The risk is that a few implementation details still give capability or authority to model output, semantic index metadata, or debug surfaces instead of owned, replayable, auditable mechanisms.

## 2. Run Record

Baseline: branch `refactor/pgvector-semantic-recall`, commit `0cc266e`.

Model and infra:

- API model: `deepseek-v4-flash`.
- Embedding: OpenAI-compatible embedding configured through the model gateway.
- Semantic recall: PostgreSQL `pgvector`.
- Graphiti sidecar: healthy for enabled runs.
- Density timeout experiment: `OPENAI_MEMORY_PLAN_TIMEOUT_MS=120000` mitigated some seed-time provider long tails but did not make density green.

Verified green gates:

- Kernel retrieval/query tests: passed.
- `pnpm graphiti:smoke`: passed.
- `pnpm test:graphiti`: passed.
- `pnpm e2e:p0`: passed, including no-evidence behavior.
- `pnpm e2e:graphiti`: passed.

P1 core A/B:

```text
Command: pnpm e2e:graphiti:compare
Status: passed
Enabled events: 9
Disabled events: 9
Enabled rawGraphitiQueryCount: 5
Enabled temporalEvidenceQueryCount: 5
Disabled rawGraphitiQueryCount: 0
Disabled temporalEvidenceQueryCount: 0
Enabled queryDurationP95Ms: 36252
Disabled queryDurationP95Ms: 31327
```

P1 density:

```text
Command: pnpm e2e:graphiti:density
Status: incomplete / not green
```

Observed density failures:

- Initial run failed during enabled seed `medication-family-confirmed` because MemoryPlan generation hit provider JSON/timeout failures under the 60s default.
- With MemoryPlan timeout raised to 120s, enabled seeds progressed, but provider long tail remained visible. Examples included long seed readiness and an answer generation timeout followed by retry.
- Enabled query phase surfaced chain evidence coverage gaps:
  - `medication-phone-safety`: evidence missing expected chain hint `停药`.
  - `fraud-risk-chain`: evidence missing expected chain hint `保证金`.
  - `privacy-family-visible-risk`: no Graphiti temporal evidence returned.
- Disabled density phase was intentionally stopped before completion after the failure pattern was clear.
- A temporary experiment allowing ordinary no-record seeds was discarded and not kept in code.

## 3. Density Interpretation

### Core Passed

The core P1 test is enough to prove that Graphiti can work as a temporal evidence layer on the minimum high-value relationship set. It also proves disabled isolation for the core fixture.

### Density Not Complete

Density should not be treated as a failed architecture direction. It is showing the next layer of product-readiness work:

- Relationship chains with several related events need stronger retrieval and evidence expansion.
- Raw Graphiti evidence and Graphiti provenance must be consistently aligned back to PostgreSQL before final answer use.
- Provider failure and retry rates need to become first-class metrics, not just log noise.
- Ordinary distractors should measure noise resistance, not require every ordinary note to create business records.

### Current Claim Boundary

Safe claim:

```text
Graphiti core evidence path works and does not cross disabled boundaries.
```

Unsafe claim:

```text
Graphiti is fully proven as a product-grade long-term relationship layer under high-density open distribution.
```

## 4. Graphiti Design Objective Review

External references:

- Graphiti overview: https://help.getzep.com/graphiti/getting-started/overview
- Graphiti README: https://github.com/getzep/graphiti
- Zep facts model: https://help.getzep.com/facts
- Zep graph search: https://help.getzep.com/v2/searching-the-graph

Graphiti's design target is not generic recall and not business truth ownership. Its native target is a temporal context graph for agentic applications:

- Ingest evolving information as episodes.
- Extract entities, relationships, and facts from those episodes.
- Preserve provenance from derived facts back to source episodes.
- Track changing relationships over time through validity windows.
- Query with hybrid semantic, full-text, temporal, and graph-structure search.
- Support current-vs-historical reasoning without rebuilding a whole graph from scratch.

For GoldMem, the correct role is narrower and stricter:

```text
Graphiti = long-term temporal relationship evidence proposer
PostgreSQL = source/business truth
Kernel = final evidence gate, safety owner, and answer orchestrator
```

GoldMem should use Graphiti for:

- "现在有效的是哪一条，旧说法是什么"。
- "这几条记录是否是同一件事的变化链"。
- "某个药、医院、家人、风险对象在多次记录中的关系如何演变"。
- "一个诈骗/隐私/医疗风险是否由多个片段共同构成"。
- "长期趋势是否由多个 episode 支撑"。

GoldMem should not use Graphiti for:

- Writing reminders, risk flags, family tasks, permissions, or audit truth.
- Replacing PostgreSQL search for single-hop factual recall.
- Turning provenance fallback text into proof of raw graph reasoning.
- Forcing every ordinary note into a graph record.
- Blocking the elder-facing ingest path on graph construction.

Current alignment is good in several places:

- `packages/memory-kernel/src/temporal.ts` builds curated episodes after PostgreSQL truth exists, so Graphiti receives stable `sourceId` and `eventId`.
- `packages/memory-kernel/src/ingest-temporal-writer.ts` only enqueues temporal work and records audit state; it does not let Graphiti mutate business truth.
- `services/graphiti-sidecar/src/main.py` persists `graphiti_episode_provenance`, giving raw Graphiti results a path back to source/event metadata.
- `packages/memory-kernel/src/query-temporal-evidence.ts` aligns temporal results through PostgreSQL source/event stores before final evidence use.
- Core A/B verifies disabled isolation and enabled temporal evidence on the minimum relationship set.

Current mismatch:

- The sidecar sends curated JSON episodes, but Graphiti search is currently called mostly as generic `search(query, group_ids, num_results)`. Parsed entities and time ranges are not yet strongly used for graph filtering or temporal filtering.
- `entity_timeline` and `current_facts` are currently provenance-index style fallbacks, not full Graphiti temporal graph APIs.
- `metadata_for_fact` aligns raw Graphiti facts to provenance by text scoring when Graphiti does not return direct episode metadata. That is useful as a bridge, but it is weaker than storing and matching explicit Graphiti episode/fact identifiers.
- No domain ontology is defined for GoldMem concepts such as medication change, appointment reschedule, family confirmation, fraud request, privacy visibility, or reminder state. That limits Graphiti's ability to express stable care-specific relationships.
- Density tests currently over-index on "raw Graphiti appears in final evidence" and literal hint coverage. That proves final evidence composition, but only weakly proves temporal graph value.

Testing expectation adjustment:

- Core A/B should keep requiring raw Graphiti on the hand-picked relationship cases. It is the minimum path proof.
- Density should not require raw Graphiti for ordinary distractors. Ordinary seeds should measure noise resistance and no-op behavior.
- Density should require raw Graphiti only for profiles whose value depends on temporal graph reasoning: supersession, same-matter chains, cross-episode risk chains, family confirmation chains, and long-term trend.
- Product E2E should check final evidence IDs and current-vs-old ordering. Literal answer hints are secondary.
- Direct Graphiti tests should verify graph-native behavior separately from `/elder/turn`: episode provenance, current fact, historical fact, invalidation/supersession, entity timeline, and no cross-elder leakage.
- Provenance fallback should remain visible and useful, but it should be counted separately from raw Graphiti capability.

Conclusion: GoldMem's intended use of Graphiti is consistent with Graphiti's design philosophy. The incomplete part is not the architectural direction; it is that the current adapter and tests only partially exercise Graphiti's native strengths. The next work should deepen temporal graph usage and measurement, not broaden Graphiti into a truth store or force unrelated notes into it.

## 5. System TBL Review

### Finding 1: Semantic Evidence Is Not Fully PostgreSQL-Aligned

Severity: P0.

Current behavior: `packages/memory-kernel/src/retrieval.ts` builds semantic answer evidence from `semantic_memories.metadata.summary`, `title`, `timeText`, and related metadata. The metadata is PostgreSQL-derived when the index is fresh, but the final query path does not rehydrate semantic candidates from current PostgreSQL records before using them as answer evidence.

TBL risk: semantic recall should propose candidates. It should not become a fact source. If the index is stale, polluted, points to archived data, or predates a summary/visibility change, final answers may cite old index metadata.

Required change:

- Add `alignSemanticEvidence`.
- Input: semantic search results.
- Re-read by `metadata.eventId` and `metadata.sourceId` from PostgreSQL stores.
- Validate `tenantId`, `elderId`, event/source existence, status, and visibility.
- Build final semantic evidence from current `memory_events` fields, not semantic metadata.
- Record diagnostics such as `semanticAlignedCount` and `semanticUnalignedCount`.

Required regression tests:

- Semantic metadata summary differs from PostgreSQL event summary; final evidence uses PostgreSQL summary.
- Semantic candidate points to missing/foreign/archived event; final evidence excludes it.
- No aligned semantic evidence still preserves no-evidence behavior.

### Finding 2: Safety Still Depends Too Much on Model Labels

Severity: P0.

Current behavior: `packages/risk-engine/src/index.ts` receives only a `MemoryPlan`. It forces confirmation when the model has already emitted `medical`, `financial`, `fraud_risk`, or `sensitive`, and it upgrades existing `riskFlags`. It does not independently scan the source transcript for safety-critical signals.

TBL risk: safety cannot rely on the model first choosing the right label. Medical, medication, identity, password, verification code, bank card, transfer, fraud, and privacy boundaries are deterministic product constraints.

Required change:

- Change risk enforcement input from `enforce(plan)` to `enforce({ plan, source })`.
- Add deterministic safety scan inside risk-engine for safety domains only.
- On hit, force confirmation, raise risk where appropriate, add minimum risk flags, create `risk_review` family tasks, and audit the repair.
- Keep this separate from recall keyword hacks. Safety policy terms are allowed; business understanding shortcuts are not.

Required regression tests:

- Model emits `riskLevel: normal` while transcript contains `验证码`, `银行卡密码`, `身份证号`, or transfer/fraud language.
- Kernel still creates high-risk state, review task, and audit record.
- Model emits no risk flags; Kernel repairs the missing flags.

### Finding 3: Debug Trace Surface Is Too Broad By Default

Severity: P0/P1 depending on deployment data.

Current behavior: `services/api-server/src/index.ts` registers `/debug/traces/:traceId`, `/debug/sources/:sourceId`, and `/debug/queries/:auditId` whenever a debug trace store exists. The route returns the trace object directly. The Web MVP dev panel is gated by `import.meta.env.DEV`, but the API surface itself is not gated by an explicit debug flag or redaction DTO.

TBL risk: privacy and authorization cannot rely on "this is only a dev tool." Debug trace is a useful feedback mechanism, but raw transcript, source details, audit payloads, memory plans, and evidence merge internals must not be a default user-facing data surface.

Required change:

- Register debug routes only when `MEM_ENABLE_DEBUG_API=true`.
- Require an admin/debug token or explicit actor role before returning traces.
- Return a redacted trace DTO by default.
- Do not include raw transcript, audio URL, raw evidence quote, or unfiltered audit payloads.
- Gate Web DevPanel behind both `import.meta.env.DEV` and `VITE_ENABLE_DEV_PANEL === "true"`.

Required regression tests:

- Production/default env returns 404 or 403 for debug routes.
- Redacted trace does not contain transcript, audio URL, raw source text, or arbitrary audit payload JSON.
- Family/user-facing routes cannot fetch debug traces.

### Finding 4: Query Parse Failure Still Fails Recall

Severity: P1.

Current behavior: `packages/memory-kernel/src/query-orchestrator.ts` calls `parseMemoryQuery`, parses the result with `ParsedMemoryQuerySchema`, and throws on parse/model failure. The catch path audits `memory_query_failed`, but does not continue to broad recall.

TBL risk: recall depends on one model JSON call succeeding before search starts. A more robust system should keep broad PostgreSQL and semantic recall available even when query parse fails.

Required change:

- Add parse fallback:

```json
{
  "intent": "unknown",
  "eventTypes": [],
  "entities": [],
  "safetyTags": [],
  "requiresTemporalEvidence": false,
  "relationQueryIntent": "none",
  "requiresSourceEvidence": true
}
```

- Audit `query_parse_fallback_used`.
- Continue PostgreSQL broad recall and semantic recall.
- Consider a second-stage temporal trigger if broad/semantic evidence shows high-risk or conflicting versions.

Required regression tests:

- `parseMemoryQuery` throws schema error while PostgreSQL contains direct evidence; answer still succeeds.
- Parse fallback with no evidence returns the deterministic no-evidence answer and does not call answer generation.

### Finding 5: Eval Runner Is Not Yet a Capability Eval

Severity: P1/P2.

Current behavior: `scripts/eval-runner.ts` validates eval JSON shape. Golden E2E is useful, but it mixes real model calls, LLM-as-judge, retries, and product routing. It is a golden/smoke gate, not enough as the only capability measurement.

TBL risk: tests prove curated examples exist, not that the mechanism generalizes. Graphiti, semantic recall, ranking, parse fallback, and safety repair need ablation and failure distribution.

Required change:

- Split eval into:
  - `eval:static`: fixture schema checks.
  - `eval:kernel`: deterministic fake model/store Kernel behavior tests.
  - `eval:e2e`: real API/Postgres/model/Graphiti golden tests.
- Add ablations:
  - semantic off/on.
  - Graphiti off/on.
  - parse fallback off/on.
  - stale semantic alignment before/after.
- Track metrics:
  - recall hit rate.
  - no-evidence correctness.
  - unsafe-answer rate.
  - retry/fallback count.
  - latency percentiles.

## 6. Technical Advice

### Immediate P0 Work

1. Implement semantic evidence PostgreSQL rehydration and alignment.
2. Implement deterministic safety scan in risk-engine.
3. Lock down debug API registration and redaction before real family data enters the system.

These three are correctness and safety gates. They should be handled before treating density as the next main problem, because density will otherwise be testing a system with unresolved authority boundaries.

### P1 Work After P0 Gates

1. Add query parse fallback to preserve broad recall during model/schema failures.
2. Improve Graphiti chain evidence coverage without adding keyword hacks:
   - expand from temporal result to aligned source/event provenance;
   - preserve raw Graphiti evidence when relation intent is present;
   - make replacement/ranking diagnostics explicit;
   - compare final evidence IDs, not only answer text.
3. Upgrade density fixture expectations:
   - relationship profiles require records and temporal evidence;
   - ordinary distractors may be allowed to no-op, but must be counted;
   - failure reasons should separate `no_record_expected_ok`, `provider_failure`, `missing_chain_evidence`, and `bad_answer`.
4. Report provider retry/failure distribution in every E2E summary.

### Avoid Overengineering

- Do not solve recall by adding business keyword mappings such as `城里 -> shopping`.
- Do not turn Graphiti or semantic index into truth stores. They propose candidates; PostgreSQL supplies final evidence.
- Do not use longer timeouts as the main reliability fix. Timeouts are useful for testing, but provider failure rate must be measured and reduced.
- Do not require ordinary distractor notes to create records just to satisfy density. That would optimize the fixture, not the product.
- Do not add broad redaction frameworks before the minimal debug DTO and route gate exist.

## 7. Recommended Completion Gates

P0 should be considered complete only when:

- Semantic evidence final summaries are rehydrated from current PostgreSQL records.
- Safety-critical transcript content is caught even when the model fails to label it.
- Default/production debug APIs cannot expose raw traces.
- Current P0 E2E still passes with `deepseek-v4-flash`.

P1 should be considered complete only when:

- Core A/B remains green.
- Density either passes or every failed query is categorized with a clear owner and reason.
- Enabled Graphiti shows stable relationship-query lift over disabled.
- Disabled Graphiti evidence remains zero.
- Provider retries, timeouts, dead jobs, and fallback paths are reported in machine-readable summaries.
