import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FamilyTask } from "@goldmem/memory-schema";
import type { FamilyTaskStore } from "./index.js";
import { mapFamilyTask } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresFamilyTaskStore implements FamilyTaskStore {
  constructor(private readonly db: Db) {}

  async create(input: Parameters<FamilyTaskStore["create"]>[0]): Promise<FamilyTask> {
    const task: FamilyTask = {
      id: randomUUID(),
      tenantId: input.tenantId,
      elderId: input.elderId,
      title: input.title,
      summary: input.summary,
      type: input.type as FamilyTask["type"],
      urgency: input.urgency as FamilyTask["urgency"],
      visibility: input.visibility as FamilyTask["visibility"],
      relatedEventId: input.relatedEventId,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(schema.familyTasks).values({
      id: task.id,
      tenantId: task.tenantId,
      elderId: task.elderId,
      familyUserId: task.familyUserId,
      type: task.type,
      title: task.title,
      summary: task.summary,
      status: task.status,
      visibility: task.visibility,
      urgency: task.urgency,
      relatedEventId: task.relatedEventId,
      confirmedBy: task.confirmedBy,
      confirmedAt: task.confirmedAt ? new Date(task.confirmedAt) : null,
      createdAt: new Date(task.createdAt),
    });

    return task;
  }

  async listPending(input: { tenantId: string; elderId: string }): Promise<FamilyTask[]> {
    const rows = await this.db
      .select()
      .from(schema.familyTasks)
      .where(and(
        eq(schema.familyTasks.tenantId, input.tenantId),
        eq(schema.familyTasks.elderId, input.elderId),
        eq(schema.familyTasks.status, "pending"),
      ))
      .orderBy(desc(schema.familyTasks.createdAt));
    return rows.map(mapFamilyTask);
  }

  async confirm(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "confirmed" });
  }

  async reject(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "rejected" });
  }

  async requestMoreInfo(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "needs_more_info" });
  }

  private async updateStatus(input: {
    tenantId: string;
    taskId: string;
    actorUserId: string;
    status: FamilyTask["status"];
  }): Promise<FamilyTask> {
    const confirmedAt = new Date();
    const [row] = await this.db
      .update(schema.familyTasks)
      .set({ status: input.status, confirmedBy: input.actorUserId, confirmedAt })
      .where(and(eq(schema.familyTasks.tenantId, input.tenantId), eq(schema.familyTasks.id, input.taskId)))
      .returning();
    if (!row) throw new Error(`Family task not found: ${input.taskId}`);
    return mapFamilyTask(row);
  }
}
