import { randomUUID } from "node:crypto";
import type { AuditLog } from "./index.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresAuditLog implements AuditLog {
  constructor(private readonly db: Db) {}

  async record(input: Parameters<AuditLog["record"]>[0]): Promise<void> {
    await this.db.insert(schema.auditLogs).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      elderId: input.elderId,
      sourceId: input.sourceId,
      type: input.type,
      payload: input.traceId ? { ...input.payload, traceId: input.traceId } : input.payload,
      createdAt: new Date(),
    });
  }
}
