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
  type FamilyTaskStore,
  type AuditLog,
  type ContextLinkStore,
  type EventStore,
  type ReminderStore,
} from "@goldmem/memory-store";
import { NotImplementedModelGateway, OpenAIModelGateway, type ModelGateway } from "@goldmem/model-gateway";
import { GraphitiTemporalMemoryStore, NullTemporalMemoryStore, type TemporalMemoryStore } from "@goldmem/temporal-memory";

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
  eventStore: EventStore;
  contextLinkStore: ContextLinkStore;
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
    const tenantId = String(fields.tenantId?.value ?? "tenant-mvp");
    const buffer = await file.toBuffer();
    return deps.kernel.ingestVoice({
      tenantId,
      elderId,
      audio: new Uint8Array(buffer),
    });
  });

  server.post("/elder/query", async (request) => {
    const input = QueryMemoryRequestSchema.parse(request.body);
    return deps.kernel.queryMemory(input);
  });

  server.get("/elder/events", async (request) => {
    const query = request.query as Record<string, unknown>;
    const elderId = String(query.elderId ?? "");
    const tenantId = String(query.tenantId ?? "tenant-mvp");
    if (!elderId) throw new Error("elderId is required");
    return deps.eventStore.search({ tenantId, elderId, limit: 20 });
  });

  server.get("/elder/reminders", async (request) => {
    const query = request.query as Record<string, unknown>;
    const elderId = String(query.elderId ?? "");
    const tenantId = String(query.tenantId ?? "tenant-mvp");
    if (!elderId) throw new Error("elderId is required");
    return deps.reminderStore.listByElder({ tenantId, elderId });
  });

  server.post("/elder/reminders/:id/confirm", async (request) => {
    const params = request.params as { id: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    const before = await deps.reminderStore.get({ tenantId: input.tenantId, reminderId: params.id });
    const reminder = await deps.reminderEngine.confirmReminder({
      tenantId: input.tenantId,
      reminderId: params.id,
      actorUserId: input.actorUserId,
      remindAt: input.remindAt,
    });
    await deps.auditLog.record({
      type: "reminder_confirmed",
      tenantId: reminder.tenantId,
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
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    return deps.familyTaskStore.listPending({ tenantId, elderId: params.elderId });
  });

  server.post("/family/tasks/:taskId/confirm", async (request) => {
    const params = request.params as { taskId: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    const task = await deps.familyTaskStore.confirm({ tenantId: input.tenantId, taskId: params.taskId, actorUserId: input.actorUserId });
    await deps.auditLog.record({
      type: "family_task_confirmed",
      tenantId: task.tenantId,
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
    return deps.kernel.createFamilyReminder(input);
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
  const mem0BaseUrl = requiredEnv("MEM0_BASE_URL");
  const temporalMemory = buildTemporalMemoryFromEnv();

  const kernelDeps: ElderMemoryKernelDeps = {
    sourceStore: postgres.sourceStore,
    eventStore: postgres.eventStore,
    contextLinkStore: postgres.contextLinkStore,
    reminderEngine,
    familyReminderCommandStore: postgres.familyReminderCommandStore,
    familyTaskStore: postgres.familyTaskStore,
    riskFlagStore: postgres.riskFlagStore,
    semanticMemory: new HttpSemanticMemoryStore({ baseUrl: mem0BaseUrl, apiKey: process.env.MEM0_API_KEY }),
    personalContextStore: postgres.personalContextStore,
    modelGateway,
    riskEngine: new DefaultRiskEngine(),
    permissionEngine: new DefaultPermissionEngine(),
    auditLog: postgres.auditLog,
    temporalMemory,
    temporalMemoryJobStore: postgres.temporalMemoryJobStore,
  };

  return {
    deps: {
      kernel: new ElderMemoryKernel(kernelDeps),
      eventStore: postgres.eventStore,
      contextLinkStore: postgres.contextLinkStore,
      reminderStore: postgres.reminderStore,
      reminderEngine,
      familyTaskStore: postgres.familyTaskStore,
      auditLog: postgres.auditLog,
      healthCheck: async () => {
        await postgres.pool.query("select 1");
        const graphiti = await checkGraphitiHealth(temporalMemory);
        const graphitiRetryJobs = await postgres.temporalMemoryJobStore.stats();
        const graphitiRequired = isGraphitiRequired();
        return {
          ok: graphitiRequired ? graphiti === "ok" : true,
          postgres: "ok",
          mem0: "configured",
          mem0BaseUrl,
          graphiti,
          graphitiRequired,
          graphitiRetryJobs,
        };
      },
    },
    close: postgres.close,
  };
}

export function buildTemporalMemoryFromEnv(): TemporalMemoryStore {
  const graphitiBaseUrl = process.env.GRAPHITI_BASE_URL;
  const required = isGraphitiRequired();
  if (!graphitiBaseUrl) {
    if (required) throw new Error("GRAPHITI_BASE_URL is required when Graphiti is required in production");
    return new NullTemporalMemoryStore();
  }
  return new GraphitiTemporalMemoryStore({
    baseUrl: graphitiBaseUrl,
    apiKey: process.env.GRAPHITI_API_KEY,
  });
}

function isGraphitiRequired(): boolean {
  return (
    process.env.GRAPHITI_REQUIRED_IN_PRODUCTION === "true" ||
    process.env.GOLDMEM_REQUIRE_GRAPHITI === "true" ||
    process.env.NODE_ENV === "production"
  );
}

async function checkGraphitiHealth(temporalMemory: TemporalMemoryStore): Promise<"ok" | "missing_config" | "unhealthy"> {
  const baseUrl = process.env.GRAPHITI_BASE_URL;
  if (temporalMemory instanceof NullTemporalMemoryStore || !baseUrl) return "missing_config";
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
      headers: process.env.GRAPHITI_API_KEY ? { "x-api-key": process.env.GRAPHITI_API_KEY } : undefined,
    });
    if (!response.ok) return "unhealthy";
    const body = await response.json() as { ok?: unknown };
    return body.ok === true ? "ok" : "unhealthy";
  } catch {
    return "unhealthy";
  }
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
