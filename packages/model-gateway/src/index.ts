import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import OpenAI from "openai";
import {
  MemoryAnswerSchema,
  MemoryPlanSchema,
  ParsedMemoryQuerySchema,
  type MemoryAnswer,
  type MemoryPlan,
  type ParsedMemoryQuery,
} from "@goldmem/memory-schema";

export type TranscriptionResult = {
  text: string;
  confidence?: number;
  language?: string;
};

export type GenerateMemoryPlanInput = {
  transcript: string;
  sourceId: string;
  elderId: string;
  createdAt: string;
  context: PersonalContext;
};

export type GenerateMemoryAnswerInput = {
  query: string;
  parsedQuery: ParsedMemoryQuery;
  evidence: RetrievedEvidence[];
  responseStyle: "elder_friendly_voice" | "family_summary";
};

export type ParseMemoryQueryInput = {
  elderId: string;
  query: string;
  now: string;
  context: PersonalContext;
};

export type RetrievedEvidence = {
  sourceId: string;
  eventId?: string;
  createdAt: string;
  summary: string;
  transcriptQuote?: string;
  score: number;
  canPlayAudio: boolean;
  retrievalSource: "postgres" | "mem0" | "context_link";
};

export type PersonalContext = {
  elderProfile?: Record<string, unknown>;
  recentEvents: Array<{ eventId?: string; sourceId?: string; title: string; summary: string; createdAt: string }>;
  openReminders?: Array<{
    reminderId: string;
    eventId?: string;
    title: string;
    reason: string;
    timeText?: string;
    remindAt?: string;
    timeConfidence?: number;
    status: string;
  }>;
  semanticMemories: Array<{ memory: string; score?: number }>;
  knownEntities: Array<{ type: string; name: string; aliases?: string[] }>;
  familyRelations: Array<{ name: string; relationship: string; userId?: string }>;
  safetyPolicy: string[];
};

export interface ModelGateway {
  transcribe(audio: Uint8Array): Promise<TranscriptionResult>;
  generateMemoryPlan(input: GenerateMemoryPlanInput): Promise<MemoryPlan>;
  parseMemoryQuery(input: ParseMemoryQueryInput): Promise<ParsedMemoryQuery>;
  generateMemoryAnswer(input: GenerateMemoryAnswerInput): Promise<MemoryAnswer>;
}

export class NotImplementedModelGateway implements ModelGateway {
  async transcribe(): Promise<TranscriptionResult> {
    throw new Error("ModelGateway.transcribe is not implemented");
  }

  async generateMemoryPlan(): Promise<MemoryPlan> {
    throw new Error("ModelGateway.generateMemoryPlan is not implemented");
  }

  async parseMemoryQuery(): Promise<ParsedMemoryQuery> {
    throw new Error("ModelGateway.parseMemoryQuery is not implemented");
  }

  async generateMemoryAnswer(): Promise<MemoryAnswer> {
    throw new Error("ModelGateway.generateMemoryAnswer is not implemented");
  }
}

export type ModelGatewayErrorCode =
  | "provider_error"
  | "schema_validation_error"
  | "empty_evidence_error"
  | "unsafe_output_error";

export class ModelGatewayError extends Error {
  constructor(
    readonly code: ModelGatewayErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ModelGatewayError";
  }
}

export type OpenAIModelGatewayOptions = {
  apiKey: string;
  model: string;
  baseURL?: string;
  transcriptionModel?: string;
  promptsDir?: string;
  promptVersion?: string;
};

export class OpenAIModelGateway implements ModelGateway {
  private readonly client: OpenAI;
  private readonly promptVersion: string;

  constructor(private readonly options: OpenAIModelGatewayOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
    this.promptVersion = options.promptVersion ?? "v1";
  }

