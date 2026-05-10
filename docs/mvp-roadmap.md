# MVP Roadmap

GoldMem MVP 的阶段目标是用最少代码打通一个可演示、可验证的后端闭环：

```text
text note -> OpenAI MemoryPlan -> Kernel guardrails -> PostgreSQL truth store
          -> elder-facing cards + reminder candidates -> basic recall query
```

MVP 不追求完整产品形态。它只证明 Elder Memory Kernel 的核心价值：老人输入一段文字后，系统能安全地产生结构化记忆、提醒候选、风险/确认状态，并能基于证据回答简单回忆问题。

## MVP Scope

### Must Have

- `POST /elder/text-notes`
- `POST /elder/query`
- `GET /elder/reminders`
- `POST /elder/reminders/:id/confirm`
- OpenAI text-only `MemoryPlan` generation
- PostgreSQL persistence for sources, events, reminders, risk flags, family tasks, audit logs
- deterministic risk, permission, and reminder guardrails
- basic eval cases for schema, risk, privacy, and recall

### Defer

- native mobile app
- family web app
- full authentication
- production scheduler
- Mem0 production deployment beyond local OSS smoke and Chinese NLP hardening
- voice/audio ingestion
- complex timeline UI
- multi-provider model routing

MVP may keep `actorUserId` and `elderId` as explicit request fields. Full auth is not part of MVP.

## Milestone 1: Backend Runs Locally

Goal: one command starts the minimum backend against local Postgres.

Deliverables:

- finalize `.env.example`
- document local startup commands
- verify docker Postgres + migration + API server startup
- expose health endpoint
- require local Mem0 for the real API server

Acceptance:

- developer can run Postgres, apply migration, start API server
- `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm eval` pass

## Milestone 2: Text Ingest Demo

Goal: text note creates auditable memory records.

Deliverables:

- ensure `POST /elder/text-notes` works with real OpenAI gateway
- persist source, events, reminder candidates, risk flags, family tasks, audit logs
- return elder-facing cards and reminder candidates
- handle model schema failure without writing business truth

Acceptance:

- normal daily note creates normal private event
- ambiguous reminder creates confirmation-required reminder
- medication/financial/fraud input triggers risk and family review
- all important writes have source evidence and audit trail

## Milestone 3: Basic Recall Demo

Goal: elder can ask a fuzzy question and receive an evidence-bound answer.

Deliverables:

- `POST /elder/query` parses query through OpenAI
- search PostgreSQL events first
- use PostgreSQL structured recall plus Mem0 multilingual recall
- include retrieval-source metadata for frontend evidence display
- answer generation must receive merged evidence only
- record query audit log

Acceptance:

- recall query returns answer with confidence
- answer includes matched source metadata when available
- no evidence means no invented answer

## Milestone 4: Reminder Confirmation

Goal: reminder candidates can become confirmed reminders.

Deliverables:

- `GET /elder/reminders`
- `POST /elder/reminders/:id/confirm`
- reminder state checks stay in `reminder-engine`
- confirmation records actor and timestamp

Acceptance:

- reminder without time cannot be confirmed unless `remindAt` is provided
- confirmed reminder cannot bypass state machine
- audit records confirmation action

## Milestone 5: Minimal Safety Regression Loop

Goal: every prompt/schema/guardrail change has a small regression check.

Deliverables:

- keep initial eval cases small and readable
- add eval cases whenever a model failure is found
- document known failure categories

Acceptance:

- `pnpm eval` runs locally without external services
- eval set covers normal note, ambiguous reminder, medication risk, fraud risk, and no-invention recall

## Golden E2E Baseline

Goal: keep the real MVP path from regressing after Mem0 or retrieval changes.

Deliverables:

- `e2e/golden-retrieval.json` stores stable seed notes, queries, and expected evidence hints
- `pnpm e2e:golden` runs against the real API, PostgreSQL, Mem0, and model gateway
- at least one case must return Mem0 evidence
- the previously failed query `我说过去城里做什么吗` is a required baseline case
- fraud-risk behavior stays in the lightweight eval suite unless a future real-service regression requires an E2E case

Acceptance:

- golden E2E passes before changing retrieval, prompts, Mem0 wiring, or answer schema
- failures become fixture updates only when product behavior intentionally changes

## MVP Success Criteria

MVP is complete when a developer can:

1. start local Postgres
2. start local Mem0 and its pgvector/Neo4j backing services
3. run migrations
4. start API server with `OPENAI_API_KEY` and `MEM0_BASE_URL`
5. submit a text note
6. see source/events/reminders/risk/audit persisted in PostgreSQL
7. confirm a reminder
8. ask one recall question and get an evidence-bound answer with retrieval-source metadata
9. run the test/eval suite successfully

## Local Mem0 Recall Milestone

Goal: wire the first external dependency without changing the truth-store boundary.

Deliverables:

- run local Mem0 OSS REST API at `http://localhost:8888`
- keep PostgreSQL as the source of truth
- write event summaries to Mem0 with `sourceId` and `eventId`
- keep Mem0 available as a multilingual recall engine using semantic, keyword/BM25, entity, and rerank signals when supported
- improve self-hosted Mem0 Chinese tokenization/entity recall with a small GoldMem domain dictionary
- rebuild Mem0 from PostgreSQL truth records
- verify direct add/search with `pnpm mem0:smoke`

Acceptance:

- API server requires `MEM0_BASE_URL` and uses the Mem0 HTTP recall adapter
- recall audit shows Mem0 retrieval counts when Mem0 returns evidence
- no answer may rely on Mem0 recall results without source/event metadata

## Post-MVP Roadmap

After MVP, expand in this order:

1. family task APIs and family-facing digest
2. production reminder scheduler
3. Mem0-compatible multilingual recall hardening for real deployment
4. voice ingestion and audio evidence offsets
5. full authentication and permission management
6. elder mobile client and family web/miniprogram client
7. evaluate a separate temporal graph only after Mem0 recall evals expose a clear gap

This order keeps the MVP focused on proving the Kernel and truth-store loop before adding product surfaces.
