import type {
  FamilyTask,
  ElderTurnPlan,
  MemoryAnswer,
  MemoryContextLink,
  MemoryEvent,
  MemoryPlan,
  MemorySource,
  ParsedMemoryQuery,
  PersonalContext,
  Reminder,
} from "@goldmem/memory-schema";
import type { GenerateMemoryPlanInput, ModelGateway, PlanElderTurnInput, TranscriptionResult } from "@goldmem/model-gateway";
import type {
  AuditLog,
  ContextLinkStore,
  CreateContextLinkInput,
  CreateEventInput,
  CreateFamilyReminderCommandInput,
  CreateFamilyReminderCommandResult,
  CreateReminderInput,
  CreateRiskFlagInput,
  CreateSourceInput,
  EventStore,
  FamilyReminderCommandStore,
  FamilyTaskStore,
  MemoryRecallResult,
  PersonalContextStore,
  ReminderStore,
  RiskFlagStore,
  SemanticMemoryStore,
  SourceStore,
  TemporalMemoryJob,
  TemporalMemoryJobStore,
} from "@goldmem/memory-store";
import { DefaultPermissionEngine } from "@goldmem/permission-engine";
import { DefaultReminderEngine } from "@goldmem/reminder-engine";
import { DefaultRiskEngine } from "@goldmem/risk-engine";
import { NullTemporalMemoryStore, type AddTemporalEpisodeInput, type TemporalEvidence, type TemporalMemoryStore } from "@goldmem/temporal-memory";
import { ElderMemoryKernel, type ElderMemoryKernelDeps } from "../src/index.js";

export const now = "2026-05-09T12:00:00.000Z";

export function createHarness(plan: MemoryPlan, temporalMemory: TemporalMemoryStore = new NullTemporalMemoryStore()) {
  const sourceStore = new InMemorySourceStore();
  const eventStore = new InMemoryEventStore();
  const reminderStore = new InMemoryReminderStore();
  const audit = new InMemoryAuditLog();
  const familyReminderCommands = new InMemoryFamilyReminderCommandStore(sourceStore, reminderStore, audit);
  const familyTasks = new InMemoryFamilyTaskStore();
  const riskFlags = new InMemoryRiskFlagStore();
  const contextLinkStore = new InMemoryContextLinkStore(eventStore);
  const semanticMemory = new InMemorySemanticMemoryStore();
  const temporalMemoryJobStore = new InMemoryTemporalMemoryJobStore();
  const personalContextStore = new FakePersonalContextStore();
  const model = new FakeModelGateway(plan);

  const deps: ElderMemoryKernelDeps = {
    sourceStore,
    eventStore,
    contextLinkStore,
    reminderEngine: new DefaultReminderEngine(reminderStore),
    familyReminderCommandStore: familyReminderCommands,
    familyTaskStore: familyTasks,
    riskFlagStore: riskFlags,
    semanticMemory,
    personalContextStore,
    modelGateway: model,
    riskEngine: new DefaultRiskEngine(),
    permissionEngine: new DefaultPermissionEngine(),
    auditLog: audit,
    temporalMemory,
    temporalMemoryJobStore,
  };

  return {
    kernel: new ElderMemoryKernel(deps),
    sourceStore,
    eventStore,
    reminderStore,
    familyReminderCommands,
    contextLinkStore,
    familyTasks,
    riskFlags,
    semanticMemory,
    audit,
    temporalMemoryJobStore,
    personalContextStore,
    model,
  };
}

export function buildPlan(input: Partial<MemoryPlan>): MemoryPlan {
  const events = input.events ?? [];
  return {
    tenantId: input.tenantId ?? "tenant-mvp",
    sourceId: "source-1",
    elderId: "elder-1",
    summary: input.summary ?? "Summary",
    events,
    reminderCandidates: input.reminderCandidates ?? [],
    eventActionDecisions: "eventActionDecisions" in input
      ? input.eventActionDecisions ?? []
      : events.map((_, eventIndex) => buildEventActionDecision({ eventIndex })),
    riskFlags: input.riskFlags ?? [],
    familyTasks: input.familyTasks ?? [],
    contextLinks: input.contextLinks ?? [],
    relationEnrichmentSignals: input.relationEnrichmentSignals ?? [],
    memoryUpdates: input.memoryUpdates ?? [],
    uncertainties: input.uncertainties ?? [],
    evidence: input.evidence ?? [evidence()],
    modelInfo: input.modelInfo ?? {
      provider: "fake",
      model: "fake-memory-plan",
      promptVersion: "test",
    },
    confidence: input.confidence ?? 0.9,
  };
}

