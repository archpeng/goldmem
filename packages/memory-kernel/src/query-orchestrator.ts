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
    const evidence = mergeEvidence(structuredEvents, semanticResults, alignedTemporalResults, parsedQuery, input.query, now);
    timings.mergeEvidenceMs = Date.now() - mergeEvidenceStartedAt;

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
      contextLinkCount: 0,
      evidenceCount: evidence.length,
    };
    if (evidence.length === 0) {
      const answer: MemoryAnswer = {
        answerText: "我没有找到可以回答这件事的记忆。",
        traceId,
        confidence: 0,
        matchedSources: [],
        retrievedEvidence: [],
        suggestedActions: [],
        safetyNote: "没有找到可引用的来源依据。",
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
    const safetyCheckedAnswer = enforceQueryAnswerSafety(generatedAnswer, evidence, parsedQuery);
    const answer: MemoryAnswer = {
      ...safetyCheckedAnswer,
      traceId,
      retrievedEvidence: evidence,
      matchedSources: evidenceBoundMatchedSources(safetyCheckedAnswer.matchedSources, evidence),
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

    return candidates.flatMap((result) => {
      if (!result.sourceId || !validSourceIds.has(result.sourceId)) return [];
      if (result.eventId) {
        const event = validEventsById.get(result.eventId);
        if (!event || event.sourceId !== result.sourceId) return [];
        return [{ ...result, metadata: { ...result.metadata, eventType: event.type, riskLevel: event.riskLevel, requiresConfirmation: event.requiresConfirmation } }];
      }
      return isString(result.episodeId) ? [result] : [];
    });
  }

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

function enforceQueryAnswerSafety(
  answer: MemoryAnswer,
  evidence: RetrievedEvidence[],
  parsedQuery: ParsedMemoryQuery,
): MemoryAnswer {
  const note = querySafetyNote(parsedQuery, evidence);
  if (!note) return answer;
  return {
    ...answer,
    answerText: answer.answerText.includes(note) ? answer.answerText : `${answer.answerText} ${note}`,
    safetyNote: appendSafetyNote(answer.safetyNote, note),
  };
}

function querySafetyNote(
  parsedQuery: ParsedMemoryQuery,
  evidence: RetrievedEvidence[],
): string | undefined {
  const tags = new Set(parsedQuery.safetyTags);
  const risks = new Set(evidence.map((item) => item.riskLevel).filter(Boolean));
  const eventTypes = new Set(evidence.map((item) => item.eventType).filter(Boolean));
  if (tags.has("fraud") || tags.has("identity") || tags.has("financial") || tags.has("privacy") || risks.has("fraud_risk") || risks.has("financial") || eventTypes.has("finance")) {
    return "请先不要发送身份证号、验证码、密码或转账信息，最好让家人先帮你确认。";
  }
  if (tags.has("medical") || tags.has("medication") || risks.has("medical") || eventTypes.has("health") || eventTypes.has("medication")) {
    return "涉及医疗或用药的信息，请先按医生或家人确认过的安排处理。";
  }
  return undefined;
}

function appendSafetyNote(current: string | undefined, note: string): string {
  if (!current) return note;
  if (current.includes(note)) return current;
  return `${current} ${note}`;
}

function sanitizeTemporalTimeRange(
  timeRange: ParsedMemoryQuery["timeRange"],
): { start: string; end: string } | undefined {
  if (!timeRange) return undefined;
  return { start: timeRange.start, end: timeRange.end };
}
