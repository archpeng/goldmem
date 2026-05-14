import { and, eq, sql } from "drizzle-orm";
import type { AuditRecord, DebugTrace } from "@mem/memory-schema";
import type { DebugTraceStore } from "./index.js";
import { mapSource } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresDebugTraceStore implements DebugTraceStore {
  constructor(private readonly db: Db) {}

  async getByTrace(input: { tenantId: string; traceId: string }): Promise<DebugTrace | null> {
    const rows = await this.db.select().from(schema.auditLogs).where(and(
      eq(schema.auditLogs.tenantId, input.tenantId),
      sql`${schema.auditLogs.payload}->>'traceId' = ${input.traceId}`,
    ));
    return this.buildTrace(input.tenantId, input.traceId, rows.map(mapAuditRecord));
  }

  async getBySource(input: { tenantId: string; sourceId: string }): Promise<DebugTrace | null> {
    const rows = await this.db.select().from(schema.auditLogs).where(and(
      eq(schema.auditLogs.tenantId, input.tenantId),
      eq(schema.auditLogs.sourceId, input.sourceId),
    ));
    const audits = rows.map(mapAuditRecord);
    const traceId = audits.map((audit) => audit.traceId).find((value): value is string => Boolean(value)) ?? input.sourceId;
    return this.buildTrace(input.tenantId, traceId, audits);
  }

  async getByAuditId(input: { tenantId: string; auditId: string }): Promise<DebugTrace | null> {
    const [row] = await this.db.select().from(schema.auditLogs).where(and(
      eq(schema.auditLogs.tenantId, input.tenantId),
      eq(schema.auditLogs.id, input.auditId),
    )).limit(1);
    if (!row) return null;
    const audit = mapAuditRecord(row);
    if (audit.traceId) return this.getByTrace({ tenantId: input.tenantId, traceId: audit.traceId });
    return this.buildTrace(input.tenantId, audit.id, [audit]);
  }

  private async buildTrace(tenantId: string, traceId: string, auditTrail: AuditRecord[]): Promise<DebugTrace | null> {
    if (auditTrail.length === 0) return null;
    auditTrail.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const sourceId = auditTrail.map((audit) => audit.sourceId).find((value): value is string => Boolean(value));
    const source = sourceId
      ? (await this.db.select().from(schema.memorySources).where(and(
        eq(schema.memorySources.tenantId, tenantId),
        eq(schema.memorySources.id, sourceId),
      )).limit(1))[0]
      : undefined;
    const ingest = auditTrail.find((audit) => audit.type === "memory_ingest");
    const query = [...auditTrail].reverse().find((audit) => audit.type === "memory_query");
    const graphitiAudits = auditTrail.filter((audit) => audit.type.includes("graphiti") || audit.type.includes("consolidation"));

    return {
      traceId,
      source: source ? mapSource(source) : undefined,
      memoryPlan: ingest?.payload.plan,
      guardrails: ingest?.payload.plan
        ? {
          uncertainties: readRecord(ingest.payload.plan).uncertainties,
          riskFlags: readRecord(ingest.payload.plan).riskFlags,
        }
        : undefined,
      postgresWrites: ingest?.payload.result,
      semanticWritesOrCandidates: {
        semanticCandidateEvents: readRecord(ingest?.payload.plan).semanticCandidateEvents,
        retrieval: query?.payload.retrieval,
      },
      graphitiEpisodesOrFacts: graphitiAudits.map((audit) => ({ type: audit.type, payload: audit.payload })),
      evidenceMerge: query ? { retrieval: query.payload.retrieval, evidence: query.payload.evidence } : undefined,
      finalAnswer: query?.payload.answer,
      auditTrail,
    };
  }
}

function mapAuditRecord(row: typeof schema.auditLogs.$inferSelect): AuditRecord {
  const payload = row.payload as Record<string, unknown>;
  return {
    id: row.id,
    tenantId: row.tenantId,
    elderId: row.elderId,
    sourceId: row.sourceId ?? undefined,
    traceId: typeof payload.traceId === "string" ? payload.traceId : undefined,
    type: row.type,
    payload,
    createdAt: row.createdAt.toISOString(),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
