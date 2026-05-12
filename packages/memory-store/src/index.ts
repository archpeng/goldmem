import type {
  FamilyTask,
  Feedback,
  DebugTrace,
  MemoryAnswer,
  MemoryContextLink,
  MemoryEvent,
  MemoryPlan,
  MemorySource,
  NotificationIntent,
  PersonalContext,
  Reminder,
  RiskFlag,
  RiskFlagRecord,
} from "@goldmem/memory-schema";

export type CreateSourceInput = Omit<MemorySource, "id">;
export type CreateEventInput = Omit<MemoryEvent, "id" | "createdAt">;
export type CreateReminderInput = Omit<Reminder, "id" | "createdAt">;
export type CreateContextLinkInput = Omit<MemoryContextLink, "id" | "createdAt">;
export type CreateRiskFlagInput = RiskFlag & {
  tenantId: string;
  elderId: string;
  sourceId: string;
  eventId?: string;
};

export interface SourceStore {
  saveAudio(audio: Uint8Array): Promise<string>;
  create(input: CreateSourceInput): Promise<MemorySource>;
  get(input: { tenantId: string; sourceId: string }): Promise<MemorySource | null>;
}

export interface EventStore {
  create(input: CreateEventInput): Promise<MemoryEvent>;
  getByIds(input: { tenantId: string; eventIds: string[] }): Promise<MemoryEvent[]>;
  search(input: {
    tenantId: string;
    elderId: string;
    query?: string;
    types?: string[];
    timeRange?: { start: string; end: string };
    entityNames?: string[];
    limit?: number;
  }): Promise<MemoryEvent[]>;
}

export interface ContextLinkStore {
  create(input: CreateContextLinkInput): Promise<MemoryContextLink>;
  listByEventIds(input: { tenantId: string; elderId: string; eventIds: string[] }): Promise<MemoryContextLink[]>;
  listByElder(input: { tenantId: string; elderId: string }): Promise<MemoryContextLink[]>;
}

export interface ReminderStore {
  create(input: CreateReminderInput): Promise<Reminder>;
  get(input: { tenantId: string; reminderId: string }): Promise<Reminder | null>;
  listByElder(input: { tenantId: string; elderId: string }): Promise<Reminder[]>;
  update(input: { tenantId: string; reminderId: string; patch: Partial<Reminder> }): Promise<Reminder>;
}

export interface FamilyTaskStore {
  create(input: {
    tenantId: string;
    elderId: string;
    title: string;
    summary: string;
    type: string;
    urgency: string;
    visibility: string;
    relatedEventId?: string;
  }): Promise<FamilyTask>;
  listByElder(input: { tenantId: string; elderId: string }): Promise<FamilyTask[]>;
  listPending(input: { tenantId: string; elderId: string }): Promise<FamilyTask[]>;
  confirm(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask>;
  reject(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask>;
  requestMoreInfo(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask>;
}

export interface RiskFlagStore {
  create(input: CreateRiskFlagInput): Promise<RiskFlagRecord>;
}

export interface AuditLog {
  record(input: {
    type: string;
    tenantId: string;
    elderId: string;
    sourceId?: string;
    traceId?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export type CreateFamilyReminderCommandInput = {
  idempotencyKey?: string;
  actorUserId: string;
  source: CreateSourceInput;
  reminder: CreateReminderInput;
  audit: Parameters<AuditLog["record"]>[0];
  request: Record<string, unknown>;
};

export type CreateFamilyReminderCommandResult = {
  source: MemorySource;
  reminder: Reminder;
  reused: boolean;
};

export interface FamilyReminderCommandStore {
  create(input: CreateFamilyReminderCommandInput): Promise<CreateFamilyReminderCommandResult>;
}

export interface FeedbackStore {
  create(input: Omit<Feedback, "id" | "createdAt">): Promise<Feedback>;
}

export interface DebugTraceStore {
  getByTrace(input: { tenantId: string; traceId: string }): Promise<DebugTrace | null>;
  getBySource(input: { tenantId: string; sourceId: string }): Promise<DebugTrace | null>;
  getByAuditId(input: { tenantId: string; auditId: string }): Promise<DebugTrace | null>;
}

export interface NotificationIntentStore {
  create(input: Omit<NotificationIntent, "id" | "createdAt" | "status"> & { status?: NotificationIntent["status"] }): Promise<NotificationIntent>;
  listByElder(input: { tenantId: string; elderId: string }): Promise<NotificationIntent[]>;
}

export type MemoryRecallResult = {
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export interface SemanticMemoryStore {
  addMemory(input: {
    tenantId: string;
    elderId: string;
    memory: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  searchMemory(input: {
    tenantId: string;
    elderId: string;
    query: string;
    embedding: number[];
    limit?: number;
  }): Promise<MemoryRecallResult[]>;
}

export interface PersonalContextStore {
  buildContext(input: { tenantId: string; elderId: string; queryText: string }): Promise<PersonalContext>;
}

export type TemporalMemoryJobStatus = "pending" | "running" | "succeeded" | "failed" | "dead";

export type TemporalMemoryJob = {
  id: string;
  tenantId: string;
  elderId: string;
  sourceId: string;
  status: TemporalMemoryJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lockedAt?: string;
  lastError?: string;
  episode: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export interface TemporalMemoryJobStore {
  enqueue(input: {
    tenantId: string;
    elderId: string;
    sourceId: string;
    traceId?: string;
    episode: Record<string, unknown>;
    nextRunAt?: string;
    maxAttempts?: number;
  }): Promise<TemporalMemoryJob>;
  claimDue(input: { now: string; limit: number }): Promise<TemporalMemoryJob[]>;
  markSucceeded(input: { jobId: string }): Promise<TemporalMemoryJob>;
  markFailed(input: { jobId: string; errorMessage: string; nextRunAt: string; dead: boolean }): Promise<TemporalMemoryJob>;
  stats(input?: { tenantId?: string; elderId?: string }): Promise<Record<TemporalMemoryJobStatus, number>>;
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

export * from "./postgres.js";
export * from "./postgres-schema.js";
