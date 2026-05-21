import type { ElderMemoryKernel } from "@mem/memory-kernel";
import type { PostgresStores } from "@mem/memory-store";
import type { TemporalMemoryStore } from "@mem/temporal-memory";

export function buildHealthCheck(
  postgres: PostgresStores,
  temporalMemory: TemporalMemoryStore,
  metadata: {
    semanticMemoryProvider: string;
    model: string;
    embeddingModel: string;
    openaiTimeoutMs: number;
    openaiMemoryPlanTimeoutMs: number;
    graphitiRequired: boolean;
    checkGraphitiHealth: (temporalMemory: TemporalMemoryStore) => Promise<"ok" | "missing_config" | "unhealthy">;
  },
): () => Promise<Record<string, unknown>> {
  return async () => {
    await postgres.pool.query("select 1");
    const graphiti = await metadata.checkGraphitiHealth(temporalMemory);
    const graphitiRetryJobs = await postgres.temporalMemoryJobStore.stats();
    const memoryProcessingJobs = await postgres.memoryProcessingJobStore.stats();
    return {
      ok: metadata.graphitiRequired ? graphiti === "ok" : true,
      postgres: "ok",
      semanticMemory: metadata.semanticMemoryProvider,
      model: metadata.model,
      embeddingModel: metadata.embeddingModel,
      openaiTimeoutMs: metadata.openaiTimeoutMs,
      openaiMemoryPlanTimeoutMs: metadata.openaiMemoryPlanTimeoutMs,
      graphiti,
      graphitiRequired: metadata.graphitiRequired,
      graphitiRetryJobs,
      memoryProcessingJobs,
    };
  };
}

export function startMemoryProcessingWorker(kernel: ElderMemoryKernel, parsePositiveInt: (raw: string | undefined, fallback: number) => number): () => void {
  if (process.env.MEM_API_BACKGROUND_WORKERS === "false") return () => undefined;
  const intervalMs = parsePositiveInt(process.env.MEM_MEMORY_WORKER_POLL_MS, 2_000);
  const limit = parsePositiveInt(process.env.MEM_MEMORY_WORKER_BATCH_SIZE, 5);
  const timer = setInterval(() => {
    kernel.processMemoryProcessingJobs({ limit }).catch((error) => {
      console.error("memory processing worker failed", error);
    });
  }, intervalMs);
  void kernel.processMemoryProcessingJobs({ limit }).catch((error) => {
    console.error("memory processing worker failed", error);
  });
  return () => clearInterval(timer);
}
