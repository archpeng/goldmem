export type TemporalEpisodeType =
  | "voice_memory"
  | "text_memory"
  | "family_confirmation"
  | "reminder_state_change"
  | "risk_review"
  | "daily_consolidation";

export type TemporalEntityType =
  | "person"
  | "place"
  | "medicine"
  | "object"
  | "organization"
  | "symptom"
  | "unknown";

export type TemporalFactStatus = "active" | "superseded" | "uncertain" | "rejected";

export type TemporalGroupRef = {
  tenantId: string;
  elderId: string;
  groupId: string;
};

export type AddTemporalEpisodeInput = TemporalGroupRef & {
  episodeType: TemporalEpisodeType;
  occurredAt: string;
  sourceIds: string[];
  eventIds: string[];
  reminderIds?: string[];
  riskFlagIds?: string[];
  familyTaskIds?: string[];
  content: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const TEMPORAL_EPISODE_TYPES = [
  "voice_memory",
  "text_memory",
  "family_confirmation",
  "reminder_state_change",
  "risk_review",
  "daily_consolidation",
] as const satisfies readonly TemporalEpisodeType[];

export type TemporalQueryEntity = {
  name: string;
  type: TemporalEntityType;
};

export type TemporalTimeRange = {
  start: string;
  end: string;
};

export type SearchTemporalFactsInput = TemporalGroupRef & {
  query: string;
  entities?: TemporalQueryEntity[];
  timeRange?: TemporalTimeRange;
  limit?: number;
};

export type EntityTimelineInput = TemporalGroupRef & {
  entityName: string;
  entityType: TemporalEntityType;
  timeRange?: TemporalTimeRange;
  limit?: number;
};

export type CurrentFactsInput = TemporalGroupRef & {
  entities?: TemporalQueryEntity[];
  predicates?: string[];
  limit?: number;
};

export type TemporalEvidence = {
  retrievalSource: "graphiti";
  sourceId?: string;
  eventId?: string;
  episodeId?: string;
  factId?: string;
  entityNames: string[];
  fact: string;
  validFrom?: string;
  validTo?: string;
  score: number;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type TimelineItem = {
  occurredAt: string;
  sourceId?: string;
  eventId?: string;
  episodeId?: string;
  title?: string;
  fact: string;
  status: TemporalFactStatus;
  metadata?: Record<string, unknown>;
};

export type CurrentFact = {
  factId?: string;
  sourceId?: string;
  eventId?: string;
  episodeId?: string;
  subject: string;
  predicate: string;
  object?: string;
  value?: string;
  validFrom?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export interface TemporalMemoryStore {
  /** Add a curated GoldMem episode to the long-term temporal memory backend. */
  addEpisode(input: AddTemporalEpisodeInput): Promise<void>;

  /** Search long-term temporal facts and relationship evidence. */
  searchFacts(input: SearchTemporalFactsInput): Promise<TemporalEvidence[]>;

  /** Return a timeline for one entity, such as a medicine, doctor, hospital, or family member. */
  getEntityTimeline(input: EntityTimelineInput): Promise<TimelineItem[]>;

  /** Return currently effective facts for one elder/family graph. */
  getCurrentFacts(input: CurrentFactsInput): Promise<CurrentFact[]>;
}

export function parseAddTemporalEpisodeInput(value: unknown): AddTemporalEpisodeInput {
  const record = asRecord(value);
  const input: AddTemporalEpisodeInput = {
    tenantId: requiredString(record.tenantId, "tenantId"),
    elderId: requiredString(record.elderId, "elderId"),
    groupId: requiredString(record.groupId, "groupId"),
    episodeType: requiredEpisodeType(record.episodeType),
    occurredAt: requiredIsoDateTime(record.occurredAt, "occurredAt"),
    sourceIds: requiredStringArray(record.sourceIds, "sourceIds"),
    eventIds: requiredStringArray(record.eventIds, "eventIds"),
    content: requiredRecord(record.content, "content"),
  };

  const reminderIds = optionalStringArray(record.reminderIds, "reminderIds");
  if (reminderIds) input.reminderIds = reminderIds;
  const riskFlagIds = optionalStringArray(record.riskFlagIds, "riskFlagIds");
  if (riskFlagIds) input.riskFlagIds = riskFlagIds;
  const familyTaskIds = optionalStringArray(record.familyTaskIds, "familyTaskIds");
  if (familyTaskIds) input.familyTaskIds = familyTaskIds;
  if (record.metadata !== undefined) input.metadata = requiredRecord(record.metadata, "metadata");

  return input;
}

export type GraphitiTemporalMemoryStoreOptions = {
  baseUrl: string;
  apiKey?: string;
};

export class TemporalMemoryNotConfiguredError extends Error {
  constructor(message = "Graphiti temporal memory is not configured") {
    super(message);
    this.name = "TemporalMemoryNotConfiguredError";
  }
}

/**
 * Disabled implementation for tests and explicit local development. Kernel code
 * treats it like any other temporal-memory failure and surfaces audit/retry state.
 */
export class NullTemporalMemoryStore implements TemporalMemoryStore {
  async addEpisode(_input: AddTemporalEpisodeInput): Promise<void> {
    throw new TemporalMemoryNotConfiguredError();
  }
  async searchFacts(_input: SearchTemporalFactsInput): Promise<TemporalEvidence[]> {
    throw new TemporalMemoryNotConfiguredError();
  }
  async getEntityTimeline(_input: EntityTimelineInput): Promise<TimelineItem[]> {
    throw new TemporalMemoryNotConfiguredError();
  }
  async getCurrentFacts(_input: CurrentFactsInput): Promise<CurrentFact[]> {
    throw new TemporalMemoryNotConfiguredError();
  }
}

export class GraphitiTemporalMemoryStore implements TemporalMemoryStore {
  constructor(private readonly options: GraphitiTemporalMemoryStoreOptions) {
    if (!options.baseUrl.trim()) throw new Error("Graphiti baseUrl is required");
  }

  async addEpisode(input: AddTemporalEpisodeInput): Promise<void> {
    await requestGraphiti(this.options, "/add_episode", {
      method: "POST",
      body: JSON.stringify({
        name: `${input.tenantId}:${input.elderId}:${input.episodeType}:${input.sourceIds[0] ?? input.occurredAt}`,
        episode_body: input.content,
        source: "json",
        source_description: "GoldMem curated temporal episode",
        reference_time: input.occurredAt,
        group_id: input.groupId,
        metadata: {
          ...input.metadata,
          tenantId: input.tenantId,
          elderId: input.elderId,
          groupId: input.groupId,
          episodeType: input.episodeType,
          sourceIds: input.sourceIds,
          eventIds: input.eventIds,
          reminderIds: input.reminderIds ?? [],
          riskFlagIds: input.riskFlagIds ?? [],
          familyTaskIds: input.familyTaskIds ?? [],
        },
      }),
    });
  }

  async searchFacts(input: SearchTemporalFactsInput): Promise<TemporalEvidence[]> {
    const result = await requestGraphiti(this.options, "/search_facts", {
      method: "POST",
      body: JSON.stringify({
        query: input.query,
        group_id: input.groupId,
        max_facts: input.limit,
        tenantId: input.tenantId,
        elderId: input.elderId,
        entities: input.entities,
        timeRange: input.timeRange,
      }),
    });
    return normalizeTemporalEvidence(result);
  }

  async getEntityTimeline(input: EntityTimelineInput): Promise<TimelineItem[]> {
    const result = await requestGraphiti(this.options, "/entity_timeline", {
      method: "POST",
      body: JSON.stringify({
        group_id: input.groupId,
        tenantId: input.tenantId,
        elderId: input.elderId,
        entityName: input.entityName,
        entityType: input.entityType,
        timeRange: input.timeRange,
        limit: input.limit,
      }),
    });
    return normalizeTimelineItems(result);
  }

  async getCurrentFacts(input: CurrentFactsInput): Promise<CurrentFact[]> {
    const result = await requestGraphiti(this.options, "/current_facts", {
      method: "POST",
      body: JSON.stringify({
        group_id: input.groupId,
        tenantId: input.tenantId,
        elderId: input.elderId,
        entities: input.entities,
        predicates: input.predicates,
        limit: input.limit,
      }),
    });
    return normalizeCurrentFacts(result);
  }
}

export function buildTemporalGroupId(input: { tenantId: string; elderId: string }): string {
  return `tenant_${encodeTemporalGroupPart(input.tenantId)}__elder_${encodeTemporalGroupPart(input.elderId)}`;
}

function encodeTemporalGroupPart(value: string): string {
  const encoded = value.trim().replace(/[^A-Za-z0-9_-]/g, (char) => {
    const codePoint = char.codePointAt(0)?.toString(16) ?? "0";
    return `_${codePoint}_`;
  });
  return encoded || "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Temporal episode must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Temporal episode ${field} must be a non-empty string`);
  }
  return value;
}

function requiredEpisodeType(value: unknown): TemporalEpisodeType {
  if (typeof value === "string" && TEMPORAL_EPISODE_TYPES.includes(value as TemporalEpisodeType)) {
    return value as TemporalEpisodeType;
  }
  throw new Error("Temporal episode episodeType is invalid");
}

function requiredIsoDateTime(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!Number.isFinite(Date.parse(text))) {
    throw new Error(`Temporal episode ${field} must be an ISO date-time`);
  }
  return new Date(text).toISOString();
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Temporal episode ${field} must be a non-empty string array`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Temporal episode ${field} must be a string array`);
  }
  return value;
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Temporal episode ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function requestGraphiti(
  options: GraphitiTemporalMemoryStoreOptions,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}`, "x-api-key": options.apiKey } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Graphiti temporal memory request failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) return undefined;
  return response.json();
}

function normalizeTemporalEvidence(result: unknown): TemporalEvidence[] {
  const items = resultItems(result, ["facts", "results", "edges"]);
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const metadata = recordValue(item.metadata);
    const sourceId = stringValue(item.sourceId ?? item.source_id ?? metadata?.sourceId ?? metadata?.source_id)
      ?? firstStringValue(metadata?.sourceIds ?? metadata?.source_ids);
    const fact = stringValue(item.fact ?? item.text ?? item.name ?? item.summary);
    if (!sourceId || !fact) return [];
    return [{
      retrievalSource: "graphiti" as const,
      sourceId,
      eventId: stringValue(item.eventId ?? item.event_id ?? metadata?.eventId ?? metadata?.event_id)
        ?? firstStringValue(metadata?.eventIds ?? metadata?.event_ids),
      episodeId: stringValue(item.episodeId ?? item.episode_id ?? metadata?.episodeId ?? metadata?.episode_id ?? item.uuid ?? item.id),
      factId: stringValue(item.factId ?? item.fact_id ?? item.uuid ?? item.id),
      entityNames: stringArrayValue(item.entityNames ?? item.entity_names ?? item.entities) ?? [],
      fact,
      validFrom: stringValue(item.validFrom ?? item.valid_from),
      validTo: stringValue(item.validTo ?? item.valid_to),
      score: clampScore(numberValue(item.score) ?? numberValue(item.fact_score) ?? 0.5),
      reason: stringValue(item.reason) ?? "Graphiti temporal fact matched the query.",
      metadata,
    }];
  });
}

function normalizeTimelineItems(result: unknown): TimelineItem[] {
  const items = resultItems(result, ["timeline", "items", "results"]);
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const occurredAt = stringValue(item.occurredAt ?? item.occurred_at ?? item.validFrom ?? item.valid_from);
    const fact = stringValue(item.fact ?? item.text ?? item.summary);
    if (!occurredAt || !fact) return [];
    return [{
      occurredAt,
      sourceId: stringValue(item.sourceId ?? item.source_id),
      eventId: stringValue(item.eventId ?? item.event_id),
      episodeId: stringValue(item.episodeId ?? item.episode_id ?? item.uuid ?? item.id),
      title: stringValue(item.title ?? item.name),
      fact,
      status: temporalFactStatusValue(item.status),
      metadata: recordValue(item.metadata),
    }];
  });
}

function normalizeCurrentFacts(result: unknown): CurrentFact[] {
  const items = resultItems(result, ["facts", "results", "items"]);
  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const subject = stringValue(item.subject ?? item.source_node_name ?? item.source);
    const predicate = stringValue(item.predicate ?? item.relation ?? item.name);
    if (!subject || !predicate) return [];
    return [{
      factId: stringValue(item.factId ?? item.fact_id ?? item.uuid ?? item.id),
      sourceId: stringValue(item.sourceId ?? item.source_id),
      eventId: stringValue(item.eventId ?? item.event_id),
      episodeId: stringValue(item.episodeId ?? item.episode_id),
      subject,
      predicate,
      object: stringValue(item.object ?? item.target_node_name ?? item.target),
      value: stringValue(item.value ?? item.fact ?? item.summary),
      validFrom: stringValue(item.validFrom ?? item.valid_from),
      confidence: numberValue(item.confidence ?? item.score),
      metadata: recordValue(item.metadata),
    }];
  });
}

function resultItems(result: unknown, keys: string[]): unknown[] {
  if (Array.isArray(result)) return result;
  if (!isRecord(result)) return [];
  for (const key of keys) {
    const value = result[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function temporalFactStatusValue(value: unknown): TemporalFactStatus {
  return value === "superseded" || value === "uncertain" || value === "rejected" ? value : "active";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length ? strings : undefined;
}

function firstStringValue(value: unknown): string | undefined {
  return stringArrayValue(value)?.[0];
}

function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}
