# mem

mem is a user-first memory and reminder MVP. The current product surface is deliberately narrow: a Chinese-first Web MVP, a Fastify API, a deterministic Memory Kernel, PostgreSQL truth records, pgvector semantic recall, and Graphiti-backed temporal evidence.

The core rule is unchanged:

```text
Models understand.
Kernel constrains.
PostgreSQL owns truth.
Semantic / Graphiti recall propose evidence.
Answers stay evidence-bound.
```

`README.md` is the active repo summary. The fuller current-state explanation lives in [docs/current-capabilities-and-architecture.md](docs/current-capabilities-and-architecture.md).

## Repository Layout

```text
apps/
  web-mvp/              # Chinese-first React single-page MVP
services/
  api-server/           # Fastify HTTP adapter and local runtime bootstrap
  graphiti-sidecar/     # FastAPI sidecar for Graphiti + provenance readback
packages/
  memory-schema/        # Zod contracts and shared domain types
  memory-kernel/        # Ingest/query orchestration and audit
  memory-store/         # PostgreSQL truth store and pgvector recall store
  model-gateway/        # OpenAI-compatible model boundary
  permission-engine/    # Deterministic visibility rules
  reminder-engine/      # Reminder confirmation/state transitions
  risk-engine/          # Deterministic safety guardrails
  temporal-memory/      # Graphiti-targeted temporal memory adapter
prompts/                # Prompt contracts
scripts/                # Verification, smoke, and E2E helpers
docs/                   # Current architecture, roadmap, and debt registers
e2e/                    # Golden fixtures
```

Broad-file debt that is intentionally allowlisted is tracked in [docs/ai-coder-debt-register.md](docs/ai-coder-debt-register.md).

## Quickstart

```bash
pnpm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`.

Start PostgreSQL:

```bash
set -a
source .env
set +a
docker compose -f infra/docker-compose.yml up -d postgres
pnpm db:migrate
```

Start the API server:

```bash
pnpm dev:api:env
```

Start the Web MVP in another terminal:

```bash
pnpm dev:web
```

Open `http://localhost:5173`.

## Verification

Fast local gate without real service dependencies:

```bash
pnpm verify:fast
```

This runs:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm architecture:check
```

Important: `pnpm test` is the fast unit/UI/API layer. It does not claim real PostgreSQL or Graphiti coverage.

Real-dependency gate:

```bash
pnpm verify:real
```

This runs:

```text
pnpm test:postgres
pnpm test:graphiti
pnpm mvp:smoke
```

`pnpm verify:real` requires:

- a populated `.env`
- a running local API server for `pnpm mvp:smoke`
- PostgreSQL and Graphiti availability, which the helper scripts will start or validate as needed
- if Docker Hub is flaky, you can override `GRAPHITI_NEO4J_IMAGE` or set `GRAPHITI_NEO4J_IMAGE_FALLBACK` to a mirror image; `pnpm test:graphiti` will retry pulls before failing
- `pnpm test:graphiti` starts the local compose Graphiti stack by default; set `GRAPHITI_TEST_USE_EXISTING=true` only when you deliberately want to validate an already-running external Graphiti service
- if your normal `DATABASE_URL` points at a different database, set `GRAPHITI_TEST_DATABASE_URL` to control which Postgres instance `pnpm test:graphiti` should validate; localhost Graphiti defaults to `postgres://mem:mem@localhost:5432/mem`

If you want only one real dependency check:

```bash
pnpm test:postgres
pnpm test:graphiti
```

`pnpm test:postgres` is the explicit real Postgres readback gate. The package-level `@mem/memory-store` test is skipped in plain `pnpm test`; `scripts/test-postgres-store.ts` enables it and honors `MEM_STORE_TEST_DATABASE_URL` when you want a non-default database.

Additional gates:

```bash
pnpm doc:drift:check
pnpm mvp:verify
pnpm e2e:golden
```

`pnpm doc:drift:check` validates that active docs only describe paths that actually exist.