export function buildRelationEnrichmentSignal(
  input: Partial<MemoryPlan["relationEnrichmentSignals"][number]>,
): MemoryPlan["relationEnrichmentSignals"][number] {
  return {
    intent: input.intent ?? "same_matter_link",
    valueScore: input.valueScore ?? 0.8,
    confidence: input.confidence ?? 0.8,
    relatedEventIndexes: input.relatedEventIndexes ?? [0],
    relatedReminderCandidateIndexes: input.relatedReminderCandidateIndexes ?? [],
    reason: input.reason ?? "This record has long-term relationship value.",
    evidence: input.evidence ?? [evidence()],
  };
}

export function buildEventActionDecision(
  input: Partial<MemoryPlan["eventActionDecisions"][number]>,
): MemoryPlan["eventActionDecisions"][number] {
  return {
    eventIndex: input.eventIndex ?? 0,
    action: input.action ?? "none",
    reminderCandidateIndex: input.reminderCandidateIndex,
    targetReminderId: input.targetReminderId,
    reason: input.reason ?? "No follow-up action is needed.",
    confidence: input.confidence ?? 0.8,
    evidence: input.evidence ?? [evidence()],
  };
}

export function memoryEvent(input: Partial<MemoryEvent>): MemoryEvent {
  return {
    id: input.id ?? "event-existing",
    tenantId: input.tenantId ?? "tenant-mvp",
    elderId: input.elderId ?? "elder-1",
    sourceId: input.sourceId ?? "source-existing",
    type: input.type ?? "general",
    title: input.title ?? "Existing event",
    summary: input.summary ?? "Existing event summary.",
    timeText: input.timeText ?? "未提到时间",
    eventTimeStart: input.eventTimeStart,
    eventTimeEnd: input.eventTimeEnd,
    timeConfidence: input.timeConfidence ?? 0.7,
    entities: input.entities ?? [],
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.8,
    riskLevel: input.riskLevel ?? "normal",
    requiresConfirmation: input.requiresConfirmation ?? false,
    visibility: input.visibility ?? "private",
    evidence: input.evidence ?? [evidence()],
    status: input.status ?? "active",
    createdAt: input.createdAt ?? now,
  };
}

export function buildEvent(input: Partial<MemoryPlan["events"][number]>): MemoryPlan["events"][number] {
  return {
    type: input.type ?? "general",
    title: input.title ?? "Event",
    summary: input.summary ?? "Event summary.",
    timeText: input.timeText ?? "未提到时间",
    eventTimeStart: input.eventTimeStart,
    eventTimeEnd: input.eventTimeEnd,
    timeConfidence: input.timeConfidence ?? 0.8,
    entities: input.entities ?? [],
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.8,
    riskLevel: input.riskLevel ?? "normal",
    requiresConfirmation: input.requiresConfirmation ?? false,
    visibility: input.visibility ?? "private",
    evidence: input.evidence ?? [evidence()],
  };
}

export function buildReminderCandidate(
  input: Partial<MemoryPlan["reminderCandidates"][number]>,
): MemoryPlan["reminderCandidates"][number] {
  return {
    title: input.title ?? "Reminder",
    description: input.description,
    timeText: input.timeText ?? "tomorrow",
    remindAt: input.remindAt ?? "2026-05-10T09:00:00.000Z",
    timeConfidence: input.timeConfidence ?? 0.9,
    relatedEventIndex: input.relatedEventIndex,
    confirmationRequired: input.confirmationRequired ?? false,
    suggestedConfirmers: input.suggestedConfirmers ?? [],
    confidence: input.confidence ?? 0.8,
    reason: input.reason ?? "The transcript requested a reminder.",
  };
}

export function evidence() {
  return {
    sourceId: "source-1",
    quote: "source quote",
    startChar: 0,
    endChar: 12,
  };
}

class FakeModelGateway implements ModelGateway {
  answerCalls = 0;
  answerError?: Error;
  turnError?: Error;
  lastPlanContext?: PersonalContext;
  lastTurnInput?: PlanElderTurnInput;

  turnPlan: ElderTurnPlan = {
    intent: "clarify",
    confidence: 0.5,
    clarifyingQuestion: "您想让我记住这件事，还是帮您查以前的记忆？",
  };

  parsedQuery: ParsedMemoryQuery = {
    intent: "unknown",
    requiresSourceEvidence: true,
    eventTypes: [],
    safetyTags: [],
    entities: [],
  };

