# 04. Migration Roadmap

This roadmap evolves the current MVP architecture into the target PostgreSQL + Mem0 + Graphiti architecture without destabilizing the real-time product path.

## Phase 0: Stabilize current MVP path

Goal: finish the current PR baseline and keep the product demonstrable.

Current path:

```text
text note
  -> MemoryPlan
  -> Kernel guardrails
  -> PostgreSQL truth store
  -> Mem0 semantic recall
  -> evidence-bound answer
```

Deliverables:

```text
pnpm typecheck
pnpm test
pnpm eval
pnpm e2e:golden
POST /elder/text-notes
POST /elder/query
GET /elder/reminders
POST /elder/reminders/:id/confirm
Mem0 smoke test
```

Do not introduce Graphiti into the critical path in this phase.

## Phase 1: Reframe architecture docs and naming

Goal: clarify truth-source boundaries.

Changes:

```text
PostgreSQL -> business/source truth
Mem0 -> semantic recall memory
Graphiti -> planned long-term relational memory truth
Kernel -> care-memory orchestrator
```

Actions:

```text
update README
update architecture.md
update docs/memory-kernel-design.md
update docs/mvp-roadmap.md
keep memory_context_links as MVP/debug/fallback
```

Acceptance:

```text
No doc claims PostgreSQL is the long-term memory engine.
No doc claims Mem0 owns business truth.
Graphiti is presented as async/shadow first.
```

## Phase 2: Add TemporalMemoryStore abstraction

Goal: add a clean Graphiti slot without binding product code to Graphiti directly.

Add package:

```text
packages/temporal-memory
```

Core interface:

```ts
interface TemporalMemoryStore {
  addEpisode(input: AddTemporalEpisodeInput): Promise<void>
  searchFacts(input: SearchTemporalFactsInput): Promise<TemporalEvidence[]>
  getEntityTimeline(input: EntityTimelineInput): Promise<TimelineItem[]>
  getCurrentFacts(input: CurrentFactsInput): Promise<CurrentFact[]>
}
```

Implementations:

```text
NullTemporalMemoryStore
GraphitiTemporalMemoryStore
```

Acceptance:

```text
Kernel can accept TemporalMemoryStore dependency.
Default local MVP uses NullTemporalMemoryStore.
No Graphiti service required for existing tests.
```

## Phase 3: Build Graphiti episode builder

Goal: convert GoldMem business/evidence records into Graphiti episodes.

Episode sources:

```text
voice/text memory source
family confirmation
reminder state change
risk review
nightly daily summary
```

Episode shape:

```ts
type GoldMemTemporalEpisode = {
  groupId: string // tenantId:elderId
  episodeType:
    | "voice_memory"
    | "family_confirmation"
    | "reminder_state_change"
    | "risk_review"
    | "daily_consolidation"
  occurredAt: string
  sourceIds: string[]
  eventIds: string[]
  reminderIds?: string[]
  riskFlagIds?: string[]
  content: string | Record<string, unknown>
}
```

Acceptance:

```text
Episode builder produces deterministic output from PostgreSQL records.
All episodes include source/event metadata.
Medical/financial/risk episodes preserve confirmation status.
```

## Phase 4: Graphiti shadow write

Goal: write Graphiti asynchronously without affecting product correctness.

Path:

```text
PostgreSQL daily records
  -> episode builder
  -> GraphitiTemporalMemoryStore.addEpisode
  -> audit log: graphiti_write_success / graphiti_write_failed
```

Feature flag:

```text
GRAPHITI_ENABLED=false by default
```

Graphiti should first receive only high-value memory:

```text
health
medication
appointment
family confirmation
financial risk
fraud risk
repeated symptoms
daily summaries
```

Acceptance:

```text
Graphiti can be unavailable without breaking MVP.
Failed writes are queued or audited.
No frontend uses Graphiti output yet.
```

## Phase 5: Graphiti shadow query

Goal: compare Graphiti with existing PostgreSQL + Mem0 recall.

Build internal-only endpoint or script:

```text
pnpm graphiti:shadow-query
```

Query categories:

```text
medication changes
appointment reschedules
family confirmations
repeated symptoms
fraud/risk chains
current effective facts
historical facts
```

Acceptance:

```text
Graphiti evidence can be inspected side-by-side with PostgreSQL/Mem0 evidence.
Golden cases show whether Graphiti adds value.
No user-facing behavior depends on Graphiti yet.
```

## Phase 6: Graphiti as evidence source for long-term questions

Goal: include Graphiti evidence in `queryMemory` for long-term relation queries.

Update `retrievalSource` enum:

```text
postgres
mem0
context_link
graphiti
```

Fusion rules:

```text
PostgreSQL wins for business/action state.
Graphiti wins for long-term relationship/fact history.
Mem0 provides semantic candidates and alias context.
All answers must remain source-evidence-bound.
```

Acceptance:

```text
Questions about medication changes use Graphiti evidence.
Questions about appointment reschedules use Graphiti evidence.
No evidence still means no invented answer.
```

## Phase 7: Graphiti as long-term relational memory truth

Goal: stop expanding PostgreSQL context links into a custom memory engine.

PostgreSQL remains:

```text
business/source truth
fallback/debug indexes
MVP context links
```

Graphiti becomes authoritative for:

```text
current long-term facts
superseded facts
relationship chains
entity timelines
historical memory queries
```

Acceptance:

```text
Long-term memory decisions no longer rely on PostgreSQL context_links.
GoldMem docs and code treat Graphiti as long-term memory truth.
Kernel still validates permissions, risks, and business actions.
```

## Phase 8: Data flywheel integration

Goal: turn multi-tenant scale into care intelligence without mixing private raw data.

Inputs:

```text
feedback
family corrections
reminder confirmations
risk misses
risk false positives
query no-hit cases
Graphiti/answer disagreement cases
```

Outputs:

```text
eval cases
prompt updates
policy updates
care pattern analytics
model routing improvements
anonymized learning patterns
```

Acceptance:

```text
New model/prompt releases run against evals before deployment.
Failures add eval cases instead of ad-hoc rules.
Tenant raw data remains isolated.
```
