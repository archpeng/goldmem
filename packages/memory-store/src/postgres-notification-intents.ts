import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { NotificationIntent } from "@goldmem/memory-schema";
import type { NotificationIntentStore } from "./index.js";
import { mapNotificationIntent } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresNotificationIntentStore implements NotificationIntentStore {
  constructor(private readonly db: Db) {}

  async create(input: Parameters<NotificationIntentStore["create"]>[0]): Promise<NotificationIntent> {
    const item: NotificationIntent = {
      ...input,
      id: randomUUID(),
      status: input.status ?? "pending",
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(schema.notificationIntents).values({
      id: item.id,
      tenantId: item.tenantId,
      elderId: item.elderId,
      familyUserId: item.familyUserId,
      type: item.type,
      status: item.status,
      title: item.title,
      payload: item.payload,
      createdAt: new Date(item.createdAt),
    });
    return item;
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<NotificationIntent[]> {
    const rows = await this.db
      .select()
      .from(schema.notificationIntents)
      .where(and(eq(schema.notificationIntents.tenantId, input.tenantId), eq(schema.notificationIntents.elderId, input.elderId)))
      .orderBy(desc(schema.notificationIntents.createdAt));
    return rows.map(mapNotificationIntent);
  }
}
