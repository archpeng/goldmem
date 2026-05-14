# 07. Risks and Validation

This document lists the main risks of the PostgreSQL + semantic recall index + Graphiti architecture and how to validate or mitigate them.

## Risk 1: Dual truth confusion

### Problem

Graphiti may say one thing while PostgreSQL business state says another.

Example:

```text
Graphiti indicates an appointment was confirmed.
PostgreSQL reminder is still pending_family_confirm.
```

### Rule

```text
PostgreSQL wins for business/action state.
Graphiti wins for long-term memory/fact relationship.
```

### Mitigation

```text
Never let Graphiti directly schedule reminders.
Never let Graphiti directly notify family.
Always pass action requests through Kernel state checks.
Include sourceId/eventId/episodeId in Graphiti evidence.
Audit disagreements.
```

## Risk 2: Graphiti ingestion mistakes

### Problem

Graphiti depends on model-driven extraction. Incorrect structured output can create wrong facts or wrong relationships.

### Mitigation

```text
Use high-quality structured-output-capable models.
Send curated episodes rather than raw noisy fragments first.
Keep high-risk facts as needs_review until confirmed.
Record graphiti_write audit logs.
Build golden cases before user-facing use.
```

## Risk 3: Graphiti operational complexity

### Problem

Graphiti introduces another service and graph backend.

### Mitigation

```text
Use NullTemporalMemoryStore only for development and tests.
Require Graphiti config in production and fail fast when it is missing.
Surface Graphiti write failures in response metadata and audit.
Add retry queue for failed episode writes.
```

## Risk 4: semantic recall index and Graphiti duplicate recall

### Problem

The same memory may be returned by semantic recall index and Graphiti.

### Mitigation

```text
All writes include sourceId/eventId metadata.
Query fusion deduplicates by sourceId/eventId/episodeId.
semantic recall index evidence is treated as semantic candidate.
Graphiti evidence is treated as temporal fact candidate.
PostgreSQL verifies source records.
```

## Risk 5: Long-term memory answers become overconfident

### Problem

The model may present inferred long-term relationships as certain facts.

### Mitigation

```text
Answer prompts must preserve uncertainty.
Medical/financial answers must include confirmation language.
Confidence from Graphiti/Kernel must be exposed to answer generation.
No source evidence means no answer.
```

## Risk 6: Tenant isolation leakage

### Problem

Graphiti and semantic recall index have their own grouping/user concepts. Mistakes could leak memory across tenants.

### Mitigation

```text
mem constructs a Graphiti-safe groupId from tenantId and elderId.
Frontend never calls Graphiti or semantic recall index directly.
All memory backend calls go through Kernel/API.
All memory backend metadata includes tenantId and elderId.
PostgreSQL remains tenant authority.
```

## Risk 7: Nightly consolidation produces hidden drift

### Problem

Nightly jobs may silently create bad curated episodes or summaries.

### Mitigation

```text
Nightly outputs are audited.
High-risk nightly findings generate family tasks or review tasks.
Curated summaries carry source/event references.
Regression evals include nightly-generated cases.
```

## Risk 8: The project couples Graphiti to business actions

### Problem

Graphiti may be powerful, but coupling it to reminders, permissions, notifications, or risk state would weaken deterministic safety.

### Mitigation

```text
Keep PostgreSQL as business/action truth.
Let Graphiti own long-term relation memory only.
Require golden cases for each user-facing Graphiti capability.
Avoid Graphiti-specific types in business schemas.
```

## Validation plan

## Stage 1: Current MVP validation

Required commands:

```bash
pnpm typecheck
pnpm test
pnpm eval
pnpm e2e:golden
pnpm test:postgres
```

Required behavior:

```text
text note writes source/event/reminder/risk/audit to PostgreSQL
query answer uses evidence only
semantic recall index recall returns metadata-aligned evidence
no evidence means no answer
```

## Stage 2: Graphiti production write validation

Test cases:

```text
medication advice
medication changed
appointment scheduled
appointment rescheduled
family confirmation
fraud risk chain
repeated symptom
```

Validation:

```text
Graphiti receives episodes with groupId, sourceIds, eventIds.
Failed writes are audited and visible to the caller as internal temporal status.
PostgreSQL + semantic recall index product path stays committed when Graphiti write fails.
```

## Stage 3: Graphiti query validation

Create golden cases:

```text
Which medication instruction is current?
Was the appointment time changed?
Who confirmed the medical item?
Did dizziness repeat after medication changed?
Which event is the insurance card related to?
How did the fraud-risk chain evolve?
```

Compare:

```text
PostgreSQL + semantic recall index answer
Graphiti evidence
human expected answer
```

Promotion requires:

```text
Graphiti improves answer quality in high-value cases.
Graphiti evidence can be traced to source/event IDs.
Graphiti latency/cost is acceptable.
Graphiti failure mode is safe.
```

## Stage 4: User-facing Graphiti evidence

Enable only for query categories:

```text
medication changed over time
appointment reschedule
family confirmation chain
symptom trend
fraud/risk chain
```

Keep disabled for simple daily recall:

```text
what did I say today?
what did my daughter ask me to remember?
what reminders are pending?
```

## Stage 5: Long-term memory truth hardening

Graphiti remains the long-term relational memory truth target and is hardened when:

```text
Graphiti evidence alignment is stable
nightly consolidation is reliable
admin memory debugger can inspect graph facts
no high-risk answer depends on unverified Graphiti-only evidence
```

## Metrics

### Product metrics

```text
memory recall success rate
reminder confirmation rate
family correction rate
risk review usefulness
no-evidence answer rate
```

### Memory metrics

```text
semantic recall index recall hit rate
Graphiti evidence hit rate
PostgreSQL fallback rate
Graphiti/PostgreSQL disagreement rate
Graphiti write retry rate
```

### Flywheel metrics

```text
new eval cases per week
repeat failure reduction
prompt regression pass rate
risk false-positive reduction
risk miss reduction
family correction reduction
```

## Final validation principle

Do not promote a memory backend because it is elegant. Promote it only when golden cases show that it improves care outcomes without weakening safety, evidence, or tenant isolation.
