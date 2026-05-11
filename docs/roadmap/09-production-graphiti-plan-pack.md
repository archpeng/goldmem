# 09. Production Graphiti Plan Pack

This plan pack turns the long-term memory direction into an implementation sequence for a new-build GoldMem codebase with no historical production burden.

The direction is production-first:

```text
Graphiti = long-term relational memory production path
PostgreSQL = business/source/evidence truth
Mem0 = short-to-medium multilingual recall engine
Kernel = orchestration, safety, evidence fusion, and business action control
```

Graphiti is not a shadow-only experiment in this plan. It enters the production memory path directly, while PostgreSQL remains the hard dependency for business writes and raw evidence.

## Non-Negotiable Boundaries

- PostgreSQL owns tenant membership, source records, reminders, risk flags, family tasks, feedback, and audit.
- Graphiti owns long-term relational memory: entities, relationships, temporal facts, validity, supersession, and relationship history.
- Mem0 owns short-to-medium recall candidates, aliases, preferences, and fuzzy context.
- Kernel is the only layer allowed to fuse evidence and decide whether an answer or business action is safe.
- Graphiti may inform answers, but it must never directly schedule reminders, notify family, change permissions, or mutate PostgreSQL business state.
- High-risk answers must preserve uncertainty and source evidence.

## Step 1: Repair Current Verification

Goal: make the current pulled state green before adding production Graphiti behavior.

Tasks:

- Run `pnpm install` to refresh workspace links so `@goldmem/temporal-memory` resolves from `@goldmem/memory-kernel`.
- Fix `packages/temporal-memory` typecheck:
  - Preferred: make `NullTemporalMemoryStore` method signatures accept the same parameters as `TemporalMemoryStore`.
  - Also align its `tsconfig.json` with other packages by excluding `src/**/*.test.ts` from package typecheck.
