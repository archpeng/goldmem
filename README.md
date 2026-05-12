# GoldMem

GoldMem is an elder-first memory and reminder system. The product surface is simple: voice memo, reminder, recall, and family confirmation. The core asset is the **Elder Memory Kernel**: a model-driven, guardrail-constrained memory layer that turns raw voice/text into structured life events, reminder candidates, risk flags, family tasks, and long-term memory writes.

## Product thesis

GoldMem is not only an AI notes app. It is a family-level memory service for older adults.

```text
Elder voice/text
  -> source evidence
  -> structured memory event
  -> reminder candidate
  -> risk flag
  -> family confirmation task
  -> memory recall index
  -> query recall
  -> feedback/eval loop
```

## Architecture principles

1. **LLM understands; Kernel constrains.** Models produce a `MemoryPlan`; deterministic code validates, guards, and applies it.
2. **PostgreSQL is the truth source.** Original source, event state, reminders, permissions, risk records, and audit logs are not delegated to memory frameworks.
3. **Semantic recall index is fast candidate retrieval, not truth.** Pgvector stores PostgreSQL-derived canonical summaries and returns recall candidates.
4. **Graphiti is the long-term relational memory path.** Its local Neo4j backing service is Graphiti infrastructure; GoldMem still gates every answer and business action through the Kernel.
5. **Failures become eval data, not ad-hoc rules.** Case-by-case mistakes are collected into evaluation cases and prompt/model improvements.

## Repository layout

```text
apps/
  elder-android/        # placeholder for elder mobile client
  family-web/           # placeholder for family web/miniprogram client
  admin-web/            # placeholder for internal console
services/
  api-server/           # HTTP API shell
  worker-service/       # async ingest/query jobs shell
  reminder-service/     # reminder delivery shell
  eval-runner/          # eval runner shell
packages/
  memory-schema/        # Zod schemas and shared domain types
  memory-kernel/        # Elder Memory Kernel orchestration
  model-gateway/        # LLM/ASR abstraction
  memory-store/         # PostgreSQL truth store and pgvector semantic recall index
  reminder-engine/      # deterministic reminder state machine
  risk-engine/          # hard risk guardrails
  permission-engine/    # visibility and family sharing guardrails
  shared-types/         # shared primitives
prompts/                # prompt contracts
infra/                  # docker-compose and local infra placeholders
docs/                   # architecture and design docs
evals/                  # eval case folders
```

## First milestone

The first milestone is text-only ingestion:

```text
input transcript
  -> build MemoryPlan
  -> validate schema
  -> enforce risk/permission guardrails
  -> create events and reminder candidates
  -> write recall memory
  -> return elder-facing cards
```

Then add ASR/audio, reminder scheduling, fuzzy recall hardening, family confirmation, Graphiti-backed long-term relationship evidence, and eval-driven consolidation.

## Development

This repo is initialized as a pnpm TypeScript monorepo.

```bash
pnpm install
pnpm typecheck
```

## MVP Quickstart

The MVP is text-first: local PostgreSQL, Fastify API, OpenAI model gateway, deterministic Kernel guardrails, and PostgreSQL truth records.

1. Install dependencies.

```bash
pnpm install
```

2. Create local environment.

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

3. Start local PostgreSQL.

```bash
set -a
source .env
set +a
docker compose -f infra/docker-compose.yml up -d postgres
```

4. Apply migrations.

```bash
set -a
source .env
set +a
pnpm db:migrate
```

5. Start the API server.

```bash
pnpm dev:api:env
```

6. Start the Web MVP in another terminal.

```bash
pnpm dev:web
```

Open `http://localhost:5173` and use the single-page MVP console to save a memory, confirm reminders, ask a recall question, and review family tasks.

7. Run the MVP smoke flow in another terminal.

```bash
set -a
source .env
set +a
pnpm mvp:smoke
```

The smoke flow calls health, text ingest, reminder list/confirm, and recall query.

## Local Semantic Recall

Semantic recall is backed by pgvector in the main PostgreSQL database. PostgreSQL remains truth; the `semantic_memories` table is a rebuildable index of PostgreSQL-derived summaries and embeddings.

Rebuild the semantic recall index from PostgreSQL truth records when needed.

```bash
set -a
source .env
set +a
pnpm semantic:rebuild
```

Restart the API server after changing model or embedding settings.

## Local Graphiti

Graphiti is exposed to GoldMem through a small local sidecar that wraps `graphiti-core` with the REST contract used by `@goldmem/temporal-memory`. The default local backend is Neo4j 5.26+.

1. Set `OPENAI_API_KEY` and keep `GRAPHITI_BASE_URL=http://localhost:8890` in `.env`.

2. Start Graphiti with the existing local stack.

```bash
set -a
source .env
set +a
docker compose -f infra/docker-compose.yml --profile graphiti up -d graphiti-neo4j graphiti-sidecar
```

The sidecar is available at `http://localhost:8890/health`; Graphiti Neo4j Browser is exposed at `http://localhost:7475` and Bolt at `localhost:7688`. In `.env`, `GRAPHITI_NEO4J_URI` is the host-facing Bolt URL and `GRAPHITI_SIDECAR_NEO4J_URI` is the container-internal URL.

3. Verify direct Graphiti write/search.

```bash
set -a
source .env
set +a
pnpm graphiti:smoke
```

4. For production-style Graphiti E2E, start PostgreSQL and Graphiti, run migrations, start the API server, then run:

```bash
set -a
source .env
set +a
pnpm e2e:graphiti
```

For the context-link golden fixture, keep Graphiti enabled so temporal evidence can participate in relationship and disambiguation queries:

```bash
set -a
source .env
set +a
pnpm --filter @goldmem/api-server dev
pnpm e2e:context
```

`pnpm e2e:context` now fails fast unless the API reports `graphiti: "ok"`.

## MVP Verification

Run the local non-network verification suite:

```bash
pnpm mvp:verify
```

This runs typecheck, unit tests, real PostgreSQL readback, Graphiti readback, build, lint, eval fixtures, and architecture checks. The Graphiti readback gate requires a healthy local Graphiti sidecar and its provenance PostgreSQL path; the helper will start the local compose Graphiti profile when `GRAPHITI_BASE_URL` is not already set.

Architecture constraints can also be checked directly:

```bash
pnpm architecture:check
```

## Golden E2E

The golden E2E suite is the long-lived real-service regression baseline. It requires the API server, PostgreSQL with pgvector, and the OpenAI-compatible model gateway.

```bash
set -a
source .env
set +a
pnpm e2e:golden
```

The fixture lives in `e2e/golden-retrieval.json`. It verifies the previously failed city-shopping recall, cross-language semantic recall, person/place recall, and reminder creation. Fraud-risk behavior remains covered by the non-network eval suite.
