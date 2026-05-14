# 04. Production Roadmap

This roadmap evolves the current MVP architecture into the target PostgreSQL + semantic recall index + Graphiti architecture. Because mem is new and has no historical production burden, Graphiti should enter the production long-term memory path directly rather than as a long-running shadow-only experiment.

The invariant is:

```text
Graphiti = long-term relational memory truth
PostgreSQL = business/source/evidence truth
semantic recall index = short-to-medium multilingual recall engine
Kernel = orchestration, safety, evidence fusion, and action control
```

## Phase 0: Repair Current Verification

Goal: make the current baseline green before production Graphiti work.

Deliverables:

```text
pnpm install
pnpm typecheck
pnpm test
pnpm mvp:verify
```

Acceptance:

```text
@mem/temporal-memory resolves from workspace links.
temporal-memory typecheck passes.
memory-kernel tests pass.
MVP verification is green.
```

## Phase 1: Reframe Documentation and Boundaries

Goal: make `docs/roadmap/*` the authoritative direction and remove conflicting legacy guidance.

Actions:

```text
update docs/road as Chinese overview
remove self-built Long-Term Relation Layer as final target
remove Graphiti optional/future-only/shadow-first language
keep PostgreSQL as business/evidence truth
keep Graphiti blocked from direct business actions
```

Acceptance:

```text
No active roadmap doc says PostgreSQL should become the complete long-term fact graph.
No active roadmap doc says Graphiti is merely optional for long-term memory.
Docs still say Graphiti cannot schedule, notify, confirm, share, or mutate business state directly.
```

## Phase 2: TenantId Full Path

Goal: make production Graphiti tenant-safe.

Tasks:

```text
Add tenantId to MemoryPlan.
Add tenantId to MemorySource, MemoryEvent, Reminder, RiskFlagRecord, FamilyTask, MemoryContextLink, Feedback, AuditLog.
Add tenant_id NOT NULL to PostgreSQL schema/migrations.
Make all store reads and writes tenant-scoped.
Make API request schemas tenant-aware, with tenant-mvp only at an explicit MVP boundary.
Write tenantId into semantic recall index metadata.
Build Graphiti-safe groupId only inside Kernel from tenantId and elderId.
```

Acceptance:

```text
No query path searches by elderId alone.
No semantic recall index or Graphiti backend call lacks tenantId.
Frontend never supplies Graphiti groupId.
Cross-tenant isolation tests pass.
```

## Phase 3: Graphiti Adapter

Goal: implement the production temporal memory adapter behind `TemporalMemoryStore`.

Deliverables:

```text
GraphitiTemporalMemoryStore
Graphiti HTTP client
GRAPHITI_BASE_URL
GRAPHITI_API_KEY if required
GRAPHITI_REQUIRED_IN_PRODUCTION
production startup fail-fast when Graphiti is required but missing
```

Required methods:

```text
addEpisode
searchFacts
getEntityTimeline
getCurrentFacts
```

Acceptance:

```text
Adapter tests use mocked HTTP.
All requests include tenantId, elderId, groupId, sourceIds/eventIds metadata.
Development and tests may use NullTemporalMemoryStore.
Production fails fast without Graphiti config.
```

## Phase 4: Graphiti Write Enters Ingest

Goal: make Graphiti part of the production write path after PostgreSQL truth is persisted.

Write order:

```text
PostgreSQL truth write
-> semantic recall index recall write
-> Graphiti temporal episode write
-> audit
-> response
```

Failure behavior:

```text
Graphiti failure does not rollback PostgreSQL.
Graphiti failure is included in response internal metadata.
Graphiti failure writes audit event graphiti_enqueue_failed.
Retry queue/job can replay from PostgreSQL records later.
```

Acceptance:

```text
Ingest tests cover Graphiti success and failure.
No Graphiti write happens before source/event IDs exist.
PostgreSQL remains the only hard dependency for business writes.
```

## Phase 5: Graphiti Evidence Enters QueryMemory

Goal: use Graphiti evidence for long-term relationship questions.

Flow:

```text
parse query
-> PostgreSQL business/evidence search
-> semantic recall index semantic recall
-> Graphiti temporal fact search
-> evidence alignment by sourceId/eventId/episodeId
-> evidence merge/rank
-> answer generation with safety guardrails
```

Graphiti should help with:

```text
medication changes
appointment reschedules
family confirmation chains
symptom trends
fraud and financial risk chains
current effective facts
historical fact questions
```

PostgreSQL still overrides Graphiti for:

```text
reminder status
family task status
risk review status
permission decisions
action execution
```

Acceptance:

```text
retrievedEvidence can include retrievalSource=graphiti.
Graphiti evidence only enters answers when source/event/episode alignment exists.
No-evidence queries still return no invented answer.
Conflict tests preserve PostgreSQL business state.
```

## Phase 6: Production Golden Cases

Goal: validate each Graphiti-backed capability as it is introduced.

First case set:

```text
medication instruction changed over time
appointment or follow-up time rescheduled
family confirmed a medical item
symptom repeated after medication changed
insurance card or object linked to an appointment
fraud or financial risk chain evolved across records
```

Acceptance:

```text
pnpm e2e:graphiti exists before query integration is considered complete.
Every new user-facing Graphiti capability adds at least one golden case.
Failures become fixtures, prompts, model updates, or policy changes, not keyword special cases.
```

## Phase 7: Nightly Consolidation

Goal: strengthen Graphiti with curated daily episodes and generate eval data.

Job:

```text
NightlyConsolidationJob(tenantId, elderId, date)
```

Steps:

```text
Load daily PostgreSQL records.
Generate daily care summary.
Detect duplicates, conflicts, low-confidence items.
Build curated Graphiti episodes.
Write curated summaries to semantic recall index.
Create family digest.
Generate eval cases.
Write audit log.
```

Acceptance:

```text
Job is idempotent and retryable.
Curated episodes carry source/event references.
High-risk findings create review tasks, not silent business truth changes.
```

## Phase 8: Admin Debugger and Eval Flywheel

Goal: make memory behavior explainable and convert failures into learning assets.

Debugger shows:

```text
source transcript
MemoryPlan
risk/permission guardrail changes
PostgreSQL writes
semantic recall index writes/results
Graphiti episodes/facts
evidence merge
final answer
audit trail
```

Acceptance:

```text
A developer can replay one source end to end.
A developer can inspect why Graphiti evidence was used or ignored.
Every real failure can become an eval case.
```
