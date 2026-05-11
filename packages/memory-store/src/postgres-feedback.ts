import { randomUUID } from "node:crypto";
import type { FeedbackStore } from "./index.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresFeedbackStore implements FeedbackStore {
  constructor(private readonly db: Db) {}

  async create(input: Parameters<FeedbackStore["create"]>[0]) {
    const item = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.db.insert(schema.feedback).values({
      id: item.id,
      tenantId: item.tenantId,
      elderId: item.elderId,
      sourceId: item.sourceId,
      eventId: item.eventId,
      actorUserId: item.actorUserId,
      feedbackType: item.feedbackType,
      correction: item.correction,
      createdAt: new Date(item.createdAt),
    });
    return item;
  }
}
