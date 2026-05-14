import { OpenAIModelGateway, type RetrievedEvidence } from "../packages/model-gateway/src/index.js";

const models = (process.env.LATENCY_MODELS ?? "gpt-4.1-mini,gpt-5.4-mini")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const context = {
  recentEvents: [],
  semanticCandidateEvents: [],
  openReminders: [],
  semanticMemories: [],
  knownEntities: [],
  familyRelations: [],
  safetyPolicy: [],
};
const now = new Date().toISOString();
const evidence: RetrievedEvidence[] = [{
  sourceId: "source-latency",
  eventId: "event-latency",
  createdAt: now,
  summary: "蓝色钥匙放在门口鞋柜上。",
  score: 0.95,
  canPlayAudio: false,
  retrievalSource: "postgres",
}];

const results = [];
for (const model of models) {
  const gateway = new OpenAIModelGateway({
    apiKey: requiredEnv("OPENAI_API_KEY"),
    baseURL: process.env.OPENAI_BASE_URL,
    model,
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000),
    promptsDir: process.env.MEM_PROMPTS_DIR ?? "prompts",
  });

  results.push({
    model,
    planElderTurnMs: await measure(() => gateway.planElderTurn({
      tenantId: "tenant-mvp",
      elderId: "latency-model",
      text: "我把蓝色钥匙放在门口鞋柜上了。",
      now,
      context,
    })),
    generateMemoryPlanMs: await measure(() => gateway.generateMemoryPlan({
      tenantId: "tenant-mvp",
      elderId: "latency-model",
      sourceId: "source-latency",
      transcript: "我把蓝色钥匙放在门口鞋柜上了。",
      createdAt: now,
      timeContext: { createdAt: now, timezone: "Asia/Shanghai" },
      context,
    })),
    parseMemoryQueryMs: await measure(() => gateway.parseMemoryQuery({
      tenantId: "tenant-mvp",
      elderId: "latency-model",
      query: "我的蓝色钥匙放在哪里？",
      now,
      context,
    })),
    generateMemoryAnswerMs: await measure(() => gateway.generateMemoryAnswer({
      query: "我的蓝色钥匙放在哪里？",
      parsedQuery: {
        intent: "recall_event",
        entities: [{ type: "object", name: "蓝色钥匙", confidence: 0.95 }],
        eventTypes: ["object"],
        safetyTags: [],
        requiresTemporalEvidence: false,
        relationQueryIntent: "none",
        requiresSourceEvidence: true,
      },
      evidence,
      responseStyle: "elder_friendly_voice",
    })),
  });
}

console.log(JSON.stringify(results, null, 2));

async function measure(action: () => Promise<unknown>): Promise<number | string> {
  const startedAt = Date.now();
  try {
    await action();
    return Date.now() - startedAt;
  } catch (error) {
    return `failed after ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