- Verify:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm mvp:verify`

Acceptance:

- Workspace install produces a node_modules link for `@goldmem/temporal-memory`.
- `@goldmem/temporal-memory` tests pass.
- `@goldmem/memory-kernel` tests pass.
- Full MVP verification is green before Graphiti production work starts.

## Step 2: Unify Roadmap Direction

Goal: make `docs/roadmap/*` the authoritative roadmap and remove conflicting direction.

Tasks:

- Treat `docs/roadmap/*` as the primary plan source.
- Rewrite or deprecate `docs/road` so it no longer presents a self-built Long-Term Relation Layer as the target architecture.
- Update older docs that describe Graphiti as optional, shadow-only, or only future evaluation.
- Use consistent terminology:
  - `Graphiti = long-term relational memory truth`
  - `PostgreSQL = business/source/evidence truth`
  - `Mem0 = short-to-medium multilingual recall engine`
  - `Kernel = orchestration, safety, evidence fusion`

Acceptance:

- No active roadmap doc presents a custom PostgreSQL fact graph as the final target.
- No active roadmap doc says Graphiti is merely optional if the production direction is long-term relational memory.
- Docs still state that Graphiti cannot trigger business actions directly.

## Step 3: TenantId Full Path

Goal: make Graphiti production-safe by enforcing tenant boundaries before any production Graphiti reads or writes.

Tasks:

- Add `tenantId` to domain schemas:
  - `MemoryPlan`
  - `MemorySource`
  - `MemoryEvent`
  - `Reminder`
  - `RiskFlagRecord`
  - `FamilyTask`
  - `MemoryContextLink`
  - `Feedback`
  - audit records
- Add `tenant_id NOT NULL` to PostgreSQL migrations and Drizzle schema.
- Update API request schemas to include `tenantId`; MVP may default to `tenant-mvp` only at an explicit boundary.
- Update stores so all reads and writes require tenant scope.
- Update Mem0 metadata to include `tenantId`.
- Generate Graphiti group IDs only inside Kernel:

```text
groupId = Graphiti-safe encoding of tenantId + elderId
```

Acceptance:

- No query path can search by `elderId` alone.
- No memory backend call is made without tenant context.
- Frontend clients never pass Graphiti `groupId` directly.
- Cross-tenant store tests prove isolation.

## Step 4: Graphiti Adapter

Goal: implement the production temporal memory adapter behind the existing `TemporalMemoryStore` interface.

Tasks:

- Add `GraphitiTemporalMemoryStore`.
- Add env/config:
  - `GRAPHITI_BASE_URL`
  - `GRAPHITI_API_KEY` if needed
  - `GRAPHITI_REQUIRED_IN_PRODUCTION=true`
- Implement:
  - `addEpisode`
  - `searchFacts`
  - `getEntityTimeline`
  - `getCurrentFacts`
- All requests must include:
  - `tenantId`
  - `elderId`
  - `groupId`
  - `sourceIds`
  - `eventIds`
  - `episodeId` when returned by Graphiti
  - metadata needed to align evidence back to PostgreSQL
- Development and tests may use `NullTemporalMemoryStore`.
- Production must fail fast if Graphiti config is missing.

Acceptance:

- Graphiti adapter has focused unit tests with mocked HTTP.
- Production config without Graphiti fails at API startup.
- Development/test config remains runnable without Graphiti.
- Adapter preserves source/event metadata round trip.

## Step 5: Graphiti Write Enters Ingest

Goal: make Graphiti part of the production write path after PostgreSQL truth is safely persisted.

Write order:

```text
PostgreSQL truth write
-> Mem0 recall write
-> Graphiti temporal episode write
-> audit
-> response
```

Tasks:

- Add `TemporalMemoryStore` to Kernel dependencies.
- After `ingestText` and `ingestVoice` persist PostgreSQL records, build a temporal episode with `buildMemorySourceTemporalEpisode`.
- Write the episode to Graphiti for production builds.
- Add ingest result metadata indicating temporal write status:
  - `written`
  - `failed`
  - missing Graphiti config is reported as `failed` with `errorCode=graphiti_not_configured`
- If Graphiti write fails:
  - do not rollback PostgreSQL
  - do not mark reminder/risk/family truth as failed
  - audit `graphiti_write_failed`
  - return elder-facing result with internal temporal status metadata

Acceptance:

- Ingest tests cover Graphiti success and failure.
- PostgreSQL persistence remains the only hard dependency for business truth.
- A failed Graphiti write is visible through audit and response metadata.
- No Graphiti write can occur before source/event IDs exist.

## Step 6: Graphiti Evidence Enters QueryMemory

Goal: use Graphiti as production evidence for long-term relationship questions.

Query flow:

```text
parse query
-> PostgreSQL business/evidence search
-> Mem0 recall
-> Graphiti temporal fact search
-> evidence alignment
-> evidence merge/rank
-> answer generation
```

Tasks:

- Extend `retrievalSource` to include `graphiti`.
- Map `TemporalEvidence` into answer evidence only when it has source/event/episode alignment.
- Add query triggers for Graphiti:
  - medication changes
  - appointment reschedules
  - family confirmation chains
  - symptom trends
  - fraud and financial risk chains
  - current effective facts
  - historical fact questions
- PostgreSQL overrides Graphiti for:
  - reminder status
  - family task status
  - risk review status
  - permission decisions
  - action execution

Acceptance:

- No-evidence still returns no invented answer.
- Graphiti evidence appears in `retrievedEvidence` only with source alignment.
- High-risk answers preserve uncertainty.
- Tests cover conflict: Graphiti says appointment changed, PostgreSQL reminder is still unconfirmed.

## Step 7: Graphiti Production Golden Cases

Goal: validate each production Graphiti capability with a golden case as it is introduced.

First case set:

- Medication instruction changed over time.
- Appointment or follow-up time rescheduled.
- Family confirmed a medical item.
- Symptom repeated after medication changed.
- Insurance card or object linked to an appointment.
- Fraud or financial risk chain evolved across multiple records.

Rules:

- Do not wait for 20 or 50 cases before enabling Graphiti production path.
- Every new user-facing Graphiti capability must add at least one golden case before merge.
- Golden cases must verify:
  - Graphiti evidence source
  - PostgreSQL source/event alignment
  - answer uncertainty when appropriate
  - no business action without PostgreSQL confirmation

Acceptance:

- `pnpm e2e:graphiti` exists before query integration is considered complete.
- Graphiti write/read fixtures can run against a real Graphiti service.
- Failures become fixtures or prompt/model updates, not keyword special cases.

## Step 8: Nightly Consolidation Strengthens Graphiti

Goal: improve long-term memory quality after the realtime production path exists.

Tasks:

- Add nightly consolidation job after production ingest writes are working.
- Load daily PostgreSQL records by tenant/elder/date.
- Generate curated daily care episodes for Graphiti.
- Write curated daily summaries to Mem0.
- Generate family digest.
- Generate eval cases from:
  - query no-hit audits
  - family corrections
  - reminder confirmations
  - risk misses
  - Graphiti/PostgreSQL/Mem0 disagreement

Acceptance:

- Nightly job is idempotent.
- Nightly job can retry failed Graphiti writes.
- Curated episodes still carry source/event references.
- High-risk nightly findings create review tasks, not silent business truth changes.

## Step 9: Admin Debugger and Eval Flywheel

Goal: make memory behavior explainable and convert failures into learning assets.

Debugger should show:

- source transcript
- MemoryPlan
- risk/permission guardrail changes
- PostgreSQL writes
- Mem0 writes/results
- Graphiti episodes/facts
- evidence merge
- final answer
- audit trail

Eval flywheel should produce:

- prompt regression cases
- policy regression cases
- Graphiti disagreement cases
- anonymized analytics patterns

Acceptance:

- A developer can replay one source end to end.
- A developer can inspect why Graphiti evidence was used or ignored.
- Every real failure can become an eval case.

## Safety Rules For Production Graphiti

- Graphiti is long-term relational memory truth, but not business/action truth.
- Graphiti facts must not directly schedule, cancel, confirm, notify, share, or escalate.
- Kernel must check PostgreSQL state before any business action.
- High-risk Graphiti-only evidence must be phrased as uncertain unless confirmed by PostgreSQL state.
- Frontends must never call Graphiti directly.
- Graphiti group IDs are Kernel-generated.
- Graphiti outage must not corrupt PostgreSQL truth.

Example:

```text
Graphiti says appointment changed
-> Kernel checks PostgreSQL reminder confirmation
-> only confirmed reminder state can schedule/send
```

## Implementation Order

```text
1. Fix verification
2. Unify docs
3. Add tenantId full path
4. Implement Graphiti adapter
5. Add Graphiti production ingest write
6. Add Graphiti query evidence
7. Add production golden cases
8. Add nightly consolidation
9. Add admin debugger and eval flywheel
```

## Verification Matrix

Baseline:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm mvp:verify
```

Graphiti adapter:

```bash
pnpm --filter @goldmem/temporal-memory test
pnpm --filter @goldmem/memory-kernel test
```

Production query path:

```bash
pnpm e2e:golden
pnpm e2e:context
pnpm e2e:graphiti
```

No phase is complete until its tests and relevant golden cases are green.
