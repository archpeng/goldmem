import { and, desc, eq, or } from "drizzle-orm";
import type { ElderProfile, PersonalContext } from "@mem/memory-schema";
import type { ElderProfileStore, PersonalContextStore } from "./index.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

const SAFETY_POLICY = [
  "Require confirmation for medication, medical, financial, password, identity, and fraud-like content.",
  "Do not expose sensitive details unnecessarily.",
];

function elderProfileToContextRecord(profile: ElderProfile | null): Record<string, unknown> | undefined {
  if (!profile) return undefined;
  const record: Record<string, unknown> = {
    displayName: profile.displayName,
    timezone: profile.timezone,
  };
  if (profile.wakeTime) record.wakeTime = profile.wakeTime;
  if (profile.sleepTime) record.sleepTime = profile.sleepTime;
  if (profile.medications.length > 0) record.medications = profile.medications;
  if (profile.places.length > 0) record.places = profile.places;
  if (profile.notes) record.notes = profile.notes;
  return record;
}

export class PostgresPersonalContextStore implements PersonalContextStore {
  constructor(
    private readonly db: Db,
    private readonly elderProfileStore?: ElderProfileStore,
  ) {}

  async buildContext(input: { tenantId: string; elderId: string; queryText: string }): Promise<PersonalContext> {
    const recentEvents = await this.db
      .select()
      .from(schema.memoryEvents)
      .where(and(eq(schema.memoryEvents.tenantId, input.tenantId), eq(schema.memoryEvents.elderId, input.elderId)))
      .orderBy(desc(schema.memoryEvents.createdAt))
      .limit(5);

    const openReminders = await this.db
      .select()
      .from(schema.reminders)
      .where(
        and(
          eq(schema.reminders.elderId, input.elderId),
          eq(schema.reminders.tenantId, input.tenantId),
          or(
            eq(schema.reminders.status, "candidate"),
            eq(schema.reminders.status, "pending_elder_confirm"),
            eq(schema.reminders.status, "pending_family_confirm"),
          ),
        ),
      )
      .orderBy(desc(schema.reminders.createdAt))
      .limit(5);

    const family = await this.db
      .select()
      .from(schema.familyLinks)
      .where(and(eq(schema.familyLinks.tenantId, input.tenantId), eq(schema.familyLinks.elderId, input.elderId)))
      .limit(20);

    const profile = this.elderProfileStore
      ? await this.elderProfileStore.get({ tenantId: input.tenantId, elderId: input.elderId })
      : null;

    return {
      elderProfile: elderProfileToContextRecord(profile),
      recentEvents: recentEvents.map((event) => ({
        eventId: event.id,
        sourceId: event.sourceId,
        title: event.title,
        summary: event.summary,
        createdAt: event.createdAt.toISOString(),
      })),
      semanticCandidateEvents: [],
      openReminders: openReminders.map((reminder) => ({
        reminderId: reminder.id,
        eventId: reminder.eventId ?? undefined,
        title: reminder.title,
        reason: reminder.reason,
        timeText: reminder.timeText ?? undefined,
        remindAt: reminder.remindAt?.toISOString(),
        timeConfidence: reminder.timeConfidence ?? undefined,
        status: reminder.status,
      })),
      semanticMemories: [],
      knownEntities: [],
      familyRelations: family.map((link) => ({
        name: link.familyUserId,
        relationship: link.relationship,
        userId: link.familyUserId,
      })),
      safetyPolicy: SAFETY_POLICY,
    };
  }

  async buildPlanContext(input: { tenantId: string; elderId: string }): Promise<PersonalContext> {
    const family = await this.db
      .select()
      .from(schema.familyLinks)
      .where(and(eq(schema.familyLinks.tenantId, input.tenantId), eq(schema.familyLinks.elderId, input.elderId)))
      .limit(20);

    const profile = this.elderProfileStore
      ? await this.elderProfileStore.get({ tenantId: input.tenantId, elderId: input.elderId })
      : null;

    return {
      elderProfile: elderProfileToContextRecord(profile),
      recentEvents: [],
      semanticCandidateEvents: [],
      openReminders: [],
      semanticMemories: [],
      knownEntities: [],
      familyRelations: family.map((link) => ({
        name: link.familyUserId,
        relationship: link.relationship,
        userId: link.familyUserId,
      })),
      safetyPolicy: SAFETY_POLICY,
    };
  }
}
