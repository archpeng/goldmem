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

/**
 * No-op implementation used only to keep Graphiti out of the realtime MVP path.
 * It is not a compatibility layer and should not grow behavior.
 */
export class NullTemporalMemoryStore implements TemporalMemoryStore {
  async addEpisode(): Promise<void> {}
  async searchFacts(): Promise<TemporalEvidence[]> { return []; }
  async getEntityTimeline(): Promise<TimelineItem[]> { return []; }
  async getCurrentFacts(): Promise<CurrentFact[]> { return []; }
}

export function buildTemporalGroupId(input: { tenantId: string; elderId: string }): string {
  return `${input.tenantId}:${input.elderId}`;
}
