import { HttpSemanticMemoryStore } from "../packages/memory-store/src/http-adapters.js";

const baseUrl = requiredEnv("MEM0_BASE_URL");
const userId = process.env.MEM0_SMOKE_USER_ID ?? "goldmem-mem0-smoke";
const marker = `goldmem-mem0-smoke-${Date.now()}`;

const semanticMemory = new HttpSemanticMemoryStore({
  baseUrl,
  apiKey: process.env.MEM0_API_KEY,
});

await semanticMemory.addMemory({
  userId,
  memory: `Title: Mem0 smoke test\nSummary: ${marker} confirms semantic memory writes and recall.\nType: daily_life\nRisk: none\nSource: mem0-smoke`,
  metadata: {
    sourceId: "mem0-smoke",
    eventId: marker,
    eventType: "daily_life",
    riskLevel: "none",
    visibility: "private",
  },
});

const results = await semanticMemory.searchMemory({
  userId,
  query: marker,
  limit: 5,
});

if (!results.some((result) => result.memory.includes(marker) || result.metadata?.eventId === marker)) {
  throw new Error(`Mem0 smoke search did not return marker ${marker}`);
}

console.log(`mem0 smoke ok: ${results.length} result(s)`);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
