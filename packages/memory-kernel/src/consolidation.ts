import { createHash } from "node:crypto";
import type { FamilyTask, MemoryEvent, MemorySource, Reminder, RiskFlagRecord } from "@goldmem/memory-schema";
import { buildTemporalGroupId, type AddTemporalEpisodeInput } from "@goldmem/temporal-memory";

export type DailyConsolidationInput = {
  tenantId: string;
  elderId: string;
  date: string;
  sources: MemorySource[];
  events: MemoryEvent[];
  reminders?: Reminder[];
  riskFlags?: RiskFlagRecord[];
  familyTasks?: FamilyTask[];
  traceId?: string;
};

export type TemporalLifecycleFact = {
  relationType: "medication_changed" | "appointment_rescheduled" | "family_confirmed";
  previousFact?: string;
  currentFact: string;
  validFrom?: string;
  validTo?: string;
  sourceId?: string;
  eventId?: string;
  confidence: number;
  confirmationState: string;
};

export function buildDailyConsolidationTemporalEpisode(input: DailyConsolidationInput): AddTemporalEpisodeInput {
  const reminders = input.reminders ?? [];
  const riskFlags = input.riskFlags ?? [];
  const familyTasks = input.familyTasks ?? [];
  const sourceIds = sortedIds(input.sources);
  const eventIds = sortedIds(input.events);
  const reminderIds = sortedIds(reminders);
  const riskFlagIds = sortedIds(riskFlags);
  const familyTaskIds = sortedIds(familyTasks);
  const lifecycleFacts = deriveTemporalLifecycleFacts({ ...input, reminders, riskFlags, familyTasks });
  const idempotencyKey = buildDailyConsolidationIdempotencyKey({
    tenantId: input.tenantId,
    elderId: input.elderId,
    date: input.date,
    sourceIds,
    eventIds,
    reminderIds,
    riskFlagIds,
    familyTaskIds,
  });

  return {
    tenantId: input.tenantId,
    elderId: input.elderId,
    groupId: buildTemporalGroupId({ tenantId: input.tenantId, elderId: input.elderId }),
    episodeType: "daily_consolidation",
    occurredAt: `${input.date}T23:59:59.000Z`,
    sourceIds,
    eventIds,
    reminderIds,
    riskFlagIds,
    familyTaskIds,
    content: {
      date: input.date,
      summary: buildDailyConsolidationSummary(input),
      sources: input.sources.map((source) => ({
        id: source.id,
        type: source.type,
        transcript: source.transcript,
        createdAt: source.createdAt,
      })),
      events: input.events.map((event) => ({
        id: event.id,
        type: event.type,
        title: event.title,
        summary: event.summary,
        eventTimeStart: event.eventTimeStart,
        eventTimeEnd: event.eventTimeEnd,
        riskLevel: event.riskLevel,
        status: event.status,
        requiresConfirmation: event.requiresConfirmation,
      })),
      reminders: reminders.map((reminder) => ({
        id: reminder.id,
        eventId: reminder.eventId,
        title: reminder.title,
        remindAt: reminder.remindAt,
        status: reminder.status,
        confirmationRequired: reminder.confirmationRequired,
      })),
      riskFlags: riskFlags.map((riskFlag) => ({
        id: riskFlag.id,
        eventId: riskFlag.eventId,
        type: riskFlag.type,
        severity: riskFlag.severity,
        summary: riskFlag.summary,
        requiresFamilyReview: riskFlag.requiresFamilyReview,
      })),
      familyTasks: familyTasks.map((task) => ({
        id: task.id,
        relatedEventId: task.relatedEventId,
        type: task.type,
        title: task.title,
        status: task.status,
        urgency: task.urgency,
      })),
      lifecycleFacts,
    },
    metadata: {
      traceId: input.traceId,
      writeMode: "daily_consolidation",
      idempotencyKey,
      date: input.date,
      sourceCount: sourceIds.length,
      eventCount: eventIds.length,
      reminderCount: reminderIds.length,
      riskFlagCount: riskFlagIds.length,
      familyTaskCount: familyTaskIds.length,
      lifecycleFactCount: lifecycleFacts.length,
    },
  };
}

