import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { MemoryProcessingJob, MemoryProcessingJobStore } from "./index.js";
import { mapMemoryProcessingJob } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresMemoryProcessingJobStore implements MemoryProcessingJobStore {
  constructor(private readonly db: Db) {}

  async enqueue(input: Parameters<MemoryProcessingJobStore["enqueue"]>[0]): Promise<MemoryProcessingJob> {
    const now = new Date();
    const job = {
      id: randomUUID(),
      type: input.type,
      tenantId: input.tenantId,
      elderId: input.elderId,
      sourceId: input.sourceId ?? null,
      eventId: input.eventId ?? null,
      traceId: input.traceId ?? null,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : now,
      lockedAt: null,
      lastError: null,
      payload: input.payload ?? {},
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(schema.memoryProcessingJobs).values(job);
    return mapMemoryProcessingJob(job);
  }

  async claimDue(input: Parameters<MemoryProcessingJobStore["claimDue"]>[0]): Promise<MemoryProcessingJob[]> {
    const now = new Date(input.now);
    const filters = [
      inArray(schema.memoryProcessingJobs.status, ["pending", "failed"]),
      lte(schema.memoryProcessingJobs.nextRunAt, now),
      input.types?.length ? inArray(schema.memoryProcessingJobs.type, input.types) : undefined,
    ].filter(Boolean);

    const rows = await this.db
      .select()
      .from(schema.memoryProcessingJobs)
      .where(and(...filters))
      .orderBy(schema.memoryProcessingJobs.nextRunAt, schema.memoryProcessingJobs.createdAt)
      .limit(input.limit);

    const claimed: MemoryProcessingJob[] = [];
    for (const row of rows) {
      const [updated] = await this.db
        .update(schema.memoryProcessingJobs)
        .set({ status: "running", lockedAt: now, updatedAt: now })
        .where(and(eq(schema.memoryProcessingJobs.id, row.id), inArray(schema.memoryProcessingJobs.status, ["pending", "failed"])))
        .returning();
      if (updated) claimed.push(mapMemoryProcessingJob(updated));
    }
    return claimed;
  }

  async getBySource(input: Parameters<MemoryProcessingJobStore["getBySource"]>[0]): Promise<MemoryProcessingJob | null> {
    const filters = [
      eq(schema.memoryProcessingJobs.tenantId, input.tenantId),
      eq(schema.memoryProcessingJobs.sourceId, input.sourceId),
      input.type ? eq(schema.memoryProcessingJobs.type, input.type) : undefined,
    ].filter(Boolean);
    const [row] = await this.db
      .select()
      .from(schema.memoryProcessingJobs)
      .where(and(...filters))
      .orderBy(desc(schema.memoryProcessingJobs.createdAt))
      .limit(1);
    return row ? mapMemoryProcessingJob(row) : null;
  }

  async markSucceeded(input: Parameters<MemoryProcessingJobStore["markSucceeded"]>[0]): Promise<MemoryProcessingJob> {
    const [row] = await this.db
      .update(schema.memoryProcessingJobs)
      .set({ status: "succeeded", lockedAt: null, lastError: null, payload: input.payload ?? {}, updatedAt: new Date() })
      .where(eq(schema.memoryProcessingJobs.id, input.jobId))
      .returning();
    if (!row) throw new Error(`Memory processing job not found: ${input.jobId}`);
    return mapMemoryProcessingJob(row);
  }

  async markFailed(input: Parameters<MemoryProcessingJobStore["markFailed"]>[0]): Promise<MemoryProcessingJob> {
    const [row] = await this.db.select().from(schema.memoryProcessingJobs).where(eq(schema.memoryProcessingJobs.id, input.jobId)).limit(1);
    if (!row) throw new Error(`Memory processing job not found: ${input.jobId}`);
    const attempts = row.attempts + 1;
    const status = input.dead || attempts >= row.maxAttempts ? "dead" : "failed";
    const [updated] = await this.db
      .update(schema.memoryProcessingJobs)
      .set({
        status,
        attempts,
        lockedAt: null,
        lastError: input.errorMessage,
        nextRunAt: new Date(input.nextRunAt),
        payload: input.payload ?? row.payload,
        updatedAt: new Date(),
      })
      .where(eq(schema.memoryProcessingJobs.id, input.jobId))
      .returning();
    if (!updated) throw new Error(`Memory processing job not found: ${input.jobId}`);
    return mapMemoryProcessingJob(updated);
  }

  async stats(input: Parameters<MemoryProcessingJobStore["stats"]>[0] = {}): Promise<Record<MemoryProcessingJob["status"], number>> {
    const filters = [
      input.tenantId ? eq(schema.memoryProcessingJobs.tenantId, input.tenantId) : undefined,
      input.elderId ? eq(schema.memoryProcessingJobs.elderId, input.elderId) : undefined,
      input.types?.length ? inArray(schema.memoryProcessingJobs.type, input.types) : undefined,
    ].filter(Boolean);
    const rows = await this.db
      .select()
      .from(schema.memoryProcessingJobs)
      .where(filters.length ? and(...filters) : undefined);
    const output: Record<MemoryProcessingJob["status"], number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };
    for (const row of rows) {
      const status = row.status as MemoryProcessingJob["status"];
      if (status in output) output[status] += 1;
    }
    return output;
  }
}
