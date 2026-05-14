# mem Agent Constraints

This file defines the rules for humans and coding agents changing mem. Keep it short, enforceable, and aligned with `architecture.md`.

## Must Preserve

1. **Models understand; Kernel constrains.**
   LLMs may produce transcripts, parsed queries, answers, and `MemoryPlan` objects. They must not write business truth directly.

2. **PostgreSQL is truth.**
   Sources, events, context links, reminders, risk flags, family tasks, feedback, audit logs, and the rebuildable pgvector semantic recall index belong in PostgreSQL.

3. **Semantic recall proposes; Kernel decides.**
   Pgvector semantic recall may propose candidate memories. It must not adjudicate business truth. Kernel-generated/PostgreSQL-derived canonical event summaries are indexed with embeddings; recall evidence text must come from PostgreSQL-derived metadata or PostgreSQL records.

4. **The Kernel owns memory orchestration.**
   Ingest and recall behavior belongs in `packages/memory-kernel`. API routes and frontends must stay thin.

5. **Safety is deterministic.**
   Medical, medication, financial, fraud, identity, password, privacy, visibility, and reminder-confirmation behavior must be enforced by schema, engines, stores, and audit. Prompts are not enough.

6. **Recall is evidence-bound.**
   Answers must be generated from merged evidence. No evidence means no invented answer.

7. **Retrieval uses broad recall plus ranking.**
   `eventTypes` are ranking signals, not hard filters. Do not add keyword special cases such as `城里 -> shopping`.

8. **Context links are relationships, not facts.**
   Context links may connect related events or missing reminder details, but they must not merge records, auto-confirm reminders, or overwrite event truth.

9. **Provider output is not relationship truth.**
   Semantic recall results may propose candidate event IDs and ranking signals. Graph relationships belong to mem-owned PostgreSQL context links or the Graphiti temporal path, never to provider-owned recall output.

10. **Chinese is the default product language.**
   User-facing Web MVP copy and default model-facing output should be Simplified Chinese unless the user input clearly uses another language.

## Forbidden

- Do not bypass `memory-kernel` for memory writes or recall answers.
- Do not let providers, prompts, frontends, or API routes mutate truth state directly.
- Do not treat the semantic recall index as authoritative state.
- Do not use provider-generated memory text as final evidence when PostgreSQL-derived metadata is available.
- Do not share raw transcripts by default.
- Do not auto-confirm ambiguous reminders.
- Do not use context links to silently fill reminder times.
- Do not solve recall bugs with one-off keyword/type mappings.
- Do not swallow validation or persistence failures without caller visibility or audit.
- Do not introduce age-labeled Chinese wording; use 用户、使用者、本人, or role-specific neutral copy.

## Change Rules

- Schema or domain contract changes start in `packages/memory-schema`.
- Kernel pipeline, retrieval, evidence merge, and audit changes require Kernel tests.
- Risk, permission, and reminder state changes require focused engine tests.
- Prompt changes that affect behavior require eval or regression cases.
- Frontend changes must call existing APIs through `apps/web-mvp/src/lib/api.ts`; do not duplicate backend rules in React.
- Store adapters must expose domain operations and hide provider-specific details from the Kernel.

## Current MVP Boundaries

- `apps/web-mvp`: React + Tailwind + shadcn-style components, Chinese-first single-page MVP.
- `services/api-server`: Fastify adapter, request parsing, Kernel calls, minimal health/read routes.
- `packages/memory-kernel`: source ingest, MemoryPlan validation, guardrails, persistence, recall, evidence merge, audit.
- `packages/memory-store`: PostgreSQL truth adapter plus pgvector semantic recall storage.
- `packages/model-gateway`: OpenAI-compatible LLM/ASR/embedding boundary with Zod-normalized outputs.

## Required Verification

Run the smallest useful checks for the change. For broad changes, run:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm eval
pnpm architecture:check
```

For MVP confidence, run:

```bash
pnpm mvp:verify
pnpm mvp:smoke
pnpm e2e:golden
```

If a bug was discovered from a real query or model failure, add a regression test or eval case before considering it fixed.
