# mem Long-Term Memory Roadmap

This roadmap series defines the medium-to-long-term technical direction for mem after the initial MVP.

The key architectural decision is to stop treating PostgreSQL as the only memory layer. PostgreSQL remains the source of truth for business state, raw evidence, permissions, and audit. Graphiti is the production temporal relationship memory layer. semantic recall index remains the short-to-medium-term multilingual recall layer.

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
10. [Mobile Elder AI-Native Roadmap](./10-mobile-elder-ai-native-roadmap.md)
11. [Graphiti Background Relation Roadmap](./16-graphiti-background-relation-roadmap.md)
12. [Long-Term Understanding Gap Roadmap](./17-long-term-understanding-gap-roadmap.md)
13. [Validation Acceleration E2E Roadmap](./18-validation-acceleration-e2e-roadmap.md)
14. [Graphiti Density E2E Run Report](./19-graphiti-density-e2e-run-report.md)

## One-line direction

```text
PostgreSQL = business/source truth
semantic recall index = semantic recall / short-to-medium memory
Graphiti = long-term temporal relationship evidence
mem Kernel = care orchestration, guardrails, policy, scheduling, and evidence fusion
```

## Why this matters

The most valuable memory in mem is not a larger text archive. The most valuable memory is long-term care context:

```text
who is involved
what changed
which fact is current
who confirmed it
which source supports it
what risk emerged over time
```

Graphiti is purpose-built for temporal context graphs. It tracks facts, relationships, validity windows, and provenance. Rebuilding those mechanisms inside PostgreSQL would turn mem into a custom memory engine project. The updated direction is to let specialized memory infrastructure handle memory evolution, while mem owns care-specific business boundaries.

## Current code baseline

Current PR: `#1 Initialize Memory Kernel architecture`.

Current code already has:

- PostgreSQL truth-store migrations
- `memory_sources`, `memory_events`, `reminders`, `risk_flags`, `family_tasks`, `feedback`, `audit_logs`
- pgvector-backed `SemanticMemoryStore`
- `TemporalMemoryStore` interface, Graphiti adapter, sidecar, retry job, and deterministic Graphiti episode builder
- `memory_context_links` as a lightweight event-to-event context link layer
- React MVP shell
- eval and golden retrieval scripts

Current code does **not** yet have:

- Nightly consolidation job
- production notification scheduling
- production auth and permission onboarding
- mobile-first elder product experience

This roadmap describes how to evolve from the current state without destabilizing the MVP path. The current product priority is documented in [Mobile Elder AI-Native Roadmap](./10-mobile-elder-ai-native-roadmap.md): transform `apps/web-mvp` from a Kernel console into a mobile-first elder experience while keeping backend truth and memory boundaries intact.