  answer: MemoryAnswer = {
    answerText: "I found one memory.",
    confidence: 0.8,
    matchedSources: [],
    retrievedEvidence: [],
    suggestedActions: [],
  };

  constructor(public plan: MemoryPlan) {}

  async transcribe(): Promise<TranscriptionResult> {
    return { text: "transcribed text", confidence: 0.9 };
  }

  async embedText(): Promise<number[]> {
    return Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
  }

  async generateMemoryPlan(input: GenerateMemoryPlanInput): Promise<MemoryPlan> {
    this.lastPlanContext = input.context;
    return this.plan;
  }

  async planElderTurn(input: PlanElderTurnInput): Promise<ElderTurnPlan> {
    this.lastTurnInput = input;
    if (this.turnError) throw this.turnError;
    return this.turnPlan;
  }

  async parseMemoryQuery(): Promise<ParsedMemoryQuery> {
    return this.parsedQuery;
  }

  async generateMemoryAnswer(): Promise<MemoryAnswer> {
    this.answerCalls += 1;
    if (this.answerError) throw this.answerError;
    return this.answer;
  }
}

class FakePersonalContextStore implements PersonalContextStore {
  context: PersonalContext = emptyContext();

  async buildContext(): Promise<PersonalContext> {
    return this.context;
  }
}

export function emptyContext(): PersonalContext {
  return {
    recentEvents: [],
    semanticCandidateEvents: [],
    openReminders: [],
    semanticMemories: [],
    knownEntities: [],
    familyRelations: [],
    safetyPolicy: [],
  };
}

class InMemorySourceStore implements SourceStore {
  sources: MemorySource[] = [];

  async saveAudio(): Promise<string> {
    return "https://example.com/audio.wav";
  }

  async create(input: CreateSourceInput): Promise<MemorySource> {
    const source = { ...input, id: `source-${this.sources.length + 1}` };
    this.sources.push(source);
    return source;
  }

  async get(input: { tenantId: string; sourceId: string }): Promise<MemorySource | null> {
    return this.sources.find((source) => source.tenantId === input.tenantId && source.id === input.sourceId) ?? null;
  }
}

class InMemoryEventStore implements EventStore {
  events: MemoryEvent[] = [];
  searchResults?: MemoryEvent[];

  async create(input: CreateEventInput): Promise<MemoryEvent> {
    const event = {
      ...input,
      id: `event-${this.events.length + 1}`,
      createdAt: now,
    };
    this.events.push(event);
    return event;
  }

  async search(input: Parameters<EventStore["search"]>[0]): Promise<MemoryEvent[]> {
    return this.searchResults ?? this.events.filter((event) => event.tenantId === input.tenantId && event.elderId === input.elderId);
  }

  async getByIds(input: { tenantId: string; eventIds: string[] }): Promise<MemoryEvent[]> {
    return this.events.filter((event) => event.tenantId === input.tenantId && input.eventIds.includes(event.id));
  }
}

class InMemoryContextLinkStore implements ContextLinkStore {
  links: MemoryContextLink[] = [];

  constructor(private readonly eventStore: InMemoryEventStore) {}

  async create(input: CreateContextLinkInput): Promise<MemoryContextLink> {
    const fromEvent = this.eventStore.events.find((event) => event.id === input.fromEventId);
    const toEvent = this.eventStore.events.find((event) => event.id === input.toEventId);
    if (!fromEvent || !toEvent) throw new Error("Context link event reference not found");
    if (fromEvent.tenantId !== input.tenantId || toEvent.tenantId !== input.tenantId || fromEvent.elderId !== input.elderId || toEvent.elderId !== input.elderId) {
      throw new Error("Context link events must belong to the same tenant and elder");
    }
    const link = { ...input, id: `link-${this.links.length + 1}`, createdAt: now };
    this.links.push(link);
    return link;
  }

  async listByEventIds(input: { tenantId: string; elderId: string; eventIds: string[] }): Promise<MemoryContextLink[]> {
    const ids = new Set(input.eventIds);
    return this.links.filter(
      (link) => link.tenantId === input.tenantId && link.elderId === input.elderId && (ids.has(link.fromEventId) || ids.has(link.toEventId)),
    );
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<MemoryContextLink[]> {
    return this.links.filter((link) => link.tenantId === input.tenantId && link.elderId === input.elderId);
  }
}

class InMemoryReminderStore implements ReminderStore {
  reminders: Reminder[] = [];

