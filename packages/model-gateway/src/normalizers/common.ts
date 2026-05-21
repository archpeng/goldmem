import { toElderSecretaryVoiceText } from "@mem/memory-schema";

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
export const FAMILY_TASK_TYPES = ["reminder_confirm", "risk_review", "memory_correction", "general_review", "conflict_review"] as const;
export const URGENCIES = ["low", "medium", "high"] as const;
export const MEMORY_UPDATE_TARGETS = ["wiki_page"] as const;
export const MEMORY_UPDATE_OPERATIONS = ["add", "append", "replace_section", "create"] as const;
export const EVENT_ACTIONS = [
  "none",
  "create_reminder_candidate",
  "update_existing_reminder_candidate",
  "needs_clarification",
  "family_review",
] as const;
export const UNCERTAINTY_ACTIONS = ["ask_elder", "ask_family", "leave_unresolved", "review_later"] as const;
export const CONTEXT_LINK_TYPES = ["possibly_related", "fills_missing_time"] as const;
export const CONTEXT_LINK_STATUSES = ["active", "needs_confirmation", "rejected"] as const;
export const RELATION_ENRICHMENT_INTENTS = [
  "temporal_change",
  "conflict_resolution",
  "same_matter_link",
  "safety_chain",
  "caregiver_context",
  "long_term_pattern",
] as const;
export const QUERY_INTENTS = [
  "recall_event",
  "check_reminder",
  "ask_today",
  "ask_recent_important",
  "ask_person_related",
  "unknown",
] as const;
export const QUERY_SAFETY_TAGS = ["medical", "medication", "financial", "fraud", "identity", "privacy"] as const;
export const RELATION_QUERY_INTENTS = ["none", ...RELATION_ENRICHMENT_INTENTS] as const;

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

export function elderSecretaryText(value: string): string {
  return toElderSecretaryVoiceText(value);
}

export function numberValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return clamp01(value);
  if (typeof value !== "string") return fallback;

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

export function optionalBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "required"].includes(normalized)) return true;
  if (["false", "no", "not required"].includes(normalized)) return false;
  return undefined;
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
