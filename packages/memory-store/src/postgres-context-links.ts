import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { MemoryContextLink, MemoryEvent } from "@mem/memory-schema";
import type { ContextLinkStore, CreateContextLinkInput } from "./index.js";
import { mapContextLink, mapEvent } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresContextLinkStore implements ContextLinkStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateContextLinkInput): Promise<MemoryContextLink> {
    const [fromEvent, toEvent] = await Promise.all([
      this.event(input.tenantId, input.fromEventId),
      this.event(input.tenantId, input.toEventId),
    ]);
    if (!fromEvent || !toEvent) throw new Error("Context link event reference not found");
    if (fromEvent.tenantId !== input.tenantId || toEvent.tenantId !== input.tenantId || fromEvent.elderId !== input.elderId || toEvent.elderId !== input.elderId) {
      throw new Error("Context link events must belong to the same tenant and elder");
    }

    const link: MemoryContextLink = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(schema.memoryContextLinks).values({
      id: link.id,
      tenantId: link.tenantId,
      elderId: link.elderId,
      fromEventId: link.fromEventId,
      toEventId: link.toEventId,
      reminderId: link.reminderId,
      type: link.type,
      status: link.status,
      confidence: link.confidence,
      reason: link.reason,
      evidence: link.evidence,
      createdAt: new Date(link.createdAt),
    });

    return link;
  }

  async listByEventIds(input: { tenantId: string; elderId: string; eventIds: string[] }): Promise<MemoryContextLink[]> {
    const uniqueIds = [...new Set(input.eventIds)].filter(Boolean);
    if (uniqueIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(schema.memoryContextLinks)
      .where(
        and(
          eq(schema.memoryContextLinks.elderId, input.elderId),
          eq(schema.memoryContextLinks.tenantId, input.tenantId),
          or(
            inArray(schema.memoryContextLinks.fromEventId, uniqueIds),
            inArray(schema.memoryContextLinks.toEventId, uniqueIds),
          ),
        ),
      )
      .orderBy(desc(schema.memoryContextLinks.createdAt));

    return rows.map(mapContextLink);
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<MemoryContextLink[]> {
    const rows = await this.db
      .select()
      .from(schema.memoryContextLinks)
      .where(and(eq(schema.memoryContextLinks.tenantId, input.tenantId), eq(schema.memoryContextLinks.elderId, input.elderId)))
      .orderBy(desc(schema.memoryContextLinks.createdAt));
    return rows.map(mapContextLink);
  }

  private async event(tenantId: string, eventId: string): Promise<MemoryEvent | null> {
    const [row] = await this.db.select().from(schema.memoryEvents).where(
      and(eq(schema.memoryEvents.tenantId, tenantId), eq(schema.memoryEvents.id, eventId)),
    ).limit(1);
    return row ? mapEvent(row) : null;
  }
}
