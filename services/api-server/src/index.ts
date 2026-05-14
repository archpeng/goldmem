import Fastify, { type FastifyInstance } from "fastify";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfirmReminderRequestSchema,
  CreateFeedbackRequestSchema,
  CreateFamilyReminderRequestSchema,
  ElderTurnRequestSchema,
  UpsertElderProfileRequestSchema,
} from "@mem/memory-schema";
import { ElderMemoryKernel, type ElderMemoryKernelDeps } from "@mem/memory-kernel";
import { DefaultPermissionEngine } from "@mem/permission-engine";
import { DefaultReminderEngine } from "@mem/reminder-engine";
import { DefaultRiskEngine } from "@mem/risk-engine";
import {
  createPostgresStores,
  type DebugTraceStore,
  type ElderProfileStore,
  type EventStore,
  type ReminderStore,
} from "@mem/memory-store";
import { NotImplementedModelGateway, OpenAIModelGateway, type ModelGateway } from "@mem/model-gateway";
import { GraphitiTemporalMemoryStore, NullTemporalMemoryStore, type TemporalMemoryStore } from "@mem/temporal-memory";

export const apiRouteContract = {
  elder: {
    turn: "POST /elder/turn",
    ingestStatus: "GET /elder/sources/:sourceId/ingest-status",
    listEvents: "GET /elder/events",
    listReminders: "GET /elder/reminders",
    confirmReminder: "POST /elder/reminders/:id/confirm",
    sendFeedback: "POST /elder/feedback",
    getProfile: "GET /elder/profile",
    upsertProfile: "PUT /elder/profile",
    todaySnapshot: "GET /elder/today-snapshot",
  },
  family: {
    pendingTasks: "GET /family/elders/:elderId/pending-tasks",
    confirmTask: "POST /family/tasks/:taskId/confirm",
    rejectTask: "POST /family/tasks/:taskId/reject",
    needsMoreInfoTask: "POST /family/tasks/:taskId/needs-more-info",
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
  reminderStore: ReminderStore;
  elderProfileStore: ElderProfileStore;
  debugTraceStore?: DebugTraceStore;
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

  server.get("/elder/sources/:sourceId/ingest-status", async (request) => {
    const params = request.params as { sourceId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    return deps.kernel.getIngestStatus({ tenantId, sourceId: params.sourceId });
  });

  server.post("/elder/feedback", async (request) => {
    const input = CreateFeedbackRequestSchema.parse(request.body);
    return deps.kernel.createFeedback(input);
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

  server.get("/elder/today-snapshot", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const elderId = String(query.elderId ?? "");
    const tenantId = String(query.tenantId ?? "tenant-mvp");
    const timezone = String(query.timezone ?? "Asia/Shanghai");
    if (!elderId) return reply.code(400).send({ message: "elderId is required" });
    return deps.kernel.getTodaySnapshot({ tenantId, elderId, timezone });
  });

  server.get("/elder/profile", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const elderId = String(query.elderId ?? "");
    const tenantId = String(query.tenantId ?? "tenant-mvp");
    if (!elderId) return reply.code(400).send({ message: "elderId is required" });
    const existing = await deps.elderProfileStore.get({ tenantId, elderId });
    if (existing) return existing;
    return {
      tenantId,
      elderId,
      displayName: elderId,
      timezone: "Asia/Shanghai",
      medications: [],
      places: [],
    };
  });

  server.put("/elder/profile", async (request) => {
    const input = UpsertElderProfileRequestSchema.parse(request.body);
    return deps.elderProfileStore.upsert({
      tenantId: input.tenantId,
      elderId: input.elderId,
      displayName: input.displayName,
      timezone: input.timezone,
      wakeTime: input.wakeTime,
      sleepTime: input.sleepTime,
      medications: input.medications,
      places: input.places,
      notes: input.notes,
    });
  });

  server.post("/elder/reminders/:id/confirm", async (request) => {
    const params = request.params as { id: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    return deps.kernel.confirmReminder({
      tenantId: input.tenantId,
      reminderId: params.id,
      actorUserId: input.actorUserId,
      remindAt: input.remindAt,
      timezone: input.timezone,
      traceId: input.traceId,
    });
  });

  server.get("/family/elders/:elderId/pending-tasks", async (request, reply) => {
    const params = request.params as { elderId: string };
    const query = request.query as Record<string, unknown>;
    const actorUserId = String(query.actorUserId ?? "");
    if (!actorUserId) return reply.code(400).send({ message: "actorUserId is required" });
    const tenantId = String(query.tenantId ?? "tenant-mvp");
    const traceId = typeof query.traceId === "string" ? query.traceId : undefined;
    return deps.kernel.listFamilyAssistTasks({ tenantId, elderId: params.elderId, actorUserId, traceId });
  });

  server.post("/family/tasks/:taskId/confirm", async (request) => {
    const params = request.params as { taskId: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    return deps.kernel.updateFamilyTaskStatus({
      tenantId: input.tenantId,
      taskId: params.taskId,
      actorUserId: input.actorUserId,
      action: "confirm",
      traceId: input.traceId,
    });
  });

  server.post("/family/tasks/:taskId/reject", async (request) => {
    const params = request.params as { taskId: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    return deps.kernel.updateFamilyTaskStatus({
      tenantId: input.tenantId,
      taskId: params.taskId,
      actorUserId: input.actorUserId,
      action: "reject",
      traceId: input.traceId,
    });
  });

  server.post("/family/tasks/:taskId/needs-more-info", async (request) => {
    const params = request.params as { taskId: string };
    const input = ConfirmReminderRequestSchema.parse(request.body);
    return deps.kernel.updateFamilyTaskStatus({
      tenantId: input.tenantId,
      taskId: params.taskId,
      actorUserId: input.actorUserId,
      action: "needs_more_info",
      traceId: input.traceId,
    });
  });

  server.post("/family/reminders", async (request) => {
    const input = CreateFamilyReminderRequestSchema.parse(request.body);
    return deps.kernel.createFamilyReminder(input);
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
    audioDir: process.env.MEM_AUDIO_DIR,
    publicAudioBaseUrl: process.env.MEM_AUDIO_BASE_URL,
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
	    reminderStore: postgres.reminderStore,
	    reminderEngine,
    familyReminderCommandStore: postgres.familyReminderCommandStore,
    familyTaskStore: postgres.familyTaskStore,
    feedbackStore: postgres.feedbackStore,
    riskFlagStore: postgres.riskFlagStore,
    semanticMemory: postgres.semanticMemoryStore,
    personalContextStore: postgres.personalContextStore,
    elderProfileStore: postgres.elderProfileStore,
    modelGateway,
    riskEngine: new DefaultRiskEngine(),
    permissionEngine: new DefaultPermissionEngine(),
    auditLog: postgres.auditLog,
    temporalMemory,
    temporalMemoryJobStore: postgres.temporalMemoryJobStore,
    memoryProcessingJobStore: postgres.memoryProcessingJobStore,
  };

  return {
    deps: {
      kernel: new ElderMemoryKernel(kernelDeps),
      eventStore: postgres.eventStore,
      reminderStore: postgres.reminderStore,
      elderProfileStore: postgres.elderProfileStore,
      debugTraceStore: postgres.debugTraceStore,
      healthCheck: async () => {
        await postgres.pool.query("select 1");
        const graphiti = await checkGraphitiHealth(temporalMemory);
        const graphitiRetryJobs = await postgres.temporalMemoryJobStore.stats();
        const memoryProcessingJobs = await postgres.memoryProcessingJobStore.stats();
        const graphitiRequired = isGraphitiRequired();
        return {
          ok: graphitiRequired ? graphiti === "ok" : true,
          postgres: "ok",
          semanticMemory: semanticMemoryProvider,
          model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
          embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
          openaiTimeoutMs: parseOpenAITimeoutMs(),
          openaiMemoryPlanTimeoutMs: parseOpenAIMemoryPlanTimeoutMs(),
          graphiti,
          graphitiRequired,
          graphitiRetryJobs,
          memoryProcessingJobs,
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
    process.env.MEM_REQUIRE_GRAPHITI === "true" ||
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
  const timeoutMs = parseOpenAITimeoutMs();
  if (!process.env.OPENAI_API_KEY) return new NotImplementedModelGateway();
  return new OpenAIModelGateway({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    baseURL: process.env.OPENAI_BASE_URL,
    project: process.env.OPENAI_PROJECT_ID,
    transcriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL,
    promptsDir: process.env.MEM_PROMPTS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "prompts"),
    promptVersion: process.env.MEM_PROMPT_VERSION ?? "v1",
    timeoutMs,
    operationTimeouts: {
      generateMemoryPlan: parseOpenAIMemoryPlanTimeoutMs(timeoutMs),
    },
  });
}

function parseOpenAITimeoutMs(): number {
  return parsePositiveInt(process.env.OPENAI_TIMEOUT_MS, 15_000);
}

function parseOpenAIMemoryPlanTimeoutMs(baseTimeoutMs = parseOpenAITimeoutMs()): number {
  return parsePositiveInt(process.env.OPENAI_MEMORY_PLAN_TIMEOUT_MS, Math.max(baseTimeoutMs, 60_000));
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
  const stopMemoryWorker = startMemoryProcessingWorker(deps.kernel);
  server.listen({ port, host: "0.0.0.0" }).catch(async (error) => {
    server.log.error(error);
    stopMemoryWorker();
    await close();
    process.exit(1);
  });
}

function startMemoryProcessingWorker(kernel: ElderMemoryKernel): () => void {
  if (process.env.MEM_API_BACKGROUND_WORKERS === "false") return () => undefined;
  const intervalMs = parsePositiveInt(process.env.MEM_MEMORY_WORKER_POLL_MS, 2_000);
  const limit = parsePositiveInt(process.env.MEM_MEMORY_WORKER_BATCH_SIZE, 5);
  const timer = setInterval(() => {
    kernel.processMemoryProcessingJobs({ limit }).catch((error) => {
      console.error("memory processing worker failed", error);
    });
  }, intervalMs);
  void kernel.processMemoryProcessingJobs({ limit }).catch((error) => {
    console.error("memory processing worker failed", error);
  });
  return () => clearInterval(timer);
}
