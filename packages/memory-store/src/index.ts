import type { MemoryAnswer, MemoryEvent, MemoryPlan, MemorySource, Reminder } from "@goldmem/memory-schema";
import type { PersonalContext, RetrievedEvidence } from "@goldmem/model-gateway";

export type CreateSourceInput = Omit<MemorySource, "id">;
export type CreateEventInput = Omit<MemoryEvent, "id" | "createdAt">;
export type CreateReminderInput = Omit<Reminder, "id" | "createdAt">;

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
  }): Promise<void>;
}

export interface AuditLog {
  record(input: { type: string; elderId: string; sourceId?: string; payload: Record<string, unknown> }): Promise<void>;
}

export interface FeedbackStore {
  create(input: Record<string, unknown>): Promise<void>;
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
