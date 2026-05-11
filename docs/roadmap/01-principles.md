# 01. Principles

## 1. Long-term memory is the highest-value layer

GoldMem's core product value is not simple note capture. The long-term value is care memory:

```text
facts that change
relationships that evolve
evidence that must be traced
care actions that require confirmation
risk signals that accumulate over time
```

Examples:

```text
The medication instruction changed.
A family member confirmed the new appointment time.
The elder repeatedly mentioned dizziness after medication changed.
A financial-risk conversation started with a stranger and later involved a transfer.
```

These are temporal relationship problems, not plain text retrieval problems.

## 2. Avoid building a hand-written long-term memory engine

A custom PostgreSQL graph/fact layer is attractive because it is controllable. But if it keeps growing, GoldMem will gradually reimplement:

```text
entity extraction
entity summaries
relationship extraction
fact validity windows
fact invalidation
historical queries
hybrid graph retrieval
provenance management
ontology evolution
```

This is exactly the kind of manual system that can become brittle and expensive.

The updated direction is to let a specialized temporal context graph engine handle long-term memory evolution.

## 3. Use Graphiti for long-term relational memory truth

Graphiti's model maps well to GoldMem's long-term needs:

```text
Episodes        -> source transcripts, family confirmations, reminder state changes, risk reviews
Entities        -> elders, family members, doctors, medicines, hospitals, symptoms, objects
Facts/Relations -> advised, confirmed, rescheduled, changed, repeated, associated_with
Validity        -> what was true then vs what is true now
Provenance      -> which source or event produced the fact
```

Graphiti should not replace GoldMem's business database. It should replace the need to build a custom long-term memory graph inside PostgreSQL.

## 4. PostgreSQL remains business and evidence truth

PostgreSQL owns deterministic business state:

```text
tenants
users
family links
raw source records
audio object references
memory events as business/evidence indexes
reminders
risk flags
family tasks
feedback
audit logs
billing/auth/permissions
```

PostgreSQL does not need to become the long-term relationship memory engine.

## 5. Mem0 remains semantic recall memory

Mem0 is best used for:

```text
short-to-medium-term semantic recall
recent summaries
elder preferences
nicknames and aliases
common places and objects
fast fuzzy lookup
conversation context
```

Mem0 should not be responsible for:

```text
current effective medical facts
fact invalidation
long-term relationship chains
business actions
permissions
reminder status
```

## 6. Kernel becomes an orchestrator, not a memory engine

The GoldMem Kernel should not implement deep graph memory internals.

It should own:

```text
input normalization
MemoryPlan validation
risk guardrails
permission guardrails
business state transitions
Graphiti episode construction
Mem0 summary construction
query fusion
evidence verification
nightly consolidation scheduling
audit logging
```

## 7. Real-time path should make Graphiti visible but bounded

Do not make every component a hard dependency for business truth, but do make the long-term memory path visible in production from the start.

Early production write order:

```text
source -> MemoryPlan -> PostgreSQL -> Mem0 -> Graphiti episode -> audit -> response
```

PostgreSQL write success remains the business hard dependency. Graphiti write failure must be surfaced in response metadata and audit, then retried by a later queue/job; it must not rollback PostgreSQL truth or silently disappear.

## 8. Nightly consolidation is a core mechanism

GoldMem should use two speeds:

```text
Daytime: fast capture, quick recall, safe actions
Nighttime: deep consolidation, relation extraction, conflict detection, family digest, eval generation
```

Nightly consolidation is where high-quality curated episodes are written to Graphiti.

## 9. Evidence-bound answers are non-negotiable

Even when Graphiti or Mem0 retrieves a memory, final user-facing answers must be evidence-bound.

For high-risk domains:

```text
medical
medication
financial
fraud
identity
password/code
```

The answer must preserve uncertainty, cite source records internally, and avoid acting without confirmation.

## 10. Data flywheel comes from feedback, not raw data pooling

The flywheel is not built by mixing private elder data across tenants.

The flywheel comes from:

```text
structured failures
family corrections
reminder confirmations
ignored reminders
risk false positives
risk misses
query no-hit cases
anonymous evaluation patterns
```

Raw private memory stays tenant-scoped. Learning patterns can be anonymized and used to improve prompts, policies, evals, and model routing.
