import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type {
  FamilyTask,
  MemoryContextLink,
  MemoryEvent,
  MemorySource,
  Reminder,
  RiskFlagRecord,
} from "@goldmem/memory-schema";
import type { PersonalContext } from "@goldmem/model-gateway";
import type {
  AuditLog,
  ContextLinkStore,
  CreateContextLinkInput,
  CreateEventInput,
  CreateReminderInput,
  CreateRiskFlagInput,
  CreateSourceInput,
  EventStore,
  FamilyTaskStore,
  FeedbackStore,
  PersonalContextStore,
  ReminderStore,
  RiskFlagStore,
  SourceStore,
} from "./index.js";
import * as schema from "./postgres-schema.js";

type Db = NodePgDatabase<typeof schema>;

export type PostgresStoreOptions = {
  databaseUrl: string;
  audioDir?: string;
  publicAudioBaseUrl?: string;
};

export type PostgresStores = {
  pool: Pool;
  db: Db;
  sourceStore: SourceStore;
  eventStore: EventStore;
  contextLinkStore: ContextLinkStore;
  reminderStore: ReminderStore;
  familyTaskStore: FamilyTaskStore;
  riskFlagStore: RiskFlagStore;
  feedbackStore: FeedbackStore;
  personalContextStore: PersonalContextStore;
  auditLog: AuditLog;
  close(): Promise<void>;
};

export function createPostgresStores(options: PostgresStoreOptions): PostgresStores {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const db = drizzle(pool, { schema });

  return {
    pool,
    db,
    sourceStore: new PostgresSourceStore(db, options),
    eventStore: new PostgresEventStore(db),
    contextLinkStore: new PostgresContextLinkStore(db),
    reminderStore: new PostgresReminderStore(db),
    familyTaskStore: new PostgresFamilyTaskStore(db),
    riskFlagStore: new PostgresRiskFlagStore(db),
    feedbackStore: new PostgresFeedbackStore(db),
    personalContextStore: new PostgresPersonalContextStore(db),
    auditLog: new PostgresAuditLog(db),
    close: () => pool.end(),
  };
}

class PostgresSourceStore implements SourceStore {
  constructor(
    private readonly db: Db,
    private readonly options: PostgresStoreOptions,
  ) {}

  async saveAudio(audio: Uint8Array): Promise<string> {
    const audioDir = this.options.audioDir ?? ".goldmem/audio";
    await mkdir(audioDir, { recursive: true });
    const filename = `${randomUUID()}.wav`;
    await writeFile(join(audioDir, filename), audio);
    const baseUrl = this.options.publicAudioBaseUrl ?? "file://.goldmem/audio";
    return `${baseUrl.replace(/\/$/, "")}/${filename}`;
  }

  async create(input: CreateSourceInput): Promise<MemorySource> {
    const source: MemorySource = {
      ...input,
      id: randomUUID(),
    };

    await this.db.insert(schema.memorySources).values({
      id: source.id,
      elderId: source.elderId,
      type: source.type,
      audioUrl: source.audioUrl,
      transcript: source.transcript,
      asrConfidence: source.asrConfidence,
      createdAt: new Date(source.createdAt),
      localCreatedAt: source.localCreatedAt ? new Date(source.localCreatedAt) : null,
      deviceId: source.deviceId,
      metadata: source.metadata,
    });

    return source;
  }

  async get(sourceId: string): Promise<MemorySource | null> {
    const [row] = await this.db.select().from(schema.memorySources).where(eq(schema.memorySources.id, sourceId)).limit(1);
    return row ? mapSource(row) : null;
  }
}

