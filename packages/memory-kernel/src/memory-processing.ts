import { DEFAULT_TENANT_ID, type IngestDraft, type IngestStatus, type MemorySource } from "@goldmem/memory-schema";
import { randomUUID } from "node:crypto";
import type { CreateSourceInput, MemoryProcessingJob } from "@goldmem/memory-store";
import { IngestOrchestrator } from "./ingest-orchestrator.js";
import { SemanticIndexer } from "./semantic-indexer.js";
import type { ElderMemoryKernelDeps, IngestTextInput } from "./index.js";

export class MemoryProcessingOrchestrator {
  private readonly ingestOrchestrator: IngestOrchestrator;
  private readonly semanticIndexer: SemanticIndexer;

  constructor(private readonly deps: ElderMemoryKernelDeps) {
    this.ingestOrchestrator = new IngestOrchestrator(deps);
    this.semanticIndexer = new SemanticIndexer(deps);
  }

  async enqueueTextIngest(input: IngestTextInput & { requiresIngestContextRecall: boolean }): Promise<IngestDraft> {
    const sourceInput: CreateSourceInput = {
      tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
      elderId: input.elderId,
      type: "text",
      transcript: input.transcript,
      createdAt: new Date().toISOString(),
      localCreatedAt: input.localCreatedAt,
      metadata: input.metadata,
    };
    const sourceResult = input.clientTurnId
      ? await this.deps.sourceStore.createForClientTurn({ ...sourceInput, clientTurnId: input.clientTurnId })
      : { source: await this.deps.sourceStore.create(sourceInput), reused: false };
    const source = sourceResult.source;
    const jobResult = await this.deps.memoryProcessingJobStore.enqueueBySource({
      type: "ingest_source",
      tenantId: source.tenantId,
      elderId: source.elderId,
      sourceId: source.id,
      traceId: input.traceId,
      payload: { requiresIngestContextRecall: input.requiresIngestContextRecall },
    });
    const job = jobResult.job;
    await this.deps.auditLog.record({
      type: sourceResult.reused || jobResult.reused ? "memory_ingest_reused" : "memory_ingest_queued",
      tenantId: source.tenantId,
      elderId: source.elderId,
      sourceId: source.id,
      traceId: input.traceId,
      payload: {
        traceId: input.traceId,
        clientTurnId: input.clientTurnId,
        processingJobId: job.id,
        sourceReused: sourceResult.reused,
        jobReused: jobResult.reused,
        requiresIngestContextRecall: input.requiresIngestContextRecall,
      },
    });
    return {
      sourceId: source.id,
      transcript: source.transcript,
      status: toDraftStatus(job.status),
      createdAt: source.createdAt,
      processingJobId: job.id,
    };
  }

  async getStatus(input: { tenantId?: string; sourceId: string }): Promise<IngestStatus> {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const job = await this.deps.memoryProcessingJobStore.getBySource({
      tenantId,
      sourceId: input.sourceId,
      type: "ingest_source",
    });
    if (!job) return { sourceId: input.sourceId, status: "failed", eventIds: [], reminderIds: [], errorMessage: "Ingest job not found" };
    if (job.status === "succeeded") {
      return {
        sourceId: input.sourceId,
        status: "ready",
        traceId: typeof job.payload.traceId === "string" ? job.payload.traceId : undefined,
        summary: typeof job.payload.summary === "string" ? job.payload.summary : undefined,
        eventIds: stringArray(job.payload.eventIds),
        reminderIds: stringArray(job.payload.reminderIds),
        temporalMemory: ingestStatusTemporalMemory(job.payload.temporalMemory),
      };
    }
    if (job.status === "running") return { sourceId: input.sourceId, status: "processing", eventIds: [], reminderIds: [] };
    if (job.status === "pending" || job.status === "failed") return { sourceId: input.sourceId, status: "queued", eventIds: [], reminderIds: [], errorMessage: job.lastError };
    return { sourceId: input.sourceId, status: "failed", eventIds: [], reminderIds: [], errorMessage: job.lastError };
  }

