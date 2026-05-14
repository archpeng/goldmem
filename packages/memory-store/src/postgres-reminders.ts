import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Reminder } from "@mem/memory-schema";
import type { CreateReminderInput, ReminderStore } from "./index.js";
import { mapReminder } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresReminderStore implements ReminderStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateReminderInput): Promise<Reminder> {
    const reminder: Reminder = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(schema.reminders).values({
      id: reminder.id,
      tenantId: reminder.tenantId,
      elderId: reminder.elderId,
      sourceId: reminder.sourceId,
      eventId: reminder.eventId,
      title: reminder.title,
      description: reminder.description,
      timeText: reminder.timeText,
      remindAt: reminder.remindAt ? new Date(reminder.remindAt) : null,
      timeConfidence: reminder.timeConfidence,
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

  async get(input: { tenantId: string; reminderId: string }): Promise<Reminder | null> {
    const [row] = await this.db.select().from(schema.reminders).where(
      and(eq(schema.reminders.tenantId, input.tenantId), eq(schema.reminders.id, input.reminderId)),
    ).limit(1);
    return row ? mapReminder(row) : null;
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<Reminder[]> {
    const rows = await this.db
      .select()
      .from(schema.reminders)
      .where(and(eq(schema.reminders.tenantId, input.tenantId), eq(schema.reminders.elderId, input.elderId)))
      .orderBy(desc(schema.reminders.createdAt));
    return rows.map(mapReminder);
  }

  async findByRemindAtRange(input: {
    tenantId: string;
    elderId: string;
    fromIso: string;
    toIso: string;
    statuses?: Reminder["status"][];
  }): Promise<Reminder[]> {
    const filters = [
      eq(schema.reminders.tenantId, input.tenantId),
      eq(schema.reminders.elderId, input.elderId),
      gte(schema.reminders.remindAt, new Date(input.fromIso)),
      lt(schema.reminders.remindAt, new Date(input.toIso)),
    ];
    if (input.statuses?.length) filters.push(inArray(schema.reminders.status, input.statuses));

    const rows = await this.db
      .select()
      .from(schema.reminders)
      .where(and(...filters))
      .orderBy(asc(schema.reminders.remindAt), desc(schema.reminders.createdAt));
    return rows.map(mapReminder);
  }

  async findByConfirmedAtRange(input: {
    tenantId: string;
    elderId: string;
    fromIso: string;
    toIso: string;
  }): Promise<Reminder[]> {
    const rows = await this.db
      .select()
      .from(schema.reminders)
      .where(and(
        eq(schema.reminders.tenantId, input.tenantId),
        eq(schema.reminders.elderId, input.elderId),
        gte(schema.reminders.confirmedAt, new Date(input.fromIso)),
        lt(schema.reminders.confirmedAt, new Date(input.toIso)),
      ))
      .orderBy(desc(schema.reminders.confirmedAt), desc(schema.reminders.createdAt));
    return rows.map(mapReminder);
  }

  async update(input: { tenantId: string; reminderId: string; patch: Partial<Reminder> }): Promise<Reminder> {
    const [row] = await this.db
      .update(schema.reminders)
      .set({
        remindAt: input.patch.remindAt ? new Date(input.patch.remindAt) : undefined,
        title: input.patch.title,
        description: input.patch.description,
        timeText: input.patch.timeText,
        timeConfidence: input.patch.timeConfidence,
        status: input.patch.status,
        confirmationRequired: input.patch.confirmationRequired,
        reason: input.patch.reason,
        confirmedBy: input.patch.confirmedBy,
        confirmedAt: input.patch.confirmedAt ? new Date(input.patch.confirmedAt) : undefined,
      })
      .where(and(eq(schema.reminders.tenantId, input.tenantId), eq(schema.reminders.id, input.reminderId)))
      .returning();

    if (!row) throw new Error(`Reminder not found: ${input.reminderId}`);
    return mapReminder(row);
  }
}
