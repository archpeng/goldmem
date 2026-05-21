import { MemoryAnswerSchema, toElderSecretaryVoiceText, type MemoryAnswer, type ParsedMemoryQuery } from "@mem/memory-schema";
import { ModelGatewayError, type ModelGateway, type RetrievedEvidence } from "@mem/model-gateway";
import type { AuditLog } from "@mem/memory-store";
import { clampScore, evidenceBoundMatchedSources } from "./retrieval.js";
import { consumeProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";

export async function generateAnswerWithFallback(input: {
  modelGateway: ModelGateway;
  auditLog: AuditLog;
  tenantId: string;
  elderId: string;
  query: string;
  parsedQuery: ParsedMemoryQuery;
  evidence: RetrievedEvidence[];
  traceId: string;
}): Promise<MemoryAnswer> {
  try {
    return MemoryAnswerSchema.parse(await input.modelGateway.generateMemoryAnswer({
      query: input.query,
      parsedQuery: input.parsedQuery,
      evidence: input.evidence,
      responseStyle: "elder_friendly_voice",
    }));
  } catch (error) {
    if (!(error instanceof ModelGatewayError) || error.code !== "schema_validation_error") throw error;
    const answer = buildEvidenceBoundFallbackAnswer(input.traceId, input.evidence);
    await input.auditLog.record({
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
        providerTimings: consumeProviderTimings(input.modelGateway),
        fallbackUsed: true,
        evidenceCount: input.evidence.length,
      },
    });
    return answer;
  }
}

export function enforceQueryAnswerSafety(
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

export function applyElderSecretaryVoice(answer: MemoryAnswer): MemoryAnswer {
  return {
    ...answer,
    answerText: elderSecretaryText(answer.answerText),
    matchedSources: answer.matchedSources.map((source) => ({
      ...source,
      summary: elderSecretaryText(source.summary),
    })),
    retrievedEvidence: answer.retrievedEvidence.map((item) => ({
      ...item,
      summary: elderSecretaryText(item.summary),
    })),
    safetyNote: answer.safetyNote ? elderSecretaryText(answer.safetyNote) : undefined,
  };
}

export function buildEvidenceBoundFallbackAnswer(traceId: string, evidence: RetrievedEvidence[]): MemoryAnswer {
  const top = evidence[0];
  const confidence = top ? clampScore(top.score) : 0;
  const matchedSources = evidenceBoundMatchedSources([], evidence);
  return applyElderSecretaryVoice({
    traceId,
    answerText: top
      ? `我找到了相关记忆：${top.summary}`
      : "我没有找到可以回答这件事的记忆。",
    confidence,
    matchedSources,
    retrievedEvidence: evidence,
    suggestedActions: [],
    safetyNote: "回答来自已找到的记忆依据；如果不确定，可以再补充一句说明。",
  });
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

function elderSecretaryText(text: string): string {
  return toElderSecretaryVoiceText(text);
}
