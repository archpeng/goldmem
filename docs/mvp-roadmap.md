# MVP Roadmap

GoldMem MVP 当前目标是用最少产品面打通老人端 AI-native 闭环：

```text
one elder utterance
  -> /elder/turn
  -> model turn plan
  -> Kernel schema gate
  -> record / recall / record_and_recall / clarify
  -> PostgreSQL truth + Mem0 recall + Graphiti temporal evidence
  -> auditable elder-facing result
```

## Must Have

- `POST /elder/turn`
- `GET /elder/reminders`
- `POST /elder/reminders/:id/confirm`
- `POST /elder/feedback`
- OpenAI-compatible turn planning, MemoryPlan generation, query parsing, and answer generation
- PostgreSQL persistence for sources, events, reminders, risk flags, family tasks, feedback, and audit logs
- deterministic risk, permission, and reminder guardrails
- evidence-bound recall with no invented answer when evidence is absent
- smoke and golden e2e over real Postgres, Mem0, and Graphiti paths

## Defer

- native mobile app
- full family dashboard
- full authentication
- production scheduler UI
- manual CRUD editor for memory truth
- provider-specific Mem0 or Graphiti UI

## Milestones

### M1: Unified Elder Turn

Acceptance:

- one route handles record, recall, record-and-recall, and clarify
- frontend does not branch on task type
- unclear input does not write truth

### M2: Mobile Elder Prototype

Acceptance:

- app opens as a mobile-first conversation surface
- no technical identifiers in normal UI
- record results show “我理解的是”
- recall results show answer plus trust copy
- correction feedback is auditable

### M3: Real-Service Confidence

Acceptance:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm lint`
- `pnpm eval`
- `pnpm architecture:check`
- `pnpm mvp:verify`
- `pnpm mvp:smoke`
- `pnpm e2e:golden`
