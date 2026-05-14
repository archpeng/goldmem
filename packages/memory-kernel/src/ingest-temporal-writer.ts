import { type MemoryPlan, type MemorySource } from "@mem/memory-schema";
import { buildMemorySourceTemporalEpisode } from "./temporal.js";
import type { ElderMemoryKernelDeps, IngestResult } from "./index.js";
import type { AppliedMemoryPlan } from "./ingest-types.js";
import { decideTemporalEnqueue } from "./temporal-enqueue.js";

export class IngestTemporalWriter {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async enqueue(source: MemorySource, plan: MemoryPlan, applied: AppliedMemoryPlan, traceId: string): Promise<IngestResult["temporalMemory"]> {
    const decision = decideTemporalEnqueue(plan, applied);
    await this.deps.auditLog.record({
      type: "graphiti_enqueue_decision",
      tenantId: source.tenantId,
      elderId: source.elderId,
      sourceId: source.id,
      traceId,
      payload: {
        traceId,
        reason: decision.reason,
        shouldEnqueue: decision.shouldEnqueue,
        relationSignalIntents: decision.signals.map((signal) => signal.intent),
      },
    });
    if (!decision.shouldEnqueue) {
      return {
        status: "not_needed",
        enqueueReason: decision.reason,
        relationSignalIntents: decision.signals.map((signal) => signal.intent),
      };
    }

    const episode = buildMemorySourceTemporalEpisode({
      tenantId: source.tenantId,
      elderId: source.elderId,
      source,
      events: applied.events,
      reminders: applied.reminderCandidates,
      contextLinks: applied.contextLinks,
      riskFlags: applied.riskFlags,
      metadata: {
        writeMode: "production_ingest",
        traceId,
        enqueueReason: decision.reason,
        relationSignalIntents: decision.signals.map((signal) => signal.intent),
      },
    });

    try {
      await this.deps.temporalMemoryJobStore.enqueue({
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        traceId,
        episode: { ...episode },
      });
      return {
        status: "queued",
        enqueueReason: decision.reason,
        relationSignalIntents: decision.signals.map((signal) => signal.intent),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.deps.auditLog.record({
        type: "graphiti_enqueue_failed",
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        traceId,
        payload: { traceId, errorCode: "graphiti_enqueue_failed", errorMessage },
      });
      return {
        status: "failed",
        enqueueReason: decision.reason,
        relationSignalIntents: decision.signals.map((signal) => signal.intent),
        errorCode: "graphiti_enqueue_failed",
        errorMessage,
      };
    }
  }
}
