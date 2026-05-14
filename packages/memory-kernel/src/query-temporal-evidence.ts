import type { MemorySource, ParsedMemoryQuery } from "@mem/memory-schema";
import type { AuditLog, EventStore, SourceStore } from "@mem/memory-store";
import { buildTemporalGroupId, type TemporalEvidence, type TemporalMemoryStore } from "@mem/temporal-memory";
import { isString } from "./guards.js";
import { shouldSearchTemporalMemory } from "./retrieval.js";

export async function searchTemporalFactsSafely(input: {
  temporalMemory: TemporalMemoryStore;
  auditLog: AuditLog;
  tenantId: string;
  elderId: string;
  query: string;
  parsedQuery: ParsedMemoryQuery;
  traceId: string;
}): Promise<TemporalEvidence[]> {
  if (!shouldSearchTemporalMemory(input.query, input.parsedQuery)) return [];

  try {
    return await input.temporalMemory.searchFacts({
      tenantId: input.tenantId,
      elderId: input.elderId,
      groupId: buildTemporalGroupId({ tenantId: input.tenantId, elderId: input.elderId }),
      query: input.query,
      entities: input.parsedQuery.entities.map((entity) => ({ name: entity.name, type: entity.type })),
      timeRange: sanitizeTemporalTimeRange(input.parsedQuery.timeRange),
      limit: 10,
    });
  } catch (error) {
    await input.auditLog.record({
      type: "graphiti_search_failed",
      tenantId: input.tenantId,
      elderId: input.elderId,
      traceId: input.traceId,
      payload: {
        traceId: input.traceId,
        query: input.query,
        errorCode: error instanceof Error && error.name === "TemporalMemoryNotConfiguredError"
          ? "graphiti_not_configured"
          : "graphiti_search_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    return [];
  }
}

export async function alignTemporalEvidence(input: {
  sourceStore: SourceStore;
  eventStore: EventStore;
  tenantId: string;
  elderId: string;
  temporalResults: TemporalEvidence[];
}): Promise<TemporalEvidence[]> {
  const candidates = input.temporalResults.filter(
    (result) => isString(result.sourceId) && (isString(result.eventId) || isString(result.episodeId)),
  );
  if (candidates.length === 0) return [];

  const sourceIds = [...new Set(candidates.map((result) => result.sourceId).filter(isString))];
  const eventIds = [...new Set(candidates.map((result) => result.eventId).filter(isString))];
  const sources = await Promise.all(sourceIds.map((sourceId) => input.sourceStore.get({ tenantId: input.tenantId, sourceId })));
  const validSourceIds = new Set(
    sources
      .filter((source): source is MemorySource => source !== null)
      .filter((source) => source.elderId === input.elderId && source.tenantId === input.tenantId)
      .map((source) => source.id),
  );
  const events = await input.eventStore.getByIds({ tenantId: input.tenantId, eventIds });
  const validEventsById = new Map(
    events
      .filter((event) => event.elderId === input.elderId && event.tenantId === input.tenantId && validSourceIds.has(event.sourceId))
      .map((event) => [event.id, event]),
  );

  return candidates.flatMap((result) => {
    if (!result.sourceId || !validSourceIds.has(result.sourceId)) return [];
    if (result.eventId) {
      const event = validEventsById.get(result.eventId);
      if (!event || event.sourceId !== result.sourceId) return [];
      return [{
        ...result,
        metadata: {
          ...result.metadata,
          eventType: event.type,
          riskLevel: event.riskLevel,
          requiresConfirmation: event.requiresConfirmation,
        },
      }];
    }
    return isString(result.episodeId) ? [result] : [];
  });
}

function sanitizeTemporalTimeRange(
  timeRange: ParsedMemoryQuery["timeRange"],
): { start: string; end: string } | undefined {
  if (!timeRange) return undefined;
  return { start: timeRange.start, end: timeRange.end };
}
