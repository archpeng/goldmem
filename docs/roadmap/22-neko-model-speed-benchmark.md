# 22. Neko Model Speed Benchmark

Date: 2026-05-14

## Goal

Measure current Neko API model latency for GoldMem. The benchmark focuses on OpenAI-compatible JSON completion because GoldMem's model gateway depends on structured JSON outputs for turn planning, memory plan extraction, query parsing, and answer generation.

## Setup

- Base URL: `OPENAI_BASE_URL` from `.env` (`https://nekoapi.dangtang8.net/v1`)
- Raw benchmark script: `scripts/benchmark-neko-models.ts`
- GoldMem gateway script: `scripts/measure-model-gateway-latency.ts`
- Raw JSON benchmark timeout: `NEKO_BENCH_TIMEOUT_MS=20000`
- GoldMem gateway timeout: `OPENAI_TIMEOUT_MS=30000`
- Raw results: `/private/tmp/neko-benchmark-raw.json`
- GoldMem results:
  - `/private/tmp/neko-benchmark-goldmem.json`
  - `/private/tmp/neko-benchmark-goldmem-top5-round*.json`
  - `/private/tmp/neko-benchmark-goldmem-baseline-round*.json`

## Raw JSON Completion

The script pulled `/models`, filtered out embedding/image/internal task aliases, and tested 92 candidate chat models with a short JSON completion prompt.

Result:

- Tested: 92
- JSON-compatible success: 59
- Failed/timeout/schema-invalid: 33

Fastest successful raw JSON calls:

| Rank | Model | Latency |
|---:|---|---:|
| 1 | `Qwen/Qwen3-Coder-30B-A3B-Instruct` | 0.594s |
| 2 | `Qwen/Qwen3-VL-235B-A22B-Instruct` | 0.654s |
| 3 | `Qwen/Qwen3-Coder-480B-A35B-Instruct` | 0.679s |
| 4 | `Qwen/Qwen3-Next-80B-A3B-Instruct` | 0.735s |
| 5 | `deepseek-v4-flash` | 0.738s |
| 6 | `gpt-4.1-nano` | 0.886s |
| 7 | `cc-deepseek-v4-flash` | 0.918s |
| 8 | `moonshotai/Kimi-K2.5` | 0.954s |
| 9 | `gpt-5.3-codex-spark` | 1.380s |
| 10 | `gpt-5.3-chat-latest` | 1.765s |

## GoldMem Gateway Benchmark

This benchmark ran the four model gateway operations that matter for GoldMem latency:

1. `planElderTurn`
2. `generateMemoryPlan`
3. `parseMemoryQuery`
4. `generateMemoryAnswer`

The table sorts by average total latency across successful runs.

| Rank | Model | Runs | Failures | Avg total | Avg turn plan | Avg MemoryPlan | Avg query parse | Avg answer |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | `Qwen/Qwen3-Coder-30B-A3B-Instruct` | 4 | 0 | 8.177s | 1.120s | 4.692s | 1.060s | 1.305s |
| 2 | `Qwen/Qwen3-Next-80B-A3B-Instruct` | 4 | 1 | 8.279s | 1.247s | 4.256s | 1.206s | 1.571s |
| 3 | `Qwen/Qwen3-Coder-480B-A35B-Instruct` | 4 | 0 | 9.210s | 1.190s | 5.056s | 1.330s | 1.635s |
| 4 | `gpt-4.1-nano` | 4 | 1 | 9.922s | 1.675s | 4.551s | 1.344s | 2.352s |
| 5 | `gpt-5.3-codex-spark` | 4 | 0 | 10.765s | 2.852s | 3.964s | 2.454s | 1.496s |
| 6 | `gpt-4.1-mini` | 4 | 0 | 13.504s | 2.207s | 7.548s | 2.048s | 1.701s |
| 7 | `gpt-5.3-chat-latest` | 4 | 0 | 13.967s | 2.174s | 5.118s | 3.417s | 3.258s |
| 8 | `gpt-4.1` | 4 | 0 | 14.034s | 1.496s | 7.417s | 2.704s | 2.416s |
| 9 | `deepseek-v4-flash` | 4 | 0 | 16.381s | 2.225s | 9.023s | 2.803s | 2.330s |
| 10 | `gpt-5.4-mini` | 4 | 1 | 23.542s | 3.599s | 9.788s | 4.523s | 5.632s |

Failure details:

- `Qwen/Qwen3-Next-80B-A3B-Instruct`: one `generateMemoryPlan` schema validation failure.
- `gpt-4.1-nano`: one `generateMemoryPlan` schema validation failure.
- `gpt-5.4-mini`: one `parseMemoryQuery` `OpenAI JSON completion failed`.

## Conclusion

Fastest by average successful GoldMem gateway latency:

1. `Qwen/Qwen3-Coder-30B-A3B-Instruct`
2. `Qwen/Qwen3-Next-80B-A3B-Instruct`
3. `Qwen/Qwen3-Coder-480B-A35B-Instruct`

Fastest zero-failure candidates in this run:

1. `Qwen/Qwen3-Coder-30B-A3B-Instruct`
2. `Qwen/Qwen3-Coder-480B-A35B-Instruct`
3. `gpt-5.3-codex-spark`

Recommendation:

- Use `Qwen/Qwen3-Coder-30B-A3B-Instruct` as the first speed candidate for the next P0 run.
- Do not switch the project default solely from this latency benchmark; run P0 capability-boundary E2E with the candidate model to verify schema fidelity, safety behavior, Chinese answer quality, and evidence-bound recall.
- Treat `Qwen/Qwen3-Next-80B-A3B-Instruct` and `gpt-4.1-nano` as fast but not yet reliable enough for default use because each produced one MemoryPlan schema validation failure.

Follow-up runtime decision:

- The checked-in default is `deepseek-v4-flash` for both `OPENAI_MODEL` and `GRAPHITI_MODEL`.
- This is not the fastest overall model, but it was selected as a conservative speed improvement over `gpt-5.4-mini`: `deepseek-v4-flash` averaged 16.381s across the four GoldMem gateway operations with 4/4 success, while `gpt-5.4-mini` averaged 23.542s across successful runs with one JSON completion failure.
- Embedding remains `text-embedding-3-small` and ASR remains `whisper-1`; `deepseek-v4-flash` is a chat/completion model, not an embedding or transcription model.
