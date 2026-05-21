import Fastify, { type FastifyInstance } from "fastify";
import {
  ConfirmReminderRequestSchema,
  CreateFeedbackRequestSchema,
  CreateFamilyReminderRequestSchema,
  ElderTurnRequestSchema,
  UpsertElderProfileRequestSchema,
} from "@mem/memory-schema";
import { registerDebugRoutes } from "./debug-routes.js";
import type { ApiServerDeps } from "./server-types.js";

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

  if (deps.debugApi) registerDebugRoutes(server, deps, deps.debugApi.token);

  return server;
}
