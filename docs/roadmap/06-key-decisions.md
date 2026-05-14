# 06. Key Decisions

This document records why mem should evolve toward PostgreSQL + semantic recall index + Graphiti instead of a single memory system or a fully custom memory graph.

## Decision 1: PostgreSQL remains business/source truth

### Decision

PostgreSQL owns business state and raw evidence, not long-term relational memory truth.

### Why

mem has deterministic product obligations:

```text
permission
family access
reminder state
risk flag status
source evidence
audit trail
delete/export
tenant boundary
billing/auth
```

These belong in a conventional transactional database.

### Consequence

PostgreSQL tables such as `memory_sources`, `memory_events`, `reminders`, `risk_flags`, `family_tasks`, `feedback`, and `audit_logs` stay central.

However, PostgreSQL should not grow into a general temporal graph memory engine.

## Decision 2: Do not expand `memory_context_links` into the final memory graph

### Decision

Keep `memory_context_links` as MVP/debug/fallback infrastructure.

### Why

The current context link model only expresses lightweight event-to-event relations:

```text
possibly_related
fills_missing_time
```

Long-term memory needs much more:

```text
facts
validity windows
supersession
current effective fact
historical fact
entity summaries
relationship chains
provenance
```

Expanding context links into all of this would gradually recreate Graphiti inside PostgreSQL.

### Consequence

`memory_context_links` can support early recall and debugging, but not the final long-term memory layer.

## Decision 3: semantic recall index remains semantic recall memory

### Decision

Use semantic recall index for short-to-medium-term semantic recall, not as the long-term relational memory truth source.

### Why

semantic recall index is strong for:

```text
semantic search
recent summaries
preferences
aliases
entity-boosted fuzzy recall
context injection
```

But it should not own:

```text
fact validity
fact supersession
medical current truth
business actions
reminder state
permissions
```

### Consequence

semantic recall index write metadata must include:

```text
tenantId
elderId
sourceId
eventId
eventType
riskLevel
visibility
occurredAt
```

All user-facing answers that use semantic recall index must align results back to PostgreSQL source/event evidence.

## Decision 4: Graphiti becomes the long-term relational memory truth target

### Decision

Graphiti should be the production target and source of truth for long-term relational memory.

### Why

Graphiti's native model aligns with mem's long-term needs:

```text
episodes
entities
facts/relationships
validity windows
source provenance
incremental graph construction
hybrid graph retrieval
```

These are the capabilities that matter for high-value elder-care memory:

```text
medication changed over time
appointment rescheduled
family confirmed a medical item
symptom repeated after a medication change
fraud-risk chain evolved across several records
```

### Consequence

Graphiti should not be treated as an optional visualization layer or long-running shadow experiment. It should enter the production memory path directly, with PostgreSQL remaining the hard dependency for business writes and evidence.

## Decision 5: Kernel becomes an orchestrator, not a full memory engine

### Decision

The mem Kernel should coordinate memory systems instead of implementing all memory mechanics.

### Kernel owns

```text
MemoryPlan validation
risk guardrails
permission guardrails
state transitions
episode construction
query fusion
evidence verification
nightly job orchestration
audit logging
```

### Kernel does not own

```text
general temporal fact invalidation
entity summary evolution
relationship ontology learning
multi-hop graph retrieval implementation
```

### Why

This follows the Bitter Lesson more closely: avoid encoding a growing set of handcrafted memory rules when a general temporal context graph engine can absorb more data and improve through better models and retrieval.

## Decision 6: Graphiti enters production without owning business writes

### Decision

Introduce Graphiti as part of the production long-term memory path after PostgreSQL truth is persisted.

### Why

Graphiti adds operational complexity:

```text
Python service
graph backend
LLM/embedding setup
structured output reliability
retry handling
tenant group management
```

mem's user-facing product must remain fast and stable, so Graphiti failure must be surfaced, audited, and retried rather than allowed to corrupt PostgreSQL truth.

### Consequence

Production write path:

```text
PostgreSQL truth write
-> semantic recall index recall write
-> Graphiti temporal episode write
-> audit
-> response
```

When Graphiti write fails:

```text
PostgreSQL stays committed
response records temporal write failure in internal metadata
audit records graphiti_enqueue_failed
retry queue/job can replay from PostgreSQL records
```

## Decision 7: Nightly consolidation is required

### Decision

Nightly consolidation is not a nice-to-have. It is a core architecture component.

### Why

Daytime input is noisy:

```text
short utterances
ambiguous time
pronouns
family nicknames
uncertain medical facts
partial reminders
```

Nighttime processing can use more context and more expensive models.

### Outputs

```text
curated Graphiti episodes
curated semantic recall index summaries
family digest
eval cases
risk/fact conflict cases
audit records
```

### Consequence

mem should be designed around two speeds:

```text
fast real-time capture
slow deep consolidation
```

## Decision 8: Graphiti is not a replacement for product guardrails

### Decision

Graphiti may own long-term relational memory, but it cannot trigger business actions directly.

### Why

For elder care, safety-sensitive actions need deterministic control:

```text
medical advice
medication changes
financial risk
fraud risk
reminder confirmation
family notification
privacy sharing
```

### Consequence

Business actions still require Kernel + PostgreSQL state machine checks.

Example:

```text
Graphiti says appointment time changed.
Kernel checks PostgreSQL family confirmation state.
Only confirmed reminder state can schedule notification.
```

## Decision 9: Validate every Graphiti production capability with golden cases

### Decision

Graphiti is the long-term relational memory truth target, but each user-facing capability must be covered by golden cases before merge.

### Why

The architecture should remain empirical.

### Required proof

```text
Graphiti improves medication-change recall.
Graphiti improves reschedule recall.
Graphiti improves symptom trend recall.
Graphiti can align facts to sourceId/eventId.
Graphiti failures are explainable and retryable.
Graphiti cost/latency is acceptable.
```

### Consequence

Before each capability is considered complete:

```text
Graphiti write/read fixture
PostgreSQL source/event alignment check
answer uncertainty check for high-risk domains
conflict check where PostgreSQL business state overrides Graphiti
```

## Decision 10: Data flywheel must be anonymized and evaluation-driven

### Decision

The flywheel is built from structured feedback and anonymized patterns, not raw private data pooling.

### Inputs

```text
family corrections
reminder confirmations
ignored reminders
query no-hit cases
risk false positives
risk misses
Graphiti/PostgreSQL/semantic recall index disagreement cases
```

### Outputs

```text
eval fixtures
prompt improvements
policy improvements
model routing improvements
care pattern analytics
```

### Consequence

Every production failure should be transformable into an eval case. This is more valuable than adding one-off rules.