  async create(input: CreateReminderInput): Promise<Reminder> {
    const reminder = {
      ...input,
      id: `reminder-${this.reminders.length + 1}`,
      createdAt: now,
    };
    this.reminders.push(reminder);
    return reminder;
  }

  async get(input: { tenantId: string; reminderId: string }): Promise<Reminder | null> {
    return this.reminders.find((reminder) => reminder.tenantId === input.tenantId && reminder.id === input.reminderId) ?? null;
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<Reminder[]> {
    return this.reminders.filter((reminder) => reminder.tenantId === input.tenantId && reminder.elderId === input.elderId);
  }

  async update(input: { tenantId: string; reminderId: string; patch: Partial<Reminder> }): Promise<Reminder> {
    const reminder = await this.get(input);
    if (!reminder) throw new Error(`Reminder not found: ${input.reminderId}`);
    Object.assign(reminder, input.patch);
    return reminder;
  }
}

class InMemoryFamilyReminderCommandStore implements FamilyReminderCommandStore {
  failReminderCreate = false;
  failAudit = false;
  private readonly commands = new Map<string, CreateFamilyReminderCommandResult>();

  constructor(
    private readonly sourceStore: InMemorySourceStore,
    private readonly reminderStore: InMemoryReminderStore,
    private readonly auditLog: InMemoryAuditLog,
  ) {}

  async create(input: CreateFamilyReminderCommandInput): Promise<CreateFamilyReminderCommandResult> {
    const commandKey = input.idempotencyKey
      ? `${input.source.tenantId}:${input.source.elderId}:${input.idempotencyKey}`
      : undefined;
    if (commandKey) {
      const existing = this.commands.get(commandKey);
      if (existing) return { ...existing, reused: true };
    }

    const sourceSnapshot = [...this.sourceStore.sources];
    const reminderSnapshot = [...this.reminderStore.reminders];
    const auditSnapshot = [...this.auditLog.records];
    try {
      const source = await this.sourceStore.create(input.source);
      if (this.failReminderCreate) throw new Error("Reminder command create failed");
      const reminder = await this.reminderStore.create({ ...input.reminder, sourceId: source.id });
      if (this.failAudit) throw new Error("Reminder command audit failed");
      await this.auditLog.record({
        ...input.audit,
        sourceId: source.id,
        payload: { ...input.audit.payload, sourceId: source.id, reminderId: reminder.id },
      });

      const result = { source, reminder, reused: false };
      if (commandKey) this.commands.set(commandKey, result);
      return result;
    } catch (error) {
      this.sourceStore.sources = sourceSnapshot;
      this.reminderStore.reminders = reminderSnapshot;
      this.auditLog.records = auditSnapshot;
      throw error;
    }
  }
}

class InMemoryFamilyTaskStore implements FamilyTaskStore {
  tasks: FamilyTask[] = [];

  async create(input: Parameters<FamilyTaskStore["create"]>[0]): Promise<FamilyTask> {
    const task: FamilyTask = {
      ...input,
      id: `task-${this.tasks.length + 1}`,
      type: input.type as FamilyTask["type"],
      urgency: input.urgency as FamilyTask["urgency"],
      visibility: input.visibility as FamilyTask["visibility"],
      status: "pending",
      createdAt: now,
    };
    this.tasks.push(task);
    return task;
  }

  async listPending(input: { tenantId: string; elderId: string }): Promise<FamilyTask[]> {
    return this.tasks.filter((task) => task.tenantId === input.tenantId && task.elderId === input.elderId && task.status === "pending");
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<FamilyTask[]> {
    return this.tasks.filter((task) => task.tenantId === input.tenantId && task.elderId === input.elderId);
  }

  async confirm(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "confirmed" });
  }

  async reject(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "rejected" });
  }

  async requestMoreInfo(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "needs_more_info" });
  }

  private updateStatus(input: {
    tenantId: string;
    taskId: string;
    actorUserId: string;
    status: FamilyTask["status"];
  }): FamilyTask {
    const task = this.tasks.find((item) => item.tenantId === input.tenantId && item.id === input.taskId);
    if (!task) throw new Error(`Family task not found: ${input.taskId}`);
    task.status = input.status;
    task.confirmedBy = input.actorUserId;
    task.confirmedAt = now;
    return task;
  }
}

class InMemoryRiskFlagStore implements RiskFlagStore {
  flags: CreateRiskFlagInput[] = [];

  async create(input: CreateRiskFlagInput) {
    this.flags.push(input);
    return { ...input, id: `risk-${this.flags.length}`, createdAt: now };
  }
}

