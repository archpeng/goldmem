# 05. Work Packages

This document turns the target architecture into concrete implementation packages.

## WP-1: Tenant-aware foundations

### Goal

Prepare mem for multi-tenant growth.

### Scope

Add tenant awareness to core records and adapters.

Current code mostly uses `elderId`. This is acceptable for MVP, but medium-term growth requires:

```text
tenantId
elderId
userId
sourceId
eventId
```

### Tasks

```text
Add tenantId to MemorySource, MemoryEvent, Reminder, RiskFlagRecord, FamilyTask, Feedback, AuditLog.
Add tenantId to MemoryPlan.
Update PostgreSQL migrations and drizzle schema.
Update stores to require tenantId in all writes and reads.
Update semantic recall index metadata to include tenantId.
Update API request schemas.
Update eval fixtures.
```

### Acceptance

```text
No cross-elder query exists without tenant boundary.
All memory writes include tenantId.
All audit logs include tenantId.
```

## WP-2: TemporalMemoryStore package

### Goal

Create a production Graphiti-targeted temporal memory boundary without binding business schemas to provider-specific graph objects.

### Package

```text
packages/temporal-memory
```

### Types

```ts
export type AddTemporalEpisodeInput = {
  groupId: string
  episodeType: string
  occurredAt: string
  sourceIds: string[]
  eventIds: string[]
  content: string | Record<string, unknown>
  metadata: Record<string, unknown>
}

export type TemporalEvidence = {
  sourceId?: string
  eventId?: string
  episodeId?: string
  entityNames: string[]
  fact: string
  validFrom?: string
  validTo?: string
  score: number
  reason: string
}
```

### Interface

```ts
export interface TemporalMemoryStore {
  addEpisode(input: AddTemporalEpisodeInput): Promise<void>
  searchFacts(input: SearchTemporalFactsInput): Promise<TemporalEvidence[]>
  getEntityTimeline(input: EntityTimelineInput): Promise<TimelineItem[]>
  getCurrentFacts(input: CurrentFactsInput): Promise<CurrentFact[]>
}
```

### Implementations

```text
NullTemporalMemoryStore
GraphitiTemporalMemoryStore
```

### Acceptance

```text
Kernel can depend on TemporalMemoryStore.
NullTemporalMemoryStore keeps all existing tests green.
GraphitiTemporalMemoryStore can be added without changing Memory Kernel API.
Production configuration can require Graphiti while development and tests use NullTemporalMemoryStore.
```

## WP-3: Graphiti deployment stack

### Goal

Run Graphiti as an isolated service.

### Scope

```text
Graphiti FastAPI service
Graph backend: Neo4j 5.26+ for first integration
LLM/embedding environment variables
Docker compose profile
health check
retryable client
```

### Suggested first backend

Start with Neo4j as the primary local and production backend.

Neo4j is more mature, easier to inspect visually, and matches Graphiti's primary backend path.

### Acceptance

```text
Graphiti can start independently.
mem development and tests can run without Graphiti.
mem production fails fast when Graphiti is required but not configured.
Graphiti health check is visible from API/worker environment.
```

## WP-4: Episode builder

### Goal

Convert mem records into Graphiti episodes.

### Inputs

```text
memory_sources
memory_events
reminders
risk_flags
family_tasks
feedback
audit slices
```

### Episode types

```text
voice_memory
text_memory
family_confirmation
reminder_state_change
risk_review
daily_consolidation
```

### Acceptance

```text
Each episode has a Kernel-generated Graphiti-safe groupId derived from tenantId and elderId.
Each episode references sourceId/eventId when possible.
Each episode is deterministic from PostgreSQL records.
High-risk episodes preserve risk and confirmation metadata.
```

## WP-5: Nightly consolidation

### Goal

Use nightly processing to convert daytime fragments into higher-quality long-term memory input.

### Job

```text
NightlyConsolidationJob(tenantId, elderId, date)
```

### Steps

```text
Load daily records from PostgreSQL.
Generate daily care summary.
Detect duplicates, conflicts, low-confidence items.
Build curated Graphiti episodes.
Write curated summaries to semantic recall index.
Create family digest.
Generate eval cases.
Write audit log.
```

### Acceptance

```text
Job can run idempotently.
Job can be retried.
Graphiti failure is audited and retryable without corrupting PostgreSQL truth.
semantic recall index summary write can be rebuilt from PostgreSQL.
```

## WP-6: Query fusion v2

### Goal

Use PostgreSQL, semantic recall index, and Graphiti together without confusing their responsibilities.

### Flow

```text
parse query
  -> PostgreSQL structured search
  -> semantic recall index semantic search
  -> Graphiti temporal search when query suggests long-term relation
  -> merge and rank evidence
  -> verify source metadata
  -> answer generation
```

### Long-term relation triggers

```text
后来
改过
以前
现在
上次
确认过
是不是还是
有没有变化
药怎么改
复查有没有改期
最近是不是经常
```

### Acceptance

```text
Graphiti evidence only affects answers when source metadata is present or can be aligned.
PostgreSQL reminder state overrides Graphiti memory when actions are requested.
No-evidence queries still return no answer.
```

## WP-7: Long-term memory golden cases

### Goal

Validate whether Graphiti materially improves mem.

### Categories

```text
medication changed over time
appointment rescheduled
family confirmed medical item
repeated symptom trend
fraud risk chain
object linked to appointment
old fact superseded
current effective fact
```

### Acceptance

```text
At least one golden case for each Graphiti-backed user-facing capability before merge.
Graphiti is treated as the long-term relational memory truth target from the start, but every production ability must prove source/event alignment and safe failure behavior.
Failures become fixtures, not ad-hoc rules.
```

## WP-8: Admin memory debugger

### Goal

Make memory behavior explainable.

### UI/debug output

```text
source transcript
MemoryPlan
risk guardrail changes
permission guardrail changes
PostgreSQL writes
semantic recall index writes
Graphiti episodes
Graphiti facts returned
query fusion evidence
final answer
```

### Acceptance

```text
A developer can replay one memory source end-to-end.
A developer can inspect why a query answer used or ignored Graphiti evidence.
```

## WP-9: Data flywheel store

### Goal

Convert feedback and failures into reusable learning assets.

### Data sources

```text
feedback table
query no-hit audits
risk false positives
risk misses
family corrections
reminder ignored/confirmed stats
Graphiti/PostgreSQL/semantic recall index disagreement cases
```

### Outputs

```text
eval fixtures
prompt examples
policy updates
model routing signals
anonymous analytics patterns
```

### Acceptance

```text
Every production failure can become an eval case.
No raw tenant data enters cross-tenant analytics without anonymization.
```
