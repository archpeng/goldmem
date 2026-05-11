import type { GenerateMemoryAnswerInput, RetrievedEvidence } from "../index.js";
import {
  arrayValue,
  asRecord,
  booleanValue,
  clamp01,
  enumValue,
  isRecord,
  optionalIso,
  optionalNumberValue,
  optionalString,
  stringValue,
} from "./common.js";
import type { JsonRecord } from "./common.js";

export function normalizeMemoryAnswerResult(raw: unknown, input: GenerateMemoryAnswerInput): unknown {
  const record = asRecord(raw);

  return {
    ...record,
    answerText: extractAnswerText(record),
    confidence: optionalNumberValue(record.confidence ?? record.score ?? record.certainty) ?? defaultAnswerConfidence(input.evidence),
    matchedSources: normalizeMatchedSources(record.matchedSources, input.evidence),
    suggestedActions: arrayValue(record.suggestedActions).map(normalizeSuggestedAction).filter(isRecord),
    safetyNote: optionalString(record.safetyNote),
  };
}

function extractAnswerText(record: JsonRecord): string | undefined {
  const direct = optionalString(record.answerText ?? record.text ?? record.response);
  if (direct) return direct;

  const answer = record.answer;
  if (typeof answer === "string") return optionalString(answer);
  const nested = asRecord(answer);
  return optionalString(nested.answerText ?? nested.text ?? nested.summary ?? nested.response);
}

function defaultAnswerConfidence(evidence: RetrievedEvidence[]): number {
  if (evidence.length === 0) return 0.5;
  return clamp01(Math.max(...evidence.map((item) => item.score), 0.5));
}

function normalizeMatchedSources(raw: unknown, evidence: RetrievedEvidence[]): JsonRecord[] {
  const normalized = arrayValue(raw).map((item) => normalizeMatchedSource(item, evidence)).filter(isRecord);
  if (normalized.length > 0) return normalized;

  return evidence.map((item) => ({
    sourceId: item.sourceId,
    createdAt: item.createdAt,
    summary: item.summary,
    canPlayAudio: item.canPlayAudio,
    retrievalSource: item.retrievalSource,
  }));
}

function normalizeMatchedSource(raw: unknown, evidence: RetrievedEvidence[]): JsonRecord | undefined {
  if (typeof raw === "string") {
    const matched = evidence.find((item) => item.sourceId === raw);
    if (!matched) return undefined;
    return {
      sourceId: matched.sourceId,
      createdAt: matched.createdAt,
      summary: matched.summary,
      canPlayAudio: matched.canPlayAudio,
      retrievalSource: matched.retrievalSource,
    };
  }

  const record = asRecord(raw);
  const sourceId = stringValue(record.sourceId, "");
  if (!sourceId) return undefined;
  const matched = evidence.find((item) => item.sourceId === sourceId);
  if (!matched) return undefined;

  return {
    sourceId,
    createdAt: optionalIso(record.createdAt) ?? matched.createdAt,
    summary: stringValue(record.summary, matched.summary),
    canPlayAudio: booleanValue(record.canPlayAudio, matched.canPlayAudio),
    retrievalSource: enumValue(
      record.retrievalSource,
      ["postgres", "mem0", "context_link", "graphiti"] as const,
      matched.retrievalSource,
    ),
  };
}

function normalizeSuggestedAction(raw: unknown): JsonRecord | undefined {
  if (typeof raw === "string") return undefined;
  const record = asRecord(raw);
  const type = optionalString(record.type);

  if (type === "play_audio") {
    const sourceId = stringValue(record.sourceId, "");
    return sourceId ? { type, sourceId } : undefined;
  }

  if (type === "create_reminder" || type === "ask_family_confirm") {
    const title = stringValue(record.title, "");
    return title ? { type, title } : undefined;
  }

  return undefined;
}
