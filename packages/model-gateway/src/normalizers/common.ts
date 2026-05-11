export type JsonRecord = Record<string, unknown>;

export const EVENT_TYPES = [
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

export const ENTITY_TYPES = ["person", "place", "medicine", "object", "organization", "unknown"] as const;
export const RISK_LEVELS = ["normal", "sensitive", "medical", "financial", "fraud_risk"] as const;
export const VISIBILITIES = ["private", "shared_summary", "shared_full", "family_required"] as const;
export const RISK_TYPES = [
  "medical_advice",
  "medication_change",
  "financial_transfer",
  "fraud_suspected",
  "identity_document",
  "password_or_code",
  "location_sensitive",
] as const;
export const SEVERITIES = ["low", "medium", "high"] as const;
export const FAMILY_TASK_TYPES = ["reminder_confirm", "risk_review", "memory_correction", "general_review"] as const;
export const URGENCIES = ["low", "medium", "high"] as const;
export const MEMORY_UPDATE_TARGETS = ["semantic_memory", "wiki_page"] as const;
export const MEMORY_UPDATE_OPERATIONS = ["add", "append", "replace_section", "create"] as const;
export const UNCERTAINTY_ACTIONS = ["ask_elder", "ask_family", "leave_unresolved", "review_later"] as const;
export const CONTEXT_LINK_TYPES = ["possibly_related", "fills_missing_time"] as const;
export const CONTEXT_LINK_STATUSES = ["active", "needs_confirmation", "rejected"] as const;
export const QUERY_INTENTS = [
  "recall_event",
  "check_reminder",
  "ask_today",
  "ask_recent_important",
  "ask_person_related",
  "unknown",
] as const;

export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function numberValue(value: unknown, fallback: number): number {
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

export function optionalNumberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return clamp01(value);
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized.endsWith("%")) {
    const parsedPercent = Number(normalized.slice(0, -1));
    if (Number.isFinite(parsedPercent)) return clamp01(parsedPercent / 100);
  }
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) return clamp01(parsed);

  if (["very high", "certain", "high"].includes(normalized)) return 0.9;
  if (["medium", "moderate", "approximate", "unclear"].includes(normalized)) return 0.5;
  if (["low", "unknown", "unspecified"].includes(normalized)) return 0.3;
  return undefined;
}

export function integerValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "required"].includes(normalized)) return true;
  if (["false", "no", "not required"].includes(normalized)) return false;
  return fallback;
}

export function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

export function optionalIso(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function inferEventType(text: string): (typeof EVENT_TYPES)[number] {
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

export function inferEntityType(text: string): (typeof ENTITY_TYPES)[number] {
  const normalized = text.toLowerCase();
  if (/(hospital|clinic|market|store|park|医院|菜场|超市|公园)/.test(normalized)) return "place";
  if (/(medicine|pill|tablet|药)/.test(normalized)) return "medicine";
  if (/(bank|company|hospital|银行|公司|医院)/.test(normalized)) return "organization";
  return "unknown";
}

export function inferRiskLevel(text: string): (typeof RISK_LEVELS)[number] {
  const normalized = text.toLowerCase();
  if (/(scam|fraud|code|password|诈骗|验证码|密码)/.test(normalized)) return "fraud_risk";
  if (/(transfer|bank|payment|money|转账|银行|钱)/.test(normalized)) return "financial";
  if (/(medicine|dose|doctor|hospital|药|剂量|医生|医院)/.test(normalized)) return "medical";
  if (/(id card|address|身份证|住址)/.test(normalized)) return "sensitive";
  return "normal";
}

export function inferRiskType(text: string): (typeof RISK_TYPES)[number] {
  const normalized = text.toLowerCase();
  if (/(scam|fraud|验证码|code|诈骗)/.test(normalized)) return "fraud_suspected";
  if (/(password|密码)/.test(normalized)) return "password_or_code";
  if (/(transfer|bank|payment|money|转账|银行|钱)/.test(normalized)) return "financial_transfer";
  if (/(dose|stop taking|change medication|剂量|换药|停药)/.test(normalized)) return "medication_change";
  if (/(doctor said|medical advice|医生建议|医嘱)/.test(normalized)) return "medical_advice";
  if (/(id card|passport|身份证|护照)/.test(normalized)) return "identity_document";
  return "location_sensitive";
}

export function inferSeverity(text: string): (typeof SEVERITIES)[number] {
  const normalized = text.toLowerCase();
  if (/(scam|fraud|password|code|transfer|诈骗|密码|验证码|转账)/.test(normalized)) return "high";
  if (/(medicine|doctor|hospital|药|医生|医院)/.test(normalized)) return "medium";
  return "low";
}

export function inferRequiresConfirmation(text: string): boolean {
  return inferRiskLevel(text) !== "normal" || /(remind|remember|提醒|记得)/.test(text.toLowerCase());
}

export function inferRequiresFamilyReview(text: string): boolean {
  return inferSeverity(text) !== "low";
}

export function inferQueryIntent(query: string): (typeof QUERY_INTENTS)[number] {
  const normalized = query.toLowerCase();
  if (/(reminder|remind|提醒)/.test(normalized)) return "check_reminder";
  if (/(today|今天)/.test(normalized)) return "ask_today";
  if (/(recent|important|最近|重要)/.test(normalized)) return "ask_recent_important";
  if (/(who|daughter|son|family|谁|女儿|儿子|家人)/.test(normalized)) return "ask_person_related";
  if (/(what|when|where|did i|remember|什么|什么时候|哪里|记得)/.test(normalized)) return "recall_event";
  return "unknown";
}
