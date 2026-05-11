# GoldMem Architecture

GoldMem is an elder-first memory and reminder system. The current MVP proves one core loop:

```text
elder text note
  -> OpenAI-compatible MemoryPlan
  -> Elder Memory Kernel
  -> deterministic guardrails
  -> PostgreSQL truth store
  -> reminders / family tasks / audit
  -> evidence-bound recall
  -> Chinese-first Web MVP
```

The system is intentionally constrained:

```text
Models understand.
Kernel constrains.
PostgreSQL owns truth.
Auxiliary memory improves recall.
Evals prevent regression.
```

## Current Product Surface

- `apps/web-mvp` is the first user-facing surface.
- It is a React + Tailwind CSS + shadcn-style single-page MVP.
- It uses Simplified Chinese by default.
- It supports text memory capture, memory event display, reminder confirmation, fuzzy recall, and family task confirmation.
- It does not implement authentication, production scheduling, mobile UI, or voice UX yet.

## Runtime Flow

### Ingest

```text
Web/API text input
  -> Fastify route
  -> Kernel creates source
  -> personal context
  -> model-gateway generateMemoryPlan
  -> Zod validation and gateway normalization
  -> risk-engine
  -> permission-engine
  -> PostgreSQL events/reminders/risk/family/audit
  -> pgvector semantic recall index write
  -> elder-facing result
```

### Recall

```text
Web/API query
  -> model-gateway parseMemoryQuery
  -> PostgreSQL broad structured recall
  -> pgvector semantic recall
  -> Kernel merge/rank evidence
  -> context link evidence expansion
  -> model-gateway generateMemoryAnswer
  -> audit log
  -> answer with matched source and retrieval-source metadata
```

Recall is evidence-bound. If merged evidence is empty, the Kernel returns a safe no-evidence answer and does not call answer generation.

## Retrieval Architecture

Recall uses broad candidate retrieval plus ranking.

- `ParsedMemoryQuery.eventTypes` are hints, not hard filters.
- PostgreSQL first recalls candidates from truth data using elder scope plus broad title/summary/entity matching.
- Kernel ranking gives bonuses for event type match, entity match, query text match, event confidence, importance, and active status.
- Pgvector semantic recall returns low-latency candidate memories from PostgreSQL-derived summaries. Its results are merged with structured evidence and each returned evidence item carries `retrievalSource`.
- PostgreSQL context links can expand evidence from an initially matched event to related events, using `retrievalSource: context_link`.
- During ingest, semantic recall results may supply candidate PostgreSQL event IDs for context-link proposal. Provider-owned relation output is ignored as GoldMem truth.
- No special keyword rules should be added for individual examples.

This keeps recall robust when the model misclassifies a query, while preserving PostgreSQL as truth.

## Data Ownership

### PostgreSQL

Authoritative state:

- memory sources
- memory events
- reminders
- memory context links
- risk flags
- family tasks
- feedback
- audit logs

PostgreSQL must be sufficient to reconstruct business truth.

### PgVector Semantic Recall Index

Default recall index:

- event summaries
- stable preferences and facts
- multilingual fuzzy recall
- vector similarity over PostgreSQL-derived canonical summaries

Semantic index entries must carry source/event metadata when available and must be rebuildable from PostgreSQL. The index is not truth; it is a fast candidate source.

### Memory Context Links

Context links are lightweight PostgreSQL relationships between events. They express possible context continuity such as `possibly_related` or `fills_missing_time`.

They do not merge events, confirm facts, or schedule reminders. Low-confidence links remain confirmation-required evidence and must be presented as uncertain in answers.

## Package Boundaries

### `packages/memory-schema`

Owns Zod schemas and shared domain types:

- `MemorySource`
- `MemoryPlan`
- `MemoryEvent`
- `Reminder`
- `RiskFlag`
- `FamilyTask`
- `ParsedMemoryQuery`
- `MemoryAnswer`

This package has no provider, store, HTTP, or UI logic.

### `packages/model-gateway`

Owns LLM/ASR provider access.

- Uses an OpenAI-compatible SDK client.
- Generates memory plans, parsed queries, and answers.
- Normalizes provider output before Zod parsing.
- Does not persist truth or enforce safety policy.

### `packages/memory-kernel`

Owns the domain pipeline.

- Applies model outputs through schemas and deterministic engines.
- Persists events, reminders, risk flags, family tasks, semantic recall writes, and audit.
- Merges and ranks recall evidence.
- Depends on interfaces, not concrete providers.

### `packages/memory-store`

Owns persistence interfaces and adapters.

- PostgreSQL truth store.
- Pgvector-backed semantic recall store.

### `packages/risk-engine`

Owns deterministic safety escalation.

- Medical, medication, financial, fraud, sensitive, password/code, and transfer risks require review or confirmation as appropriate.

### `packages/permission-engine`

Owns visibility defaults.

- Normal events default private.
- Medical events share summary.
- Financial/fraud events require family visibility.
- Sensitive events remain private unless policy changes.

### `packages/reminder-engine`

Owns reminder state transitions.

- Ambiguous or low-confidence reminders require confirmation.
- Confirmation records actor and timestamp.
- Scheduling/sent/done/cancelled/expired transitions must stay in this state machine.

### `services/api-server`

Owns HTTP delivery.

- Parses requests.
- Calls Kernel or domain stores.
- Returns API results.
- Keeps route handlers thin.

### `apps/web-mvp`

Owns the current frontend MVP.

- React + Tailwind + shadcn-style UI components.
- Chinese-first copy in `src/lib/copy.ts`.
- API calls centralized in `src/lib/api.ts`.
- Does not implement backend rules in the browser.

## Current External Services

The MVP can run with:

- local PostgreSQL via Docker
- OpenAI-compatible model gateway using `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`
- local pgvector through the PostgreSQL container

`SEMANTIC_MEMORY_PROVIDER=pgvector` is the only supported semantic recall provider. Tests use in-memory fakes instead of a null production adapter.

## Verification

Local non-network verification:

```bash
pnpm mvp:verify
```

Real MVP smoke with running API/PostgreSQL/model gateway:

```bash
pnpm mvp:smoke
```

The most important regression class is recall failure. Any fixed recall failure should produce a Kernel test or eval case, not a keyword special case.
