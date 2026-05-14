import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ElderProfile, ElderProfileMedication, ElderProfilePlace } from "@mem/memory-schema";
import type { ElderProfileStore, UpsertElderProfileInput } from "./index.js";
import * as schema from "./postgres-schema.js";
import type { Db } from "./postgres-types.js";

function mapMedications(value: unknown): ElderProfileMedication[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      alias: typeof item.alias === "string" ? item.alias : undefined,
      dosage: typeof item.dosage === "string" ? item.dosage : undefined,
      frequency: typeof item.frequency === "string" ? item.frequency : undefined,
    }))
    .filter((item) => item.name.length > 0);
}

function mapPlaces(value: unknown): ElderProfilePlace[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      kind: typeof item.kind === "string" ? item.kind : undefined,
    }))
    .filter((item) => item.name.length > 0);
}

export class PostgresElderProfileStore implements ElderProfileStore {
  constructor(private readonly db: Db) {}

  async get(input: { tenantId: string; elderId: string }): Promise<ElderProfile | null> {
    const [row] = await this.db
      .select()
      .from(schema.elderProfiles)
      .where(
        and(
          eq(schema.elderProfiles.tenantId, input.tenantId),
          eq(schema.elderProfiles.elderId, input.elderId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      tenantId: row.tenantId,
      elderId: row.elderId,
      displayName: row.displayName,
      timezone: row.timezone,
      wakeTime: row.wakeTime ?? undefined,
      sleepTime: row.sleepTime ?? undefined,
      medications: mapMedications(row.medications),
      places: mapPlaces(row.places),
      notes: row.notes ?? undefined,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async upsert(input: UpsertElderProfileInput): Promise<ElderProfile> {
    const existing = await this.get({ tenantId: input.tenantId, elderId: input.elderId });
    const now = new Date();
    const merged: ElderProfile = {
      tenantId: input.tenantId,
      elderId: input.elderId,
      displayName: input.displayName ?? existing?.displayName ?? input.elderId,
      timezone: input.timezone ?? existing?.timezone ?? "Asia/Shanghai",
      wakeTime: input.wakeTime ?? existing?.wakeTime,
      sleepTime: input.sleepTime ?? existing?.sleepTime,
      medications: input.medications ?? existing?.medications ?? [],
      places: input.places ?? existing?.places ?? [],
      notes: input.notes ?? existing?.notes,
      updatedAt: now.toISOString(),
    };
    if (existing) {
      await this.db
        .update(schema.elderProfiles)
        .set({
          displayName: merged.displayName,
          timezone: merged.timezone,
          wakeTime: merged.wakeTime ?? null,
          sleepTime: merged.sleepTime ?? null,
          medications: merged.medications,
          places: merged.places,
          notes: merged.notes ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.elderProfiles.tenantId, merged.tenantId),
            eq(schema.elderProfiles.elderId, merged.elderId),
          ),
        );
    } else {
      await this.db.insert(schema.elderProfiles).values({
        id: randomUUID(),
        tenantId: merged.tenantId,
        userId: merged.elderId,
        elderId: merged.elderId,
        displayName: merged.displayName,
        timezone: merged.timezone,
        wakeTime: merged.wakeTime ?? null,
        sleepTime: merged.sleepTime ?? null,
        medications: merged.medications,
        places: merged.places,
        notes: merged.notes ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return merged;
  }
}
