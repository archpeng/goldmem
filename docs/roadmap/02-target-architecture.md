# 02. Target Architecture

## Target shape

```text
Elder App / Family App / Admin Console
        |
        v
GoldMem API Server
        |
        v
GoldMem Kernel
        |
        +---------------- PostgreSQL ----------------+
        | business state, evidence, permissions       |
        | sources/events/reminders/risks/tasks/audit  |
        +---------------------------------------------+
        |
        +------------------- Mem0 --------------------+
        | semantic recall, aliases, preferences       |
        | short-to-medium-term context                |
        +---------------------------------------------+
        |
        +---------------- Graphiti -------------------+
        | long-term temporal relationship memory      |
        | entities/facts/relationships/validity       |
        +---------------------------------------------+
        |
        +----------- Eval / Analytics Store ----------+
        | anonymized failures, corrections, patterns  |
        +---------------------------------------------+
```

## Runtime write path

Current MVP path:

```text
source/audio/text
  -> ASR if needed
  -> MemoryPlan generation
  -> schema validation
  -> risk guardrails
  -> permission guardrails
  -> PostgreSQL source/event/reminder/risk/family_task/audit
  -> Mem0 semantic memory
  -> response to elder/family
```

Production Graphiti path:

```text
source/audio/text
  -> ASR if needed
  -> MemoryPlan generation
  -> schema validation
  -> risk guardrails
  -> permission guardrails
  -> PostgreSQL business write
  -> Mem0 semantic write
  -> Graphiti temporal episode write
  -> audit
  -> response to elder/family with temporal write status
```

High-value events include:

```text
health
medication
appointment
family confirmation
financial risk
fraud risk
identity/password/code risk
repeated symptoms
important life events
```

## Nightly consolidation path

```text
load daily PostgreSQL records
  -> sources
  -> events
  -> reminders
  -> risk flags
  -> family tasks
  -> feedback
  -> audit slices

run consolidation model
  -> daily care summary
  -> family digest
  -> high-value Graphiti episodes
  -> curated Mem0 summary
  -> eval cases
  -> anonymized learning patterns

write outputs
  -> Graphiti episodes
  -> Mem0 curated memory
  -> PostgreSQL family digest/audit/eval references
```

## Query path

Current query path:

```text
query
  -> parse query
  -> PostgreSQL event search
  -> Mem0 semantic search
  -> merge evidence
  -> answer generation
```

Target query path:

```text
query
  -> parse query
  -> PostgreSQL business/evidence search
  -> Mem0 semantic recall
  -> Graphiti temporal fact search
  -> evidence alignment by sourceId/eventId/episodeId
  -> answer generation with safety guardrails
```

## Source-of-truth boundaries

### PostgreSQL truth

PostgreSQL owns deterministic business truth:

```text
who the user is
which tenant owns data
who can access an elder
what raw source exists
what reminders exist
what state a reminder is in
what risk flags were created
who confirmed what
what was audited
```

### Graphiti truth

Graphiti owns long-term relational memory truth:

```text
what relationship exists
which fact is current
which fact was superseded
when a relationship became true
when it became invalid
which episode supports a fact
how entities relate over time
```

### Mem0 truth

Mem0 should not be a truth source for actions. It is a recall memory source:

```text
what context may be relevant
what aliases or preferences may matter
what recent or personal memory should be injected
```

## Multi-tenant boundary

Graphiti group identifiers should be created by GoldMem, not by the client.

Recommended group ID:

```text
groupId = Graphiti-safe encoding of tenantId + elderId
```

PostgreSQL remains the tenant authority. Graphiti queries must go through GoldMem Kernel, never directly from frontend clients.

## Fail-safe design

If Graphiti is unavailable:

```text
record source/event/reminder in PostgreSQL
write semantic memory to Mem0
return elder-facing response with internal temporal write failure status
record audit with graphiti_write_failed
queue Graphiti episode for retry when retry queue exists
```

If Mem0 is unavailable:

```text
record truth in PostgreSQL
return response from structured event data
queue semantic memory rebuild
```

If PostgreSQL is unavailable:

```text
do not create business truth
fail safely
```

PostgreSQL is the only hard dependency for business writes.
