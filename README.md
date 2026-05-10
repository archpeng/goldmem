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
3. **Mem0 is the recall engine, not truth.** It can use semantic search, keyword/BM25, entity linking, rerank, and context lookup to find candidate memories.
4. **Mem0 includes the MVP recall index.** Its local pgvector/Neo4j backing services are Mem0 internals; GoldMem does not run a separate Graphiti path in the MVP.
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
  memory-store/         # PostgreSQL truth store and Mem0 adapter
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

Then add ASR/audio, reminder scheduling, fuzzy recall hardening, family confirmation, and later a separate temporal graph only if evals prove Mem0 is insufficient.

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

3. Start local PostgreSQL and Mem0.

```bash
set -a
source .env
set +a
docker compose -f infra/docker-compose.yml up -d postgres mem0-postgres mem0-neo4j mem0
```

4. Apply migrations.

```bash
set -a
source .env
set +a
pnpm db:migrate
```

5. Verify direct Mem0 add/search.

```bash
set -a
source .env
set +a
pnpm mem0:smoke
```

6. Start the API server.

```bash
pnpm dev:api:env
```

7. Start the Web MVP in another terminal.

```bash
pnpm dev:web
```

Open `http://localhost:5173` and use the single-page MVP console to save a memory, confirm reminders, ask a recall question, and review family tasks.

8. Run the MVP smoke flow in another terminal.

```bash
set -a
source .env
set +a
pnpm mvp:smoke
```

The smoke flow calls health, text ingest, reminder list/confirm, and recall query.

## Local Mem0

Mem0 is the default local external dependency. PostgreSQL remains the truth store; Mem0 is the multilingual recall engine and every write must carry source/event metadata.

1. Set `MEM0_BASE_URL=http://localhost:8888` in `.env`.

2. Start Mem0 and its local pgvector/Neo4j backing services.

```bash
set -a
source .env
set +a
docker compose -f infra/docker-compose.yml up -d mem0-postgres mem0-neo4j mem0
```

The local Mem0 API is available at `http://localhost:8888/docs`. Local compose uses `AUTH_DISABLED=true`; do not use that setting outside development.

GoldMem writes structured Kernel summaries to Mem0 with `infer=false`. Mem0 may provide semantic, keyword/BM25, entity-linked, and reranked recall candidates, while PostgreSQL-derived metadata remains the evidence text.

3. Verify direct Mem0 add/search.

```bash
set -a
source .env
set +a
pnpm mem0:smoke
```

4. Rebuild the Mem0 recall index from PostgreSQL truth records when needed.

```bash
set -a
source .env
set +a
pnpm semantic:rebuild
```

Restart the API server after changing `MEM0_BASE_URL`.

## MVP Verification

Run the local non-network verification suite:

```bash
pnpm mvp:verify
```

This runs typecheck, tests, build, lint, and eval fixtures. It does not require OpenAI, Mem0, or a running database.

Architecture constraints can also be checked directly:

```bash
pnpm architecture:check
```

## Golden E2E

The golden E2E suite is the long-lived real-service regression baseline. It requires the API server, PostgreSQL, Mem0, and the OpenAI-compatible model gateway.

```bash
set -a
source .env
set +a
pnpm e2e:golden
```

The fixture lives in `e2e/golden-retrieval.json`. It verifies the previously failed city-shopping recall, cross-language Mem0 recall, person/place recall, and reminder creation. Fraud-risk behavior remains covered by the non-network eval suite.