class PostgresEventStore implements EventStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateEventInput): Promise<MemoryEvent> {
    const event: MemoryEvent = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(schema.memoryEvents).values({
      id: event.id,
      elderId: event.elderId,
      sourceId: event.sourceId,
      type: event.type,
      title: event.title,
      summary: event.summary,
      timeText: event.timeText,
      eventTimeStart: event.eventTimeStart ? new Date(event.eventTimeStart) : null,
      eventTimeEnd: event.eventTimeEnd ? new Date(event.eventTimeEnd) : null,
      timeConfidence: event.timeConfidence,
      entities: event.entities,
      importance: event.importance,
      confidence: event.confidence,
      riskLevel: event.riskLevel,
      requiresConfirmation: event.requiresConfirmation,
      visibility: event.visibility,
      evidence: event.evidence,
      status: event.status,
      createdAt: new Date(event.createdAt),
    });

    return event;
  }

  async getByIds(eventIds: string[]): Promise<MemoryEvent[]> {
    const uniqueIds = [...new Set(eventIds)].filter(Boolean);
    if (uniqueIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(schema.memoryEvents)
      .where(inArray(schema.memoryEvents.id, uniqueIds));

    return rows.map(mapEvent);
  }

  async search(input: {
    elderId: string;
    query?: string;
    types?: string[];
    timeRange?: { start: string; end: string };
    entityNames?: string[];
    limit?: number;
  }): Promise<MemoryEvent[]> {
    const filters = [eq(schema.memoryEvents.elderId, input.elderId)];
    const terms = buildRecallTerms(input.query, input.entityNames);
    if (terms.length) {
      const textFilter = or(
        ...terms.flatMap((term) => [
          ilike(schema.memoryEvents.title, `%${term}%`),
          ilike(schema.memoryEvents.summary, `%${term}%`),
        ]),
      );
      if (textFilter) filters.push(textFilter);
    }

    const rows = await this.db
      .select()
      .from(schema.memoryEvents)
      .where(and(...filters))
      .orderBy(desc(schema.memoryEvents.createdAt))
      .limit(input.limit ?? 20);

    return rows.map(mapEvent);
  }
}

class PostgresContextLinkStore implements ContextLinkStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateContextLinkInput): Promise<MemoryContextLink> {
    const [fromEvent, toEvent] = await Promise.all([
      this.event(input.fromEventId),
      this.event(input.toEventId),
    ]);
    if (!fromEvent || !toEvent) throw new Error("Context link event reference not found");
    if (fromEvent.elderId !== input.elderId || toEvent.elderId !== input.elderId) {
      throw new Error("Context link events must belong to the same elder");
    }

    const link: MemoryContextLink = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(schema.memoryContextLinks).values({
      id: link.id,
      elderId: link.elderId,
      fromEventId: link.fromEventId,
      toEventId: link.toEventId,
      reminderId: link.reminderId,
      type: link.type,
      status: link.status,
      confidence: link.confidence,
      reason: link.reason,
      evidence: link.evidence,
      createdAt: new Date(link.createdAt),
    });

    return link;
  }

  async listByEventIds(input: { elderId: string; eventIds: string[] }): Promise<MemoryContextLink[]> {
    const uniqueIds = [...new Set(input.eventIds)].filter(Boolean);
    if (uniqueIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(schema.memoryContextLinks)
      .where(
        and(
          eq(schema.memoryContextLinks.elderId, input.elderId),
          or(
            inArray(schema.memoryContextLinks.fromEventId, uniqueIds),
            inArray(schema.memoryContextLinks.toEventId, uniqueIds),
          ),
        ),
      )
      .orderBy(desc(schema.memoryContextLinks.createdAt));

    return rows.map(mapContextLink);
  }

  async listByElder(elderId: string): Promise<MemoryContextLink[]> {
    const rows = await this.db
      .select()
      .from(schema.memoryContextLinks)
      .where(eq(schema.memoryContextLinks.elderId, elderId))
      .orderBy(desc(schema.memoryContextLinks.createdAt));
    return rows.map(mapContextLink);
  }

  private async event(eventId: string): Promise<MemoryEvent | null> {
    const [row] = await this.db.select().from(schema.memoryEvents).where(eq(schema.memoryEvents.id, eventId)).limit(1);
    return row ? mapEvent(row) : null;
  }
}