class InMemorySemanticMemoryStore implements SemanticMemoryStore {
  memories: Array<Parameters<SemanticMemoryStore["addMemory"]>[0]> = [];
  searchResults?: MemoryRecallResult[];

  async addMemory(input: Parameters<SemanticMemoryStore["addMemory"]>[0]): Promise<void> {
    this.memories.push(input);
  }

  async searchMemory(input: Parameters<SemanticMemoryStore["searchMemory"]>[0]): Promise<MemoryRecallResult[]> {
    if (this.searchResults) return this.searchResults;
    return this.memories
      .filter((memory) => memory.tenantId === input.tenantId && memory.elderId === input.elderId)
      .map((memory) => ({
        memory: memory.memory,
        metadata: memory.metadata,
        score: 0.7,
      }));
  }
}

export class RecordingTemporalMemoryStore implements TemporalMemoryStore {
  episodes: AddTemporalEpisodeInput[] = [];
  facts: TemporalEvidence[] = [];
  searches: Parameters<TemporalMemoryStore["searchFacts"]>[0][] = [];
  failAdd = false;

  async addEpisode(input: AddTemporalEpisodeInput): Promise<void> {
    if (this.failAdd) throw new Error("Graphiti unavailable");
    this.episodes.push(input);
  }

  async searchFacts(input: Parameters<TemporalMemoryStore["searchFacts"]>[0]): Promise<TemporalEvidence[]> {
    this.searches.push(input);
    return this.facts;
  }

  async getEntityTimeline() {
    return [];
  }

  async getCurrentFacts() {
    return [];
  }
}

class InMemoryTemporalMemoryJobStore implements TemporalMemoryJobStore {
  jobs: TemporalMemoryJob[] = [];
  failEnqueue = false;

  async enqueue(input: Parameters<TemporalMemoryJobStore["enqueue"]>[0]): Promise<TemporalMemoryJob> {
    if (this.failEnqueue) throw new Error("Graphiti queue unavailable");
    const nowIso = now;
    const job: TemporalMemoryJob = {
      id: `temporal-job-${this.jobs.length + 1}`,
      tenantId: input.tenantId,
      elderId: input.elderId,
      sourceId: input.sourceId,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      nextRunAt: input.nextRunAt ?? nowIso,
      episode: input.episode,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.jobs.push(job);
    return job;
  }

  async claimDue(input: Parameters<TemporalMemoryJobStore["claimDue"]>[0]): Promise<TemporalMemoryJob[]> {
    const nowMs = new Date(input.now).getTime();
    const due = this.jobs
      .filter((job) => (job.status === "pending" || job.status === "failed") && new Date(job.nextRunAt).getTime() <= nowMs)
      .slice(0, input.limit);
    for (const job of due) {
      job.status = "running";
      job.lockedAt = input.now;
      job.updatedAt = input.now;
    }
    return due;
  }

  async markSucceeded(input: Parameters<TemporalMemoryJobStore["markSucceeded"]>[0]): Promise<TemporalMemoryJob> {
    const job = this.requireJob(input.jobId);
    job.status = "succeeded";
    job.lockedAt = undefined;
    job.lastError = undefined;
    job.updatedAt = now;
    return job;
  }

  async markFailed(input: Parameters<TemporalMemoryJobStore["markFailed"]>[0]): Promise<TemporalMemoryJob> {
    const job = this.requireJob(input.jobId);
    job.attempts += 1;
    job.status = input.dead || job.attempts >= job.maxAttempts ? "dead" : "failed";
    job.lockedAt = undefined;
    job.lastError = input.errorMessage;
    job.nextRunAt = input.nextRunAt;
    job.updatedAt = now;
    return job;
  }

  async stats(input: Parameters<TemporalMemoryJobStore["stats"]>[0] = {}) {
    const output = { pending: 0, running: 0, succeeded: 0, failed: 0, dead: 0 };
    for (const job of this.jobs) {
      if (input?.tenantId && job.tenantId !== input.tenantId) continue;
      if (input?.elderId && job.elderId !== input.elderId) continue;
      output[job.status] += 1;
    }
    return output;
  }

  private requireJob(jobId: string): TemporalMemoryJob {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Temporal job not found: ${jobId}`);
    return job;
  }
}

class InMemoryAuditLog implements AuditLog {
  records: Array<Parameters<AuditLog["record"]>[0]> = [];

  async record(input: Parameters<AuditLog["record"]>[0]): Promise<void> {
    this.records.push(input);
  }
}
