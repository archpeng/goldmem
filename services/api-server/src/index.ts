import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfirmReminderRequestSchema,
  CreateFeedbackRequestSchema,
  CreateFamilyReminderRequestSchema,
  ElderTurnRequestSchema,
} from "@goldmem/memory-schema";
import { ElderMemoryKernel, type ElderMemoryKernelDeps } from "@goldmem/memory-kernel";
import { DefaultPermissionEngine } from "@goldmem/permission-engine";
import { DefaultReminderEngine } from "@goldmem/reminder-engine";
import { DefaultRiskEngine } from "@goldmem/risk-engine";
import {
  createPostgresStores,
  type FamilyTaskStore,
  type AuditLog,
  type ContextLinkStore,
  type DebugTraceStore,
  type EventStore,
  type FeedbackStore,
  type NotificationIntentStore,
  type ReminderStore,
} from "@goldmem/memory-store";
import { NotImplementedModelGateway, OpenAIModelGateway, type ModelGateway } from "@goldmem/model-gateway";
import { GraphitiTemporalMemoryStore, NullTemporalMemoryStore, type TemporalMemoryStore } from "@goldmem/temporal-memory";

export const apiRouteContract = {
  elder: {
    turn: "POST /elder/turn",
    listEvents: "GET /elder/events",
    listReminders: "GET /elder/reminders",
    confirmReminder: "POST /elder/reminders/:id/confirm",
    sendFeedback: "POST /elder/feedback",
  },
  family: {
    pendingTasks: "GET /family/elders/:elderId/pending-tasks",
    tasks: "GET /family/elders/:elderId/tasks",
    confirmTask: "POST /family/tasks/:taskId/confirm",
    rejectTask: "POST /family/tasks/:taskId/reject",
    needsMoreInfoTask: "POST /family/tasks/:taskId/needs-more-info",
    notificationIntents: "GET /family/elders/:elderId/notification-intents",
    createRemoteReminder: "POST /family/reminders",
  },
  debug: {
    getTrace: "GET /debug/traces/:traceId",
    getSourceTrace: "GET /debug/sources/:sourceId",
    getQueryTrace: "GET /debug/queries/:auditId",
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
  feedbackStore: FeedbackStore;
  auditLog: AuditLog;
  debugTraceStore?: DebugTraceStore;
  notificationIntentStore?: NotificationIntentStore;
  healthCheck?: () => Promise<Record<string, unknown>>;
};

export function buildServer(deps: ApiServerDeps): FastifyInstance {
  const server = Fastify({ logger: true });

  server.get("/health", async () => ({
    ok: true,
    ...(deps.healthCheck ? await deps.healthCheck() : {}),
  }));

  server.post("/elder/turn", async (request) => {
    const input = ElderTurnRequestSchema.parse(request.body);
    return deps.kernel.elderTurn(input);
  });

  server.post("/elder/feedback", async (request) => {
    const input = CreateFeedbackRequestSchema.parse(request.body);
    const traceId = input.traceId ?? randomUUID();
    const feedback = await deps.feedbackStore.create({
      tenantId: input.tenantId,
      elderId: input.elderId,
      actorUserId: input.actorUserId,
      sourceId: input.sourceId,
      eventId: input.eventId,
      feedbackType: input.feedbackType,
      correction: input.correction,
    });
    await deps.auditLog.record({
      type: "feedback_created",
      tenantId: feedback.tenantId,
      elderId: feedback.elderId,
      sourceId: feedback.sourceId,
      traceId,
      payload: {
        traceId,
        feedbackId: feedback.id,
        feedbackType: feedback.feedbackType,
        actorUserId: feedback.actorUserId,
        eventId: feedback.eventId,
      },
    });
    return feedback;
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
    const traceId = input.traceId ?? randomUUID();
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
      traceId,
      payload: {
        traceId,
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

  server.get("/family/elders/:elderId/tasks", async (request) => {
    const params = request.params as { elderId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    return deps.familyTaskStore.listByElder({ tenantId, elderId: params.elderId });
  });

  server.post("/family/tasks/:taskId/confirm", async (request) => {
    const params = request.params as { taskId: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    const traceId = input.traceId ?? randomUUID();
    const task = await deps.familyTaskStore.confirm({ tenantId: input.tenantId, taskId: params.taskId, actorUserId: input.actorUserId });
    await deps.auditLog.record({
      type: "family_task_confirmed",
      tenantId: task.tenantId,
      elderId: task.elderId,
      traceId,
      payload: {
        traceId,
        taskId: task.id,
        actorUserId: input.actorUserId,
        status: task.status,
        confirmedAt: task.confirmedAt,
      },
    });
    return task;
  });

  server.post("/family/tasks/:taskId/reject", async (request) => {
    const params = request.params as { taskId: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    const traceId = input.traceId ?? randomUUID();
    const task = await deps.familyTaskStore.reject({ tenantId: input.tenantId, taskId: params.taskId, actorUserId: input.actorUserId });
    await deps.auditLog.record({
      type: "family_task_rejected",
      tenantId: task.tenantId,
      elderId: task.elderId,
      traceId,
      payload: { traceId, taskId: task.id, actorUserId: input.actorUserId, status: task.status },
    });
    return task;
  });

  server.post("/family/tasks/:taskId/needs-more-info", async (request) => {
    const params = request.params as { taskId: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    const traceId = input.traceId ?? randomUUID();
    const task = await deps.familyTaskStore.requestMoreInfo({ tenantId: input.tenantId, taskId: params.taskId, actorUserId: input.actorUserId });
    await deps.auditLog.record({
      type: "family_task_needs_more_info",
      tenantId: task.tenantId,
      elderId: task.elderId,
      traceId,
      payload: { traceId, taskId: task.id, actorUserId: input.actorUserId, status: task.status },
    });
    return task;
  });

  server.post("/family/reminders", async (request) => {
    const input = CreateFamilyReminderRequestSchema.parse(request.body);
    return deps.kernel.createFamilyReminder(input);
  });

  server.get("/family/elders/:elderId/notification-intents", async (request, reply) => {
    if (!deps.notificationIntentStore) return reply.code(404).send({ message: "Notification intent store is not configured" });
    const params = request.params as { elderId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    return deps.notificationIntentStore.listByElder({ tenantId, elderId: params.elderId });
  });

  server.get("/debug/traces/:traceId", async (request, reply) => {
    if (!deps.debugTraceStore) return reply.code(404).send({ message: "Debug trace store is not configured" });
    const params = request.params as { traceId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    const trace = await deps.debugTraceStore.getByTrace({ tenantId, traceId: params.traceId });
    if (!trace) return reply.code(404).send({ message: "Trace not found" });
    return trace;
  });

  server.get("/debug/sources/:sourceId", async (request, reply) => {
    if (!deps.debugTraceStore) return reply.code(404).send({ message: "Debug trace store is not configured" });
    const params = request.params as { sourceId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    const trace = await deps.debugTraceStore.getBySource({ tenantId, sourceId: params.sourceId });
    if (!trace) return reply.code(404).send({ message: "Trace not found" });
    return trace;
  });

  server.get("/debug/queries/:auditId", async (request, reply) => {
    if (!deps.debugTraceStore) return reply.code(404).send({ message: "Debug trace store is not configured" });
    const params = request.params as { auditId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    const trace = await deps.debugTraceStore.getByAuditId({ tenantId, auditId: params.auditId });
    if (!trace) return reply.code(404).send({ message: "Trace not found" });
    return trace;
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
  const semanticMemoryProvider = process.env.SEMANTIC_MEMORY_PROVIDER ?? "pgvector";
  if (semanticMemoryProvider !== "pgvector") {
    throw new Error("SEMANTIC_MEMORY_PROVIDER must be pgvector");
  }
  const temporalMemory = buildTemporalMemoryFromEnv();

  const kernelDeps: ElderMemoryKernelDeps = {
    sourceStore: postgres.sourceStore,
    eventStore: postgres.eventStore,
    contextLinkStore: postgres.contextLinkStore,
    reminderEngine,
      familyReminderCommandStore: postgres.familyReminderCommandStore,
      familyTaskStore: postgres.familyTaskStore,
      riskFlagStore: postgres.riskFlagStore,
    semanticMemory: postgres.semanticMemoryStore,
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
      feedbackStore: postgres.feedbackStore,
      auditLog: postgres.auditLog,
      debugTraceStore: postgres.debugTraceStore,
      notificationIntentStore: postgres.notificationIntentStore,
      healthCheck: async () => {
        await postgres.pool.query("select 1");
        const graphiti = await checkGraphitiHealth(temporalMemory);
        const graphitiRetryJobs = await postgres.temporalMemoryJobStore.stats();
        const graphitiRequired = isGraphitiRequired();
        return {
          ok: graphitiRequired ? graphiti === "ok" : true,
          postgres: "ok",
          semanticMemory: semanticMemoryProvider,
          model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
          embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
          openaiTimeoutMs: parseOpenAITimeoutMs(),
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
    timeoutMs: parsePositiveInt(process.env.GRAPHITI_TIMEOUT_MS, 5_000),
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
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    baseURL: process.env.OPENAI_BASE_URL,
    transcriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL,
    promptsDir: process.env.GOLDMEM_PROMPTS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "prompts"),
    promptVersion: process.env.GOLDMEM_PROMPT_VERSION ?? "v1",
    timeoutMs: parseOpenAITimeoutMs(),
  });
}

function parseOpenAITimeoutMs(): number {
  return parsePositiveInt(process.env.OPENAI_TIMEOUT_MS, 15_000);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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
