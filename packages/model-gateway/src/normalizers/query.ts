import type { ParseMemoryQueryInput } from "../index.js";
import {
  arrayValue,
  asRecord,
  booleanValue,
  isRecord,
  numberValue,
  optionalIso,
  optionalString,
  QUERY_SAFETY_TAGS,
  RELATION_QUERY_INTENTS,
} from "./common.js";
import type { JsonRecord } from "./common.js";

export function normalizeParsedMemoryQueryResult(raw: unknown, input: ParseMemoryQueryInput): unknown {
  const record = asRecord(raw);
  void input;
  const relationQueryIntent = typeof record.relationQueryIntent === "string"
    && RELATION_QUERY_INTENTS.includes(record.relationQueryIntent as (typeof RELATION_QUERY_INTENTS)[number])
    ? record.relationQueryIntent
    : "none";

  return {
    ...record,
    intent: optionalString(record.intent),
    timeRange: normalizeTimeRange(record.timeRange),
    entities: arrayValue(record.entities).map(normalizeQueryEntity).filter(isRecord),
    eventTypes: normalizeQueryEventTypes(record.eventTypes),
    safetyTags: normalizeSafetyTags(record.safetyTags),
    requiresTemporalEvidence: booleanValue(record.requiresTemporalEvidence, relationQueryIntent !== "none"),
    relationQueryIntent,
    requiresSourceEvidence: booleanValue(record.requiresSourceEvidence, true),
  };
}

function normalizeTimeRange(raw: unknown): JsonRecord | undefined {
  const record = asRecord(raw);
  const start = optionalIso(record.start);
  const end = optionalIso(record.end);
  if (!start || !end) return undefined;

  return {
    start,
    end,
    confidence: numberValue(record.confidence, 0.5),
  };
}

function normalizeQueryEntity(raw: unknown): JsonRecord | undefined {
  const record = typeof raw === "string" ? { name: raw } : asRecord(raw);
  const name = optionalString(record.name);
  if (!name) return undefined;

  return {
    type: optionalString(record.type),
    name,
    confidence: numberValue(record.confidence, 0.5),
  };
}

function normalizeQueryEventTypes(raw: unknown): string[] {
  return [
    ...new Set(
      arrayValue(raw)
        .map((item) => optionalString(item))
        .filter((item): item is string => Boolean(item)),
    ),
  ];
}

function normalizeSafetyTags(raw: unknown): Array<(typeof QUERY_SAFETY_TAGS)[number]> {
  return [
    ...new Set(
      arrayValue(raw)
        .filter((item): item is (typeof QUERY_SAFETY_TAGS)[number] => (
          typeof item === "string" && QUERY_SAFETY_TAGS.includes(item as (typeof QUERY_SAFETY_TAGS)[number])
        )),
    ),
  ];
}
