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
  -> semantic memory
  -> temporal graph memory
  -> query recall
  -> feedback/eval loop
```

## Architecture principles

1. **LLM understands; Kernel constrains.** Models produce a `MemoryPlan`; deterministic code validates, guards, and applies it.
2. **PostgreSQL is the truth source.** Original source, event state, reminders, permissions, risk records, and audit logs are not delegated to memory frameworks.
3. **Mem0 is semantic memory.** It remembers user facts, preferences, event summaries, and recall context.
4. **Graphiti is temporal graph memory.** It is optional in the first version and reserved for high-value long-term relations: medication changes, health timelines, family confirmations, financial risk, repeated symptoms.
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
  memory-store/         # truth/semantic/graph store interfaces
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
  -> write semantic memory
  -> return elder-facing cards
```

Then add ASR/audio, reminder scheduling, fuzzy recall, family confirmation, and later Graphiti.

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

## Local Mem0

Mem0 is the first optional external dependency. PostgreSQL remains the truth store; Mem0 is only a semantic recall index and every write must carry source/event metadata.

1. Set `MEM0_BASE_URL=http://localhost:8888` in `.env`.

2. Start Mem0 and its local pgvector/Neo4j backing services.

```bash
set -a
source .env
set +a
docker compose -f infra/docker-compose.yml up -d mem0-postgres mem0-neo4j mem0
```

The local Mem0 API is available at `http://localhost:8888/docs`. Local compose uses `AUTH_DISABLED=true`; do not use that setting outside development.

3. Verify direct Mem0 add/search.

```bash
set -a
source .env
set +a
pnpm mem0:smoke
```

4. Rebuild the semantic index from PostgreSQL truth records when needed.

```bash
set -a
source .env
set +a
pnpm semantic:rebuild
```

Restart the API server after changing `MEM0_BASE_URL`; otherwise it will keep using the null semantic adapter.

## MVP Verification

Run the local non-network verification suite:

```bash
pnpm mvp:verify
```

This runs typecheck, tests, build, lint, and eval fixtures. It does not require OpenAI, Mem0, Graphiti, or a running database.
