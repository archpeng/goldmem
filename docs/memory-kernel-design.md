# Elder Memory Kernel Design

## Goal

The Elder Memory Kernel converts messy elder voice/text into safe, auditable, long-term life memory.

It is not a free-form agent. It is a deterministic orchestration layer around model understanding.

```text
Model proposes -> Kernel validates -> Guardrails constrain -> Stores persist -> Feedback improves
```

## Core invariant

The model never directly changes business truth. It returns a `MemoryPlan`.

The Kernel is the only layer allowed to apply the plan.

## Main pipeline

```text
source
  -> personal context
  -> model-generated MemoryPlan
  -> schema validation
  -> risk guardrails
  -> permission guardrails
  -> create events
  -> create reminder candidates
  -> create family tasks
  -> write recall memory
  -> audit log
```

## Storage split

### PostgreSQL truth source

- users
- family links
- memory sources
- memory events
- reminders
- risk flags
- family tasks
- permissions
- audit logs
- feedback/eval cases

### Pgvector semantic recall index

- elder facts
- preferences
- daily event summaries
- common people/places/objects
- recall context
- vector similarity over PostgreSQL-derived canonical summaries

GoldMem writes canonical event memory to the PostgreSQL `semantic_memories` index with embeddings. The index provides recall candidates; Kernel and PostgreSQL remain responsible for fact adjudication and evidence text.

## Rule philosophy

GoldMem avoids case-by-case elder rules.

Hard rules are limited to:

- evidence requirements
- medical/financial/fraud confirmations
- reminder state machine
- privacy and sharing visibility
- auditability

Everything else should become data: prompts, few-shot examples, eval cases, and personal memory.

## First milestone

Text-only ingestion:

```text
transcript -> MemoryPlan -> events + reminder candidates + semantic recall index writes
```

No Android, no separate temporal graph, no scheduler required yet.