class PostgresReminderStore implements ReminderStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateReminderInput): Promise<Reminder> {
    const reminder: Reminder = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(schema.reminders).values({
      id: reminder.id,
      elderId: reminder.elderId,
      sourceId: reminder.sourceId,
      eventId: reminder.eventId,
      title: reminder.title,
      description: reminder.description,
      remindAt: reminder.remindAt ? new Date(reminder.remindAt) : null,
      status: reminder.status,
      confirmationRequired: reminder.confirmationRequired,
      confidence: reminder.confidence,
      reason: reminder.reason,
      confirmedBy: reminder.confirmedBy,
      confirmedAt: reminder.confirmedAt ? new Date(reminder.confirmedAt) : null,
      createdAt: new Date(reminder.createdAt),
    });

    return reminder;
  }

  async get(reminderId: string): Promise<Reminder | null> {
    const [row] = await this.db.select().from(schema.reminders).where(eq(schema.reminders.id, reminderId)).limit(1);
    return row ? mapReminder(row) : null;
  }

  async listByElder(elderId: string): Promise<Reminder[]> {
    const rows = await this.db
      .select()
      .from(schema.reminders)
      .where(eq(schema.reminders.elderId, elderId))
      .orderBy(desc(schema.reminders.createdAt));
    return rows.map(mapReminder);
  }

  async update(reminderId: string, patch: Partial<Reminder>): Promise<Reminder> {
    const [row] = await this.db
      .update(schema.reminders)
      .set({
        remindAt: patch.remindAt ? new Date(patch.remindAt) : undefined,
        status: patch.status,
        confirmedBy: patch.confirmedBy,
        confirmedAt: patch.confirmedAt ? new Date(patch.confirmedAt) : undefined,
      })
      .where(eq(schema.reminders.id, reminderId))
      .returning();

    if (!row) throw new Error(`Reminder not found: ${reminderId}`);
    return mapReminder(row);
  }
}

class PostgresFamilyTaskStore implements FamilyTaskStore {
  constructor(private readonly db: Db) {}

  async create(input: Parameters<FamilyTaskStore["create"]>[0]): Promise<FamilyTask> {
    const task: FamilyTask = {
      id: randomUUID(),
      elderId: input.elderId,
      title: input.title,
      summary: input.summary,
      type: input.type as FamilyTask["type"],
      urgency: input.urgency as FamilyTask["urgency"],
      visibility: input.visibility as FamilyTask["visibility"],
      relatedEventId: input.relatedEventId,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(schema.familyTasks).values({
      id: task.id,
      elderId: task.elderId,
      familyUserId: task.familyUserId,
      type: task.type,
      title: task.title,
      summary: task.summary,
      status: task.status,
      visibility: task.visibility,
      urgency: task.urgency,
      relatedEventId: task.relatedEventId,
      confirmedBy: task.confirmedBy,
      confirmedAt: task.confirmedAt ? new Date(task.confirmedAt) : null,
      createdAt: new Date(task.createdAt),
    });

    return task;
  }

  async listPending(elderId: string): Promise<FamilyTask[]> {
    const rows = await this.db
      .select()
      .from(schema.familyTasks)
      .where(and(eq(schema.familyTasks.elderId, elderId), eq(schema.familyTasks.status, "pending")))
      .orderBy(desc(schema.familyTasks.createdAt));
    return rows.map(mapFamilyTask);
  }

  async confirm(taskId: string, actorUserId: string): Promise<FamilyTask> {
    const confirmedAt = new Date();
    const [row] = await this.db
      .update(schema.familyTasks)
      .set({ status: "confirmed", confirmedBy: actorUserId, confirmedAt })
      .where(eq(schema.familyTasks.id, taskId))
      .returning();
    if (!row) throw new Error(`Family task not found: ${taskId}`);
    return mapFamilyTask(row);
  }
}

class PostgresRiskFlagStore implements RiskFlagStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateRiskFlagInput): Promise<RiskFlagRecord> {
    const flag: RiskFlagRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(schema.riskFlags).values({
      id: flag.id,
      elderId: flag.elderId,
      sourceId: flag.sourceId,
      eventId: flag.eventId,
      type: flag.type,
      severity: flag.severity,
      summary: flag.summary,
      reason: flag.reason,
      requiresFamilyReview: flag.requiresFamilyReview,
      requiresHumanConfirmation: flag.requiresHumanConfirmation,
      evidence: flag.evidence,
      createdAt: new Date(flag.createdAt),
    });
    return flag;
  }
}

