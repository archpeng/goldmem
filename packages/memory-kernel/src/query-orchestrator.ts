import {
  DEFAULT_TENANT_ID,
  MemoryAnswerSchema,
  ParsedMemoryQuerySchema,
  type MemoryAnswer,
  type MemorySource,
  type ParsedMemoryQuery,
} from "@goldmem/memory-schema";
import { ModelGatewayError, type RetrievedEvidence } from "@goldmem/model-gateway";
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
import { appendProviderTimings, consumeProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";
import type { ElderMemoryKernelDeps, QueryMemoryInput } from "./index.js";

export class QueryOrchestrator {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async queryMemory(input: QueryMemoryInput, traceId: string): Promise<MemoryAnswer> {
    const startedAt = Date.now();
    const timings: Record<string, unknown> = {};
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const now = input.now ?? new Date().toISOString();
    try {
    const contextStartedAt = Date.now();
    const context = await this.deps.personalContextStore.buildContext({
      tenantId,
      elderId: input.elderId,
      queryText: input.query,
    });
    timings.buildContextMs = Date.now() - contextStartedAt;

    const parseQueryStartedAt = Date.now();
    const parsedQuery = ParsedMemoryQuerySchema.parse(await this.deps.modelGateway.parseMemoryQuery({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      now,
      context,
    }));
    timings.parseQueryMs = Date.now() - parseQueryStartedAt;
    appendProviderTimings(timings, this.deps.modelGateway);

    const postgresSearchStartedAt = Date.now();
    const structuredEvents = await this.deps.eventStore.search({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      types: parsedQuery.eventTypes,
      timeRange: parsedQuery.timeRange,
      entityNames: parsedQuery.entities.map((entity) => entity.name),
      limit: 10,
    });
    timings.postgresSearchMs = Date.now() - postgresSearchStartedAt;

    const semanticSearchStartedAt = Date.now();
    const semanticResults = await this.searchSemanticMemorySafely({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      traceId,
    });
    timings.semanticSearchMs = Date.now() - semanticSearchStartedAt;
    appendProviderTimings(timings, this.deps.modelGateway);

    const temporalSearchStartedAt = Date.now();
    const temporalResults = await this.searchTemporalFactsSafely({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      parsedQuery,
      traceId,
    });
    timings.temporalSearchMs = Date.now() - temporalSearchStartedAt;

    const temporalAlignStartedAt = Date.now();
    const alignedTemporalResults = await this.alignTemporalEvidence({
      tenantId,
      elderId: input.elderId,
      temporalResults,
    });
    timings.temporalAlignMs = Date.now() - temporalAlignStartedAt;

    const mergeEvidenceStartedAt = Date.now();
    const initialEvidence = mergeEvidence(structuredEvents, semanticResults, alignedTemporalResults, parsedQuery, input.query, now);
    timings.mergeEvidenceMs = Date.now() - mergeEvidenceStartedAt;

    const contextLinksStartedAt = Date.now();
    const evidence = await this.expandEvidenceWithContextLinks(tenantId, input.elderId, initialEvidence);
    timings.contextLinksMs = Date.now() - contextLinksStartedAt;
    const retrieval = {
      postgresCount: structuredEvents.length,
      semanticCount: semanticResults.length,
      semanticMetadataCount: semanticResults.filter((result) => (
        typeof result.metadata?.sourceId === "string" && typeof result.metadata.summary === "string"
      )).length,
      semanticUnlinkedCount: semanticResults.filter((result) => (
        typeof result.metadata?.sourceId !== "string" || typeof result.metadata.summary !== "string"
      )).length,
      graphitiCount: temporalResults.length,
      graphitiAlignedCount: alignedTemporalResults.length,
      graphitiRawCount: temporalResults.filter((result) => result.origin === "graphiti_raw").length,
      graphitiRawAlignedCount: alignedTemporalResults.filter((result) => result.origin === "graphiti_raw").length,
      graphitiProvenanceCount: temporalResults.filter((result) => result.origin === "provenance_fallback").length,
      graphitiProvenanceAlignedCount: alignedTemporalResults.filter((result) => result.origin === "provenance_fallback").length,
      contextLinkCount: evidence.filter((item) => item.retrievalSource === "context_link").length,
      evidenceCount: evidence.length,
    };
    if (evidence.length === 0) {
      const answer: MemoryAnswer = {
        answerText: "I could not find a matching memory for that question.",
        traceId,
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
        traceId,
        payload: { traceId, query: input.query, parsedQuery, evidence, retrieval, answer, noEvidence: true, failureType: "no_evidence", timings: { ...timings, totalMs: Date.now() - startedAt } },
      });

      return answer;
    }

    const answerGenerationStartedAt = Date.now();
    const generatedAnswer = await this.generateAnswerWithFallback({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      parsedQuery,
      evidence,
      traceId,
    });
    timings.answerGenerationMs = Date.now() - answerGenerationStartedAt;
    appendProviderTimings(timings, this.deps.modelGateway);
    timings.totalMs = Date.now() - startedAt;
    const answer: MemoryAnswer = {
      ...generatedAnswer,
      answerText: ensureContextLinkAnswerFidelity(generatedAnswer.answerText, evidence),
      traceId,
      retrievedEvidence: evidence,
      matchedSources: evidenceBoundMatchedSources(generatedAnswer.matchedSources, evidence),
    };

    await this.deps.auditLog.record({
      type: "memory_query",
      tenantId,
      elderId: input.elderId,
      traceId,
      payload: { traceId, query: input.query, parsedQuery, evidence, retrieval, answer, timings },
    });

    return answer;
    } catch (error) {
      timings.totalMs = Date.now() - startedAt;
      appendProviderTimings(timings, this.deps.modelGateway);
      await this.deps.auditLog.record({
        type: "memory_query_failed",
        tenantId,
        elderId: input.elderId,
        traceId,
        payload: {
          traceId,
          query: input.query,
          timings,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          modelGateway: modelGatewayErrorPayload(error),
        },
      });
      throw error;
    }
  }

  private async generateAnswerWithFallback(input: {
    tenantId: string;
    elderId: string;
    query: string;
    parsedQuery: ParsedMemoryQuery;
    evidence: RetrievedEvidence[];
    traceId: string;
  }): Promise<MemoryAnswer> {
    try {
      return MemoryAnswerSchema.parse(await this.deps.modelGateway.generateMemoryAnswer({
        query: input.query,
        parsedQuery: input.parsedQuery,
        evidence: input.evidence,
        responseStyle: "elder_friendly_voice",
      }));
    } catch (error) {
      if (!(error instanceof ModelGatewayError) || error.code !== "schema_validation_error") throw error;
      const answer = buildEvidenceBoundFallbackAnswer(input.traceId, input.evidence);
      await this.deps.auditLog.record({
        type: "memory_query_answer_generation_failed",
        tenantId: input.tenantId,
        elderId: input.elderId,
        traceId: input.traceId,
        payload: {
          traceId: input.traceId,
          query: input.query,
          failureType: "answer_schema_validation_error",
          errorMessage: error.message,
          modelGateway: modelGatewayErrorPayload(error),
          providerTimings: consumeProviderTimings(this.deps.modelGateway),
          fallbackUsed: true,
          evidenceCount: input.evidence.length,
        },
      });
      return answer;
    }
  }

  private async searchTemporalFactsSafely(input: {
    tenantId: string;
    elderId: string;
    query: string;
    parsedQuery: ParsedMemoryQuery;
    traceId: string;
  }): Promise<TemporalEvidence[]> {
    if (!shouldSearchTemporalMemory(input.query, input.parsedQuery)) return [];

    try {
      return await this.deps.temporalMemory.searchFacts({
        tenantId: input.tenantId,
        elderId: input.elderId,
        groupId: buildTemporalGroupId({ tenantId: input.tenantId, elderId: input.elderId }),
        query: input.query,
        entities: input.parsedQuery.entities.map((entity) => ({ name: entity.name, type: entity.type })),
        timeRange: sanitizeTemporalTimeRange(input.parsedQuery.timeRange),
        limit: 10,
      });
    } catch (error) {
      await this.deps.auditLog.record({
        type: "graphiti_search_failed",
        tenantId: input.tenantId,
        elderId: input.elderId,
        traceId: input.traceId,
        payload: {
          traceId: input.traceId,
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

  private async searchSemanticMemorySafely(input: {
    tenantId: string;
    elderId: string;
    query: string;
    traceId: string;
  }) {
    try {
      const embedding = await this.deps.modelGateway.embedText({ text: input.query });
      return await this.deps.semanticMemory.searchMemory({
        tenantId: input.tenantId,
        elderId: input.elderId,
        query: input.query,
        embedding,
        limit: 10,
      });
    } catch (error) {
      await this.deps.auditLog.record({
        type: "semantic_memory_search_failed",
        tenantId: input.tenantId,
        elderId: input.elderId,
        traceId: input.traceId,
        payload: {
          traceId: input.traceId,
          query: input.query,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          modelGateway: modelGatewayErrorPayload(error),
          providerTimings: consumeProviderTimings(this.deps.modelGateway),
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

    const eventsById = new Map(
      (await this.deps.eventStore.getByIds({ tenantId, eventIds: linkedEventIds }))
        .map((event) => [event.id, event]),
    );

    const linkedEvidence: RetrievedEvidence[] = links.flatMap((link) => {
      if (!initialEventIds.has(link.toEventId) && !initialEventIds.has(link.fromEventId)) return [];
      const fromEvent = eventsById.get(link.fromEventId);
      const toEvent = eventsById.get(link.toEventId);
      if (!fromEvent || !toEvent) return [];
      const statusText = link.status === "active" ? "已建立" : "待确认";
      return [
        {
          sourceId: fromEvent.sourceId,
          eventId: fromEvent.id,
          createdAt: fromEvent.createdAt,
          summary: `原事项：${toEvent.summary}；补充信息：${fromEvent.summary}；关系：${link.reason}；状态：${statusText}`,
          score: clampScore(link.confidence * 0.85),
          canPlayAudio: true,
          retrievalSource: "context_link" as const,
        },
      ];
    });

    return mergeRetrievedEvidence([...evidence, ...linkedEvidence]);
  }
}

function ensureContextLinkAnswerFidelity(answerText: string, evidence: RetrievedEvidence[]): string {
  const contextEvidence = evidence.find(
    (item) => item.retrievalSource === "context_link" && item.summary.includes("原事项：") && item.summary.includes("补充信息："),
  );
  if (!contextEvidence) return answerText;

  const anchor = extractBetween(contextEvidence.summary, "原事项：", "；补充信息：");
  const detail = extractBetween(contextEvidence.summary, "补充信息：", "；关系：");
  if (hasEvidenceTermOverlap(answerText, anchor) && hasEvidenceTermOverlap(answerText, detail)) return answerText;
  return `${answerText} 补充说明：${contextEvidence.summary}`;
}

function extractBetween(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  if (startIndex < 0) return "";
  const contentStart = startIndex + start.length;
  const endIndex = value.indexOf(end, contentStart);
  return value.slice(contentStart, endIndex < 0 ? undefined : endIndex);
}

function hasEvidenceTermOverlap(answerText: string, evidenceText: string): boolean {
  const answerTerms = new Set(cjkTerms(answerText));
  const evidenceTerms = cjkTerms(evidenceText);
  if (evidenceTerms.length === 0) return true;
  let matches = 0;
  for (const term of evidenceTerms) {
    if (answerTerms.has(term)) matches += 1;
    if (matches >= 2) return true;
  }
  return false;
}

function cjkTerms(value: string): string[] {
  const chars = [...value].filter((char) => /[\p{Script=Han}]/u.test(char));
  const terms = new Set<string>();
  for (const size of [2, 3]) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      terms.add(chars.slice(index, index + size).join(""));
    }
  }
  return [...terms];
}

function buildEvidenceBoundFallbackAnswer(traceId: string, evidence: RetrievedEvidence[]): MemoryAnswer {
  const top = evidence[0];
  const confidence = top ? clampScore(top.score) : 0;
  const matchedSources = evidenceBoundMatchedSources([], evidence);
  return {
    traceId,
    answerText: top
      ? `我找到了相关记忆：${top.summary}`
      : "我没有找到可以回答这件事的记忆。",
    confidence,
    matchedSources,
    retrievedEvidence: evidence,
    suggestedActions: [],
    safetyNote: "回答来自已找到的记忆依据；如果不确定，可以再补充一句说明。",
  };
}

function sanitizeTemporalTimeRange(
  timeRange: ParsedMemoryQuery["timeRange"],
): { start: string; end: string } | undefined {
  if (!timeRange) return undefined;
  return { start: timeRange.start, end: timeRange.end };
}
