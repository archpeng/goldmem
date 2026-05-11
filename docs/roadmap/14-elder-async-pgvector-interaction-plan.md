# Elder Async Interaction Plan

Date: 2026-05-11

## Goal

Keep the elder-facing mobile interaction responsive while MemoryPlan, Graphiti, and secondary answer enrichment run behind the visible turn.

## Record Path

Target interaction:

```text
elder text/voice
-> source write
-> immediate UI acknowledgement: 我先记下了
-> async MemoryPlan
-> PostgreSQL truth writes
-> pgvector semantic index write
-> Graphiti episode write/retry
-> UI refresh with understood cards
```

Synchronous budget:

- source write
- trace id
- optimistic pending card

Async budget:

- `planElderTurn`
- `generateMemoryPlan`
- reminder/risk/family task materialization
- semantic indexing
- Graphiti enrichment

## Recall Path

Target interaction:

```text
elder query
-> PostgreSQL broad recall + pgvector semantic recall
-> fast evidence-bound draft answer
-> async Graphiti search and refined answer
-> UI refresh when stronger evidence arrives
```

The first response must never wait for Graphiti. If answer generation is slow, return a source-backed lightweight answer and mark the richer answer as updating.

## Required Instrumentation

Every model call must expose provider timing:

- `planElderTurn`
- `generateMemoryPlan`
- `parseMemoryQuery`
- `generateMemoryAnswer`
- `embedText`

Audit payloads must include operation, model, duration, timeout budget, status, and timeout type when applicable.

## Verification

- `mvp:smoke` must complete with pgvector semantic recall.
- `e2e:golden` should default to `gpt-4.1-mini` through the API server and fail fast if a high-tail model is configured.
- Latency docs should compare synchronous source acknowledgement, MemoryPlan completion, semantic index write, Graphiti completion, and final UI refresh.
