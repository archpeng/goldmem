import {
  DEFAULT_TENANT_ID,
  ParsedMemoryQuerySchema,
  type MemoryAnswer,
} from "@mem/memory-schema";
import {
  evidenceBoundMatchedSources,
  mergeEvidence,
} from "./retrieval.js";
import { appendProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";
import type { ElderMemoryKernelDeps, QueryMemoryInput } from "./index.js";
import { applyElderSecretaryVoice, enforceQueryAnswerSafety, generateAnswerWithFallback } from "./query-answer.js";
import { searchSemanticMemorySafely } from "./query-semantic.js";
import { alignTemporalEvidence, searchTemporalFactsSafely } from "./query-temporal-evidence.js";

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
    const semanticResults = await searchSemanticMemorySafely({
      semanticMemory: this.deps.semanticMemory,
      modelGateway: this.deps.modelGateway,
      auditLog: this.deps.auditLog,
      tenantId,
      elderId: input.elderId,
      query: input.query,
      traceId,
    });
    timings.semanticSearchMs = Date.now() - semanticSearchStartedAt;
    appendProviderTimings(timings, this.deps.modelGateway);

    const temporalSearchStartedAt = Date.now();
    const temporalResults = await searchTemporalFactsSafely({
      temporalMemory: this.deps.temporalMemory,
      auditLog: this.deps.auditLog,
      tenantId,
      elderId: input.elderId,
      query: input.query,
      parsedQuery,
      traceId,
    });
    timings.temporalSearchMs = Date.now() - temporalSearchStartedAt;

    const temporalAlignStartedAt = Date.now();
    const alignedTemporalResults = await alignTemporalEvidence({
      sourceStore: this.deps.sourceStore,
      eventStore: this.deps.eventStore,
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
      graphitiRawEvidenceCount: evidence.filter((item) => item.retrievalSource === "graphiti").length,
      graphitiProvenanceEvidenceCount: evidence.filter((item) => item.retrievalSource === "graphiti_provenance").length,
      contextLinkCount: 0,
      evidenceCount: evidence.length,
    };
    if (evidence.length === 0) {
      const answer = buildNoEvidenceAnswer(traceId);

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
    const generatedAnswer = await generateAnswerWithFallback({
      modelGateway: this.deps.modelGateway,
      auditLog: this.deps.auditLog,
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
    if (isNoEvidenceAnswer(generatedAnswer)) {
      const answer = buildNoEvidenceAnswer(traceId);

      await this.deps.auditLog.record({
        type: "memory_query",
        tenantId,
        elderId: input.elderId,
        traceId,
        payload: { traceId, query: input.query, parsedQuery, evidence, retrieval, answer, noEvidence: true, failureType: "answer_declined_evidence", timings },
      });

      return answer;
    }

    const safetyCheckedAnswer = enforceQueryAnswerSafety(generatedAnswer, evidence, parsedQuery);
    const answer: MemoryAnswer = applyElderSecretaryVoice({
      ...safetyCheckedAnswer,
      traceId,
      retrievedEvidence: evidence,
      matchedSources: evidenceBoundMatchedSources(safetyCheckedAnswer.matchedSources, evidence),
    });

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

}

function buildNoEvidenceAnswer(traceId: string): MemoryAnswer {
  return {
    answerText: "我没有找到可以回答这件事的记忆。",
    traceId,
    confidence: 0,
    matchedSources: [],
    retrievedEvidence: [],
    suggestedActions: [],
    safetyNote: "没有找到可引用的来源依据。",
  };
}

function isNoEvidenceAnswer(answer: MemoryAnswer): boolean {
  if (answer.confidence > 0.4) return false;
  if (/但是|但我找到了|但有|不过我找到了|however|but/i.test(answer.answerText)) return false;
  return /没有找到|没找到|未找到|没有记录|没有相关|not find|not found/i.test(answer.answerText);
}
