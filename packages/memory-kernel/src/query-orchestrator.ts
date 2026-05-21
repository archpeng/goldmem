import {
  DEFAULT_TENANT_ID,
  type MemoryAnswer,
} from "@mem/memory-schema";
import { evidenceBoundMatchedSources } from "./retrieval.js";
import { appendProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";
import type { ElderMemoryKernelDeps, QueryMemoryInput } from "./index.js";
import { applyElderSecretaryVoice, buildEvidenceBoundFallbackAnswer, enforceQueryAnswerSafety, generateAnswerWithFallback } from "./query-answer.js";
import { buildNoEvidenceAnswer, isNoEvidenceAnswer } from "./query-no-evidence.js";
import { collectQueryRecall } from "./query-recall.js";

export class QueryOrchestrator {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async queryMemory(input: QueryMemoryInput, traceId: string): Promise<MemoryAnswer> {
    const startedAt = Date.now();
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const now = input.now ?? new Date().toISOString();
    try {
      const recall = await collectQueryRecall(this.deps, input, traceId, now);
      const timings = { ...recall.timings };

      if (recall.evidence.length === 0 || !recall.evidenceCoverage.passed) {
      const answer = buildNoEvidenceAnswer(traceId);
      const failureType = recall.evidence.length === 0 ? "no_evidence" : "insufficient_evidence_coverage";

      await this.deps.auditLog.record({
        type: "memory_query",
        tenantId,
        elderId: input.elderId,
        traceId,
        payload: {
          traceId,
          query: input.query,
          parsedQuery: recall.parsedQuery,
          evidence: recall.evidence,
          retrieval: recall.retrieval,
          answer,
          noEvidence: true,
          failureType,
          timings: { ...timings, totalMs: Date.now() - startedAt },
        },
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
      parsedQuery: recall.parsedQuery,
      evidence: recall.evidence,
      traceId,
    });
    timings.answerGenerationMs = Date.now() - answerGenerationStartedAt;
    appendProviderTimings(timings, this.deps.modelGateway);
    timings.totalMs = Date.now() - startedAt;
    if (isNoEvidenceAnswer(generatedAnswer)) {
      if (recall.evidenceCoverage.required && recall.evidenceCoverage.passed) {
        const fallback = buildEvidenceBoundFallbackAnswer(traceId, recall.evidence);
        const answer = applyElderSecretaryVoice({
          ...enforceQueryAnswerSafety(fallback, recall.evidence, recall.parsedQuery),
          traceId,
          retrievedEvidence: recall.evidence,
          matchedSources: evidenceBoundMatchedSources(fallback.matchedSources, recall.evidence),
        });

        await this.deps.auditLog.record({
          type: "memory_query_answer_decline_fallback_used",
          tenantId,
          elderId: input.elderId,
          traceId,
          payload: {
            traceId,
            query: input.query,
            evidenceCount: recall.evidence.length,
            retrieval: recall.retrieval,
            evidenceCoverage: recall.evidenceCoverage,
            answer,
          },
        });
        await this.deps.auditLog.record({
          type: "memory_query",
          tenantId,
          elderId: input.elderId,
          traceId,
          payload: {
            traceId,
            query: input.query,
            parsedQuery: recall.parsedQuery,
            evidence: recall.evidence,
            retrieval: recall.retrieval,
            answer,
            answerDeclineFallbackUsed: true,
            timings,
          },
        });

        return answer;
      }
      const answer = buildNoEvidenceAnswer(traceId);

      await this.deps.auditLog.record({
        type: "memory_query",
        tenantId,
        elderId: input.elderId,
        traceId,
        payload: {
          traceId,
          query: input.query,
          parsedQuery: recall.parsedQuery,
          evidence: recall.evidence,
          retrieval: recall.retrieval,
          answer,
          noEvidence: true,
          failureType: "answer_declined_evidence",
          timings,
        },
      });

      return answer;
    }

    const safetyCheckedAnswer = enforceQueryAnswerSafety(generatedAnswer, recall.evidence, recall.parsedQuery);
    const answer: MemoryAnswer = applyElderSecretaryVoice({
      ...safetyCheckedAnswer,
      traceId,
      retrievedEvidence: recall.evidence,
      matchedSources: evidenceBoundMatchedSources(safetyCheckedAnswer.matchedSources, recall.evidence),
    });

    await this.deps.auditLog.record({
      type: "memory_query",
      tenantId,
      elderId: input.elderId,
      traceId,
      payload: {
        traceId,
        query: input.query,
        parsedQuery: recall.parsedQuery,
        evidence: recall.evidence,
        retrieval: recall.retrieval,
        answer,
        timings,
      },
    });

    return answer;
    } catch (error) {
      const timings: Record<string, unknown> = { totalMs: Date.now() - startedAt };
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