  async processJobs(input: { now?: string; limit?: number; types?: MemoryProcessingJob["type"][] } = {}) {
    const now = input.now ?? new Date().toISOString();
    const jobs = await this.deps.memoryProcessingJobStore.claimDue({
      now,
      limit: input.limit ?? 5,
      types: input.types,
    });
    const result = { claimed: jobs.length, succeeded: 0, failed: 0 };
    for (const job of jobs) {
      try {
        await this.processJob(job);
        result.succeeded += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  private async processJob(job: MemoryProcessingJob): Promise<void> {
    try {
      if (job.type === "ingest_source") {
        await this.processIngestSourceJob(job);
        return;
      }
      if (job.type === "semantic_index_event") {
        await this.processSemanticIndexEventJob(job);
        return;
      }
      throw new Error(`Unsupported memory processing job type: ${job.type}`);
    } catch (error) {
      await this.deps.memoryProcessingJobStore.markFailed({
        jobId: job.id,
        errorMessage: error instanceof Error ? error.message : String(error),
        nextRunAt: retryAt(job.attempts).toISOString(),
        dead: false,
        payload: job.payload,
      });
      throw error;
    }
  }

  private async processIngestSourceJob(job: MemoryProcessingJob): Promise<void> {
    const source = await this.loadSource(job);
    const result = await this.ingestOrchestrator.ingestSource(source, job.traceId ?? randomUUID(), {
      includeSemanticCandidates: job.payload.requiresIngestContextRecall === true,
    });
    await this.deps.memoryProcessingJobStore.markSucceeded({
      jobId: job.id,
      payload: {
        traceId: result.traceId,
        summary: result.summary,
        eventIds: result.events.map((event) => event.id),
        reminderIds: result.reminderCandidates.map((reminder) => reminder.id),
        temporalMemory: result.temporalMemory,
      },
    });
  }

  private async processSemanticIndexEventJob(job: MemoryProcessingJob): Promise<void> {
    const eventId = job.eventId ?? (typeof job.payload.eventId === "string" ? job.payload.eventId : undefined);
    if (!eventId) throw new Error("semantic_index_event job missing eventId");
    const [event] = await this.deps.eventStore.getByIds({ tenantId: job.tenantId, eventIds: [eventId] });
    if (!event || event.elderId !== job.elderId) throw new Error(`Memory event not found: ${eventId}`);
    await this.semanticIndexer.indexEvent(event, job.traceId);
    await this.deps.memoryProcessingJobStore.markSucceeded({
      jobId: job.id,
      payload: { eventId },
    });
  }

  private async loadSource(job: MemoryProcessingJob): Promise<MemorySource> {
    if (!job.sourceId) throw new Error("ingest_source job missing sourceId");
    const source = await this.deps.sourceStore.get({ tenantId: job.tenantId, sourceId: job.sourceId });
    if (!source) throw new Error(`Memory source not found: ${job.sourceId}`);
    return source;
  }
}

function toDraftStatus(status: MemoryProcessingJob["status"]): IngestDraft["status"] {
  if (status === "succeeded") return "ready";
  if (status === "running") return "processing";
  if (status === "dead") return "failed";
  return "queued";
}

function retryAt(attempts: number): Date {
  return new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** attempts));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function ingestStatusTemporalMemory(value: unknown): IngestStatus["temporalMemory"] {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (record.status !== "queued" && record.status !== "not_needed" && record.status !== "failed") return undefined;
  return {
    status: record.status,
    errorCode: record.errorCode === "graphiti_enqueue_failed" ? record.errorCode : undefined,
    errorMessage: typeof record.errorMessage === "string" ? record.errorMessage : undefined,
    enqueueReason: isEnqueueReason(record.enqueueReason) ? record.enqueueReason : undefined,
    relationSignalIntents: Array.isArray(record.relationSignalIntents)
      ? record.relationSignalIntents.filter(isRelationSignalIntent)
      : undefined,
  };
}

function isEnqueueReason(value: unknown): value is NonNullable<IngestStatus["temporalMemory"]>["enqueueReason"] {
  return value === "hard_risk" || value === "hard_context_link" || value === "hard_family_task" || value === "model_relation_signal" || value === "not_needed";
}

function isRelationSignalIntent(value: unknown): value is NonNullable<NonNullable<IngestStatus["temporalMemory"]>["relationSignalIntents"]>[number] {
  return value === "temporal_change" ||
    value === "conflict_resolution" ||
    value === "same_matter_link" ||
    value === "safety_chain" ||
    value === "caregiver_context" ||
    value === "long_term_pattern";
}
