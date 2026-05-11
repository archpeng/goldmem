import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FamilyTaskSchema,
  MemoryContextLinkSchema,
  MemoryEventSchema,
  MemorySourceSchema,
  PersonalContextSchema,
  ReminderSchema,
} from "@goldmem/memory-schema";
import { createPostgresStores, type PostgresStores } from "./postgres.js";

const databaseUrl = process.env.GOLDMEM_STORE_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("PostgresStores integration", () => {
  const schemaName = `goldmem_store_test_${process.pid}_${Date.now()}`;
  let stores: PostgresStores;

  beforeAll(async () => {
    if (!databaseUrl) return;
    await createSchema(databaseUrl, schemaName);
    const schemaUrl = withSearchPath(databaseUrl, schemaName);
    await runMigrations(schemaUrl);
    stores = createPostgresStores({ databaseUrl: schemaUrl });
  });

  afterAll(async () => {
    await stores?.close();
    if (databaseUrl) await dropSchema(databaseUrl, schemaName);
  });

  it("round-trips truth records and parses readback into domain schemas", async () => {
    const source = await stores.sourceStore.create({
      tenantId: "tenant-store",
      elderId: "elder-store",
      type: "text",
      transcript: "我上午去买了青菜。",
      createdAt: "2026-05-10T09:00:00.000Z",
      metadata: { language: "zh-CN" },
    });
    expect(MemorySourceSchema.parse(await stores.sourceStore.get({ tenantId: source.tenantId, sourceId: source.id }))).toEqual(source);

    const firstEvent = await stores.eventStore.create({
      tenantId: source.tenantId,
      elderId: source.elderId,
      sourceId: source.id,
      type: "shopping",
      title: "买青菜",
      summary: "老人上午去买了青菜。",
      timeConfidence: 0.8,
      entities: [{ type: "object", name: "青菜", aliases: [], confidence: 0.8 }],
      importance: 0.5,
      confidence: 0.9,
      riskLevel: "normal",
      requiresConfirmation: false,
      visibility: "private",
      evidence: [{ sourceId: source.id, quote: "我上午去买了青菜。" }],
      status: "active",
    });
    const secondEvent = await stores.eventStore.create({
      ...firstEvent,
      title: "准备晚饭",
      summary: "老人准备晚饭。",
      type: "family",
      evidence: [{ sourceId: source.id, quote: "准备晚饭。" }],
      status: "active",
    });
    const events = await stores.eventStore.getByIds({ tenantId: source.tenantId, eventIds: [firstEvent.id, secondEvent.id] });
    expect(events.map((event) => MemoryEventSchema.parse(event).id)).toEqual(expect.arrayContaining([firstEvent.id, secondEvent.id]));

    const reminder = await stores.reminderStore.create({
      tenantId: source.tenantId,
      elderId: source.elderId,
      sourceId: source.id,
      eventId: firstEvent.id,
      title: "提醒买菜",
      remindAt: "2026-05-11T09:00:00.000Z",
      status: "pending_family_confirm",
      confirmationRequired: true,
      confidence: 0.8,
      reason: "需要确认提醒。",
    });
    expect(ReminderSchema.parse(await stores.reminderStore.get({ tenantId: source.tenantId, reminderId: reminder.id })).id).toBe(reminder.id);

    const link = await stores.contextLinkStore.create({
      tenantId: source.tenantId,
      elderId: source.elderId,
      fromEventId: firstEvent.id,
      toEventId: secondEvent.id,
      reminderId: reminder.id,
      type: "possibly_related",
      status: "needs_confirmation",
      confidence: 0.7,
      reason: "同一天上下文相关。",
      evidence: [{ sourceId: source.id, quote: "上下文相关。" }],
    });
    const links = await stores.contextLinkStore.listByEventIds({ tenantId: source.tenantId, elderId: source.elderId, eventIds: [firstEvent.id] });
    expect(links.map((item) => MemoryContextLinkSchema.parse(item).id)).toContain(link.id);

    const task = await stores.familyTaskStore.create({
      tenantId: source.tenantId,
      elderId: source.elderId,
      title: "确认提醒",
      summary: "请确认提醒。",
      type: "reminder_confirm",
      urgency: "medium",
      visibility: "shared_summary",
      relatedEventId: firstEvent.id,
    });
    const confirmedTask = await stores.familyTaskStore.confirm({
      tenantId: source.tenantId,
      taskId: task.id,
      actorUserId: "family-1",
    });
    expect(FamilyTaskSchema.parse(confirmedTask).status).toBe("confirmed");

    const context = await stores.personalContextStore.buildContext({
      tenantId: source.tenantId,
      elderId: source.elderId,
      queryText: "青菜",
    });
    expect(PersonalContextSchema.parse(context).recentEvents.length).toBeGreaterThan(0);

    const job = await stores.temporalMemoryJobStore.enqueue({
      tenantId: source.tenantId,
      elderId: source.elderId,
      sourceId: source.id,
      episode: { name: "episode-1" },
      nextRunAt: "2026-05-10T09:00:00.000Z",
    });
    const [claimed] = await stores.temporalMemoryJobStore.claimDue({ now: "2026-05-10T10:00:00.000Z", limit: 1 });
    expect(claimed?.id).toBe(job.id);
    expect((await stores.temporalMemoryJobStore.stats({ tenantId: source.tenantId, elderId: source.elderId })).running).toBe(1);
    expect((await stores.temporalMemoryJobStore.markSucceeded({ jobId: job.id })).status).toBe("succeeded");
    expect((await stores.temporalMemoryJobStore.stats({ tenantId: source.tenantId, elderId: source.elderId })).succeeded).toBe(1);
  });

  it("creates family reminders atomically and reuses idempotency keys", async () => {
    const input = {
      idempotencyKey: "family-command-1",
      actorUserId: "family-1",
      source: {
        tenantId: "tenant-store",
        elderId: "elder-family-command",
        type: "family_input" as const,
        transcript: "提醒妈妈量血压",
        createdAt: "2026-05-10T09:00:00.000Z",
      },
      reminder: {
        tenantId: "tenant-store",
        elderId: "elder-family-command",
        sourceId: "__pending__",
        title: "提醒妈妈量血压",
        remindAt: "2026-05-11T09:00:00.000Z",
        status: "pending_family_confirm" as const,
        confirmationRequired: true,
        confidence: 1,
        reason: "Family-created reminder.",
      },
      audit: {
        type: "family_reminder_created",
        tenantId: "tenant-store",
        elderId: "elder-family-command",
        payload: { actorUserId: "family-1", hasRemindAt: true },
      },
      request: { title: "提醒妈妈量血压" },
    };

    const first = await stores.familyReminderCommandStore.create(input);
    const second = await stores.familyReminderCommandStore.create(input);

    expect(second.reused).toBe(true);
    expect(second.reminder.id).toBe(first.reminder.id);
    expect(second.source.id).toBe(first.source.id);
    expect(ReminderSchema.parse(await stores.reminderStore.get({
      tenantId: first.reminder.tenantId,
      reminderId: first.reminder.id,
    })).sourceId).toBe(first.source.id);
  });

  it("uses time ranges in event broad recall", async () => {
    const source = await stores.sourceStore.create({
      tenantId: "tenant-store",
      elderId: "elder-time-range",
      type: "text",
      transcript: "时间范围召回测试。",
      createdAt: "2026-05-09T08:00:00.000Z",
    });
    const yesterday = await stores.eventStore.create({
      tenantId: source.tenantId,
      elderId: source.elderId,
      sourceId: source.id,
      type: "general",
      title: "昨天散步",
      summary: "老人昨天傍晚散步。",
      eventTimeStart: "2026-05-08T09:00:00.000Z",
      timeConfidence: 0.8,
      entities: [],
      importance: 0.5,
      confidence: 0.8,
      riskLevel: "normal",
      requiresConfirmation: false,
      visibility: "private",
      evidence: [{ sourceId: source.id, quote: "昨天傍晚散步。" }],
      status: "active",
    });
    const today = await stores.eventStore.create({
      ...yesterday,
      title: "今天散步",
      summary: "老人今天上午散步。",
      eventTimeStart: "2026-05-09T09:00:00.000Z",
      evidence: [{ sourceId: source.id, quote: "今天上午散步。" }],
    });

    const results = await stores.eventStore.search({
      tenantId: source.tenantId,
      elderId: source.elderId,
      timeRange: {
        start: "2026-05-09T00:00:00.000Z",
        end: "2026-05-09T23:59:59.999Z",
      },
    });

    expect(results.map((event) => event.id)).toContain(today.id);
    expect(results.map((event) => event.id)).not.toContain(yesterday.id);
  });

  it("stores semantic memories in pgvector with tenant isolation", async () => {
    const embedding = testEmbedding(0);
    await stores.semanticMemoryStore.addMemory({
      tenantId: "tenant-store",
      elderId: "elder-semantic",
      memory: "Title: 买青菜\nSummary: 老人上午买了青菜。",
      embedding,
      metadata: {
        sourceId: "source-semantic",
        eventId: "event-semantic",
        summary: "老人上午买了青菜。",
      },
    });
    await stores.semanticMemoryStore.addMemory({
      tenantId: "tenant-other",
      elderId: "elder-semantic",
      memory: "Title: 隔离数据\nSummary: 其他租户的数据。",
      embedding,
      metadata: { sourceId: "source-other", eventId: "event-other" },
    });

    const results = await stores.semanticMemoryStore.searchMemory({
      tenantId: "tenant-store",
      elderId: "elder-semantic",
      query: "青菜",
      embedding,
      limit: 3,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.provider).toBe("semantic");
    expect(results[0]?.metadata).toMatchObject({
      tenantId: "tenant-store",
      elderId: "elder-semantic",
      sourceId: "source-semantic",
      eventId: "event-semantic",
    });
  });
});

async function createSchema(url: string, schemaName: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`create schema "${schemaName}"`);
  } finally {
    await pool.end();
  }
}

async function dropSchema(url: string, schemaName: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`drop schema if exists "${schemaName}" cascade`);
  } finally {
    await pool.end();
  }
}

async function runMigrations(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    const migrationsDir = fileURLToPath(new URL("../../../infra/db/migrations", import.meta.url));
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      await pool.query(await readFile(join(migrationsDir, file), "utf8"));
    }
  } finally {
    await pool.end();
  }
}

function testEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, index) => (index === seed ? 1 : 0));
}

function withSearchPath(url: string, schemaName: string): string {
  const parsed = new URL(url);
  const existing = parsed.searchParams.get("options");
  const searchPathOption = `-c search_path=${schemaName},public`;
  parsed.searchParams.set("options", existing ? `${existing} ${searchPathOption}` : searchPathOption);
  return parsed.toString();
}
