import type {
  FamilyTask,
  Feedback,
  MemoryAnswer,
  MemoryEvent,
  MemoryPlan,
  MemorySource,
  Reminder,
  RiskFlag,
  RiskFlagRecord,
} from "@goldmem/memory-schema";
import type { PersonalContext, RetrievedEvidence } from "@goldmem/model-gateway";

export type CreateSourceInput = Omit<MemorySource, "id">;
export type CreateEventInput = Omit<MemoryEvent, "id" | "createdAt">;
export type CreateReminderInput = Omit<Reminder, "id" | "createdAt">;
export type CreateRiskFlagInput = RiskFlag & {
  elderId: string;
  sourceId: string;
  eventId?: string;
};

export interface SourceStore {
  saveAudio(audio: Uint8Array): Promise<string>;
  create(input: CreateSourceInput): Promise<MemorySource>;
  get(sourceId: string): Promise<MemorySource | null>;
}

export interface EventStore {
  create(input: CreateEventInput): Promise<MemoryEvent>;
  search(input: {
    elderId: string;
    query?: string;
    types?: string[];
    timeRange?: { start: string; end: string };
    entityNames?: string[];
    limit?: number;
  }): Promise<MemoryEvent[]>;
}

export interface ReminderStore {
  create(input: CreateReminderInput): Promise<Reminder>;
  get(reminderId: string): Promise<Reminder | null>;
  listByElder(elderId: string): Promise<Reminder[]>;
  update(reminderId: string, patch: Partial<Reminder>): Promise<Reminder>;
}

export interface FamilyTaskStore {
  create(input: {
    elderId: string;
    title: string;
    summary: string;
    type: string;
    urgency: string;
    visibility: string;
    relatedEventId?: string;
  }): Promise<FamilyTask>;
  listPending(elderId: string): Promise<FamilyTask[]>;
  confirm(taskId: string, actorUserId: string): Promise<FamilyTask>;
}

export interface RiskFlagStore {
  create(input: CreateRiskFlagInput): Promise<RiskFlagRecord>;
}

export interface AuditLog {
  record(input: { type: string; elderId: string; sourceId?: string; payload: Record<string, unknown> }): Promise<void>;
}

export interface FeedbackStore {
  create(input: Omit<Feedback, "id" | "createdAt">): Promise<Feedback>;
}

export interface SemanticMemoryStore {
  addMemory(input: {
    userId: string;
    memory: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  searchMemory(input: {
    userId: string;
    query: string;
    limit?: number;
  }): Promise<Array<{ memory: string; score?: number; metadata?: Record<string, unknown> }>>;
}

export interface TemporalGraphStore {
  addEpisode(input: {
    groupId: string;
    episodeType: string;
    occurredAt: string;
    sourceId: string;
    content: Record<string, unknown>;
  }): Promise<void>;

  search(input: {
    groupId: string;
    query: string;
    timeRange?: { start: string; end: string };
    entities?: Array<{ name: string; type?: string }>;
    limit?: number;
  }): Promise<RetrievedEvidence[]>;
}

export interface PersonalContextStore {
  buildContext(input: { elderId: string; queryText: string }): Promise<PersonalContext>;
}

export class NullTemporalGraphStore implements TemporalGraphStore {
  async addEpisode(): Promise<void> {}
  async search(): Promise<RetrievedEvidence[]> {
    return [];
  }
}

export class NullSemanticMemoryStore implements SemanticMemoryStore {
  async addMemory(): Promise<void> {}
  async searchMemory(): Promise<Array<{ memory: string; score?: number; metadata?: Record<string, unknown> }>> {
    return [];
  }
}

export class NullRiskFlagStore implements RiskFlagStore {
  async create(input: CreateRiskFlagInput): Promise<RiskFlagRecord> {
    return { ...input, id: "null-risk-flag", createdAt: new Date().toISOString() };
  }
}

export type ApplyMemoryPlanResult = {
  sourceId: string;
  events: MemoryEvent[];
  reminderCandidates: Reminder[];
  answer?: MemoryAnswer;
};

export type MemoryPlanAuditPayload = {
  plan: MemoryPlan;
  result: ApplyMemoryPlanResult;
};

export * from "./http-adapters.js";
export * from "./postgres.js";
export * from "./postgres-schema.js";
