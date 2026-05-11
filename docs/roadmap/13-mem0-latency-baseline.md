# Mem0 Latency Baseline

Date: 2026-05-11

## Scope

This checkpoint isolates Mem0 before rerunning full elder-turn latency. The goal is to separate external service availability from synchronous product-chain suitability.

## Environment

- Mem0 API: `http://localhost:8888`
- Docker container: `infra-mem0-1`, exposed as `8888 -> 8000`
- Model gateway behind Mem0 logs: `https://nekoapi.dangtang8.net/v1`
- Kernel Mem0 timeout budget: `MEM0_TIMEOUT_MS=5000`

## Results

| Check | Result | Timing |
|---|---:|---:|
| `GET /openapi.json` | OK | 8.9ms |
| `GET /health` | 404 | n/a |
| `POST /search`, existing elder memory query | OK, returned 3 results | 3.34s |
| direct `POST /memories`, simple `infer=false` write | timed out at client | 20.01s timeout |
| direct `POST /memories`, long 60s window | OK | 30.88s |
| `pnpm mem0:smoke`, default adapter timeout | failed | 5s timeout |
| `pnpm mem0:smoke`, `MEM0_SMOKE_TIMEOUT_MS=60000` | failed on second write | first write 51.07s, second write 60.00s timeout |
| post-timeout search for second smoke marker | OK, returned written memory | 12.45s |

## Interpretation

Mem0 is reachable and not generally down. Search works, but current observed search latency is seconds-level. Writes are the critical issue: they often complete eventually, but synchronous response time is far beyond the 5s Kernel budget and can exceed 60s.

Container logs show repeated successful calls to `/embeddings` and `/chat/completions`, plus vector insertion, during a single `/memories` request. The slow point is therefore inside the Mem0 write path and its upstream model/embedding calls, not the GoldMem API adapter itself.

## Product Impact

The elder record path must not wait for Mem0 canonical writes. PostgreSQL truth writes can remain synchronous; Mem0 writes should be treated as rebuildable recall indexing and moved behind a background/outbox path with audit visibility.

For recall, Mem0 search should stay evidence-proposing only and use a tight timeout budget. If Mem0 is slow or unavailable, the Kernel should degrade to PostgreSQL-derived evidence rather than blocking the elder-facing conversation.

## Reproduction

Default production-like timeout:

```bash
set -a; source .env; set +a; pnpm mem0:smoke
```

Long diagnostic timeout:

```bash
set -a; source .env; set +a; MEM0_SMOKE_TIMEOUT_MS=60000 pnpm mem0:smoke
```

The smoke now emits structured JSON with phase timings on success or failure.
