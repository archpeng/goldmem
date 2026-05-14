# 12. Elder Async Interaction And Latency Plan

Date: 2026-05-11

This note extends the latency baseline with `deepseek-v4-flash` and defines a product-level async interaction plan for the user mobile experience.

## Model Availability

Neko API `/models` confirms these relevant model IDs:

- `gpt-4.1-mini`
- `gpt-5.4-mini`
- `deepseek-v4-flash`
- `cc-deepseek-v4-flash`

This measurement used `deepseek-v4-flash`.

## Full Chain Latency

Inputs:

- Record: `我把蓝色钥匙放在门口鞋柜上了。`
- Recall: `我的蓝色钥匙放在哪里？`

| Model | Record total | Recall total | Record status | Recall status |
| --- | ---: | ---: | --- | --- |
| `gpt-4.1-mini` | 23.4s | 12.7s | 200 | 200 |
| `gpt-5.4-mini` | 26.3s | 16.6s | 200 | 200 |
| `deepseek-v4-flash` | 30.3s | 14.5s | 200 | 200 |

Current fastest measured end-to-end preview model: `gpt-4.1-mini`.

## Model-Only Latency

| Model | Turn plan | MemoryPlan | Query parse | Answer generation |
| --- | ---: | ---: | ---: | ---: |
| `gpt-4.1-mini` | 1.4s | 8.3s | 2.7s | 2.6s |
| `gpt-5.4-mini` | 8.7s | 9.3s | 4.2s | 4.4s |
| `deepseek-v4-flash` | 3.2s | 9.6s | 3.1s | 2.0s |

`deepseek-v4-flash` is competitive for answer generation, but not for MemoryPlan extraction in this route.

## DeepSeek Full Chain Breakdown

### Record

| Node | Time | Interpretation |
| --- | ---: | --- |
| `elderTurn.planElderTurn` | 2.4s | Task routing |
| `ingest.semanticCandidates` | 5.0s | semantic recall index search timeout/degrade |
| `ingest.generateMemoryPlan` | 12.6s | Main bottleneck for DeepSeek record |
| `applyPlan.semanticWrites` | 5.0s | semantic recall index write timeout/degrade |
| `ingest.temporalWrite` | 5.0s | Graphiti write timeout/retry |
| `ingest.total` | 27.8s | Blocking record chain |
| `elderTurn.total` | 30.2s | User-facing latency |

### Recall

| Node | Time | Interpretation |
| --- | ---: | --- |
| `elderTurn.planElderTurn` | 2.7s | Task routing |
| `query.parseQuery` | 3.8s | Query understanding |
| `query.postgresSearch` | 16ms | Fast truth retrieval |
| `query.semanticSearch` | 5.0s | semantic recall index search timeout/degrade |
| `query.answerGeneration` | 2.9s | Good answer speed |
| `query.total` | 11.7s | Blocking recall chain |
| `elderTurn.total` | 14.5s | User-facing latency |

## Current Blocking Chain

The current elder turn is synchronous:

```text
User submits text
  -> planElderTurn model call
  -> record: ingestText
      -> build context
      -> semantic recall index candidate search
      -> MemoryPlan model call
      -> PostgreSQL truth writes
      -> semantic recall index canonical write
      -> Graphiti episode write
      -> audit
  -> recall: queryMemory
      -> parse query model call
      -> PostgreSQL search
      -> semantic recall index search
      -> optional Graphiti search
      -> evidence merge
      -> answer model call
      -> audit
  -> UI receives final response
```

This is technically correct, but it is not the right product interaction for a user mobile app. The user is forced to wait for nonessential enrichment steps.

## Product Principle

Models are core. The product cannot work without model understanding and model answer generation.

However, the UI does not need to block on every model and memory side effect. The product should separate:

- User acknowledgment latency
- Core truth persistence latency
- Model understanding latency
- Recall answer latency
- Long-term memory enrichment latency

## Async Interaction Plan

### A. Record Flow

Target interaction:

```text
0-300ms:
  Show user's message in conversation.
  Show "我先记下了，正在整理。"

<1s:
  Persist raw source/transcript to PostgreSQL.
  Return trace/job id.

2-12s:
  Background MemoryPlan generation.
  UI shows "正在理解这件事。"

When MemoryPlan is ready:
  Replace pending card with "我理解的是..."
  Show reminder candidates and confirmation controls.

Later:
  semantic recall index canonical write and Graphiti episode write run outside the user-visible blocking path.
```

Product effect:

- The elder gets immediate reassurance.
- Raw source is not lost.
- Business truth is still Kernel-owned.
- semantic recall index and Graphiti remain rebuildable enrichments, not blockers.

Engineering shape:

```text
POST /elder/turn
  -> for record intent:
      sync: source write + turn accepted
      async: MemoryPlan + Kernel apply + semantic recall index + Graphiti

GET /elder/turns/:traceId
  -> returns pending / understood / needs_confirmation / failed
```

### B. Recall Flow

Target interaction:

```text
0-300ms:
  Show user's question.
  Show "我正在查你之前说过的话。"

1-2s:
  PostgreSQL broad recall returns first evidence candidates.
  If strong evidence exists, show "找到相关记录，正在整理回答。"

2-8s:
  Model answer generation returns final user-friendly answer.

If semantic recall index or Graphiti is slow:
  Do not block the first answer.
  Add "我还在查长期记忆，有新线索会补上。"
```

Product effect:

- Query does not feel frozen.
- PostgreSQL truth can produce quick confidence signals.
- Final answer remains evidence-bound.
- Long-term memory enriches after the first answer.

Engineering shape:

```text
POST /elder/turn
  -> for recall intent:
      sync: parseQuery + PostgreSQL search + answer if evidence exists
      async: semantic recall index/Graphiti enrichment or second-pass answer refresh

GET /elder/turns/:traceId
  -> returns answer status and evidence status
```

### C. Record And Recall Flow

Target interaction:

```text
0-300ms:
  Show "我先记下这件事，再帮你查。"

<1s:
  Persist raw source.

First response:
  If recall evidence exists, answer from existing PostgreSQL evidence.

Second response:
  When new MemoryPlan is applied, update the conversation with the newly understood memory.
```

This avoids making the user wait for a full write path before recall starts.

## Proposed Stage Targets

| Stage | User-visible target | Blocking work |
| --- | ---: | --- |
| Submit acknowledged | <300ms | Local UI state |
| Raw source persisted | <1s | PostgreSQL source write |
| Record understood card | 3-10s | MemoryPlan + Kernel apply |
| Reminder confirmation card | 3-10s | Reminder candidate from MemoryPlan |
| Recall first signal | 1-3s | PostgreSQL evidence search |
| Recall final answer | 3-8s | Evidence-bound answer model call |
| semantic recall index enrichment | background | Nonblocking write/search |
| Graphiti enrichment | background | Nonblocking write/search + retry |

## Immediate Optimization Direction

1. Add an async turn status resource.
2. Split `/elder/turn` response into accepted/pending/final modes.
3. Move semantic recall index writes and Graphiti writes fully out of the critical user path.
4. Let recall answer from PostgreSQL first, then refresh with semantic recall index/Graphiti enrichment.
5. Keep model benchmarking per provider route before changing default models.

## Model Choice For Current Preview

For the measured Neko API route:

- Use `gpt-4.1-mini` as current preview default.
- Do not switch to `gpt-5.4-mini` for speed without new evidence.
- Do not switch to `deepseek-v4-flash` for record-heavy flows; MemoryPlan extraction is slower in this measurement.
- Consider `deepseek-v4-flash` only for answer-generation-heavy experiments after routing can choose separate models per task.
