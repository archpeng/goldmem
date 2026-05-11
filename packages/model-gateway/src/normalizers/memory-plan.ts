import type { GenerateMemoryPlanInput } from "../index.js";
import {
  arrayValue,
  asRecord,
  booleanValue,
  CONTEXT_LINK_STATUSES,
  CONTEXT_LINK_TYPES,
  ENTITY_TYPES,
  enumValue,
  EVENT_TYPES,
  FAMILY_TASK_TYPES,
  inferEntityType,
  inferEventType,
  inferRequiresConfirmation,
  inferRequiresFamilyReview,
  inferRiskLevel,
  inferRiskType,
  inferSeverity,
  integerValue,
  isRecord,
  MEMORY_UPDATE_OPERATIONS,
  MEMORY_UPDATE_TARGETS,
  numberValue,
  optionalIso,
  optionalString,
  RISK_LEVELS,
  RISK_TYPES,
  SEVERITIES,
  stringValue,
  UNCERTAINTY_ACTIONS,
  URGENCIES,
  VISIBILITIES,
} from "./common.js";
import type { JsonRecord } from "./common.js";

export function normalizeMemoryPlanResult(
  raw: unknown,
  input: GenerateMemoryPlanInput,
  model: string,
  promptVersion: string,
): unknown {
  const record = asRecord(raw);
  const summary = stringValue(record.summary, input.transcript.slice(0, 240));
  const events = arrayValue(record.events).map((event) => normalizeEventDraft(event, input)).filter(isRecord);

  return {
    ...record,
    sourceId: stringValue(record.sourceId, input.sourceId),
    elderId: stringValue(record.elderId, input.elderId),
    summary,
    events,
    reminderCandidates: arrayValue(record.reminderCandidates)
      .map((reminder) => normalizeReminderDraft(reminder, events.length))
      .filter(isRecord),
    riskFlags: arrayValue(record.riskFlags).map((risk) => normalizeRiskFlag(risk, input)).filter(isRecord),
    familyTasks: arrayValue(record.familyTasks).map(normalizeFamilyTask).filter(isRecord),
    contextLinks: arrayValue(record.contextLinks)
      .map((link) => normalizeContextLink(link, input, events.length))
      .filter(isRecord),
    memoryUpdates: arrayValue(record.memoryUpdates).map(normalizeMemoryUpdate).filter(isRecord),
    uncertainties: arrayValue(record.uncertainties).map(normalizeUncertainty).filter(isRecord),
    evidence: normalizeEvidenceRefs(record.evidence, input, false),
    modelInfo: {
      provider: stringValue(asRecord(record.modelInfo).provider, "openai-compatible"),
      model: stringValue(asRecord(record.modelInfo).model, model),
      promptVersion: stringValue(asRecord(record.modelInfo).promptVersion, promptVersion),
    },
    confidence: numberValue(record.confidence, 0.5),
  };
}

function normalizeEventDraft(raw: unknown, input: GenerateMemoryPlanInput): JsonRecord | undefined {
  const record = typeof raw === "string" ? { summary: raw, title: raw } : asRecord(raw);
  const summary = stringValue(record.summary, stringValue(record.title, input.transcript.slice(0, 240)));
  const title = stringValue(record.title, summary.slice(0, 80) || "Memory note");
  const textForInference = `${title} ${summary} ${input.transcript}`;

  return {
    ...record,
    type: enumValue(record.type, EVENT_TYPES, inferEventType(textForInference)),
    title,
    summary,
    timeText: optionalString(record.timeText),
    eventTimeStart: optionalIso(record.eventTimeStart),
    eventTimeEnd: optionalIso(record.eventTimeEnd),
    timeConfidence: numberValue(record.timeConfidence, 0.5),
    entities: arrayValue(record.entities).map(normalizeEntity).filter(isRecord),
    importance: numberValue(record.importance, 0.5),
    confidence: numberValue(record.confidence, 0.5),
    riskLevel: enumValue(record.riskLevel, RISK_LEVELS, inferRiskLevel(textForInference)),
    requiresConfirmation: booleanValue(record.requiresConfirmation, inferRequiresConfirmation(textForInference)),
    visibility: enumValue(record.visibility, VISIBILITIES, "private"),
    evidence: normalizeEvidenceRefs(record.evidence, input, true),
  };
}

function normalizeReminderDraft(raw: unknown, eventCount: number): JsonRecord | undefined {
  const record = typeof raw === "string" ? { title: raw } : asRecord(raw);
  const title = stringValue(record.title, stringValue(record.description, ""));
  if (!title) return undefined;

  const relatedEventIndex = integerValue(record.relatedEventIndex);

  return {
    ...record,
    title,
    description: optionalString(record.description),
    timeText: optionalString(record.timeText),
    remindAt: optionalIso(record.remindAt),
    timeConfidence: numberValue(record.timeConfidence, 0.5),
    relatedEventIndex: relatedEventIndex !== undefined && relatedEventIndex < eventCount ? relatedEventIndex : undefined,
    confirmationRequired: booleanValue(record.confirmationRequired, true),
    suggestedConfirmers: arrayValue(record.suggestedConfirmers).map(normalizeSuggestedConfirmer).filter(isRecord),
    confidence: numberValue(record.confidence, 0.5),
    reason: stringValue(record.reason, "Reminder candidate extracted from elder note."),
  };
}

