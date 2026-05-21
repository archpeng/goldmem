# 24. P1 Layered Graphiti Validation Plan

Date: 2026-05-14

## 1. Goal

P1 Graphiti validation now uses layered gates instead of a single mixed product E2E result.

The product question remains:

```text
Graphiti enabled 是否在长期关系问题上明显优于 disabled，并且不会拖慢或污染 PostgreSQL truth？
```

The engineering standard is:

```text
Graphiti proposes temporal relationship evidence.
PostgreSQL owns truth.
Kernel aligns, ranks, gates, and answers.
```

## 2. Validation Layers

### Direct Graphiti Tests

Command:

```bash
pnpm e2e:graphiti:direct
```

Purpose:

- Test Graphiti sidecar and `GraphitiTemporalMemoryStore` without `/elder/turn`.
- Verify episode provenance, current fact, historical fact, supersession visibility, entity timeline, and no cross-elder leakage.
- Report raw Graphiti count separately from provenance fallback.

Important boundary:

- `graphiti_provenance` is a bridge and debugability layer.
- It must not be counted as raw Graphiti graph reasoning.

### Core A/B

Command:

```bash
pnpm e2e:graphiti:compare
```

Purpose:

- Keep the core fixture strict.
- Prove the minimum enabled raw Graphiti path.
- Prove disabled isolation.

Passing requirements:

- Enabled core queries with `graphitiRequirement: "raw_required"` return final `graphiti` evidence.
- Disabled run returns no `graphiti` or `graphiti_provenance` evidence.
- Graphiti jobs do not enter `dead`.
- Debug diagnostics are available when `GRAPHITI_E2E_REQUIRE_DEBUG_TRACE=true`.

### Density A/B

Command:

```bash
pnpm e2e:graphiti:density
```

Purpose:

- Measure high-density behavior and failure distribution.
- Do not require Graphiti evidence for ordinary distractors.
- Require per-query raw Graphiti only for canary cases that prove the raw temporal path.
- Measure profile-level raw/provenance/PostgreSQL/semantic source mix for the broader density set.

Fixture fields:

- `profileKind`: `supersession`, `same_matter`, `cross_episode_risk`, `family_confirmation`, `long_term_trend`, or `ordinary_distractor`.
- `graphitiRequirement`: `raw_required`, `temporal_allowed`, `optional`, or `forbidden`.
- `allowNoRecords`: allows ordinary distractor seed notes to produce no business records while still being counted.

Passing requirements:

- `raw_required` queries must return final raw `graphiti` evidence.
- `temporal_allowed` queries may use PostgreSQL or semantic evidence without failing.
- Enabled run must still meet the fixture-level `minRawGraphitiQueries` threshold.
- Ordinary distractor no-op is counted, not treated as failure.
- Provider retry count, allowed no-record seeds, source mix, raw/provenance coverage, Graphiti raw dropped/unaligned counts, and disabled leakage are visible in the JSON summary.

### Product E2E

Product E2E should validate final evidence contracts rather than only answer wording.

Runner-supported fields:

- `expectedEvidenceSeedIds`
- `expectedCurrentEvidenceSeedIds`
- `expectedHistoricalEvidenceSeedIds`
- `forbiddenEvidenceSeedIds`

Passing requirements:

- Required seed IDs appear in `retrievedEvidence`.
- Current evidence appears before historical evidence when both are specified.
- Forbidden seed IDs do not appear.
- Answer hints and semantic judge remain secondary checks.

## 3. Current P1 Status

Current stable claim:

```text
P1 core raw Graphiti path works and disabled isolation is enforced for the core fixture.
```

Current incomplete claim:

```text
Density is not yet a product-grade proof of long-term relationship capability.
```

Density failures should be classified, not hidden:

- `missing_raw_graphiti`
- `missing_temporal_evidence`
- `disabled_leak`
- `bad_current_order`
- `evidence_contract_missing`
- `answer_hint_missing`
- `evidence_hint_mismatch`
- `provider_failure`
- `ordinary_unexpected_no_record`
- `assertion_failure`

## 4. Completion Standard

P1 is complete when:

- Direct Graphiti validation passes and reports raw vs provenance behavior.
- Core A/B passes with raw Graphiti evidence and disabled isolation.
- Density uses profile-aware requirements and reports failure distribution.
- Product E2E can assert evidence IDs and current-vs-historical ordering.
- No test treats Graphiti, semantic recall, or model output as PostgreSQL truth.

## 5. Run Record: 2026-05-14

Environment:

- Model: `deepseek-v4-flash`.
- Enabled API: Graphiti healthy.
- Disabled API: `GRAPHITI_BASE_URL` unset; `/health.graphiti = missing_config`.
- Debug diagnostics: enabled with redacted debug token.

Direct Graphiti:

```text
Command: pnpm e2e:graphiti:direct
Status: passed
rawGraphitiCount: 0
provenanceFallbackCount: 6
```

Interpretation: sidecar provenance, current/timeline bridge behavior, and cross-elder isolation pass. Raw Graphiti graph reasoning is still not proven by this direct path.

Core A/B:

```text
Command: pnpm e2e:graphiti:compare
Status: passed
Enabled rawGraphitiQueryCount: 5
Enabled temporalEvidenceQueryCount: 5
Disabled temporalEvidenceQueryCount: 0
Enabled queryDurationP95Ms: 31705
Disabled queryDurationP95Ms: 28922
```

Observed during core:

- Enabled seed ready times included provider/processing long tails around 80s.
- Graphiti drain initially saw timeout failures but retry completed with no dead jobs.
- Disabled ingest responses still reported `temporal=queued` for relationship/risk seeds, even though disabled query evidence isolation passed.

Density A/B:

```text
Command: pnpm e2e:graphiti:density
Status: incomplete / failed
```

Attempt 1 failed before disabled query phase because the density fixture expected a family task summary containing `银行卡`. That expectation conflicts with the P0 privacy boundary: deterministic safety `risk_review` tasks may be generic/redacted and should not be forced to expose sensitive details. The fixture was updated to keep risk review/type checks without requiring the bank-card text in family-facing task copy.

The same attempt also surfaced an enabled query coverage failure before the final scenario assertion:

```text
medication-phone-safety: returned no evidence
```

Attempt 2 failed in enabled seed processing:

```text
Failed elder: graphiti-core-1778771204264-graphiti
Failure: memory_processing_jobs.dead = 1
Trigger seed: correction-family-confirmed
Last observed error: MemoryPlan completeness gate failed: update action missing context link to target reminder at eventIndex: 0
Runner retry: seed eventually succeeded on retry, but the dead job remained and correctly failed the density gate
```

Observed during density:

- Ordinary distractor seeds can now no-op or avoid Graphiti without failing the fixture.
- Privacy query expectations no longer require temporal evidence when PostgreSQL/semantic evidence is enough.
- Provider instability remains visible: query retries included `provider_error`, JSON completion failure, and empty response.
- Complex confirmation/correction seeds are the main long-tail area, with observed ready times above 120s in some runs.

Current conclusion:

```text
Core A/B is green.
Density is not green.
The remaining density blocker is not answer wording; it is model-plan/Kernel-validation stability and dead-job cleanup under correction/confirmation chains.
```
