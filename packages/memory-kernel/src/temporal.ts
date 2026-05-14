import type { MemoryContextLink, MemoryEvent, MemorySource, Reminder, RiskFlagRecord } from "@mem/memory-schema";
import {
  buildTemporalGroupId,
  type AddTemporalEpisodeInput,
  type TemporalMemoryStore,
} from "@mem/temporal-memory";

export type BuildTemporalEpisodeInput = {
  tenantId: string;
  elderId: string;
  source: MemorySource;
  events: MemoryEvent[];
  reminders?: Reminder[];
  contextLinks?: MemoryContextLink[];
  riskFlags?: RiskFlagRecord[];
  metadata?: Record<string, unknown>;
};

export type WriteTemporalEpisodeInput = BuildTemporalEpisodeInput & {
  temporalMemory: TemporalMemoryStore;
};

/**
 * Builds a curated Graphiti episode from already-persisted mem truth records.
 *
 * This is used after PostgreSQL writes are complete so Graphiti receives stable
 * source/event identifiers and never becomes the business write authority.
 */
export function buildMemorySourceTemporalEpisode(input: BuildTemporalEpisodeInput): AddTemporalEpisodeInput {
  const riskFlags = input.riskFlags ?? [];
  const reminders = input.reminders ?? [];
  const contextLinks = input.contextLinks ?? [];

  return {
    groupId: buildTemporalGroupId({ tenantId: input.tenantId, elderId: input.elderId }),
    tenantId: input.tenantId,
    elderId: input.elderId,
    episodeType: input.source.type === "voice" ? "voice_memory" : "text_memory",
    occurredAt: input.source.localCreatedAt ?? input.source.createdAt,
    sourceIds: [input.source.id],
    eventIds: input.events.map((event) => event.id),
    reminderIds: reminders.map((reminder) => reminder.id),
    riskFlagIds: riskFlags.map((riskFlag) => riskFlag.id),
    content: {
      source: {
        id: input.source.id,
        type: input.source.type,
        transcript: input.source.transcript,
        createdAt: input.source.createdAt,
        localCreatedAt: input.source.localCreatedAt,
        timezone: input.source.metadata?.timezone,
      },
      events: input.events.map((event) => ({
        id: event.id,
        type: event.type,
        title: event.title,
        summary: event.summary,
        timeText: event.timeText,
        eventTimeStart: event.eventTimeStart,
        eventTimeEnd: event.eventTimeEnd,
        timeConfidence: event.timeConfidence,
        entities: event.entities,
        riskLevel: event.riskLevel,
        status: event.status,
        evidence: event.evidence,
      })),
      reminders: reminders.map((reminder) => ({
        id: reminder.id,
        eventId: reminder.eventId,
        title: reminder.title,
        timeText: reminder.timeText,
        remindAt: reminder.remindAt,
        timeConfidence: reminder.timeConfidence,
        status: reminder.status,
        confirmationRequired: reminder.confirmationRequired,
        reason: reminder.reason,
      })),
      contextLinks: contextLinks.map((link) => ({
        id: link.id,
        fromEventId: link.fromEventId,
        toEventId: link.toEventId,
        reminderId: link.reminderId,
        type: link.type,
        status: link.status,
        confidence: link.confidence,
        reason: link.reason,
        evidence: link.evidence,
      })),
      riskFlags: riskFlags.map((riskFlag) => ({
        id: riskFlag.id,
        eventId: riskFlag.eventId,
        type: riskFlag.type,
        severity: riskFlag.severity,
        summary: riskFlag.summary,
        requiresFamilyReview: riskFlag.requiresFamilyReview,
        requiresHumanConfirmation: riskFlag.requiresHumanConfirmation,
        evidence: riskFlag.evidence,
      })),
    },
    metadata: {
      ...input.metadata,
      writeMode: "production_ingest",
      sourceType: input.source.type,
      timezone: input.source.metadata?.timezone,
      eventTypes: [...new Set(input.events.map((event) => event.type))],
      riskLevels: [...new Set(input.events.map((event) => event.riskLevel))],
      temporalAnchors: {
        sourceId: input.source.id,
        eventIds: input.events.map((event) => event.id),
        reminderIds: reminders.map((reminder) => reminder.id),
        contextLinkIds: contextLinks.map((link) => link.id),
      },
    },
  };
}

export async function writeMemorySourceTemporalEpisode(input: WriteTemporalEpisodeInput): Promise<void> {
  await input.temporalMemory.addEpisode(buildMemorySourceTemporalEpisode(input));
}
