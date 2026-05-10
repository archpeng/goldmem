import type { MemoryEvent, MemorySource, Reminder, RiskFlagRecord } from "@goldmem/memory-schema";
import {
  buildTemporalGroupId,
  type AddTemporalEpisodeInput,
  type TemporalMemoryStore,
} from "@goldmem/temporal-memory";

export type BuildTemporalEpisodeInput = {
  tenantId?: string;
  elderId: string;
  source: MemorySource;
  events: MemoryEvent[];
  reminders?: Reminder[];
  riskFlags?: RiskFlagRecord[];
  metadata?: Record<string, unknown>;
};

export type WriteTemporalEpisodeInput = BuildTemporalEpisodeInput & {
  temporalMemory: TemporalMemoryStore;
};

/**
 * Builds a curated temporal episode from already-persisted GoldMem truth records.
 *
 * This is intentionally separate from the real-time ingest path. Early Graphiti
 * integration should call this from a nightly or shadow job after PostgreSQL
 * writes are complete and auditable.
 */
export function buildMemorySourceTemporalEpisode(input: BuildTemporalEpisodeInput): AddTemporalEpisodeInput {
  const riskFlags = input.riskFlags ?? [];
  const reminders = input.reminders ?? [];

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
      },
      events: input.events.map((event) => ({
        id: event.id,
        type: event.type,
        title: event.title,
        summary: event.summary,
        timeText: event.timeText,
        eventTimeStart: event.eventTimeStart,
        eventTimeEnd: event.eventTimeEnd,
        entities: event.entities,
        riskLevel: event.riskLevel,
        status: event.status,
        evidence: event.evidence,
      })),
      reminders: reminders.map((reminder) => ({
        id: reminder.id,
        eventId: reminder.eventId,
        title: reminder.title,
        remindAt: reminder.remindAt,
        status: reminder.status,
        confirmationRequired: reminder.confirmationRequired,
        reason: reminder.reason,
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
      writeMode: "shadow_or_nightly",
      sourceType: input.source.type,
      eventTypes: [...new Set(input.events.map((event) => event.type))],
      riskLevels: [...new Set(input.events.map((event) => event.riskLevel))],
    },
  };
}

export async function writeMemorySourceTemporalEpisode(input: WriteTemporalEpisodeInput): Promise<void> {
  const episode = buildMemorySourceTemporalEpisode(input);
  await input.temporalMemory.addEpisode(episode);
}
