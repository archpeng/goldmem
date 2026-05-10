# 06. Key Decisions

This document records why GoldMem should evolve toward PostgreSQL + Mem0 + Graphiti instead of a single memory system or a fully custom memory graph.

## Decision 1: PostgreSQL remains business/source truth

### Decision

PostgreSQL owns business state and raw evidence, not long-term relational memory truth.

### Why

GoldMem has deterministic product obligations:

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

## Decision 3: Mem0 remains semantic recall memory

### Decision

Use Mem0 for short-to-medium-term semantic recall, not as the long-term relational memory truth source.

### Why

Mem0 is strong for:

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

Mem0 write metadata must include:

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

All user-facing answers that use Mem0 must align results back to PostgreSQL source/event evidence.

## Decision 4: Graphiti becomes the candidate long-term relational memory truth

### Decision

Graphiti should be evaluated and then potentially promoted as the source of truth for long-term relational memory.

### Why

Graphiti's native model aligns with GoldMem's long-term needs:

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

Graphiti should not be treated as an optional visualization layer. It should be treated as the future long-term relational memory authority, but introduced through shadow write/query first.

## Decision 5: Kernel becomes an orchestrator, not a full memory engine

### Decision

The GoldMem Kernel should coordinate memory systems instead of implementing all memory mechanics.

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

## Decision 6: Graphiti should not block the real-time MVP path

### Decision

Introduce Graphiti asynchronously and behind feature flags.

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

GoldMem's elder-facing product must remain fast and stable.

### Consequence

Initial runtime path:

```text
PostgreSQL + Mem0
```

Graphiti path:

```text
nightly consolidation
shadow write
shadow query
golden case validation
selective answer integration
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
curated Mem0 summaries
family digest
eval cases
risk/fact conflict cases
audit records
```

### Consequence

GoldMem should be designed around two speeds:

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

## Decision 9: Use Graphiti as benchmark before promotion

### Decision

Graphiti should become authoritative only after evidence from golden cases.

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

Before promotion:

```text
shadow write
shadow query
side-by-side comparison
long-term memory golden cases
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
Graphiti/PostgreSQL/Mem0 disagreement cases
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
