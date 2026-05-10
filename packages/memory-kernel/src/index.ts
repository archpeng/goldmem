import {
  MemoryAnswerSchema,
  MemoryPlanSchema,
  ParsedMemoryQuerySchema,
  type MemoryAnswer,
  type MemoryContextLink,
  type MemoryEvent,
  type MemoryPlan,
  type MemorySource,
  type ParsedMemoryQuery,
  type Reminder,
} from "@goldmem/memory-schema";
import type { ModelGateway, RetrievedEvidence } from "@goldmem/model-gateway";
import type { PersonalContext } from "@goldmem/model-gateway";
import type {
  AuditLog,
  ContextLinkStore,
  EventStore,
  FamilyTaskStore,
  PersonalContextStore,
  RiskFlagStore,
  SemanticMemoryStore,
  SourceStore,
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
  contextLinkStore: ContextLinkStore;
  reminderEngine: ReminderEngine;
  familyTaskStore: FamilyTaskStore;
  riskFlagStore: RiskFlagStore;
  semanticMemory: SemanticMemoryStore;
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
      const baseContext = await this.deps.personalContextStore.buildContext({
        elderId: source.elderId,
        queryText: source.transcript,
      });
      const context = await this.buildIngestContextWithSemanticCandidates(source, baseContext);

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

      const applied = await this.applyMemoryPlan(permissionedPlan, context);

      await this.deps.auditLog.record({
        type: "memory_ingest",
        elderId: source.elderId,
        sourceId: source.id,
        payload: {
          plan: permissionedPlan,
          result: {
            eventIds: applied.events.map((event) => event.id),
            reminderIds: applied.reminderCandidates.map((reminder) => reminder.id),
            contextLinkIds: applied.contextLinks.map((link) => link.id),
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

  private async applyMemoryPlan(
    plan: MemoryPlan,
    context: PersonalContext,
  ): Promise<{ events: MemoryEvent[]; reminderCandidates: Reminder[]; contextLinks: MemoryContextLink[] }> {
    const events: MemoryEvent[] = [];
    const reminders: Reminder[] = [];
    const contextLinks: MemoryContextLink[] = [];

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

    for (const draft of plan.contextLinks) {
      const link = await this.applyContextLinkDraft(plan, draft, events, context);
      if (link) contextLinks.push(link);
    }

    await this.writeSemanticMemories(plan, events);
    return { events, reminderCandidates: reminders, contextLinks };
  }

  private async applyContextLinkDraft(
    plan: MemoryPlan,
    draft: MemoryPlan["contextLinks"][number],
    events: MemoryEvent[],
    context: Awaited<ReturnType<PersonalContextStore["buildContext"]>>,
  ): Promise<MemoryContextLink | undefined> {
    const fromEvent = events[draft.fromEventIndex];
    const toEvent = typeof draft.toEventIndex === "number" ? events[draft.toEventIndex] : undefined;
    const toEventId = toEvent?.id ?? draft.toEventId;
    const openReminders = context.openReminders ?? [];
    const allowedHistoricalEventIds = new Set([
      ...context.recentEvents.map((event) => event.eventId).filter(isString),
      ...(context.semanticCandidateEvents ?? []).map((event) => event.eventId).filter(isString),
      ...openReminders.map((reminder) => reminder.eventId).filter(isString),
    ]);
    const allowedReminderIds = new Set(openReminders.map((reminder) => reminder.reminderId));

    if (!fromEvent || !toEventId || fromEvent.id === toEventId) {
      await this.auditSkippedContextLink(plan, draft, "missing_or_self_event_reference");
      return undefined;
    }

    if (!events.some((event) => event.id === toEventId) && !allowedHistoricalEventIds.has(toEventId)) {
      await this.auditSkippedContextLink(plan, draft, "to_event_not_in_context");
      return undefined;
    }

    if (draft.reminderId && !allowedReminderIds.has(draft.reminderId)) {
      await this.auditSkippedContextLink(plan, draft, "reminder_not_in_context");
      return undefined;
    }

    if (draft.confidence < 0.5) {
      await this.auditSkippedContextLink(plan, draft, "confidence_below_persistence_threshold");
      return undefined;
    }

    const status = draft.confidence >= 0.8 && draft.status === "active" ? "active" : "needs_confirmation";
    const link = await this.deps.contextLinkStore.create({
      elderId: plan.elderId,
      fromEventId: fromEvent.id,
      toEventId,
      reminderId: draft.reminderId,
      type: draft.type,
      status,
      confidence: draft.confidence,
      reason: draft.reason,
      evidence: draft.evidence,
    });

    if (status === "needs_confirmation") {
      await this.deps.familyTaskStore.create({
        elderId: plan.elderId,
        title: draft.type === "fills_missing_time" ? "确认提醒时间关联" : "确认记忆上下文关联",
        summary: draft.reason,
        type: draft.type === "fills_missing_time" && draft.reminderId ? "reminder_confirm" : "general_review",
        urgency: "medium",
        visibility: "shared_summary",
        relatedEventId: fromEvent.id,
      });
    }

    await this.deps.auditLog.record({
      type: "memory_context_link_created",
      elderId: plan.elderId,
      sourceId: plan.sourceId,
      payload: { link },
    });

    return link;
  }

  private async auditSkippedContextLink(
    plan: MemoryPlan,
    draft: MemoryPlan["contextLinks"][number],
    reason: string,
  ): Promise<void> {
    await this.deps.auditLog.record({
      type: "memory_context_link_skipped",
      elderId: plan.elderId,
      sourceId: plan.sourceId,
      payload: { reason, contextLink: draft },
    });
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
          title: event.title,
          summary: event.summary,
          createdAt: event.createdAt,
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

  private async buildIngestContextWithSemanticCandidates(
    source: MemorySource,
    context: PersonalContext,
  ): Promise<PersonalContext> {
    const semanticResults = await this.deps.semanticMemory.searchMemory({
      userId: source.elderId,
      query: source.transcript,
      limit: 8,
    });
    const candidateIds = [
      ...new Set(
        semanticResults
          .map((result) => result.metadata?.eventId)
          .filter(isString),
      ),
    ].slice(0, 8);
    if (candidateIds.length === 0) return { ...context, semanticCandidateEvents: [] };

    const eventsById = new Map((await this.deps.eventStore.getByIds(candidateIds)).map((event) => [event.id, event]));
    const candidates = semanticResults.flatMap((result) => {
      const eventId = result.metadata?.eventId;
      if (!isString(eventId)) return [];
      const event = eventsById.get(eventId);
      if (!event || event.elderId !== source.elderId) return [];
      return [
        {
          eventId: event.id,
          sourceId: event.sourceId,
          title: event.title,
          summary: event.summary,
          createdAt: event.createdAt,
          score: result.score,
        },
      ];
    });

    const uniqueCandidates = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      if (!uniqueCandidates.has(candidate.eventId)) uniqueCandidates.set(candidate.eventId, candidate);
    }

    return {
      ...context,
      semanticCandidateEvents: [...uniqueCandidates.values()].slice(0, 5),
    };
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

    const initialEvidence = mergeEvidence(structuredEvents, semanticResults, parsedQuery, input.query);
    const evidence = await this.expandEvidenceWithContextLinks(input.elderId, initialEvidence);
    const retrieval = {
      postgresCount: structuredEvents.length,
      mem0Count: semanticResults.length,
      contextLinkCount: evidence.filter((item) => item.retrievalSource === "context_link").length,
      evidenceCount: evidence.length,
    };
    if (evidence.length === 0) {
      const answer: MemoryAnswer = {
        answerText: "I could not find a matching memory for that question.",
        confidence: 0,
        matchedSources: [],
        retrievedEvidence: [],
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

    const generatedAnswer = MemoryAnswerSchema.parse(await this.deps.modelGateway.generateMemoryAnswer({
      query: input.query,
      parsedQuery,
      evidence,
      responseStyle: "elder_friendly_voice",
    }));
    const answer: MemoryAnswer = {
      ...generatedAnswer,
      retrievedEvidence: evidence,
      matchedSources: generatedAnswer.matchedSources.map((source) => ({
        ...source,
        retrievalSource: source.retrievalSource ?? evidence.find((item) => item.sourceId === source.sourceId)?.retrievalSource,
      })),
    };

    await this.deps.auditLog.record({
      type: "memory_query",
      elderId: input.elderId,
      payload: { query: input.query, parsedQuery, evidence, retrieval, answer },
    });

    return answer;
  }

  private async expandEvidenceWithContextLinks(elderId: string, evidence: RetrievedEvidence[]): Promise<RetrievedEvidence[]> {
    const evidenceEventIds = [...new Set(evidence.map((item) => item.eventId).filter(isString))];
    if (evidenceEventIds.length === 0) return evidence;

    const links = (await this.deps.contextLinkStore.listByEventIds({ elderId, eventIds: evidenceEventIds }))
      .filter((link) => link.status !== "rejected");
    if (links.length === 0) return evidence;

    const initialEventIds = new Set(evidenceEventIds);
    const linkedEventIds = [
      ...new Set(
        links.flatMap((link) => [link.fromEventId, link.toEventId]),
      ),
    ];
    if (linkedEventIds.length === 0) return evidence;

    const linkedEvents = await this.deps.eventStore.getByIds(linkedEventIds);
    const linkByEventId = new Map<string, MemoryContextLink>();
    for (const link of links) {
      if (initialEventIds.has(link.toEventId) || initialEventIds.has(link.fromEventId)) {
        linkByEventId.set(link.fromEventId, link);
        linkByEventId.set(link.toEventId, link);
      }
    }

    const linkedEvidence: RetrievedEvidence[] = linkedEvents.flatMap((event) => {
      const link = linkByEventId.get(event.id);
      if (!link) return [];
      return [
        {
          sourceId: event.sourceId,
          eventId: event.id,
          createdAt: event.createdAt,
          summary: `${event.summary}（上下文关联：${link.reason}；状态：${link.status === "active" ? "已建立" : "待确认"}）`,
          score: clampScore(link.confidence * 0.85),
          canPlayAudio: true,
          retrievalSource: "context_link" as const,
        },
      ];
    });

    return mergeRetrievedEvidence([...evidence, ...linkedEvidence]);
  }
}

function mergeEvidence(
  events: MemoryEvent[],
  semanticResults: Array<{ memory: string; score?: number; metadata?: Record<string, unknown> }>,
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
    retrievalSource: "postgres",
  }));

  const semanticEvidence: RetrievedEvidence[] = semanticResults.flatMap((result) => {
    if (typeof result.metadata?.sourceId !== "string") return [];
    return [
      {
        sourceId: result.metadata.sourceId,
        eventId: typeof result.metadata.eventId === "string" ? result.metadata.eventId : undefined,
        createdAt: typeof result.metadata.createdAt === "string" ? result.metadata.createdAt : new Date().toISOString(),
        summary: typeof result.metadata.summary === "string" ? result.metadata.summary : result.memory,
        score: result.score ?? 0.5,
        canPlayAudio: true,
        retrievalSource: "mem0" as const,
      },
    ];
  });

  const byKey = new Map<string, RetrievedEvidence>();
  return mergeRetrievedEvidence([...eventEvidence, ...semanticEvidence]);
}

function mergeRetrievedEvidence(evidence: RetrievedEvidence[]): RetrievedEvidence[] {
  const byKey = new Map<string, RetrievedEvidence>();
  for (const item of evidence) {
    const key = `${item.retrievalSource}:${item.sourceId}:${item.eventId ?? item.summary}`;
    const existing = byKey.get(key);
    if (!existing || item.score > existing.score) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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
