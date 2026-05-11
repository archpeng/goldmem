import { type MemorySource } from "@goldmem/memory-schema";
import { buildMemorySourceTemporalEpisode } from "./temporal.js";
import type { ElderMemoryKernelDeps, IngestResult } from "./index.js";
import type { AppliedMemoryPlan } from "./ingest-types.js";

export class IngestTemporalWriter {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async write(source: MemorySource, applied: AppliedMemoryPlan): Promise<IngestResult["temporalMemory"]> {
    const episode = buildMemorySourceTemporalEpisode({
      tenantId: source.tenantId,
      elderId: source.elderId,
      source,
      events: applied.events,
      reminders: applied.reminderCandidates,
      riskFlags: applied.riskFlags,
      metadata: { writeMode: "production_ingest" },
    });

    try {
      await this.deps.temporalMemory.addEpisode(episode);
      return { status: "written" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof Error && error.name === "TemporalMemoryNotConfiguredError"
        ? "graphiti_not_configured"
        : "graphiti_write_failed";
      let retryJobId: string | undefined;
      let retryQueued = false;
      try {
        const job = await this.deps.temporalMemoryJobStore.enqueue({
          tenantId: source.tenantId,
          elderId: source.elderId,
          sourceId: source.id,
          episode: { ...episode },
        });
        retryJobId = job.id;
        retryQueued = true;
      } catch (enqueueError) {
        const enqueueErrorMessage = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
        await this.deps.auditLog.record({
          type: "graphiti_retry_enqueue_failed",
          tenantId: source.tenantId,
          elderId: source.elderId,
          sourceId: source.id,
          payload: {
            originalErrorCode: errorCode,
            originalErrorMessage: errorMessage,
            errorMessage: enqueueErrorMessage,
          },
        });
      }
      await this.deps.auditLog.record({
        type: "graphiti_write_failed",
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        payload: { errorCode, errorMessage, retryQueued, retryJobId },
      });
      return { status: "failed", errorCode, errorMessage, retryQueued, retryJobId };
    }
  }
}