function normalizeRiskFlag(raw: unknown, input: GenerateMemoryPlanInput): JsonRecord | undefined {
  const record = typeof raw === "string" ? { summary: raw, reason: raw } : asRecord(raw);
  const summary = stringValue(record.summary, stringValue(record.reason, ""));
  if (!summary) return undefined;
  const textForInference = `${summary} ${stringValue(record.reason, "")}`;

  return {
    ...record,
    type: enumValue(record.type, RISK_TYPES, inferRiskType(textForInference)),
    severity: enumValue(record.severity, SEVERITIES, inferSeverity(textForInference)),
    summary,
    reason: stringValue(record.reason, summary),
    requiresFamilyReview: booleanValue(record.requiresFamilyReview, inferRequiresFamilyReview(textForInference)),
    requiresHumanConfirmation: booleanValue(record.requiresHumanConfirmation, true),
    evidence: normalizeEvidenceRefs(record.evidence, input, true),
  };
}

function normalizeFamilyTask(raw: unknown): JsonRecord | undefined {
  const record = typeof raw === "string" ? { title: raw, summary: raw } : asRecord(raw);
  const title = stringValue(record.title, stringValue(record.summary, ""));
  if (!title) return undefined;

  return {
    ...record,
    type: enumValue(record.type, FAMILY_TASK_TYPES, "general_review"),
    title,
    summary: stringValue(record.summary, title),
    urgency: enumValue(record.urgency, URGENCIES, "medium"),
    visibility: enumValue(record.visibility, VISIBILITIES, "family_required"),
    relatedEventIndex: integerValue(record.relatedEventIndex),
  };
}

function normalizeMemoryUpdate(raw: unknown): JsonRecord | undefined {
  const record = typeof raw === "string" ? { content: raw } : asRecord(raw);
  const content = stringValue(record.content, "");
  if (!content) return undefined;

  return {
    ...record,
    target: enumValue(record.target, MEMORY_UPDATE_TARGETS, "semantic_memory"),
    path: optionalString(record.path),
    operation: enumValue(record.operation, MEMORY_UPDATE_OPERATIONS, "add"),
    content,
    metadata: isRecord(record.metadata) ? record.metadata : {},
  };
}

function normalizeContextLink(raw: unknown, input: GenerateMemoryPlanInput, eventCount: number): JsonRecord | undefined {
  const record = asRecord(raw);
  const fromEventIndex = integerValue(record.fromEventIndex);
  if (fromEventIndex === undefined || fromEventIndex >= eventCount) return undefined;

  const toEventIndex = integerValue(record.toEventIndex);
  const toEventId = optionalString(record.toEventId);
  const reason = stringValue(record.reason, "Related context proposed from the transcript and recent context.");

  return {
    ...record,
    fromEventIndex,
    toEventId,
    toEventIndex: toEventIndex !== undefined && toEventIndex < eventCount ? toEventIndex : undefined,
    reminderId: optionalString(record.reminderId),
    type: enumValue(record.type, CONTEXT_LINK_TYPES, "possibly_related"),
    confidence: numberValue(record.confidence, 0.5),
    status: enumValue(record.status, CONTEXT_LINK_STATUSES, "needs_confirmation"),
    reason,
    evidence: normalizeEvidenceRefs(record.evidence, input, true),
  };
}

function normalizeUncertainty(raw: unknown): JsonRecord | undefined {
  const record = typeof raw === "string" ? { description: raw } : asRecord(raw);
  const description = stringValue(record.description, "");
  if (!description) return undefined;

  return {
    ...record,
    field: stringValue(record.field, "general"),
    description,
    suggestedAction: enumValue(record.suggestedAction, UNCERTAINTY_ACTIONS, "review_later"),
  };
}

function normalizeEntity(raw: unknown): JsonRecord | undefined {
  const record = typeof raw === "string" ? { name: raw } : asRecord(raw);
  const name = stringValue(record.name, "");
  if (!name) return undefined;

  return {
    ...record,
    type: enumValue(record.type, ENTITY_TYPES, inferEntityType(name)),
    name,
    aliases: arrayValue(record.aliases).map((alias) => stringValue(alias, "")).filter(Boolean),
    confidence: numberValue(record.confidence, 0.5),
  };
}

function normalizeSuggestedConfirmer(raw: unknown): JsonRecord | undefined {
  const record = typeof raw === "string" ? { personName: raw } : asRecord(raw);
  const personName = optionalString(record.personName ?? record.name);
  const role = enumValue(record.role, ["elder", "family"] as const, personName === "elder" ? "elder" : "family");

  return {
    role,
    personName: role === "family" ? personName : undefined,
  };
}

function normalizeEvidenceRefs(
  raw: unknown,
  input: GenerateMemoryPlanInput,
  requireOne: boolean,
): JsonRecord[] {
  const refs = arrayValue(raw)
    .map((item) => normalizeEvidenceRef(item, input.sourceId))
    .filter(isRecord);
  if (refs.length > 0 || !requireOne) return refs;
  return [];
}

function normalizeEvidenceRef(raw: unknown, sourceId: string): JsonRecord | undefined {
  if (typeof raw === "string") {
    return {
      sourceId,
      quote: raw,
    };
  }

  const record = asRecord(raw);
  const normalizedSourceId = stringValue(record.sourceId, sourceId);
  if (!normalizedSourceId) return undefined;

  return {
    sourceId: normalizedSourceId,
    quote: optionalString(record.quote),
    startChar: integerValue(record.startChar),
    endChar: integerValue(record.endChar),
    audioStartMs: integerValue(record.audioStartMs),
    audioEndMs: integerValue(record.audioEndMs),
  };
}
