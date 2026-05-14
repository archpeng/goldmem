import type { MemoryEvent } from "@mem/memory-schema";
import type { AuditLog, EventStore, MemoryRecallResult, SemanticMemoryStore, SourceStore } from "@mem/memory-store";
import type { ModelGateway, RetrievedEvidence } from "@mem/model-gateway";
import { consumeProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";
import { buildEventEvidenceSummary } from "./retrieval.js";

export async function searchSemanticMemorySafely(input: {
  semanticMemory: SemanticMemoryStore;
  modelGateway: ModelGateway;
  auditLog: AuditLog;
  tenantId: string;
  elderId: string;
  query: string;
  traceId: string;
}): Promise<MemoryRecallResult[]> {
  try {
    const embedding = await input.modelGateway.embedText({ text: input.query });
    return await input.semanticMemory.searchMemory({
      tenantId: input.tenantId,
      elderId: input.elderId,
      query: input.query,
      embedding,
      limit: 10,
    });
  } catch (error) {
    await input.auditLog.record({
      type: "semantic_memory_search_failed",
      tenantId: input.tenantId,
      elderId: input.elderId,
      traceId: input.traceId,
      payload: {
        traceId: input.traceId,
        query: input.query,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        modelGateway: modelGatewayErrorPayload(error),
        providerTimings: consumeProviderTimings(input.modelGateway),
      },
    });
    return [];
  }
}

export type SemanticEvidenceAlignment = {
  evidence: RetrievedEvidence[];
  candidateLinkedCount: number;
  alignedCount: number;
  unalignedCount: number;
};

export async function alignSemanticEvidence(input: {
  sourceStore: SourceStore;
  eventStore: EventStore;
  tenantId: string;
  elderId: string;
  semanticResults: MemoryRecallResult[];
}): Promise<SemanticEvidenceAlignment> {
  const candidates = input.semanticResults.flatMap((result) => {
    const sourceId = typeof result.metadata?.sourceId === "string" ? result.metadata.sourceId : undefined;
    const eventId = typeof result.metadata?.eventId === "string" ? result.metadata.eventId : undefined;
    if (!sourceId || !eventId) return [];
    return [{ sourceId, eventId, score: result.score ?? 0.5 }];
  });
  if (candidates.length === 0) {
    return {
      evidence: [],
      candidateLinkedCount: 0,
      alignedCount: 0,
      unalignedCount: input.semanticResults.length,
    };
  }

  const eventIds = [...new Set(candidates.map((candidate) => candidate.eventId))];
  const sourceIds = [...new Set(candidates.map((candidate) => candidate.sourceId))];
  const [events, sources] = await Promise.all([
    input.eventStore.getByIds({ tenantId: input.tenantId, eventIds }),
    Promise.all(sourceIds.map((sourceId) => input.sourceStore.get({ tenantId: input.tenantId, sourceId }))),
  ]);
  const eventsById = new Map(
    events
      .filter((event) => event.tenantId === input.tenantId && event.elderId === input.elderId && event.status !== "archived")
      .map((event) => [event.id, event]),
  );
  const validSourceIds = new Set(
    sources.flatMap((source) => (
      source?.tenantId === input.tenantId && source.elderId === input.elderId ? [source.id] : []
    )),
  );

  const bestByEventId = new Map<string, { event: MemoryEvent; score: number }>();
  for (const candidate of candidates) {
    const event = eventsById.get(candidate.eventId);
    if (!event || event.sourceId !== candidate.sourceId || !validSourceIds.has(candidate.sourceId)) continue;
    const existing = bestByEventId.get(event.id);
    if (!existing || candidate.score > existing.score) {
      bestByEventId.set(event.id, { event, score: candidate.score });
    }
  }

  const evidence = [...bestByEventId.values()].map(({ event, score }) => ({
    sourceId: event.sourceId,
    eventId: event.id,
    createdAt: event.createdAt,
    summary: buildEventEvidenceSummary(event),
    score,
    canPlayAudio: true,
    retrievalSource: "semantic" as const,
    eventType: event.type,
    riskLevel: event.riskLevel,
    requiresConfirmation: event.requiresConfirmation,
  }));

  return {
    evidence,
    candidateLinkedCount: candidates.length,
    alignedCount: evidence.length,
    unalignedCount: input.semanticResults.length - evidence.length,
  };
}
