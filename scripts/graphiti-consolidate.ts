import { randomUUID } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import { buildDailyConsolidationSummary, buildDailyConsolidationTemporalEpisode } from "../packages/memory-kernel/src/consolidation.js";
import {
  createPostgresStores,
} from "../packages/memory-store/src/index.js";
import { OpenAIModelGateway } from "../packages/model-gateway/src/index.js";
import {
  mapEvent,
  mapFamilyTask,
  mapReminder,
  mapRiskFlag,
  mapSource,
} from "../packages/memory-store/src/postgres-mappers.js";
import * as schema from "../packages/memory-store/src/postgres-schema.js";
import { GraphitiTemporalMemoryStore } from "../packages/temporal-memory/src/index.js";

const tenantId = requiredEnv("GOLDMEM_TENANT_ID");
const elderId = requiredEnv("GOLDMEM_ELDER_ID");
const date = process.env.GOLDMEM_CONSOLIDATION_DATE ?? new Date().toISOString().slice(0, 10);
const traceId = process.env.GOLDMEM_TRACE_ID ?? `daily-${date}-${randomUUID()}`;

const postgres = createPostgresStores({
  databaseUrl: requiredEnv("DATABASE_URL"),
  audioDir: process.env.GOLDMEM_AUDIO_DIR,
  publicAudioBaseUrl: process.env.GOLDMEM_AUDIO_BASE_URL,
});

try {
  const records = await loadDailyRecords(date);
  if (records.sources.length === 0 && records.events.length === 0) {
    console.log(`graphiti consolidate no-op: tenant=${tenantId} elder=${elderId} date=${date}`);
    process.exit(0);
  }

  const episode = buildDailyConsolidationTemporalEpisode({
    tenantId,
    elderId,
    date,
    traceId,
    ...records,
  });
  const summary = buildDailyConsolidationSummary({ tenantId, elderId, date, traceId, ...records });

  const semanticMemory = postgres.semanticMemoryStore;
  const modelGateway = new OpenAIModelGateway({
    apiKey: requiredEnv("OPENAI_API_KEY"),
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    baseURL: process.env.OPENAI_BASE_URL,
  });
  const temporalMemory = new GraphitiTemporalMemoryStore({
    baseUrl: requiredEnv("GRAPHITI_BASE_URL"),
    apiKey: process.env.GRAPHITI_API_KEY,
  });

  try {
    await temporalMemory.addEpisode(episode);
    const embedding = await modelGateway.embedText({ text: summary });
    await semanticMemory.addMemory({
      tenantId,
      elderId,
      memory: summary,
      embedding,
      metadata: {
        traceId,
        writeMode: "daily_consolidation",
        idempotencyKey: episode.metadata?.idempotencyKey,
        date,
        sourceIds: episode.sourceIds,
        eventIds: episode.eventIds,
      },
    });
    await postgres.auditLog.record({
      type: "daily_consolidation_written",
      tenantId,
      elderId,
      sourceId: episode.sourceIds[0],
      traceId,
      payload: {
        traceId,
        date,
        idempotencyKey: episode.metadata?.idempotencyKey,
        sourceIds: episode.sourceIds,
        eventIds: episode.eventIds,
      },
    });
    console.log(`graphiti consolidate ok: tenant=${tenantId} elder=${elderId} date=${date} trace=${traceId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const retryJob = await postgres.temporalMemoryJobStore.enqueue({
      tenantId,
      elderId,
      sourceId: episode.sourceIds[0] ?? `daily-consolidation:${date}`,
      traceId,
      episode: { ...episode },
    });
    await postgres.auditLog.record({
      type: "daily_consolidation_failed",
      tenantId,
      elderId,
      sourceId: episode.sourceIds[0],
      traceId,
      payload: {
        traceId,
        date,
        errorMessage,
        retryJobId: retryJob.id,
        idempotencyKey: episode.metadata?.idempotencyKey,
      },
    });
    throw error;
  }
} finally {
  await postgres.close();
}

async function loadDailyRecords(dateString: string) {
  const start = new Date(`${dateString}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const [sources, events, reminders, riskFlags, familyTasks] = await Promise.all([
    postgres.db.select().from(schema.memorySources).where(and(
      eq(schema.memorySources.tenantId, tenantId),
      eq(schema.memorySources.elderId, elderId),
      gte(schema.memorySources.createdAt, start),
      lt(schema.memorySources.createdAt, end),
    )),
    postgres.db.select().from(schema.memoryEvents).where(and(
      eq(schema.memoryEvents.tenantId, tenantId),
      eq(schema.memoryEvents.elderId, elderId),
      gte(schema.memoryEvents.createdAt, start),
      lt(schema.memoryEvents.createdAt, end),
    )),
    postgres.db.select().from(schema.reminders).where(and(
      eq(schema.reminders.tenantId, tenantId),
      eq(schema.reminders.elderId, elderId),
      gte(schema.reminders.createdAt, start),
      lt(schema.reminders.createdAt, end),
    )),
    postgres.db.select().from(schema.riskFlags).where(and(
      eq(schema.riskFlags.tenantId, tenantId),
      eq(schema.riskFlags.elderId, elderId),
      gte(schema.riskFlags.createdAt, start),
      lt(schema.riskFlags.createdAt, end),
    )),
    postgres.db.select().from(schema.familyTasks).where(and(
      eq(schema.familyTasks.tenantId, tenantId),
      eq(schema.familyTasks.elderId, elderId),
      gte(schema.familyTasks.createdAt, start),
      lt(schema.familyTasks.createdAt, end),
    )),
  ]);

  return {
    sources: sources.map(mapSource),
    events: events.map(mapEvent),
    reminders: reminders.map(mapReminder),
    riskFlags: riskFlags.map(mapRiskFlag),
    familyTasks: familyTasks.map(mapFamilyTask),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
