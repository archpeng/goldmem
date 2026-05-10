# 03. Memory Layer Responsibilities

GoldMem should not have multiple competing memory truth sources. It should have clearly separated memory roles.

## Layer summary

```text
PostgreSQL = business/source truth
Mem0 = semantic recall memory
Graphiti = long-term temporal relationship memory
Kernel = orchestration and guardrails
```

## PostgreSQL responsibilities

PostgreSQL owns business and evidence truth.

### It stores

```text
tenants
users
elder profiles
family links
raw memory sources
ASR transcripts
audio object references
business memory events
reminders
risk flags
family tasks
feedback
audit logs
lightweight context links for MVP/debug/fallback
```

### It answers

```text
Does this source exist?
Who owns it?
Who can access it?
What reminder state is current?
Who confirmed the reminder?
What risk flag was created?
What was the original transcript?
What is the audit trail?
```

### It must not own long-term memory internals

PostgreSQL should not grow into a full memory graph engine. Avoid expanding it to own:

```text
long-term fact invalidation
entity summary evolution
multi-hop temporal graph retrieval
current-vs-historical fact reasoning
general relationship ontology learning
```

The current `memory_context_links` table should remain an MVP/fallback/debug structure, not the final long-term memory engine.

## Mem0 responsibilities

Mem0 is the semantic recall layer.

### It stores

```text
recent memory summaries
elder preferences
nickname/alias hints
common places
common objects
common family references
short-to-medium-term context
curated daily summaries
```

### It answers

```text
What memories may be relevant to this fuzzy query?
What personal context should be injected into MemoryPlan generation?
What aliases or preferences might matter?
What recent event summaries match the question?
```

### It must not own

```text
reminder state
permission decisions
risk decisions
current effective medical fact
long-term fact validity
relationship supersession
multi-hop temporal reasoning
```

## Graphiti responsibilities

Graphiti is the long-term relational memory truth source.

### It stores

```text
entities
relationships
facts
episodes
validity windows
source provenance
entity summaries
relationship evolution
```

### It answers

```text
Which fact is currently true?
Which older fact was superseded?
What changed over time?
Which episode supports this fact?
How is this symptom related to medication history?
Which family member confirmed a medical change?
How did this risk chain evolve?
```

### It must not own

```text
authentication
tenant membership
permission checks
reminder state transitions
notification delivery
billing
final business actions
```

## Kernel responsibilities

The Kernel is the care-memory orchestrator.

### It does

```text
validate model outputs
apply risk guardrails
apply permission guardrails
write business truth to PostgreSQL
construct Mem0 memory summaries
construct Graphiti episodes
schedule async memory jobs
fuse query evidence from PostgreSQL, Mem0, Graphiti
verify source evidence
avoid unsafe answers
record audit logs
```

### It avoids

```text
implementing its own general graph engine
creating an expanding hand-written memory rule system
letting memory backends perform business actions directly
```

## Example: medication change

### Input 1

```text
张医生说降压药早饭后吃一片。
```

PostgreSQL:

```text
source
memory_event
risk_flag: medical_advice
family_task if confirmation required
```

Mem0:

```text
老人记录：张医生建议降压药早饭后吃一片。
metadata: sourceId, eventId, riskLevel, visibility
```

Graphiti:

```text
Episode: medical advice from source/event
Fact: 张医生 advised 降压药 usage = 早饭后吃一片
valid_from = event time
```

### Input 2

```text
女儿说医生后来改了，晚上也要吃。
```

PostgreSQL:

```text
new source/event/risk/family_task
```

Mem0:

```text
semantic summary of possible medication change
```

Graphiti:

```text
new episode
new fact
older usage fact may be superseded
history preserved
```

Final answer should combine:

```text
business state from PostgreSQL
semantic candidates from Mem0
temporal fact chain from Graphiti
source evidence from PostgreSQL/Graphiti episode metadata
```