export function deriveTemporalLifecycleFacts(input: DailyConsolidationInput): TemporalLifecycleFact[] {
  const eventsById = new Map(input.events.map((event) => [event.id, event]));
  const facts: TemporalLifecycleFact[] = [];
  const medicationChangeSourceIds = new Set(
    (input.riskFlags ?? [])
      .filter((riskFlag) => riskFlag.type === "medication_change")
      .map((riskFlag) => riskFlag.sourceId),
  );
  const medicationEvents = input.events
    .filter((event) => event.type === "medication")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (let index = 0; index < medicationEvents.length; index += 1) {
    const event = medicationEvents[index];
    if (!medicationChangeSourceIds.has(event.sourceId) && medicationEvents.length < 2) continue;
    facts.push({
      relationType: "medication_changed",
      previousFact: medicationEvents[index - 1]?.summary,
      currentFact: event.summary,
      validFrom: event.eventTimeStart ?? event.createdAt,
      sourceId: event.sourceId,
      eventId: event.id,
      confidence: event.confidence,
      confirmationState: event.requiresConfirmation ? "requires_confirmation" : "recorded",
    });
  }

  const appointmentEvents = input.events
    .filter((event) => event.type === "appointment")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (let index = 1; index < appointmentEvents.length; index += 1) {
    const event = appointmentEvents[index];
    facts.push({
      relationType: "appointment_rescheduled",
      previousFact: appointmentEvents[index - 1]?.summary,
      currentFact: event.summary,
      validFrom: event.eventTimeStart ?? event.createdAt,
      sourceId: event.sourceId,
      eventId: event.id,
      confidence: event.confidence,
      confirmationState: event.requiresConfirmation ? "requires_confirmation" : "recorded",
    });
  }

  for (const task of input.familyTasks ?? []) {
    if (task.status !== "confirmed" || !task.relatedEventId) continue;
    const event = eventsById.get(task.relatedEventId);
    facts.push({
      relationType: "family_confirmed",
      currentFact: `${task.title}: ${task.summary}`,
      validFrom: task.confirmedAt ?? task.createdAt,
      sourceId: event?.sourceId,
      eventId: task.relatedEventId,
      confidence: 1,
      confirmationState: "confirmed",
    });
  }

  return facts;
}

export function buildDailyConsolidationSummary(input: DailyConsolidationInput): string {
  const parts = [
    `${input.date} 共有 ${input.sources.length} 条来源、${input.events.length} 条记忆事件。`,
    input.reminders?.length ? `提醒 ${input.reminders.length} 条。` : undefined,
    input.riskFlags?.length ? `风险标记 ${input.riskFlags.length} 条。` : undefined,
    input.familyTasks?.length ? `家属任务 ${input.familyTasks.length} 条。` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

function buildDailyConsolidationIdempotencyKey(input: {
  tenantId: string;
  elderId: string;
  date: string;
  sourceIds: string[];
  eventIds: string[];
  reminderIds: string[];
  riskFlagIds: string[];
  familyTaskIds: string[];
}): string {
  const digest = createHash("sha256")
    .update([
      ...input.sourceIds,
      ...input.eventIds,
      ...input.reminderIds,
      ...input.riskFlagIds,
      ...input.familyTaskIds,
    ].join("|"))
    .digest("hex")
    .slice(0, 16);
  return `${input.tenantId}:${input.elderId}:${input.date}:daily_consolidation:${digest}`;
}

function sortedIds(records: Array<{ id?: string }>): string[] {
  return [...new Set(records.map((record) => record.id).filter((id): id is string => Boolean(id)))].sort();
}
