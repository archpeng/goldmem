# 08. Temporal Memory Implementation Note

This note documents the first code-level refactor for the long-term memory architecture.

## Implemented in this step

Added package:

```text
packages/temporal-memory
```

The package defines the future Graphiti-targeted interface:

```text
TemporalMemoryStore
  addEpisode()
  searchFacts()
  getEntityTimeline()
  getCurrentFacts()
```

It also includes:

```text
NullTemporalMemoryStore
buildTemporalGroupId()
```

The null store is intentionally a no-op. It exists for development and tests while the Graphiti adapter is not implemented. Production configuration must require Graphiti once the adapter is introduced.

## Direct target decisions

The temporal memory layer is intentionally strict:

```text
tenantId is required
groupId is always a Graphiti-safe Kernel-generated encoding of tenantId and elderId
retrievalSource is graphiti
content is structured object data
TemporalEpisodeType is closed for now
```

This avoids a compatibility-style abstraction that pretends to support many backends. The current long-term target is Graphiti.

## Added Kernel-side episode builder

Added:

```text
packages/memory-kernel/src/temporal.ts
```

This module builds a curated temporal episode from persisted GoldMem truth records:

```text
MemorySource
MemoryEvent[]
Reminder[]
RiskFlagRecord[]
```

The output is an `AddTemporalEpisodeInput` that can later be sent to Graphiti.

## Important boundary

This step does **not** yet modify the real-time ingest/query path.

Current runtime remains:

```text
PostgreSQL + semantic recall index
```

Temporal memory is the production Graphiti path that still needs to be wired into ingest and query:

```text
PostgreSQL records
  -> episode builder
  -> TemporalMemoryStore.addEpisode()
  -> Graphiti adapter
```

## Why this shape

The goal is to introduce a Graphiti entry point before making production startup require Graphiti configuration.

Benefits:

```text
MVP stays stable during adapter implementation
Graphiti can be tested through production golden cases and retryable writes
Temporal memory API is small and target-oriented
Graphiti adapter can be implemented without leaking provider-specific graph objects into business schemas
```

## Next implementation steps

1. Add `GraphitiTemporalMemoryStore` adapter.
2. Make production API startup fail fast when Graphiti config is required but missing.
3. Wire Graphiti episode writes into ingest after PostgreSQL and semantic recall index writes.
4. Add `graphiti_enqueue_failed` audit visibility and retry preparation.
5. Add Graphiti evidence to `queryMemory()` with source/event/episode alignment.
6. Add production Graphiti golden cases.
7. Add `nightlyGraphitiConsolidation` job.
