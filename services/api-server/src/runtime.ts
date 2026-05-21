import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ElderMemoryKernel, type ElderMemoryKernelDeps } from "@mem/memory-kernel";
import { DefaultPermissionEngine } from "@mem/permission-engine";
import { DefaultReminderEngine } from "@mem/reminder-engine";
import { DefaultRiskEngine } from "@mem/risk-engine";
import {
  createPostgresStores,
} from "@mem/memory-store";
import { NotImplementedModelGateway, OpenAIModelGateway, type ModelGateway } from "@mem/model-gateway";
import { GraphitiTemporalMemoryStore, NullTemporalMemoryStore, type TemporalMemoryStore } from "@mem/temporal-memory";
import { buildDebugApiConfigFromEnv } from "./debug-routes.js";
import { buildHealthCheck } from "./health-worker.js";
import type { ApiServerDeps } from "./server-types.js";

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
  const debugApi = buildDebugApiConfigFromEnv();
  const graphitiRequired = isGraphitiRequired();
  const openaiTimeoutMs = parseOpenAITimeoutMs();
  const openaiMemoryPlanTimeoutMs = parseOpenAIMemoryPlanTimeoutMs(openaiTimeoutMs);

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
      ...(debugApi ? { debugApi } : {}),
      healthCheck: buildHealthCheck(postgres, temporalMemory, {
        semanticMemoryProvider,
        model: process.env.OPENAI_MODEL ?? "claude-sonnet-4-6",
        embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        openaiTimeoutMs,
        openaiMemoryPlanTimeoutMs,
        graphitiRequired,
        checkGraphitiHealth,
      }),
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

export function isGraphitiRequired(): boolean {
  return (
    process.env.GRAPHITI_REQUIRED_IN_PRODUCTION === "true" ||
    process.env.MEM_REQUIRE_GRAPHITI === "true" ||
    process.env.NODE_ENV === "production"
  );
}

export async function checkGraphitiHealth(temporalMemory: TemporalMemoryStore): Promise<"ok" | "missing_config" | "unhealthy"> {
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

export function buildModelGatewayFromEnv(): ModelGateway {
  const timeoutMs = parseOpenAITimeoutMs();
  if (!process.env.OPENAI_API_KEY) return new NotImplementedModelGateway();
  return new OpenAIModelGateway({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "claude-sonnet-4-6",
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

export function parseOpenAITimeoutMs(): number {
  return parsePositiveInt(process.env.OPENAI_TIMEOUT_MS, 15_000);
}

export function parseOpenAIMemoryPlanTimeoutMs(baseTimeoutMs = parseOpenAITimeoutMs()): number {
  return parsePositiveInt(process.env.OPENAI_MEMORY_PLAN_TIMEOUT_MS, Math.max(baseTimeoutMs, 60_000));
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
