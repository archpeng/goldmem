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

The null store is intentionally a no-op. It exists only to keep the MVP runtime independent from Graphiti while the Graphiti adapter is not implemented. It should not grow behavior.

## Direct target decisions

The temporal memory layer is intentionally strict:

```text
tenantId is required
groupId is always tenantId:elderId
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

This step does **not** modify the real-time ingest/query path.

Current runtime remains:

```text
PostgreSQL + Mem0
```

Temporal memory remains a future async/shadow path:

```text
PostgreSQL records
  -> episode builder
  -> TemporalMemoryStore.addEpisode()
  -> Graphiti adapter later
```

## Why this shape

The goal is to introduce a Graphiti entry point without making Graphiti a hard dependency.

Benefits:

```text
MVP stays stable
Graphiti can be tested through nightly/shadow jobs
Temporal memory API is small and target-oriented
Future Graphiti adapter can be implemented without touching product logic
```

## Next implementation steps

1. Add `GraphitiTemporalMemoryStore` adapter.
2. Add `nightlyGraphitiConsolidation` job.
3. Add Graphiti Docker Compose profile.
4. Add shadow-write audit events.
5. Add long-term memory golden cases.
6. Only after validation, include temporal evidence in `queryMemory()`.
