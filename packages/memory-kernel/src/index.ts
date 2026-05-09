import {
  MemoryAnswerSchema,
  MemoryPlanSchema,
  ParsedMemoryQuerySchema,
  type MemoryAnswer,
  type MemoryEvent,
  type MemoryPlan,
  type MemorySource,
  type ParsedMemoryQuery,
  type Reminder,
} from "@goldmem/memory-schema";
import type { ModelGateway, RetrievedEvidence } from "@goldmem/model-gateway";
import type {
  AuditLog,
  EventStore,
  FamilyTaskStore,
  PersonalContextStore,
  RiskFlagStore,
  SemanticMemoryStore,
  SourceStore,
  TemporalGraphStore,
} from "@goldmem/memory-store";
import type { ReminderEngine } from "@goldmem/reminder-engine";
import type { RiskEngine } from "@goldmem/risk-engine";
import type { PermissionEngine } from "@goldmem/permission-engine";

export type IngestTextInput = {
  elderId: string;
  transcript: string;
  localCreatedAt?: string;
  metadata?: MemorySource["metadata"];
};

export type IngestVoiceInput = {
  elderId: string;
  audio: Uint8Array;
  localCreatedAt?: string;
  metadata?: MemorySource["metadata"];
};

export type IngestResult = {
  sourceId: string;
  summary: string;
  events: MemoryEvent[];
  reminderCandidates: Reminder[];
  elderFacingCards: Array<{
    title: string;
    summary: string;
    needsConfirmation: boolean;
    riskLevel: string;
  }>;
};

export type QueryMemoryInput = {
  elderId: string;
  query: string;
  now?: string;
};

export type ElderMemoryKernelDeps = {
  sourceStore: SourceStore;
  eventStore: EventStore;
  reminderEngine: ReminderEngine;
  familyTaskStore: FamilyTaskStore;
  riskFlagStore: RiskFlagStore;
  semanticMemory: SemanticMemoryStore;
  temporalGraph: TemporalGraphStore;
  personalContextStore: PersonalContextStore;
  modelGateway: ModelGateway;
  riskEngine: RiskEngine;
  permissionEngine: PermissionEngine;
  auditLog: AuditLog;
};

export class ElderMemoryKernel {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async ingestVoice(input: IngestVoiceInput): Promise<IngestResult> {
    const audioUrl = await this.deps.sourceStore.saveAudio(input.audio);
    const transcription = await this.deps.modelGateway.transcribe(input.audio);

    const source = await this.deps.sourceStore.create({
      elderId: input.elderId,
      type: "voice",
      transcript: transcription.text,
      audioUrl,
      createdAt: new Date().toISOString(),
      localCreatedAt: input.localCreatedAt,
      asrConfidence: transcription.confidence,
      metadata: input.metadata,
    });

    return this.ingestSource(source);
  }

  async ingestText(input: IngestTextInput): Promise<IngestResult> {
    const source = await this.deps.sourceStore.create({
      elderId: input.elderId,
      type: "text",
      transcript: input.transcript,
      createdAt: new Date().toISOString(),
      localCreatedAt: input.localCreatedAt,
      metadata: input.metadata,
    });

    return this.ingestSource(source);
  }

