import type { FamilyTask, MemoryContextLink, MemoryEvent, MemorySource, Reminder } from "@goldmem/memory-schema";
import type { TemporalMemoryJob } from "./index.js";
import * as schema from "./postgres-schema.js";

export function mapSource(row: typeof schema.memorySources.$inferSelect): MemorySource {
  return {
    id: row.id,
    tenantId: row.tenantId,
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

export function mapEvent(row: typeof schema.memoryEvents.$inferSelect): MemoryEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
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

export function mapReminder(row: typeof schema.reminders.$inferSelect): Reminder {
  return {
    id: row.id,
    tenantId: row.tenantId,
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

export function mapFamilyTask(row: typeof schema.familyTasks.$inferSelect): FamilyTask {
  return {
    id: row.id,
    tenantId: row.tenantId,
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

export function mapContextLink(row: typeof schema.memoryContextLinks.$inferSelect): MemoryContextLink {
  return {
    id: row.id,
    tenantId: row.tenantId,
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

export function mapTemporalMemoryJob(row: typeof schema.temporalMemoryJobs.$inferSelect): TemporalMemoryJob {
  return {
    id: row.id,
    tenantId: row.tenantId,
    elderId: row.elderId,
    sourceId: row.sourceId,
    status: row.status as TemporalMemoryJob["status"],
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt.toISOString(),
    lockedAt: row.lockedAt?.toISOString(),
    lastError: row.lastError ?? undefined,
    episode: row.episode as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
