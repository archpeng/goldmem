import { HttpMem0RecallStore } from "../packages/memory-store/src/http-adapters.js";

const baseUrl = requiredEnv("MEM0_BASE_URL");
const tenantId = process.env.MEM0_SMOKE_TENANT_ID ?? "goldmem-smoke";
const elderId = process.env.MEM0_SMOKE_ELDER_ID ?? "goldmem-mem0-smoke";
const marker = `goldmem-mem0-smoke-${Date.now()}`;
const timeoutMs = positiveInt(process.env.MEM0_SMOKE_TIMEOUT_MS) ?? positiveInt(process.env.MEM0_TIMEOUT_MS) ?? 5_000;

const recallMemory = new HttpMem0RecallStore({
  baseUrl,
  apiKey: process.env.MEM0_API_KEY,
  timeoutMs,
});

const timings: Record<string, number> = {};
let currentPhase = "startup";

process.on("uncaughtException", (error) => {
  reportFailure(error);
});

process.on("unhandledRejection", (error) => {
  reportFailure(error);
});

await timed(timings, "englishWriteMs", () => recallMemory.addMemory({
  tenantId,
  elderId,
  memory: `Title: Mem0 smoke test\nSummary: ${marker} confirms Mem0 recall writes and search.\nType: daily_life\nRisk: none\nSource: mem0-smoke`,
  metadata: {
    tenantId,
    elderId,
    sourceId: "mem0-smoke",
    eventId: marker,
    eventType: "daily_life",
    riskLevel: "none",
    visibility: "private",
  },
}));

await timed(timings, "chineseWriteMs", () => recallMemory.addMemory({
  tenantId,
  elderId,
  memory: [
    "Title: 社区医院复查",
    `Summary: ${marker} 老人下周三下午三点去社区医院复查血压，女儿小敏提醒要带医保卡。`,
    "Type: health",
    "Risk: medical",
    "Source: mem0-smoke-cn",
  ].join("\n"),
  metadata: {
    tenantId,
    elderId,
    sourceId: "mem0-smoke-cn",
    eventId: `${marker}-cn`,
    eventType: "health",
    title: "社区医院复查",
    summary: `${marker} 老人下周三下午三点去社区医院复查血压，女儿小敏提醒要带医保卡。`,
    riskLevel: "medical",
    visibility: "shared_summary",
  },
}));

const results = await timed(timings, "markerSearchMs", () => recallMemory.searchMemory({
  tenantId,
  elderId,
  query: marker,
  limit: 5,
}));

if (!results.some((result) => result.memory.includes(marker) || result.metadata?.eventId === marker)) {
  throw new Error(`Mem0 smoke search did not return marker ${marker}`);
}

const chineseResults = await timed(timings, "chineseSearchMs", () => recallMemory.searchMemory({
  tenantId,
  elderId,
  query: "小敏提醒去社区医院复查血压要带什么？",
  limit: 5,
}));

if (!chineseResults.some((result) => result.memory.includes("医保卡") || result.metadata?.eventId === `${marker}-cn`)) {
  throw new Error("Mem0 Chinese smoke search did not return the health insurance card memory");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      marker,
      tenantId,
      elderId,
      timeoutMs,
      resultCounts: {
        marker: results.length,
        chinese: chineseResults.length,
      },
      timings,
    },
    null,
    2,
  ),
);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function timed<T>(timings: Record<string, number>, name: string, task: () => Promise<T>): Promise<T> {
  currentPhase = name;
  const startedAt = performance.now();
  try {
    const result = await task();
    currentPhase = "idle";
    return result;
  } finally {
    timings[name] = Math.round(performance.now() - startedAt);
  }
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function reportFailure(error: unknown): never {
  console.error(
    JSON.stringify(
      {
        ok: false,
        marker,
        tenantId,
        elderId,
        timeoutMs,
        failedPhase: currentPhase,
        timings,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
