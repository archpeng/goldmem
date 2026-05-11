import type { PostgresStores, TemporalMemoryJob } from "../packages/memory-store/src/index.js";
import { parseAddTemporalEpisodeInput, type TemporalMemoryStore } from "../packages/temporal-memory/src/index.js";

export type GraphitiRetryBatchStats = {
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
};

export async function runGraphitiRetryBatch(input: {
  postgres: PostgresStores;
  temporalMemory: TemporalMemoryStore;
  batchSize: number;
}): Promise<GraphitiRetryBatchStats> {
  const jobs = await input.postgres.temporalMemoryJobStore.claimDue({ now: new Date().toISOString(), limit: input.batchSize });
  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const job of jobs) {
    try {
      await input.temporalMemory.addEpisode(parseAddTemporalEpisodeInput(job.episode));
      await input.postgres.temporalMemoryJobStore.markSucceeded({ jobId: job.id });
      await audit(input.postgres, "graphiti_retry_succeeded", job, {});
      succeeded += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const willBeDead = job.attempts + 1 >= job.maxAttempts;
      const updated = await input.postgres.temporalMemoryJobStore.markFailed({
        jobId: job.id,
        errorMessage,
        nextRunAt: nextRetryTime(job).toISOString(),
        dead: willBeDead,
      });
      await audit(input.postgres, updated.status === "dead" ? "graphiti_retry_dead" : "graphiti_retry_failed", updated, { errorMessage });
      if (updated.status === "dead") dead += 1;
      else failed += 1;
    }
  }

  return { claimed: jobs.length, succeeded, failed, dead };
}

async function audit(postgres: PostgresStores, type: string, job: TemporalMemoryJob, payload: Record<string, unknown>) {
  const traceId = extractTraceId(job.episode);
  await postgres.auditLog.record({
    type,
    tenantId: job.tenantId,
    elderId: job.elderId,
    sourceId: job.sourceId,
    traceId,
    payload: { traceId, jobId: job.id, attempts: job.attempts, status: job.status, ...payload },
  });
}

function extractTraceId(episode: Record<string, unknown>): string | undefined {
  const metadata = episode.metadata;
  if (!metadata || typeof metadata !== "object" || !("traceId" in metadata)) return undefined;
  const traceId = (metadata as { traceId?: unknown }).traceId;
  return typeof traceId === "string" && traceId.length > 0 ? traceId : undefined;
}

function nextRetryTime(job: TemporalMemoryJob): Date {
  const delayMs = Math.min(60 * 60 * 1000, 60_000 * 2 ** job.attempts);
  return new Date(Date.now() + delayMs);
}
