import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { MemorySource, Reminder } from "@mem/memory-schema";
import type {
  CreateFamilyReminderCommandInput,
  CreateFamilyReminderCommandResult,
  FamilyReminderCommandStore,
} from "./index.js";
import { mapReminder, mapSource } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresFamilyReminderCommandStore implements FamilyReminderCommandStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateFamilyReminderCommandInput): Promise<CreateFamilyReminderCommandResult> {
    if (input.idempotencyKey) {
      const existing = await this.findExisting({
        tenantId: input.source.tenantId,
        elderId: input.source.elderId,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) return existing;
    }

    const source: MemorySource = { ...input.source, id: randomUUID() };
    const reminder: Reminder = { ...input.reminder, sourceId: source.id, id: randomUUID(), createdAt: new Date().toISOString() };

    return this.db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existing = await this.findExisting({
          tenantId: input.source.tenantId,
          elderId: input.source.elderId,
          idempotencyKey: input.idempotencyKey,
        });
        if (existing) return existing;
      }

      await tx.insert(schema.memorySources).values({
        id: source.id,
        tenantId: source.tenantId,
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

      await tx.insert(schema.reminders).values({
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

      await tx.insert(schema.auditLogs).values({
        id: randomUUID(),
        tenantId: input.audit.tenantId,
        elderId: input.audit.elderId,
        sourceId: source.id,
        type: input.audit.type,
        payload: { ...input.audit.payload, sourceId: source.id, reminderId: reminder.id },
        createdAt: new Date(),
      });

      if (input.idempotencyKey) {
        await tx.insert(schema.familyReminderCommands).values({
          id: randomUUID(),
          tenantId: source.tenantId,
          elderId: source.elderId,
          idempotencyKey: input.idempotencyKey,
          sourceId: source.id,
          reminderId: reminder.id,
          request: input.request,
          createdAt: new Date(),
        });
      }

      return { source, reminder, reused: false };
    });
  }

  private async findExisting(input: { tenantId: string; elderId: string; idempotencyKey: string }): Promise<CreateFamilyReminderCommandResult | null> {
    const [command] = await this.db
      .select()
      .from(schema.familyReminderCommands)
      .where(
        and(
          eq(schema.familyReminderCommands.tenantId, input.tenantId),
          eq(schema.familyReminderCommands.elderId, input.elderId),
          eq(schema.familyReminderCommands.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!command) return null;

    const [source] = await this.db
      .select()
      .from(schema.memorySources)
      .where(and(eq(schema.memorySources.tenantId, command.tenantId), eq(schema.memorySources.id, command.sourceId)))
      .limit(1);
    const [reminder] = await this.db
      .select()
      .from(schema.reminders)
      .where(and(eq(schema.reminders.tenantId, command.tenantId), eq(schema.reminders.id, command.reminderId)))
      .limit(1);
    if (!source || !reminder) throw new Error(`Family reminder command is missing persisted records: ${command.id}`);
    return { source: mapSource(source), reminder: mapReminder(reminder), reused: true };
  }
}
