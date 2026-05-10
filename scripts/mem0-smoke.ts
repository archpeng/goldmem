import { HttpMem0RecallStore } from "../packages/memory-store/src/http-adapters.js";

const baseUrl = requiredEnv("MEM0_BASE_URL");
const userId = process.env.MEM0_SMOKE_USER_ID ?? "goldmem-mem0-smoke";
const marker = `goldmem-mem0-smoke-${Date.now()}`;

const recallMemory = new HttpMem0RecallStore({
  baseUrl,
  apiKey: process.env.MEM0_API_KEY,
});

await recallMemory.addMemory({
  userId,
  memory: `Title: Mem0 smoke test\nSummary: ${marker} confirms Mem0 recall writes and search.\nType: daily_life\nRisk: none\nSource: mem0-smoke`,
  metadata: {
    sourceId: "mem0-smoke",
    eventId: marker,
    eventType: "daily_life",
    riskLevel: "none",
    visibility: "private",
  },
});

await recallMemory.addMemory({
  userId,
  memory: [
    "Title: 社区医院复查",
    `Summary: ${marker} 老人下周三下午三点去社区医院复查血压，女儿小敏提醒要带医保卡。`,
    "Type: health",
    "Risk: medical",
    "Source: mem0-smoke-cn",
  ].join("\n"),
  metadata: {
    sourceId: "mem0-smoke-cn",
    eventId: `${marker}-cn`,
    eventType: "health",
    title: "社区医院复查",
    summary: `${marker} 老人下周三下午三点去社区医院复查血压，女儿小敏提醒要带医保卡。`,
    riskLevel: "medical",
    visibility: "shared_summary",
  },
});

const results = await recallMemory.searchMemory({
  userId,
  query: marker,
  limit: 5,
});

if (!results.some((result) => result.memory.includes(marker) || result.metadata?.eventId === marker)) {
  throw new Error(`Mem0 smoke search did not return marker ${marker}`);
}

const chineseResults = await recallMemory.searchMemory({
  userId,
  query: "小敏提醒去社区医院复查血压要带什么？",
  limit: 5,
});

if (!chineseResults.some((result) => result.memory.includes("医保卡") || result.metadata?.eventId === `${marker}-cn`)) {
  throw new Error("Mem0 Chinese smoke search did not return the health insurance card memory");
}

console.log(`mem0 smoke ok: ${results.length} marker result(s), ${chineseResults.length} Chinese result(s)`);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
