import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { MemoryEvent } from "@mem/memory-schema";
import type { CreateEventInput, EventStore, EventTypeAggregate } from "./index.js";
import { mapEvent } from "./postgres-mappers.js";
import { buildRecallTerms } from "./postgres-recall-terms.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresEventStore implements EventStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateEventInput): Promise<MemoryEvent> {
    const event: MemoryEvent = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    await this.db.insert(schema.memoryEvents).values({
      id: event.id,
      tenantId: event.tenantId,
      elderId: event.elderId,
      sourceId: event.sourceId,
      type: event.type,
      title: event.title,
      summary: event.summary,
      timeText: event.timeText,
      eventTimeStart: event.eventTimeStart ? new Date(event.eventTimeStart) : null,
      eventTimeEnd: event.eventTimeEnd ? new Date(event.eventTimeEnd) : null,
      timeConfidence: event.timeConfidence,
      entities: event.entities,
      importance: event.importance,
      confidence: event.confidence,
      riskLevel: event.riskLevel,
      requiresConfirmation: event.requiresConfirmation,
      visibility: event.visibility,
      evidence: event.evidence,
      status: event.status,
      createdAt: new Date(event.createdAt),
    });

    return event;
  }

  async getByIds(input: { tenantId: string; eventIds: string[] }): Promise<MemoryEvent[]> {
    const uniqueIds = [...new Set(input.eventIds)].filter(Boolean);
    if (uniqueIds.length === 0) return [];

    const rows = await this.db
      .select()
      .from(schema.memoryEvents)
      .where(and(eq(schema.memoryEvents.tenantId, input.tenantId), inArray(schema.memoryEvents.id, uniqueIds)));

    return rows.map(mapEvent);
  }

  async search(input: {
    tenantId: string;
    elderId: string;
    query?: string;
    types?: string[];
    timeRange?: { start: string; end: string };
    entityNames?: string[];
    limit?: number;
  }): Promise<MemoryEvent[]> {
    const filters = [eq(schema.memoryEvents.tenantId, input.tenantId), eq(schema.memoryEvents.elderId, input.elderId)];
    const terms = buildRecallTerms(input.query, input.entityNames);
    const textFilter = terms.length
      ? or(
        ...terms.flatMap((term) => [
          ilike(schema.memoryEvents.title, `%${term}%`),
          ilike(schema.memoryEvents.summary, `%${term}%`),
        ]),
      )
      : undefined;
    const timeFilter = input.timeRange
      ? or(
        and(
          gte(schema.memoryEvents.eventTimeStart, new Date(input.timeRange.start)),
          lte(schema.memoryEvents.eventTimeStart, new Date(input.timeRange.end)),
        ),
        and(
          isNull(schema.memoryEvents.eventTimeStart),
          gte(schema.memoryEvents.createdAt, new Date(input.timeRange.start)),
          lte(schema.memoryEvents.createdAt, new Date(input.timeRange.end)),
        ),
      )
      : undefined;

    const broadRecallFilter = textFilter && timeFilter ? or(textFilter, timeFilter) : (textFilter ?? timeFilter);
    if (broadRecallFilter) filters.push(broadRecallFilter);

    const rows = await this.db
      .select()
      .from(schema.memoryEvents)
      .where(and(...filters))
      .orderBy(desc(schema.memoryEvents.createdAt))
      .limit(input.limit ?? 20);

    return rows.map(mapEvent);
  }

  async aggregateByTypeWithin(input: {
    tenantId: string;
    elderId: string;
    fromIso: string;
    limit?: number;
  }): Promise<EventTypeAggregate[]> {
    const grouped = await this.db
      .select({
        type: schema.memoryEvents.type,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.memoryEvents)
      .where(and(
        eq(schema.memoryEvents.tenantId, input.tenantId),
        eq(schema.memoryEvents.elderId, input.elderId),
        gte(schema.memoryEvents.createdAt, new Date(input.fromIso)),
      ))
      .groupBy(schema.memoryEvents.type)
      .orderBy(sql`count(*) desc`, desc(schema.memoryEvents.type))
      .limit(input.limit ?? 5);

    return Promise.all(grouped.map(async (row) => {
      const samples = await this.db
        .select({ title: schema.memoryEvents.title })
        .from(schema.memoryEvents)
        .where(and(
          eq(schema.memoryEvents.tenantId, input.tenantId),
          eq(schema.memoryEvents.elderId, input.elderId),
          eq(schema.memoryEvents.type, row.type),
          gte(schema.memoryEvents.createdAt, new Date(input.fromIso)),
        ))
        .orderBy(desc(schema.memoryEvents.createdAt))
        .limit(3);
      return {
        type: row.type as MemoryEvent["type"],
        count: row.count,
        sampleTitles: samples.map((sample) => sample.title),
      };
    }));
  }
}
