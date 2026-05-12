import type { ParseMemoryQueryInput } from "../index.js";
import {
  arrayValue,
  asRecord,
  booleanValue,
  ENTITY_TYPES,
  enumValue,
  EVENT_TYPES,
  inferEntityType,
  inferEventType,
  inferQueryIntent,
  isRecord,
  numberValue,
  optionalIso,
  QUERY_SAFETY_TAGS,
  QUERY_INTENTS,
  stringValue,
} from "./common.js";
import type { JsonRecord } from "./common.js";

export function normalizeParsedMemoryQueryResult(raw: unknown, input: ParseMemoryQueryInput): unknown {
  const record = asRecord(raw);

  return {
    ...record,
    intent: enumValue(record.intent, QUERY_INTENTS, inferQueryIntent(input.query)),
    timeRange: normalizeTimeRange(record.timeRange),
    entities: arrayValue(record.entities).map(normalizeQueryEntity).filter(isRecord),
    eventTypes: normalizeQueryEventTypes(record.eventTypes, input.query),
    safetyTags: normalizeSafetyTags(record.safetyTags),
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
  const name = stringValue(record.name, "");
  if (!name) return undefined;

  return {
    type: enumValue(record.type, ENTITY_TYPES, inferEntityType(name)),
    name,
    confidence: numberValue(record.confidence, 0.5),
  };
}

function normalizeQueryEventTypes(raw: unknown, query: string): Array<(typeof EVENT_TYPES)[number]> {
  const normalizedTypes = arrayValue(raw)
    .map((item) => normalizeEventTypeValue(item))
    .filter((item): item is (typeof EVENT_TYPES)[number] => item !== undefined);

  if (normalizedTypes.length > 0) return [...new Set(normalizedTypes)];
  return [inferEventType(query)];
}

function normalizeEventTypeValue(value: unknown): (typeof EVENT_TYPES)[number] | undefined {
  if (typeof value !== "string") return undefined;
  if (EVENT_TYPES.includes(value as (typeof EVENT_TYPES)[number])) return value as (typeof EVENT_TYPES)[number];

  const normalized = value.trim().toLowerCase();
  if (["purchase", "errand", "grocery", "groceries"].includes(normalized)) return "shopping";
  if (["medical", "doctor"].includes(normalized)) return "health";
  if (["money", "payment", "banking"].includes(normalized)) return "finance";
  return undefined;
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
