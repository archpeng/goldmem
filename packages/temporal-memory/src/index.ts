export type TemporalEpisodeType =
  | "voice_memory"
  | "text_memory"
  | "family_confirmation"
  | "reminder_state_change"
  | "risk_review"
  | "daily_consolidation";

export type AddTemporalEpisodeInput = {
  /** Tenant-scoped Graphiti group, recommended format: `${tenantId}:${elderId}`. */
  groupId: string;
  tenantId?: string;
  elderId: string;
  episodeType: TemporalEpisodeType | string;
  occurredAt: string;
  sourceIds: string[];
  eventIds: string[];
  reminderIds?: string[];
  riskFlagIds?: string[];
  familyTaskIds?: string[];
  content: string | Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type TemporalQueryEntity = {
  name: string;
  type?: "person" | "place" | "medicine" | "object" | "organization" | "symptom" | "unknown" | string;
};

export type SearchTemporalFactsInput = {
  groupId: string;
  tenantId?: string;
  elderId: string;
  query: string;
  entities?: TemporalQueryEntity[];
  timeRange?: {
    start: string;
    end: string;
  };
  limit?: number;
};

export type EntityTimelineInput = {
  groupId: string;
  tenantId?: string;
  elderId: string;
  entityName: string;
  entityType?: string;
  timeRange?: {
    start: string;
    end: string;
  };
  limit?: number;
};

export type CurrentFactsInput = {
  groupId: string;
  tenantId?: string;
  elderId: string;
  entities?: TemporalQueryEntity[];
  predicates?: string[];
  limit?: number;
};

export type TemporalEvidence = {
  retrievalSource: "graphiti" | "temporal_memory";
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
  status?: "active" | "superseded" | "uncertain" | "rejected" | string;
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
  /**
   * Add an episode to the long-term temporal memory backend.
   * This should be async-safe: callers may enqueue and retry failed writes.
   */
  addEpisode(input: AddTemporalEpisodeInput): Promise<void>;

  /**
   * Search long-term temporal facts and relationship evidence.
   * This is intended for long-horizon queries, not ordinary recent recall.
   */
  searchFacts(input: SearchTemporalFactsInput): Promise<TemporalEvidence[]>;

  /**
   * Return a timeline for one entity, such as a medicine, doctor, hospital, or family member.
   */
  getEntityTimeline(input: EntityTimelineInput): Promise<TimelineItem[]>;

  /**
   * Return currently effective facts for one elder/family graph.
   */
  getCurrentFacts(input: CurrentFactsInput): Promise<CurrentFact[]>;
}

export class NullTemporalMemoryStore implements TemporalMemoryStore {
  async addEpisode(): Promise<void> {
    // Intentionally no-op. Keeps MVP runtime independent from Graphiti.
  }

  async searchFacts(): Promise<TemporalEvidence[]> {
    return [];
  }

  async getEntityTimeline(): Promise<TimelineItem[]> {
    return [];
  }

  async getCurrentFacts(): Promise<CurrentFact[]> {
    return [];
  }
}

export function buildTemporalGroupId(input: { tenantId?: string; elderId: string }): string {
  return input.tenantId ? `${input.tenantId}:${input.elderId}` : input.elderId;
}