class PostgresFeedbackStore implements FeedbackStore {
  constructor(private readonly db: Db) {}

  async create(input: Parameters<FeedbackStore["create"]>[0]) {
    const item = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.db.insert(schema.feedback).values({
      id: item.id,
      elderId: item.elderId,
      sourceId: item.sourceId,
      eventId: item.eventId,
      actorUserId: item.actorUserId,
      feedbackType: item.feedbackType,
      correction: item.correction,
      createdAt: new Date(item.createdAt),
    });
    return item;
  }
}

class PostgresPersonalContextStore implements PersonalContextStore {
  constructor(private readonly db: Db) {}

  async buildContext(input: { elderId: string; queryText: string }): Promise<PersonalContext> {
    const recentEvents = await this.db
      .select()
      .from(schema.memoryEvents)
      .where(eq(schema.memoryEvents.elderId, input.elderId))
      .orderBy(desc(schema.memoryEvents.createdAt))
      .limit(10);

    const openReminders = await this.db
      .select()
      .from(schema.reminders)
      .where(
        and(
          eq(schema.reminders.elderId, input.elderId),
          or(
            eq(schema.reminders.status, "candidate"),
            eq(schema.reminders.status, "pending_elder_confirm"),
            eq(schema.reminders.status, "pending_family_confirm"),
          ),
        ),
      )
      .orderBy(desc(schema.reminders.createdAt))
      .limit(10);

    const family = await this.db
      .select()
      .from(schema.familyLinks)
      .where(eq(schema.familyLinks.elderId, input.elderId))
      .limit(20);

    return {
      recentEvents: recentEvents.map((event) => ({
        eventId: event.id,
        sourceId: event.sourceId,
        title: event.title,
        summary: event.summary,
        createdAt: event.createdAt.toISOString(),
      })),
      openReminders: openReminders.map((reminder) => ({
        reminderId: reminder.id,
        eventId: reminder.eventId ?? undefined,
        title: reminder.title,
        reason: reminder.reason,
        timeText: undefined,
        remindAt: reminder.remindAt?.toISOString(),
        timeConfidence: reminder.confidence,
        status: reminder.status,
      })),
      semanticMemories: [],
      knownEntities: [],
      familyRelations: family.map((link) => ({
        name: link.familyUserId,
        relationship: link.relationship,
        userId: link.familyUserId,
      })),
      safetyPolicy: [
        "Require confirmation for medication, medical, financial, password, identity, and fraud-like content.",
        "Do not expose sensitive details unnecessarily.",
      ],
    };
  }
}

class PostgresAuditLog implements AuditLog {
  constructor(private readonly db: Db) {}

  async record(input: Parameters<AuditLog["record"]>[0]): Promise<void> {
    await this.db.insert(schema.auditLogs).values({
      id: randomUUID(),
      elderId: input.elderId,
      sourceId: input.sourceId,
      type: input.type,
      payload: input.payload,
      createdAt: new Date(),
    });
  }
}