  async transcribe(audio: Uint8Array): Promise<TranscriptionResult> {
    try {
      const file = new File([Buffer.from(audio)], "audio.wav", { type: "audio/wav" });
      const transcription = await this.client.audio.transcriptions.create({
        file,
        model: this.options.transcriptionModel ?? "whisper-1",
        response_format: "json",
      });

      return {
        text: transcription.text,
      };
    } catch (error) {
      throw new ModelGatewayError("provider_error", "OpenAI transcription failed", error);
    }
  }

  async generateMemoryPlan(input: GenerateMemoryPlanInput): Promise<MemoryPlan> {
    const prompt = await this.loadPrompt("extract-memory-plan.md");
    const result = await this.completeJson(prompt, {
      ...input,
      promptVersion: this.promptVersion,
    });
    const normalized = normalizeMemoryPlanResult(result, input, this.options.model, this.promptVersion);

    try {
      return MemoryPlanSchema.parse(normalized);
    } catch (error) {
      throw new ModelGatewayError("schema_validation_error", "OpenAI MemoryPlan output failed schema validation", error);
    }
  }

  async parseMemoryQuery(input: ParseMemoryQueryInput): Promise<ParsedMemoryQuery> {
    const prompt = await this.loadPrompt("query-memory.md");
    const result = await this.completeJson(prompt, input);
    const normalized = normalizeParsedMemoryQueryResult(result, input);

    try {
      return ParsedMemoryQuerySchema.parse(normalized);
    } catch (error) {
      throw new ModelGatewayError("schema_validation_error", "OpenAI query parse output failed schema validation", error);
    }
  }

  async generateMemoryAnswer(input: GenerateMemoryAnswerInput): Promise<MemoryAnswer> {
    if (input.evidence.length === 0) {
      throw new ModelGatewayError("empty_evidence_error", "Cannot generate memory answer without evidence");
    }

    const prompt = await this.loadPrompt("answer-memory-query.md");
    const result = await this.completeJson(prompt, input);
    const normalized = normalizeMemoryAnswerResult(result, input);

    try {
      return MemoryAnswerSchema.parse(normalized);
    } catch (error) {
      throw new ModelGatewayError("schema_validation_error", "OpenAI answer output failed schema validation", error);
    }
  }

  private async completeJson(systemPrompt: string, input: unknown): Promise<unknown> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(input) },
        ],
      });

      const content = response.choices[0]?.message.content;
      if (!content) {
        throw new ModelGatewayError("provider_error", "OpenAI returned an empty response");
      }

      return JSON.parse(content) as unknown;
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError("provider_error", "OpenAI JSON completion failed", error);
    }
  }

  private async loadPrompt(filename: string): Promise<string> {
    const promptsDir = this.options.promptsDir ?? join(process.cwd(), "prompts");
    return readFile(join(promptsDir, filename), "utf8");
  }
}

type JsonRecord = Record<string, unknown>;

const EVENT_TYPES = [
  "health",
  "medication",
  "appointment",
  "family",
  "shopping",
  "finance",
  "place",
  "object",
  "general",
] as const;

const ENTITY_TYPES = ["person", "place", "medicine", "object", "organization", "unknown"] as const;
const RISK_LEVELS = ["normal", "sensitive", "medical", "financial", "fraud_risk"] as const;
const VISIBILITIES = ["private", "shared_summary", "shared_full", "family_required"] as const;
const RISK_TYPES = [
  "medical_advice",
  "medication_change",
  "financial_transfer",
  "fraud_suspected",
  "identity_document",
  "password_or_code",
  "location_sensitive",
] as const;
const SEVERITIES = ["low", "medium", "high"] as const;
const FAMILY_TASK_TYPES = ["reminder_confirm", "risk_review", "memory_correction", "general_review"] as const;
const URGENCIES = ["low", "medium", "high"] as const;
const MEMORY_UPDATE_TARGETS = ["semantic_memory", "wiki_page"] as const;
const MEMORY_UPDATE_OPERATIONS = ["add", "append", "replace_section", "create"] as const;
const UNCERTAINTY_ACTIONS = ["ask_elder", "ask_family", "leave_unresolved", "review_later"] as const;
const CONTEXT_LINK_TYPES = ["possibly_related", "fills_missing_time"] as const;
const CONTEXT_LINK_STATUSES = ["active", "needs_confirmation", "rejected"] as const;
const QUERY_INTENTS = [
  "recall_event",
  "check_reminder",
  "ask_today",
  "ask_recent_important",
  "ask_person_related",
  "unknown",
] as const;

