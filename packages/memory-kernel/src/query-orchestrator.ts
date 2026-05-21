import {
  DEFAULT_TENANT_ID,
  ParsedMemoryQuerySchema,
  type MemoryAnswer,
  type MemoryEvent,
  type ParsedMemoryQuery,
} from "@mem/memory-schema";
import type { RetrievedEvidence } from "@mem/model-gateway";
import {
  evidenceBoundMatchedSources,
  mergeEvidence,
} from "./retrieval.js";
import { appendProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";
import type { ElderMemoryKernelDeps, QueryMemoryInput } from "./index.js";
import { applyElderSecretaryVoice, buildEvidenceBoundFallbackAnswer, enforceQueryAnswerSafety, generateAnswerWithFallback } from "./query-answer.js";
import { alignSemanticEvidence, searchSemanticMemorySafely } from "./query-semantic.js";
import { alignTemporalEvidence, searchTemporalFactsSafely } from "./query-temporal-evidence.js";

const STRUCTURED_RECALL_LIMIT = 30;

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
    let structuredEvents = await this.deps.eventStore.search({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      types: parsedQuery.eventTypes,
      timeRange: parsedQuery.timeRange,
      entityNames: parsedQuery.entities.map((entity) => entity.name),
      limit: STRUCTURED_RECALL_LIMIT,
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

    const semanticAlignStartedAt = Date.now();
    const alignedSemantic = await alignSemanticEvidence({
      sourceStore: this.deps.sourceStore,
      eventStore: this.deps.eventStore,
      tenantId,
      elderId: input.elderId,
      semanticResults,
    });
    timings.semanticAlignMs = Date.now() - semanticAlignStartedAt;

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

    let postgresFallbackUsed = false;
    let postgresFallbackCount = 0;
    const mergeEvidenceStartedAt = Date.now();
    let evidence = mergeEvidence(structuredEvents, alignedSemantic.evidence, alignedTemporalResults, parsedQuery, input.query, now);
    timings.mergeEvidenceMs = Date.now() - mergeEvidenceStartedAt;
    let evidenceCoverage = assessEvidenceCoverage(evidence, parsedQuery, input.query);
    if (shouldUsePostgresCoverageFallback(evidenceCoverage)) {
      const postgresFallbackSearchStartedAt = Date.now();
      const fallbackEvents = await this.deps.eventStore.search({
        tenantId,
        elderId: input.elderId,
        query: input.query,
        limit: STRUCTURED_RECALL_LIMIT,
      });
      timings.postgresFallbackSearchMs = Date.now() - postgresFallbackSearchStartedAt;
      postgresFallbackUsed = true;
      postgresFallbackCount = fallbackEvents.length;
      structuredEvents = mergeEventsById([...structuredEvents, ...fallbackEvents]);

      const fallbackMergeStartedAt = Date.now();
      evidence = mergeEvidence(structuredEvents, alignedSemantic.evidence, alignedTemporalResults, parsedQuery, input.query, now);
      timings.mergeEvidenceAfterFallbackMs = Date.now() - fallbackMergeStartedAt;
      evidenceCoverage = assessEvidenceCoverage(evidence, parsedQuery, input.query);
    }

    const graphitiRawCount = temporalResults.filter((result) => result.origin === "graphiti_raw").length;
    const graphitiRawAlignedCount = alignedTemporalResults.filter((result) => result.origin === "graphiti_raw").length;
    const graphitiRawEvidenceCount = evidence.filter((item) => item.retrievalSource === "graphiti").length;
    const graphitiProvenanceCount = temporalResults.filter((result) => result.origin === "provenance_fallback").length;
    const graphitiProvenanceAlignedCount = alignedTemporalResults.filter((result) => result.origin === "provenance_fallback").length;
    const graphitiProvenanceEvidenceCount = evidence.filter((item) => item.retrievalSource === "graphiti_provenance").length;
    const retrieval = {
      postgresCount: structuredEvents.length,
      postgresFallbackUsed,
      postgresFallbackCount,
      semanticCount: semanticResults.length,
      semanticCandidateLinkedCount: alignedSemantic.candidateLinkedCount,
      semanticAlignedCount: alignedSemantic.alignedCount,
      semanticUnalignedCount: alignedSemantic.unalignedCount,
      semanticEvidenceCount: evidence.filter((item) => item.retrievalSource === "semantic").length,
      graphitiCount: temporalResults.length,
      graphitiAlignedCount: alignedTemporalResults.length,
      graphitiRawCount,
      graphitiRawAlignedCount,
      graphitiRawUnalignedCount: Math.max(0, graphitiRawCount - graphitiRawAlignedCount),
      graphitiRawEvidenceCount,
      graphitiRawDroppedByRankCount: Math.max(0, graphitiRawAlignedCount - graphitiRawEvidenceCount),
      graphitiProvenanceCount,
      graphitiProvenanceAlignedCount,
      graphitiProvenanceUnalignedCount: Math.max(0, graphitiProvenanceCount - graphitiProvenanceAlignedCount),
      graphitiProvenanceEvidenceCount,
      graphitiProvenanceDroppedByRankCount: Math.max(0, graphitiProvenanceAlignedCount - graphitiProvenanceEvidenceCount),
      contextLinkCount: 0,
      evidenceCount: evidence.length,
      evidenceCoverageRequired: evidenceCoverage.required,
      evidenceCoveragePassed: evidenceCoverage.passed,
      evidenceCoverageRequiredTerms: evidenceCoverage.requiredTerms,
      evidenceCoverageMatchedTerms: evidenceCoverage.matchedTerms,
    };
    if (evidence.length === 0 || !evidenceCoverage.passed) {
      const answer = buildNoEvidenceAnswer(traceId);
      const failureType = evidence.length === 0 ? "no_evidence" : "insufficient_evidence_coverage";

      await this.deps.auditLog.record({
        type: "memory_query",
        tenantId,
        elderId: input.elderId,
        traceId,
        payload: { traceId, query: input.query, parsedQuery, evidence, retrieval, answer, noEvidence: true, failureType, timings: { ...timings, totalMs: Date.now() - startedAt } },
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
      if (evidenceCoverage.required && evidenceCoverage.passed) {
        const fallback = buildEvidenceBoundFallbackAnswer(traceId, evidence);
        const answer = applyElderSecretaryVoice({
          ...enforceQueryAnswerSafety(fallback, evidence, parsedQuery),
          traceId,
          retrievedEvidence: evidence,
          matchedSources: evidenceBoundMatchedSources(fallback.matchedSources, evidence),
        });

        await this.deps.auditLog.record({
          type: "memory_query_answer_decline_fallback_used",
          tenantId,
          elderId: input.elderId,
          traceId,
          payload: {
            traceId,
            query: input.query,
            evidenceCount: evidence.length,
            retrieval,
            evidenceCoverage,
            answer,
          },
        });
        await this.deps.auditLog.record({
          type: "memory_query",
          tenantId,
          elderId: input.elderId,
          traceId,
          payload: { traceId, query: input.query, parsedQuery, evidence, retrieval, answer, answerDeclineFallbackUsed: true, timings },
        });

        return answer;
      }
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

type EvidenceCoverage = {
  required: boolean;
  passed: boolean;
  requiredTerms: string[];
  matchedTerms: string[];
};

function assessEvidenceCoverage(
  evidence: RetrievedEvidence[],
  parsedQuery: ParsedMemoryQuery,
  query: string,
): EvidenceCoverage {
  const required = requiresEvidenceCoverage(parsedQuery);
  if (!required) return { required, passed: true, requiredTerms: [], matchedTerms: [] };

  const requiredTerms = coverageTerms(parsedQuery, query);
  const evidenceText = evidence.map((item) => item.summary).join("\n").toLowerCase();
  const matchedTerms = requiredTerms.filter((term) => evidenceText.includes(term));
  const requiredMatchCount = requiredTerms.length === 0 ? 0 : Math.min(2, requiredTerms.length);
  const passed = requiredTerms.length === 0
    ? evidence.length > 0
    : matchedTerms.length >= requiredMatchCount;
  return { required, passed, requiredTerms, matchedTerms };
}

function requiresEvidenceCoverage(parsedQuery: ParsedMemoryQuery): boolean {
  if (parsedQuery.requiresTemporalEvidence || parsedQuery.relationQueryIntent !== "none") return true;
  return parsedQuery.safetyTags.some((tag) => (
    tag === "medical" ||
    tag === "medication" ||
    tag === "financial" ||
    tag === "fraud" ||
    tag === "identity" ||
    tag === "privacy"
  ));
}

function shouldUsePostgresCoverageFallback(coverage: EvidenceCoverage): boolean {
  return coverage.required && !coverage.passed;
}

function coverageTerms(parsedQuery: ParsedMemoryQuery, query: string): string[] {
  const entityTerms = parsedQuery.entities.flatMap((entity) => tokenizeCoverageText(entity.name));
  const terms = entityTerms.length > 0 ? entityTerms : tokenizeCoverageText(query);
  return [...new Set(terms)].slice(0, 16);
}

function tokenizeCoverageText(value: string): string[] {
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

function mergeEventsById(events: MemoryEvent[]): MemoryEvent[] {
  const byId = new Map<string, MemoryEvent>();
  for (const event of events) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()];
}
