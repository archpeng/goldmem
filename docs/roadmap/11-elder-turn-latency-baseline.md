# 11. Elder Turn Latency Baseline

Date: 2026-05-11

This note records the first measured end-to-end latency baseline for the mobile elder `/elder/turn` flow.

## Measurement Setup

- API: `http://localhost:3000`
- Web proxy path: `http://localhost:5173/api/elder/turn`
- Neko API model candidates confirmed from `/models`:
  - `gpt-4.1-mini`
  - `gpt-5.4-mini`
- Record input: `我把蓝色钥匙放在门口鞋柜上了。`
- Recall input: `我的蓝色钥匙放在哪里？`
- Measurement scripts:
  - `scripts/measure-elder-turn-latency.ts`
  - `scripts/measure-model-gateway-latency.ts`

## Full Chain Result

| Model | Record total | Recall total | Record status | Recall status |
| --- | ---: | ---: | --- | --- |
| `gpt-4.1-mini` | 23.4s | 12.7s | 200 | 200 |
| `gpt-5.4-mini` | 26.3s | 16.6s | 200 | 200 |

## Record Chain Breakdown

| Node | `gpt-4.1-mini` | `gpt-5.4-mini` | Note |
| --- | ---: | ---: | --- |
| `elderTurn.planElderTurn` | 1.7s | 5.3s | Model routing |
| `ingest.semanticCandidates` | 5.0s | 4.9s | Mem0 search timeout/degrade |
| `ingest.generateMemoryPlan` | 6.4s | 5.8s | Main model extraction |
| `applyPlan.semanticWrites` | 5.0s | 5.0s | Mem0 write timeout/degrade |
| `ingest.temporalWrite` | 5.0s | 5.0s | Graphiti write timeout/retry |
| `ingest.total` | 21.5s | 20.8s | Includes Mem0/Graphiti waits |
| `elderTurn.total` | 23.3s | 26.2s | User-facing API latency |

## Recall Chain Breakdown

| Node | `gpt-4.1-mini` | `gpt-5.4-mini` | Note |
| --- | ---: | ---: | --- |
| `elderTurn.planElderTurn` | 2.1s | 3.7s | Model routing |
| `query.parseQuery` | 1.9s | 3.8s | Model query parse |
| `query.postgresSearch` | 15ms | 17ms | Fast |
| `query.mem0Search` | 5.0s | 5.0s | Mem0 search timeout/degrade |
| `query.answerGeneration` | 3.6s | 3.9s | Model answer |
| `query.total` | 10.6s | 12.8s | Includes Mem0 wait |
| `elderTurn.total` | 12.7s | 16.5s | User-facing API latency |

## Model-Only Result

These numbers remove Mem0, PostgreSQL, Graphiti, and API routing from the path.

| Model | Turn plan | MemoryPlan | Query parse | Answer generation |
| --- | ---: | ---: | ---: | ---: |
| `gpt-4.1-mini` | 1.4s | 8.3s | 2.7s | 2.6s |
| `gpt-5.4-mini` | 8.7s | 9.3s | 4.2s | 4.4s |

## Conclusion

`gpt-5.4-mini` is available in Neko API, but in this measurement it is not faster than `gpt-4.1-mini`.

Current bottlenecks:

- Mem0 search/write repeatedly reaches the 5s timeout.
- Graphiti write reaches the 5s timeout and then enters retry.
- MemoryPlan generation is the largest model-only step.
- `gpt-5.4-mini` is slower on turn planning and recall generation in the current Neko route.

Near-term optimization priority:

1. Keep external Mem0/Graphiti failures non-blocking for elder UX.
2. Reduce or async offload Mem0 write/search from the critical record path.
3. Keep benchmarking Neko model candidates with the two latency scripts before changing defaults.
4. Treat `gpt-4.1-mini` as the current faster preview model unless a later Neko route proves otherwise.
