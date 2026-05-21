# AI Coder Debt Register

This file tracks intentionally broad files that are still allowed by the hard line-budget gate. Every entry must have an owner, a bounded reason, and an exit condition.

## Current Allowlist

| File | Owner | Reason | Exit condition |
|---|---|---|---|
| `packages/memory-schema/src/index.ts` | `memory-schema` | Shared schema barrel is still centralized. | Split schemas by domain slices behind one public export surface. |
| `packages/temporal-memory/src/index.ts` | `temporal-memory` | Graphiti adapter and transport contract still share one integration file. | Separate transport contract, provenance alignment, and adapter implementation. |
| `packages/risk-engine/src/index.ts` | `risk-engine` | Deterministic safety rules remain in one file for audit review. | Split by risk family while preserving one public engine entrypoint. |
| `packages/model-gateway/src/index.ts` | `model-gateway` | Provider client and operation wiring remain co-located. | Separate provider transport, timeout policy, and operation wiring. |
| `packages/memory-kernel/src/index.ts` | `memory-kernel` | Kernel public surface still coordinates multiple commands and queries. | Move remaining command wiring into focused modules. |
| `packages/memory-kernel/src/memory-plan-completeness.ts` | `memory-kernel` | Completeness repair policy remains centralized. | Split reminder, relation, and action completeness checks. |
| `packages/memory-store/src/index.ts` | `memory-store` | Store interface barrel still aggregates many contracts. | Split store contracts by owner without breaking package-level imports. |
| `services/graphiti-sidecar/src/main.py` | `graphiti-sidecar` | Python sidecar still bundles handlers and provenance glue. | Separate request models, provenance helpers, and route handlers. |
| `packages/memory-kernel/test/harness.ts` | `memory-kernel` | Shared test harness remains centralized for fixture reuse. | Split harness factories by ingest, query, and Graphiti scenarios. |
| `packages/memory-kernel/src/query.test.ts` | `memory-kernel` | Query regressions are still concentrated in one suite. | Split by recall mode and answer policy. |
| `packages/memory-kernel/src/graphiti.test.ts` | `memory-kernel` | Graphiti regressions remain in one suite. | Split ingest-side and query-side Graphiti coverage. |
| `packages/memory-kernel/src/context-links.test.ts` | `memory-kernel` | Context-link regressions remain broad. | Split creation, repair, and query-isolation coverage. |
| `packages/memory-kernel/src/index.test.ts` | `memory-kernel` | Ingest regressions remain broad. | Split happy-path, reminder, and risk regressions. |
| `packages/model-gateway/src/index.test.ts` | `model-gateway` | Normalization and provider timeout coverage remain consolidated. | Split normalization, prompt composition, and provider transport tests. |
| `services/api-server/src/index.test.ts` | `api-server` | HTTP regression coverage remains centered on the full public API surface. | Split route contract, debug route, and runtime boot tests. |
| `packages/memory-store/src/postgres.test.ts` | `memory-store` | Postgres integration coverage remains a broad round-trip suite. | Split truth records, idempotency, and semantic index integration tests. |
| `apps/web-mvp/src/App.test.tsx` | `web-mvp` | UI regression coverage still centers on top-level behavior. | Split draft flow, reminders, recall, and settings tests. |
| `scripts/graphiti-comparison-e2e.ts` | `evals` | Comparison harness remains one benchmark script. | Extract shared fixtures, assertions, and result classification helpers. |
| `scripts/golden-e2e.ts` | `evals` | Golden E2E control flow and assertions remain co-located. | Split helpers, fixture loading, and assertions. |
| `scripts/memory-lint.ts` | `evals` | Memory lint parsing and rule evaluation remain in one script. | Split fixture parsing, rule evaluation, and CLI presentation. |
