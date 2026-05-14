# Graphiti Background Relation Roadmap

Date: 2026-05-12

## Product Decision

mem's user-facing first principle is immediate capture:

```text
I said it -> mem remembered it -> I can see it, replay it, and act on it.
```

Graphiti should not sit on the real-time "record one thing" path. Its value is in later relationship enrichment:

- what changed
- which fact is current
- who confirmed it
- what risk evolved over time
- which long-term events are related

Five-minute delay, worker-based retry, or nightly consolidation is acceptable for this layer. The product should present Graphiti as background organization, not a visible blocking step.

## Current Code Baseline

Current code already has the required foundation:

- PostgreSQL truth tables for sources, events, reminders, risk flags, family tasks, context links, feedback, and audit logs.
- pgvector semantic recall index as rebuildable short-to-medium recall.
- `memory_context_links` as a lightweight real-time relationship layer.
- `temporal_memory_jobs` with enqueue, claim, retry, succeeded, failed, and dead states.
- Graphiti adapter, worker, replay, and retry scripts.

The main mismatch is that `IngestTemporalWriter.write()` still calls `temporalMemory.addEpisode()` synchronously in the ingest path and only enqueues a retry after failure.

## Target Architecture

```text
Real-time ingest:
source write
-> MemoryPlan
-> PostgreSQL truth writes
-> reminder/risk/family task state
-> context links
-> pgvector semantic index
-> temporal job enqueue when needed
-> audit
-> elder response

Background relation enrichment:
temporal job worker
-> Graphiti addEpisode
-> retry/audit
-> Graphiti evidence available to later queries

Query:
PostgreSQL + pgvector semantic recall
-> optional Graphiti temporal evidence when available
-> evidence-bound answer
```

## Layer Responsibilities

### PostgreSQL Truth

PostgreSQL remains the only business truth source for:

- raw source transcripts
- structured events
- reminders and reminder state
- risk flags
- family tasks
- context links
- feedback
- audit

No Graphiti or semantic recall output may mutate truth directly.

### pgvector Semantic Recall

pgvector remains the low-latency semantic recall index:

- candidate search
- multilingual fuzzy recall
- short-to-medium memory retrieval

Its entries must stay rebuildable from PostgreSQL event/source metadata.

### ContextLink

ContextLink remains the real-time lightweight relationship layer:

- possible relation
- fills missing time
- update candidate
- needs family confirmation

ContextLink is useful for debug, confirmation workflows, and ingest context. It should not be auto-expanded into final query evidence unless explicitly reintroduced with strict controls.

### Graphiti

Graphiti becomes the background high-value relationship layer:

- temporal chains
- fact changes
- current-vs-old statements
- risk evolution
- long-term care context
- family confirmation provenance

Graphiti is never required for immediate "record one thing" success.

## Temporal Status Contract

API-facing ingest result should evolve from:

```text
written | failed
```

to:

```text
not_needed | queued | failed
```

Recommended meaning:

| Status | Meaning |
|---|---|
| `not_needed` | This record is ordinary and does not require Graphiti enrichment. |
| `queued` | A temporal job was created; Graphiti will process it later. |
| `failed` | The job could not be queued; this is an infrastructure failure visible to debug/audit. |

Worker-internal statuses remain in `temporal_memory_jobs`:

```text
pending | running | succeeded | failed | dead
```

Do not expose worker-internal states to user-facing UI unless building admin/debug tooling.

## Enqueue Policy

Only high-value records should enter Graphiti. Start with a conservative Kernel-owned predicate:

```text
enqueue if any event/risk/reminder/context link is:
- health
- medication
- appointment
- finance
- fraud or identity risk
- requires confirmation
- high importance
- has context links
- has family task
```

Ordinary reminders and daily notes should return `not_needed`.

Examples that should be `not_needed`:

- buy eggs
- water flowers
- call son tonight
- simple shopping list

Examples that should be `queued`:

- medication change
- hospital appointment or reschedule
- fraud call
- identity/password/verification code request
- repeated symptom or care trend
- family-confirmed update

## Implementation Plan

### M1: Make Graphiti Nonblocking

1. Rename or repurpose `IngestTemporalWriter.write()` to enqueue temporal jobs.
2. Remove synchronous `temporalMemory.addEpisode()` from ingest.
3. Return `temporalMemory.status = "queued"` when a job is created.
4. Return `not_needed` when the enqueue policy says Graphiti is unnecessary.
5. Return `failed` only when job enqueue fails.
6. Keep audit payloads with `traceId`, `sourceId`, `jobId`, `status`, and enqueue policy reason.

### M2: Add Enqueue Policy

1. Add `shouldEnqueueTemporalMemory(applied)` inside `packages/memory-kernel`.
2. Use event type, risk level, confirmation requirement, reminder state, context links, and family tasks.
3. Avoid keyword one-off mappings.
4. Add focused Kernel tests for ordinary note, reminder, medication, appointment, fraud, and context link scenarios.

### M3: Update API and Schema

1. Extend `ElderTurnResultSchema.temporalMemory.status`.
2. Update `IngestResult` typing.
3. Update API tests and E2E parsing.
4. Keep frontend hidden from Graphiti status by default.

### M4: Update E2E Strategy

1. Golden ingest should not require `temporalMemory.status === "queued"`.
2. Graphiti-specific E2E should:
   - seed records
   - assert high-value records enqueue temporal jobs
   - run `graphiti-worker` or `graphiti-replay`
   - query after jobs are succeeded
   - compare Graphiti enabled vs disabled
3. A/B Graphiti tests should continue to reject `context_link` as final query evidence.

### M5: Product UX

Elder UI should show:

```text
我已经帮您记好了。
```

When relevant:

```text
这件事可能需要确认。
```

Do not show:

```text
正在构建关系图谱
Graphiti processing
Temporal memory queued
```

Admin/debug may show:

- source written
- events created
- reminders created
- risk flags created
- context links created
- semantic index written
- temporal job queued
- Graphiti succeeded/failed/dead

## Verification Gates

Small checks:

```bash
pnpm --filter @mem/memory-kernel test
pnpm typecheck
pnpm architecture:check
```

Broad checks:

```bash
pnpm test
pnpm mvp:smoke
pnpm e2e:golden
pnpm e2e:graphiti:compare
```

Graphiti background-specific checks:

```text
ordinary note -> temporalMemory.not_needed, no job
medical appointment -> temporalMemory.queued, job pending
fraud risk -> temporalMemory.queued, job pending
worker run -> job succeeded
query after worker -> Graphiti evidence available
Graphiti disabled query -> no temporal evidence
```

## Success Criteria

1. Elder record path no longer waits for Graphiti network calls.
2. High-value records still reach Graphiti through jobs.
3. Ordinary notes do not create unnecessary Graphiti jobs.
4. Query still works before Graphiti enrichment using PostgreSQL + pgvector.
5. Query improves after Graphiti enrichment for temporal relationship cases.
6. Risk and reminder safety remain deterministic in Kernel.

## Non-Goals

- Do not make Graphiti a business truth source.
- Do not show Graphiti status to elder users.
- Do not delete ContextLink in this phase.
- Do not build custom long-term graph logic in PostgreSQL.
- Do not add case-by-case keyword mappings for recall or enqueue decisions.

