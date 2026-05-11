import {
  DEFAULT_TENANT_ID,
  MemoryAnswerSchema,
  ParsedMemoryQuerySchema,
  type MemoryAnswer,
  type MemoryContextLink,
  type MemorySource,
  type ParsedMemoryQuery,
} from "@goldmem/memory-schema";
import type { RetrievedEvidence } from "@goldmem/model-gateway";
import {
  buildTemporalGroupId,
  type TemporalEvidence,
} from "@goldmem/temporal-memory";
import {
  clampScore,
  evidenceBoundMatchedSources,
  mergeEvidence,
  mergeRetrievedEvidence,
  shouldSearchTemporalMemory,
} from "./retrieval.js";
import { isString } from "./guards.js";
import type { ElderMemoryKernelDeps, QueryMemoryInput } from "./index.js";

export class QueryOrchestrator {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async queryMemory(input: QueryMemoryInput): Promise<MemoryAnswer> {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const now = input.now ?? new Date().toISOString();
    const context = await this.deps.personalContextStore.buildContext({
      tenantId,
      elderId: input.elderId,
      queryText: input.query,
    });

    const parsedQuery = ParsedMemoryQuerySchema.parse(await this.deps.modelGateway.parseMemoryQuery({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      now,
      context,
    }));

    const structuredEvents = await this.deps.eventStore.search({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      types: parsedQuery.eventTypes,
      timeRange: parsedQuery.timeRange,
      entityNames: parsedQuery.entities.map((entity) => entity.name),
      limit: 10,
    });

    const semanticResults = await this.deps.semanticMemory.searchMemory({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      limit: 10,
    });
    const temporalResults = await this.searchTemporalFactsSafely({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      parsedQuery,
    });
    const alignedTemporalResults = await this.alignTemporalEvidence({
      tenantId,
      elderId: input.elderId,
      temporalResults,
    });

    const initialEvidence = mergeEvidence(structuredEvents, semanticResults, alignedTemporalResults, parsedQuery, input.query, now);
    const evidence = await this.expandEvidenceWithContextLinks(tenantId, input.elderId, initialEvidence);
    const retrieval = {
      postgresCount: structuredEvents.length,
      mem0Count: semanticResults.length,
      mem0MetadataCount: semanticResults.filter((result) => typeof result.metadata?.sourceId === "string").length,
      mem0UnlinkedCount: semanticResults.filter((result) => typeof result.metadata?.sourceId !== "string").length,
      mem0SignalCount: semanticResults.filter((result) => result.retrievalSignals).length,
      graphitiCount: temporalResults.length,
      graphitiAlignedCount: alignedTemporalResults.length,
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
        tenantId,
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
      matchedSources: evidenceBoundMatchedSources(generatedAnswer.matchedSources, evidence),
    };

    await this.deps.auditLog.record({
      type: "memory_query",
      tenantId,
      elderId: input.elderId,
      payload: { query: input.query, parsedQuery, evidence, retrieval, answer },
    });

    return answer;
  }

  private async searchTemporalFactsSafely(input: {
    tenantId: string;
    elderId: string;
    query: string;
    parsedQuery: ParsedMemoryQuery;
  }): Promise<TemporalEvidence[]> {
    if (!shouldSearchTemporalMemory(input.query, input.parsedQuery)) return [];

    try {
      return await this.deps.temporalMemory.searchFacts({
        tenantId: input.tenantId,
        elderId: input.elderId,
        groupId: buildTemporalGroupId({ tenantId: input.tenantId, elderId: input.elderId }),
        query: input.query,
        entities: input.parsedQuery.entities.map((entity) => ({ name: entity.name, type: entity.type })),
        timeRange: input.parsedQuery.timeRange,
        limit: 10,
      });
    } catch (error) {
      await this.deps.auditLog.record({
        type: "graphiti_search_failed",
        tenantId: input.tenantId,
        elderId: input.elderId,
        payload: {
          query: input.query,
          errorCode: error instanceof Error && error.name === "TemporalMemoryNotConfiguredError"
            ? "graphiti_not_configured"
            : "graphiti_search_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }

  private async alignTemporalEvidence(input: {
    tenantId: string;
    elderId: string;
    temporalResults: TemporalEvidence[];
  }): Promise<TemporalEvidence[]> {
    const candidates = input.temporalResults.filter(
      (result) => isString(result.sourceId) && (isString(result.eventId) || isString(result.episodeId)),
    );
    if (candidates.length === 0) return [];

    const sourceIds = [...new Set(candidates.map((result) => result.sourceId).filter(isString))];
    const eventIds = [...new Set(candidates.map((result) => result.eventId).filter(isString))];
    const sources = await Promise.all(sourceIds.map((sourceId) => this.deps.sourceStore.get({ tenantId: input.tenantId, sourceId })));
    const validSourceIds = new Set(
      sources
        .filter((source): source is MemorySource => source !== null)
        .filter((source) => source.elderId === input.elderId && source.tenantId === input.tenantId)
        .map((source) => source.id),
    );
    const events = await this.deps.eventStore.getByIds({ tenantId: input.tenantId, eventIds });
    const validEventsById = new Map(
      events
        .filter((event) => event.elderId === input.elderId && event.tenantId === input.tenantId && validSourceIds.has(event.sourceId))
        .map((event) => [event.id, event]),
    );

    return candidates.filter((result) => {
      if (!result.sourceId || !validSourceIds.has(result.sourceId)) return false;
      if (result.eventId) {
        const event = validEventsById.get(result.eventId);
        return Boolean(event && event.sourceId === result.sourceId);
      }
      return isString(result.episodeId);
    });
  }

  private async expandEvidenceWithContextLinks(tenantId: string, elderId: string, evidence: RetrievedEvidence[]): Promise<RetrievedEvidence[]> {
    const evidenceEventIds = [...new Set(evidence.map((item) => item.eventId).filter(isString))];
    if (evidenceEventIds.length === 0) return evidence;

    const links = (await this.deps.contextLinkStore.listByEventIds({ tenantId, elderId, eventIds: evidenceEventIds }))
      .filter((link) => link.status !== "rejected");
    if (links.length === 0) return evidence;

    const initialEventIds = new Set(evidenceEventIds);
    const linkedEventIds = [
      ...new Set(
        links.flatMap((link) => [link.fromEventId, link.toEventId]),
      ),
    ];
    if (linkedEventIds.length === 0) return evidence;

    const linkedEvents = await this.deps.eventStore.getByIds({ tenantId, eventIds: linkedEventIds });
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
