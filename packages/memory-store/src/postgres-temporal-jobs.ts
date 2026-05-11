import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { TemporalMemoryJob, TemporalMemoryJobStore } from "./index.js";
import { mapTemporalMemoryJob } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresTemporalMemoryJobStore implements TemporalMemoryJobStore {
  constructor(private readonly db: Db) {}

  async enqueue(input: {
    tenantId: string;
    elderId: string;
    sourceId: string;
    episode: Record<string, unknown>;
    nextRunAt?: string;
    maxAttempts?: number;
  }): Promise<TemporalMemoryJob> {
    const now = new Date();
    const job = {
      id: randomUUID(),
      tenantId: input.tenantId,
      elderId: input.elderId,
      sourceId: input.sourceId,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : now,
      lockedAt: null,
      lastError: null,
      episode: input.episode,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(schema.temporalMemoryJobs).values(job);
    return mapTemporalMemoryJob(job);
  }

  async claimDue(input: { now: string; limit: number }): Promise<TemporalMemoryJob[]> {
    const now = new Date(input.now);
    const rows = await this.db
      .select()
      .from(schema.temporalMemoryJobs)
      .where(
        and(
          inArray(schema.temporalMemoryJobs.status, ["pending", "failed"]),
          lte(schema.temporalMemoryJobs.nextRunAt, now),
        ),
      )
      .orderBy(schema.temporalMemoryJobs.nextRunAt, schema.temporalMemoryJobs.createdAt)
      .limit(input.limit);

    const claimed: TemporalMemoryJob[] = [];
    for (const row of rows) {
      const [updated] = await this.db
        .update(schema.temporalMemoryJobs)
        .set({ status: "running", lockedAt: now, updatedAt: now })
        .where(and(eq(schema.temporalMemoryJobs.id, row.id), inArray(schema.temporalMemoryJobs.status, ["pending", "failed"])))
        .returning();
      if (updated) claimed.push(mapTemporalMemoryJob(updated));
    }
    return claimed;
  }

  async markSucceeded(input: { jobId: string }): Promise<TemporalMemoryJob> {
    const [row] = await this.db
      .update(schema.temporalMemoryJobs)
      .set({ status: "succeeded", lockedAt: null, lastError: null, updatedAt: new Date() })
      .where(eq(schema.temporalMemoryJobs.id, input.jobId))
      .returning();
    if (!row) throw new Error(`Temporal memory job not found: ${input.jobId}`);
    return mapTemporalMemoryJob(row);
  }

  async markFailed(input: { jobId: string; errorMessage: string; nextRunAt: string; dead: boolean }): Promise<TemporalMemoryJob> {
    const [row] = await this.db.select().from(schema.temporalMemoryJobs).where(eq(schema.temporalMemoryJobs.id, input.jobId)).limit(1);
    if (!row) throw new Error(`Temporal memory job not found: ${input.jobId}`);
    const attempts = row.attempts + 1;
    const status = input.dead || attempts >= row.maxAttempts ? "dead" : "failed";
    const [updated] = await this.db
      .update(schema.temporalMemoryJobs)
      .set({
        status,
        attempts,
        lockedAt: null,
        lastError: input.errorMessage,
        nextRunAt: new Date(input.nextRunAt),
        updatedAt: new Date(),
      })
      .where(eq(schema.temporalMemoryJobs.id, input.jobId))
      .returning();
    if (!updated) throw new Error(`Temporal memory job not found: ${input.jobId}`);
    return mapTemporalMemoryJob(updated);
  }

  async stats(input: { tenantId?: string; elderId?: string } = {}): Promise<Record<TemporalMemoryJob["status"], number>> {
    const filters = [
      input.tenantId ? eq(schema.temporalMemoryJobs.tenantId, input.tenantId) : undefined,
      input.elderId ? eq(schema.temporalMemoryJobs.elderId, input.elderId) : undefined,
    ].filter(Boolean);
    const rows = await this.db
      .select()
      .from(schema.temporalMemoryJobs)
      .where(filters.length ? and(...filters) : undefined);
    const output: Record<TemporalMemoryJob["status"], number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };
    for (const row of rows) {
      const status = row.status as TemporalMemoryJob["status"];
      if (status in output) output[status] += 1;
    }
    return output;
  }
}
