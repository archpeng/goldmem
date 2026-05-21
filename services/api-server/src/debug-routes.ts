import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { redactDebugTrace } from "./debug-trace.js";
import type { ApiServerDeps } from "./server-types.js";

export function registerDebugRoutes(server: FastifyInstance, deps: ApiServerDeps, token: string): void {
  server.get("/debug/traces/:traceId", async (request, reply) => {
    if (!hasValidDebugToken(request.headers["x-mem-debug-token"], token)) {
      return reply.code(403).send({ message: "Forbidden" });
    }
    if (!deps.debugTraceStore) return reply.code(404).send({ message: "Debug trace store is not configured" });
    const params = request.params as { traceId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    const trace = await deps.debugTraceStore.getByTrace({ tenantId, traceId: params.traceId });
    if (!trace) return reply.code(404).send({ message: "Trace not found" });
    return redactDebugTrace(trace);
  });

  server.get("/debug/sources/:sourceId", async (request, reply) => {
    if (!hasValidDebugToken(request.headers["x-mem-debug-token"], token)) {
      return reply.code(403).send({ message: "Forbidden" });
    }
    if (!deps.debugTraceStore) return reply.code(404).send({ message: "Debug trace store is not configured" });
    const params = request.params as { sourceId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    const trace = await deps.debugTraceStore.getBySource({ tenantId, sourceId: params.sourceId });
    if (!trace) return reply.code(404).send({ message: "Trace not found" });
    return redactDebugTrace(trace);
  });

  server.get("/debug/queries/:auditId", async (request, reply) => {
    if (!hasValidDebugToken(request.headers["x-mem-debug-token"], token)) {
      return reply.code(403).send({ message: "Forbidden" });
    }
    if (!deps.debugTraceStore) return reply.code(404).send({ message: "Debug trace store is not configured" });
    const params = request.params as { auditId: string };
    const tenantId = String((request.query as Record<string, unknown>).tenantId ?? "tenant-mvp");
    const trace = await deps.debugTraceStore.getByAuditId({ tenantId, auditId: params.auditId });
    if (!trace) return reply.code(404).send({ message: "Trace not found" });
    return redactDebugTrace(trace);
  });
}

export function buildDebugApiConfigFromEnv(): ApiServerDeps["debugApi"] | undefined {
  if (process.env.MEM_ENABLE_DEBUG_API !== "true") return undefined;
  const token = process.env.MEM_DEBUG_API_TOKEN?.trim();
  if (!token) throw new Error("MEM_DEBUG_API_TOKEN is required when MEM_ENABLE_DEBUG_API=true");
  validateDebugApiToken(token);
  return { token };
}

export function validateDebugApiToken(token: string): void {
  if (token.length < 16) {
    throw new Error("MEM_DEBUG_API_TOKEN must be at least 16 characters when debug API is enabled");
  }
}

function hasValidDebugToken(rawToken: string | string[] | undefined, expectedToken: string): boolean {
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (!token) return false;
  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
