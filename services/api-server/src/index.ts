import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfirmReminderRequestSchema,
  CreateFamilyReminderRequestSchema,
  CreateTextNoteRequestSchema,
  QueryMemoryRequestSchema,
} from "@goldmem/memory-schema";
import { ElderMemoryKernel, type ElderMemoryKernelDeps } from "@goldmem/memory-kernel";
import { DefaultPermissionEngine } from "@goldmem/permission-engine";
import { DefaultReminderEngine } from "@goldmem/reminder-engine";
import { DefaultRiskEngine } from "@goldmem/risk-engine";
import {
  createPostgresStores,
  HttpSemanticMemoryStore,
  HttpTemporalGraphStore,
  NullSemanticMemoryStore,
  NullTemporalGraphStore,
  type FamilyTaskStore,
  type AuditLog,
  type EventStore,
  type ReminderStore,
  type SourceStore,
} from "@goldmem/memory-store";
import { NotImplementedModelGateway, OpenAIModelGateway, type ModelGateway } from "@goldmem/model-gateway";

export const apiRouteContract = {
  elder: {
    createTextNote: "POST /elder/text-notes",
    createVoiceNote: "POST /elder/voice-notes",
    queryMemory: "POST /elder/query",
    listEvents: "GET /elder/events",
    listReminders: "GET /elder/reminders",
    confirmReminder: "POST /elder/reminders/:id/confirm",
    sendFeedback: "POST /elder/feedback",
  },
  family: {
    todaySummary: "GET /family/elders/:elderId/today-summary",
    pendingTasks: "GET /family/elders/:elderId/pending-tasks",
    confirmTask: "POST /family/tasks/:taskId/confirm",
    createRemoteReminder: "POST /family/reminders",
    sendFeedback: "POST /family/feedback",
  },
} as const;

export type ApiRouteContract = typeof apiRouteContract;

export type ApiServerDeps = {
  kernel: ElderMemoryKernel;
  sourceStore: SourceStore;
  eventStore: EventStore;
  reminderStore: ReminderStore;
  reminderEngine: DefaultReminderEngine;
  familyTaskStore: FamilyTaskStore;
  auditLog: AuditLog;
  healthCheck?: () => Promise<Record<string, unknown>>;
};