  private async ingestSource(source: MemorySource): Promise<IngestResult> {
    try {
      const context = await this.deps.personalContextStore.buildContext({
        elderId: source.elderId,
        queryText: source.transcript,
      });

      const rawPlan = await this.deps.modelGateway.generateMemoryPlan({
        elderId: source.elderId,
        sourceId: source.id,
        transcript: source.transcript,
        createdAt: source.createdAt,
        context,
      });

      const validatedPlan = MemoryPlanSchema.parse(rawPlan);
      const riskGuardedPlan = await this.deps.riskEngine.enforce(validatedPlan);
      const permissionedPlan = await this.deps.permissionEngine.applyDefaultVisibility(
        riskGuardedPlan,
        source.elderId,
      );

      const applied = await this.applyMemoryPlan(permissionedPlan);

      await this.deps.auditLog.record({
        type: "memory_ingest",
        elderId: source.elderId,
        sourceId: source.id,
        payload: {
          plan: permissionedPlan,
          result: {
            eventIds: applied.events.map((event) => event.id),
            reminderIds: applied.reminderCandidates.map((reminder) => reminder.id),
          },
        },
      });

      return {
        sourceId: source.id,
        summary: permissionedPlan.summary,
        events: applied.events,
        reminderCandidates: applied.reminderCandidates,
        elderFacingCards: applied.events.map((event) => ({
          title: event.title,
          summary: event.summary,
          needsConfirmation: event.requiresConfirmation,
          riskLevel: event.riskLevel,
        })),
      };
    } catch (error) {
      await this.deps.auditLog.record({
        type: "memory_ingest_failed",
        elderId: source.elderId,
        sourceId: source.id,
        payload: {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async applyMemoryPlan(plan: MemoryPlan): Promise<{ events: MemoryEvent[]; reminderCandidates: Reminder[] }> {
    const events: MemoryEvent[] = [];
    const reminders: Reminder[] = [];

    for (const draft of plan.events) {
      const event = await this.deps.eventStore.create({
        ...draft,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
        status: draft.requiresConfirmation ? "needs_review" : "active",
      });
      events.push(event);
    }

    for (const draft of plan.reminderCandidates) {
      const relatedEvent = typeof draft.relatedEventIndex === "number" ? events[draft.relatedEventIndex] : undefined;
      const reminder = await this.deps.reminderEngine.createCandidate({
        ...draft,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
        eventId: relatedEvent?.id,
      });
      reminders.push(reminder);

      if (draft.confirmationRequired) {
        await this.deps.familyTaskStore.create({
          elderId: plan.elderId,
          title: `Confirm reminder: ${draft.title}`,
          summary: draft.reason,
          type: "reminder_confirm",
          urgency: draft.timeConfidence < 0.7 ? "medium" : "low",
          visibility: "shared_summary",
          relatedEventId: relatedEvent?.id,
        });
      }

      if (typeof draft.relatedEventIndex === "number" && draft.relatedEventIndex >= events.length) {
        // Keep future lint simple: suspicious relatedEventIndex values are audit-only, not fatal.
        await this.deps.auditLog.record({
          type: "memory_plan_warning",
          elderId: plan.elderId,
          sourceId: plan.sourceId,
          payload: { warning: "Reminder relatedEventIndex out of range", reminder: draft },
        });
      }
    }

    for (const risk of plan.riskFlags) {
      await this.deps.riskFlagStore.create({
        ...risk,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
      });
    }

    for (const task of plan.familyTasks) {
      const relatedEvent = typeof task.relatedEventIndex === "number" ? events[task.relatedEventIndex] : undefined;
      await this.deps.familyTaskStore.create({
        elderId: plan.elderId,
        title: task.title,
        summary: task.summary,
        type: task.type,
        urgency: task.urgency,
        visibility: task.visibility,
        relatedEventId: relatedEvent?.id,
      });
    }

    await this.writeSemanticMemories(plan, events);
    await this.writeTemporalGraph(plan, events);

    return { events, reminderCandidates: reminders };
  }

  private async writeSemanticMemories(plan: MemoryPlan, events: MemoryEvent[]): Promise<void> {
    for (const event of events) {
      await this.deps.semanticMemory.addMemory({
        userId: event.elderId,
        memory: [
          `Title: ${event.title}`,
          `Summary: ${event.summary}`,
          `Type: ${event.type}`,
          `Risk: ${event.riskLevel}`,
          `Source: ${event.sourceId}`,
        ].join("\n"),
        metadata: {
          sourceId: event.sourceId,
          eventId: event.id,
          eventType: event.type,
          riskLevel: event.riskLevel,
          visibility: event.visibility,
        },
      });
    }

    for (const update of plan.memoryUpdates.filter((item) => item.target === "semantic_memory")) {
      await this.deps.semanticMemory.addMemory({
        userId: plan.elderId,
        memory: update.content,
        metadata: update.metadata,
      });
    }
  }

  private async writeTemporalGraph(plan: MemoryPlan, events: MemoryEvent[]): Promise<void> {
    for (const event of events) {
      if (!shouldWriteToTemporalGraph(event)) continue;

      await this.deps.temporalGraph.addEpisode({
        groupId: event.elderId,
        episodeType: "memory_event",
        occurredAt: event.eventTimeStart ?? event.createdAt,
        sourceId: event.sourceId,
        content: {
          title: event.title,
          summary: event.summary,
          type: event.type,
          riskLevel: event.riskLevel,
          entities: event.entities,
          evidence: event.evidence,
        },
      });
    }
  }

  async queryMemory(input: QueryMemoryInput): Promise<MemoryAnswer> {
    const now = input.now ?? new Date().toISOString();
    const context = await this.deps.personalContextStore.buildContext({
      elderId: input.elderId,
      queryText: input.query,
    });

    const parsedQuery = ParsedMemoryQuerySchema.parse(await this.deps.modelGateway.parseMemoryQuery({
      elderId: input.elderId,
      query: input.query,
      now,
      context,
    }));

    const structuredEvents = await this.deps.eventStore.search({
      elderId: input.elderId,
      query: input.query,
      types: parsedQuery.eventTypes,
      timeRange: parsedQuery.timeRange,
      entityNames: parsedQuery.entities.map((entity) => entity.name),
      limit: 10,
    });

    const semanticResults = await this.deps.semanticMemory.searchMemory({
      userId: input.elderId,
      query: input.query,
      limit: 10,
    });

    const graphResults = await this.deps.temporalGraph.search({
      groupId: input.elderId,
      query: input.query,
      timeRange: parsedQuery.timeRange,
      entities: parsedQuery.entities,
      limit: 10,
    });

    const evidence = mergeEvidence(structuredEvents, semanticResults, graphResults, parsedQuery, input.query);
    const retrieval = {
      structuredCount: structuredEvents.length,
      semanticCount: semanticResults.length,
      graphCount: graphResults.length,
      evidenceCount: evidence.length,
    };
    if (evidence.length === 0) {
      const answer: MemoryAnswer = {
        answerText: "I could not find a matching memory for that question.",
        confidence: 0,
        matchedSources: [],
        suggestedActions: [],
        safetyNote: "No source evidence was found.",
      };

      await this.deps.auditLog.record({
        type: "memory_query",
        elderId: input.elderId,
        payload: { query: input.query, parsedQuery, evidence, retrieval, answer, noEvidence: true },
      });

      return answer;
    }

    const answer = MemoryAnswerSchema.parse(await this.deps.modelGateway.generateMemoryAnswer({
      query: input.query,
      parsedQuery,
      evidence,
      responseStyle: "elder_friendly_voice",
    }));

    await this.deps.auditLog.record({
      type: "memory_query",
      elderId: input.elderId,
      payload: { query: input.query, parsedQuery, evidence, retrieval, answer },
    });

    return answer;
  }
}

function shouldWriteToTemporalGraph(event: MemoryEvent): boolean {
  return (
    event.type === "health" ||
    event.type === "medication" ||
    event.type === "appointment" ||
    event.type === "finance" ||
    event.riskLevel === "medical" ||
    event.riskLevel === "financial" ||
    event.riskLevel === "fraud_risk" ||
    event.importance > 0.8
  );
}

function mergeEvidence(
  events: MemoryEvent[],
  semanticResults: Array<{ memory: string; score?: number; metadata?: Record<string, unknown> }>,
  graphResults: RetrievedEvidence[],
  parsedQuery: ParsedMemoryQuery,
  query: string,
): RetrievedEvidence[] {
  const eventEvidence: RetrievedEvidence[] = events.map((event) => ({
    sourceId: event.sourceId,
    eventId: event.id,
    createdAt: event.createdAt,
    summary: event.summary,
    score: scoreStructuredEvent(event, parsedQuery, query),
    canPlayAudio: true,
  }));

  const semanticEvidence: RetrievedEvidence[] = semanticResults.map((result) => ({
    sourceId: String(result.metadata?.sourceId ?? "unknown"),
    eventId: typeof result.metadata?.eventId === "string" ? result.metadata.eventId : undefined,
    createdAt: new Date().toISOString(),
    summary: result.memory,
    score: result.score ?? 0.5,
    canPlayAudio: typeof result.metadata?.sourceId === "string",
  }));

  const byKey = new Map<string, RetrievedEvidence>();
  for (const item of [...eventEvidence, ...semanticEvidence, ...graphResults]) {
    const key = `${item.sourceId}:${item.eventId ?? item.summary}`;
    const existing = byKey.get(key);
    if (!existing || item.score > existing.score) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

function scoreStructuredEvent(event: MemoryEvent, parsedQuery: ParsedMemoryQuery, query: string): number {
  const eventText = `${event.title}\n${event.summary}`.toLowerCase();
  const queryTerms = buildRecallTerms(query, parsedQuery.entities.map((entity) => entity.name));
  const entityNames = event.entities.map((entity) => entity.name.toLowerCase());

  let score = 0.45 + event.importance * 0.2 + event.confidence * 0.15;
  if (parsedQuery.eventTypes.includes(event.type)) score += 0.12;
  if (queryTerms.some((term) => eventText.includes(term))) score += 0.16;
  if (parsedQuery.entities.some((entity) => entityNames.includes(entity.name.toLowerCase()))) score += 0.1;
  if (event.status === "active") score += 0.03;

  return clampScore(score);
}

function buildRecallTerms(query: string, entityNames: string[]): string[] {
  const terms = new Set<string>();
  for (const value of [query, ...entityNames]) {
    for (const term of tokenizeRecallText(value)) terms.add(term);
  }
  return [...terms].slice(0, 16);
}

function tokenizeRecallText(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return [];

  const terms = new Set<string>();
  for (const token of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= 2) terms.add(token);
    if (/[\p{Script=Han}]/u.test(token)) {
      for (const item of cjkNgrams(token)) terms.add(item);
    }
  }

  return [...terms];
}

function cjkNgrams(value: string): string[] {
  const chars = [...value].filter((char) => /[\p{Script=Han}]/u.test(char));
  const grams: string[] = [];
  for (const size of [2, 3]) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      grams.push(chars.slice(index, index + size).join(""));
    }
  }
  return grams;
}

function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}