function mapSource(row: typeof schema.memorySources.$inferSelect): MemorySource {
  return {
    id: row.id,
    elderId: row.elderId,
    type: row.type as MemorySource["type"],
    transcript: row.transcript,
    audioUrl: row.audioUrl ?? undefined,
    createdAt: row.createdAt.toISOString(),
    localCreatedAt: row.localCreatedAt?.toISOString(),
    asrConfidence: row.asrConfidence ?? undefined,
    deviceId: row.deviceId ?? undefined,
    metadata: (row.metadata as MemorySource["metadata"]) ?? undefined,
  };
}

function mapEvent(row: typeof schema.memoryEvents.$inferSelect): MemoryEvent {
  return {
    id: row.id,
    elderId: row.elderId,
    sourceId: row.sourceId,
    type: row.type as MemoryEvent["type"],
    title: row.title,
    summary: row.summary,
    timeText: row.timeText ?? undefined,
    eventTimeStart: row.eventTimeStart?.toISOString(),
    eventTimeEnd: row.eventTimeEnd?.toISOString(),
    timeConfidence: row.timeConfidence,
    entities: row.entities as MemoryEvent["entities"],
    importance: row.importance,
    confidence: row.confidence,
    riskLevel: row.riskLevel as MemoryEvent["riskLevel"],
    requiresConfirmation: row.requiresConfirmation,
    visibility: row.visibility as MemoryEvent["visibility"],
    evidence: row.evidence as MemoryEvent["evidence"],
    status: row.status as MemoryEvent["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

function mapReminder(row: typeof schema.reminders.$inferSelect): Reminder {
  return {
    id: row.id,
    elderId: row.elderId,
    sourceId: row.sourceId,
    eventId: row.eventId ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    remindAt: row.remindAt?.toISOString(),
    status: row.status as Reminder["status"],
    confirmationRequired: row.confirmationRequired,
    confidence: row.confidence,
    reason: row.reason,
    confirmedBy: row.confirmedBy ?? undefined,
    confirmedAt: row.confirmedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapFamilyTask(row: typeof schema.familyTasks.$inferSelect): FamilyTask {
  return {
    id: row.id,
    elderId: row.elderId,
    familyUserId: row.familyUserId ?? undefined,
    type: row.type as FamilyTask["type"],
    title: row.title,
    summary: row.summary,
    status: row.status as FamilyTask["status"],
    visibility: row.visibility as FamilyTask["visibility"],
    urgency: row.urgency as FamilyTask["urgency"],
    relatedEventId: row.relatedEventId ?? undefined,
    confirmedBy: row.confirmedBy ?? undefined,
    confirmedAt: row.confirmedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapContextLink(row: typeof schema.memoryContextLinks.$inferSelect): MemoryContextLink {
  return {
    id: row.id,
    elderId: row.elderId,
    fromEventId: row.fromEventId,
    toEventId: row.toEventId,
    reminderId: row.reminderId ?? undefined,
    type: row.type as MemoryContextLink["type"],
    status: row.status as MemoryContextLink["status"],
    confidence: row.confidence,
    reason: row.reason,
    evidence: row.evidence as MemoryContextLink["evidence"],
    createdAt: row.createdAt.toISOString(),
  };
}

function buildRecallTerms(query?: string, entityNames?: string[]): string[] {
  const terms = new Set<string>();
  for (const value of [query, ...(entityNames ?? [])]) {
    if (!value) continue;
    for (const term of tokenizeRecallText(value)) terms.add(term);
  }
  return [...terms].slice(0, 16);
}

function tokenizeRecallText(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return [];

  const terms = new Set<string>();
  for (const token of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= 2) terms.add(token);
    if (/[\p{Script=Han}]/u.test(token)) {
      for (const item of cjkNgrams(token)) terms.add(item);
    }
  }

  return [...terms];
}

function cjkNgrams(value: string): string[] {
  const chars = [...value].filter((char) => /[\p{Script=Han}]/u.test(char));
  const grams: string[] = [];
  for (const size of [2, 3]) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      grams.push(chars.slice(index, index + size).join(""));
    }
  }
  return grams;
}