export function buildServer(deps: ApiServerDeps): FastifyInstance {
  const server = Fastify({ logger: true });
  void server.register(multipart);

  server.get("/health", async () => ({
    ok: true,
    ...(deps.healthCheck ? await deps.healthCheck() : {}),
  }));

  server.post("/elder/text-notes", async (request) => {
    const input = CreateTextNoteRequestSchema.parse(request.body);
    return deps.kernel.ingestText(input);
  });

  server.post("/elder/voice-notes", async (request) => {
    const file = await request.file();
    if (!file) throw new Error("Missing voice note file");
    const fields = file.fields as Record<string, { value?: unknown }>;
    const elderId = String(fields.elderId?.value ?? "");
    const buffer = await file.toBuffer();
    return deps.kernel.ingestVoice({
      elderId,
      audio: new Uint8Array(buffer),
    });
  });

  server.post("/elder/query", async (request) => {
    const input = QueryMemoryRequestSchema.parse(request.body);
    return deps.kernel.queryMemory(input);
  });

  server.get("/elder/events", async (request) => {
    const elderId = String((request.query as Record<string, unknown>).elderId ?? "");
    if (!elderId) throw new Error("elderId is required");
    return deps.eventStore.search({ elderId, limit: 20 });
  });

  server.get("/elder/reminders", async (request) => {
    const elderId = String((request.query as Record<string, unknown>).elderId ?? "");
    if (!elderId) throw new Error("elderId is required");
    return deps.reminderStore.listByElder(elderId);
  });

  server.post("/elder/reminders/:id/confirm", async (request) => {
    const params = request.params as { id: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    const before = await deps.reminderStore.get(params.id);
    const reminder = await deps.reminderEngine.confirmReminder({
      reminderId: params.id,
      actorUserId: input.actorUserId,
      remindAt: input.remindAt,
    });
    await deps.auditLog.record({
      type: "reminder_confirmed",
      elderId: reminder.elderId,
      sourceId: reminder.sourceId,
      payload: {
        reminderId: reminder.id,
        actorUserId: input.actorUserId,
        previousStatus: before?.status,
        status: reminder.status,
        confirmedAt: reminder.confirmedAt,
      },
    });
    return reminder;
  });

  server.get("/family/elders/:elderId/pending-tasks", async (request) => {
    const params = request.params as { elderId: string };
    return deps.familyTaskStore.listPending(params.elderId);
  });

  server.post("/family/tasks/:taskId/confirm", async (request) => {
    const params = request.params as { taskId: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    const task = await deps.familyTaskStore.confirm(params.taskId, input.actorUserId);
    await deps.auditLog.record({
      type: "family_task_confirmed",
      elderId: task.elderId,
      payload: {
        taskId: task.id,
        actorUserId: input.actorUserId,
        status: task.status,
        confirmedAt: task.confirmedAt,
      },
    });
    return task;
  });

  server.post("/family/reminders", async (request) => {
    const input = CreateFamilyReminderRequestSchema.parse(request.body);
    const source = await deps.sourceStore.create({
      elderId: input.elderId,
      type: "family_input",
      transcript: input.title,
      createdAt: new Date().toISOString(),
    });

    return deps.reminderEngine.createCandidate({
      elderId: input.elderId,
      sourceId: source.id,
      title: input.title,
      description: input.description,
      remindAt: input.remindAt,
      timeConfidence: input.remindAt ? 1 : 0,
      confirmationRequired: true,
      suggestedConfirmers: [{ role: "elder" }],
      confidence: 1,
      reason: input.reason,
    });
  });

  return server;
}

export function buildKernelDepsFromEnv(): { deps: ApiServerDeps; close: () => Promise<void> } {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const postgres = createPostgresStores({
    databaseUrl,
    audioDir: process.env.GOLDMEM_AUDIO_DIR,
    publicAudioBaseUrl: process.env.GOLDMEM_AUDIO_BASE_URL,
  });
  const reminderEngine = new DefaultReminderEngine(postgres.reminderStore);
  const modelGateway = buildModelGatewayFromEnv();

  const kernelDeps: ElderMemoryKernelDeps = {
    sourceStore: postgres.sourceStore,
    eventStore: postgres.eventStore,
    reminderEngine,
    familyTaskStore: postgres.familyTaskStore,
    riskFlagStore: postgres.riskFlagStore,
    semanticMemory: process.env.MEM0_BASE_URL
      ? new HttpSemanticMemoryStore({ baseUrl: process.env.MEM0_BASE_URL, apiKey: process.env.MEM0_API_KEY })
      : new NullSemanticMemoryStore(),
    temporalGraph: process.env.GRAPHITI_BASE_URL
      ? new HttpTemporalGraphStore({ baseUrl: process.env.GRAPHITI_BASE_URL, apiKey: process.env.GRAPHITI_API_KEY })
      : new NullTemporalGraphStore(),
    personalContextStore: postgres.personalContextStore,
    modelGateway,
    riskEngine: new DefaultRiskEngine(),
    permissionEngine: new DefaultPermissionEngine(),
    auditLog: postgres.auditLog,
  };

  return {
    deps: {
      kernel: new ElderMemoryKernel(kernelDeps),
      sourceStore: postgres.sourceStore,
      eventStore: postgres.eventStore,
      reminderStore: postgres.reminderStore,
      reminderEngine,
      familyTaskStore: postgres.familyTaskStore,
      auditLog: postgres.auditLog,
      healthCheck: async () => {
        await postgres.pool.query("select 1");
        return { postgres: "ok" };
      },
    },
    close: postgres.close,
  };
}

function buildModelGatewayFromEnv(): ModelGateway {
  if (!process.env.OPENAI_API_KEY) return new NotImplementedModelGateway();
  return new OpenAIModelGateway({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    baseURL: process.env.OPENAI_BASE_URL,
    transcriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL,
    promptsDir: process.env.GOLDMEM_PROMPTS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "prompts"),
    promptVersion: process.env.GOLDMEM_PROMPT_VERSION ?? "v1",
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { deps, close } = buildKernelDepsFromEnv();
  const server = buildServer(deps);
  const port = Number(process.env.PORT ?? 3000);
  server.listen({ port, host: "0.0.0.0" }).catch(async (error) => {
    server.log.error(error);
    await close();
    process.exit(1);
  });
}