function normalizeMemoryPlanResult(
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
    evidence: normalizeEvidenceRefs(record.evidence, input, summary, false),
    modelInfo: {
      provider: stringValue(asRecord(record.modelInfo).provider, "openai-compatible"),
      model: stringValue(asRecord(record.modelInfo).model, model),
      promptVersion: stringValue(asRecord(record.modelInfo).promptVersion, promptVersion),
    },
    confidence: numberValue(record.confidence, 0.5),
  };
}

function normalizeParsedMemoryQueryResult(raw: unknown, input: ParseMemoryQueryInput): unknown {
  const record = asRecord(raw);

  return {
    ...record,
    intent: enumValue(record.intent, QUERY_INTENTS, inferQueryIntent(input.query)),
    timeRange: normalizeTimeRange(record.timeRange),
    entities: arrayValue(record.entities).map(normalizeQueryEntity).filter(isRecord),
    eventTypes: normalizeQueryEventTypes(record.eventTypes, input.query),
    requiresSourceEvidence: booleanValue(record.requiresSourceEvidence, true),
  };
}

function normalizeMemoryAnswerResult(raw: unknown, input: GenerateMemoryAnswerInput): unknown {
  const record = asRecord(raw);
  const fallbackAnswer = input.evidence.length
    ? `I found a matching memory: ${input.evidence[0]?.summary}`
    : "I could not find a matching memory for that question.";

  return {
    ...record,
    answerText: stringValue(record.answerText ?? record.answer ?? record.text ?? record.response, fallbackAnswer),
    confidence: numberValue(record.confidence, input.evidence.length ? 0.6 : 0),
    matchedSources: normalizeMatchedSources(record.matchedSources, input.evidence),
    suggestedActions: arrayValue(record.suggestedActions).map(normalizeSuggestedAction).filter(isRecord),
    safetyNote: optionalString(record.safetyNote),
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
    evidence: normalizeEvidenceRefs(record.evidence, input, summary, true),
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
    evidence: normalizeEvidenceRefs(record.evidence, input, summary, true),
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
    evidence: normalizeEvidenceRefs(record.evidence, input, reason, true),
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

  return {
    sourceId,
    createdAt: optionalIso(record.createdAt) ?? matched?.createdAt ?? new Date().toISOString(),
    summary: stringValue(record.summary, matched?.summary ?? "Matched memory source."),
    canPlayAudio: booleanValue(record.canPlayAudio, matched?.canPlayAudio ?? false),
    retrievalSource: enumValue(
      record.retrievalSource,
      ["postgres", "mem0", "context_link"] as const,
      matched?.retrievalSource ?? "postgres",
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

function normalizeEvidenceRefs(
  raw: unknown,
  input: GenerateMemoryPlanInput,
  fallbackQuote: string,
  requireOne: boolean,
): JsonRecord[] {
  const refs = arrayValue(raw)
    .map((item) => normalizeEvidenceRef(item, input.sourceId))
    .filter(isRecord);
  if (refs.length > 0 || !requireOne) return refs;

  return [
    {
      sourceId: input.sourceId,
      quote: fallbackQuote.slice(0, 300),
    },
  ];
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

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return clamp01(value);
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) return clamp01(parsed);

  if (["very high", "certain", "high"].includes(normalized)) return 0.9;
  if (["medium", "moderate", "approximate", "unclear"].includes(normalized)) return 0.5;
  if (["low", "unknown", "unspecified"].includes(normalized)) return 0.3;
  return fallback;
}

function integerValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "required"].includes(normalized)) return true;
  if (["false", "no", "not required"].includes(normalized)) return false;
  return fallback;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function optionalIso(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function inferEventType(text: string): (typeof EVENT_TYPES)[number] {
  const normalized = text.toLowerCase();
  if (/(medicine|medication|pill|dose|药|用药|吃药)/.test(normalized)) return "medication";
  if (/(doctor|hospital|clinic|blood pressure|health|医生|医院|血压|身体)/.test(normalized)) return "health";
  if (/(appointment|meeting|visit|预约|复诊|见面)/.test(normalized)) return "appointment";
  if (/(money|bank|transfer|payment|scam|fraud|钱|银行|转账|诈骗)/.test(normalized)) return "finance";
  if (/(buy|bought|market|shop|grocery|菜场|超市|买)/.test(normalized)) return "shopping";
  if (/(daughter|son|wife|husband|family|女儿|儿子|家人)/.test(normalized)) return "family";
  if (/(park|home|station|place|公园|家|车站)/.test(normalized)) return "place";
  return "general";
}

function inferEntityType(text: string): (typeof ENTITY_TYPES)[number] {
  const normalized = text.toLowerCase();
  if (/(hospital|clinic|market|store|park|医院|菜场|超市|公园)/.test(normalized)) return "place";
  if (/(medicine|pill|tablet|药)/.test(normalized)) return "medicine";
  if (/(bank|company|hospital|银行|公司|医院)/.test(normalized)) return "organization";
  return "unknown";
}

function inferRiskLevel(text: string): (typeof RISK_LEVELS)[number] {
  const normalized = text.toLowerCase();
  if (/(scam|fraud|code|password|诈骗|验证码|密码)/.test(normalized)) return "fraud_risk";
  if (/(transfer|bank|payment|money|转账|银行|钱)/.test(normalized)) return "financial";
  if (/(medicine|dose|doctor|hospital|药|剂量|医生|医院)/.test(normalized)) return "medical";
  if (/(id card|address|身份证|住址)/.test(normalized)) return "sensitive";
  return "normal";
}

function inferRiskType(text: string): (typeof RISK_TYPES)[number] {
  const normalized = text.toLowerCase();
  if (/(scam|fraud|验证码|code|诈骗)/.test(normalized)) return "fraud_suspected";
  if (/(password|密码)/.test(normalized)) return "password_or_code";
  if (/(transfer|bank|payment|money|转账|银行|钱)/.test(normalized)) return "financial_transfer";
  if (/(dose|stop taking|change medication|剂量|换药|停药)/.test(normalized)) return "medication_change";
  if (/(doctor said|medical advice|医生建议|医嘱)/.test(normalized)) return "medical_advice";
  if (/(id card|passport|身份证|护照)/.test(normalized)) return "identity_document";
  return "location_sensitive";
}

function inferSeverity(text: string): (typeof SEVERITIES)[number] {
  const normalized = text.toLowerCase();
  if (/(scam|fraud|password|code|transfer|诈骗|密码|验证码|转账)/.test(normalized)) return "high";
  if (/(medicine|doctor|hospital|药|医生|医院)/.test(normalized)) return "medium";
  return "low";
}

function inferRequiresConfirmation(text: string): boolean {
  return inferRiskLevel(text) !== "normal" || /(remind|remember|提醒|记得)/.test(text.toLowerCase());
}

function inferRequiresFamilyReview(text: string): boolean {
  return inferSeverity(text) !== "low";
}

function inferQueryIntent(query: string): (typeof QUERY_INTENTS)[number] {
  const normalized = query.toLowerCase();
  if (/(reminder|remind|提醒)/.test(normalized)) return "check_reminder";
  if (/(today|今天)/.test(normalized)) return "ask_today";
  if (/(recent|important|最近|重要)/.test(normalized)) return "ask_recent_important";
  if (/(who|daughter|son|family|谁|女儿|儿子|家人)/.test(normalized)) return "ask_person_related";
  if (/(what|when|where|did i|remember|什么|什么时候|哪里|记得)/.test(normalized)) return "recall_event";
  return "unknown";
}
