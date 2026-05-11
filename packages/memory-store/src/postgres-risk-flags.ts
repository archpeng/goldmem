import { randomUUID } from "node:crypto";
import type { RiskFlagRecord } from "@goldmem/memory-schema";
import type { CreateRiskFlagInput, RiskFlagStore } from "./index.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

export class PostgresRiskFlagStore implements RiskFlagStore {
  constructor(private readonly db: Db) {}

  async create(input: CreateRiskFlagInput): Promise<RiskFlagRecord> {
    const flag: RiskFlagRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.db.insert(schema.riskFlags).values({
      id: flag.id,
      tenantId: flag.tenantId,
      elderId: flag.elderId,
      sourceId: flag.sourceId,
      eventId: flag.eventId,
      type: flag.type,
      severity: flag.severity,
      summary: flag.summary,
      reason: flag.reason,
      requiresFamilyReview: flag.requiresFamilyReview,
      requiresHumanConfirmation: flag.requiresHumanConfirmation,
      evidence: flag.evidence,
      createdAt: new Date(flag.createdAt),
    });
    return flag;
  }
}
