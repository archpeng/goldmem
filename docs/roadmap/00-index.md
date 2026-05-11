# GoldMem Long-Term Memory Roadmap

This roadmap series defines the medium-to-long-term technical direction for GoldMem after the initial MVP.

The key architectural decision is to stop treating PostgreSQL as the long-term memory engine. PostgreSQL remains the source of truth for business state and raw evidence. Graphiti is the production target and source of truth for long-term relational memory. Mem0 remains the short-to-medium-term multilingual recall layer.

## Document series

1. [Principles](./01-principles.md)
2. [Target Architecture](./02-target-architecture.md)
3. [Memory Layer Responsibilities](./03-memory-layer-responsibilities.md)
4. [Migration Roadmap](./04-migration-roadmap.md)
5. [Work Packages](./05-work-packages.md)
6. [Key Decisions](./06-key-decisions.md)
7. [Risks and Validation](./07-risks-and-validation.md)
8. [Temporal Memory Implementation Note](./08-temporal-memory-implementation-note.md)
9. [Production Graphiti Plan Pack](./09-production-graphiti-plan-pack.md)

## One-line direction

```text
PostgreSQL = business/source truth
Mem0 = semantic recall / short-to-medium memory
Graphiti = long-term relational memory truth
GoldMem Kernel = care orchestration, guardrails, policy, scheduling, and evidence fusion
```

## Why this matters

The most valuable memory in GoldMem is not a larger text archive. The most valuable memory is long-term care context:

```text
who is involved
what changed
which fact is current
who confirmed it
which source supports it
what risk emerged over time
```

Graphiti is purpose-built for temporal context graphs. It tracks facts, relationships, validity windows, and provenance. Rebuilding those mechanisms inside PostgreSQL would turn GoldMem into a custom memory engine project. The updated direction is to let specialized memory infrastructure handle memory evolution, while GoldMem owns care-specific business boundaries.

## Current code baseline

Current PR: `#1 Initialize Elder Memory Kernel architecture`.

Current code already has:

- PostgreSQL truth-store migrations
- `memory_sources`, `memory_events`, `reminders`, `risk_flags`, `family_tasks`, `feedback`, `audit_logs`
- Mem0-compatible `SemanticMemoryStore`
- `TemporalMemoryStore` interface and deterministic Graphiti episode builder
- `memory_context_links` as a lightweight event-to-event context link layer
- React MVP shell
- eval and golden retrieval scripts

Current code does **not** yet have:

- Graphiti adapter
- Graphiti-backed long-term query evidence
- Nightly consolidation job
- Graphiti production write/query validation

This roadmap describes how to evolve from the current state without destabilizing the MVP path.
