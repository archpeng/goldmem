import OpenAI from "openai";

type BenchResult = {
  model: string;
  ok: boolean;
  durationMs: number;
  outputChars?: number;
  error?: string;
};

const apiKey = requiredEnv("OPENAI_API_KEY");
const baseURL = process.env.OPENAI_BASE_URL;
const timeoutMs = Number(process.env.NEKO_BENCH_TIMEOUT_MS ?? 30_000);
const concurrency = Number(process.env.NEKO_BENCH_CONCURRENCY ?? 4);
const maxModels = Number(process.env.NEKO_BENCH_MAX_MODELS ?? 0);
const explicitModels = (process.env.NEKO_BENCH_MODELS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const client = new OpenAI({ apiKey, baseURL, timeout: timeoutMs });
const models = explicitModels.length
  ? explicitModels
  : await listCandidateModels();
const selectedModels = maxModels > 0 ? models.slice(0, maxModels) : models;

console.error(`benchmark models=${selectedModels.length} timeoutMs=${timeoutMs} concurrency=${concurrency}`);

const results = await mapLimit(selectedModels, concurrency, benchmarkModel);
results.sort((a, b) => {
  if (a.ok !== b.ok) return a.ok ? -1 : 1;
  return a.durationMs - b.durationMs;
});

console.log(JSON.stringify({
  baseURL,
  timeoutMs,
  concurrency,
  tested: results.length,
  ok: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
  fastest: results.filter((item) => item.ok).slice(0, 10),
  results,
}, null, 2));

async function listCandidateModels(): Promise<string[]> {
  const response = await client.models.list();
  return response.data
    .map((model) => model.id)
    .filter(isCandidateChatModel)
    .sort();
}

function isCandidateChatModel(model: string): boolean {
  const lower = model.toLowerCase();
  if (lower.includes("embedding")) return false;
  if (lower.includes("image")) return false;
  if (lower.includes("transcribe") || lower.includes("whisper")) return false;
  if (lower.includes("bff")) return false;
  if ([
    "codex-auto-review",
    "data_insight_analysis",
    "enhanced_intent_router",
    "evaluation_model",
    "execute_cypher",
    "generate_answer",
    "generate_cypher",
    "intent_recognition",
    "intent_validation",
    "outline_generation",
    "outline_generation_fallback",
    "parallel_diagnosis",
    "query_expansion",
  ].includes(model)) return false;

  return /gpt|claude|deepseek|gemini|glm|mini|max|qwen|kimi|moonshot|llama|mistral|gemma|doubao|k2|z-ai|shisa|dolphin/i.test(model);
}

async function benchmarkModel(model: string): Promise<BenchResult> {
  const startedAt = Date.now();
  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Return strict JSON only. No markdown.",
        },
        {
          role: "user",
          content: "用简体中文返回 {\"ok\": true, \"summary\": \"蓝色钥匙在门口鞋柜上\"}。",
        },
      ],
    });
    const content = response.choices[0]?.message.content ?? "";
    JSON.parse(content);
    return {
      model,
      ok: true,
      durationMs: Date.now() - startedAt,
      outputChars: content.length,
    };
  } catch (error) {
    return {
      model,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
      const result = results[index] as BenchResult;
      console.error(`${result.ok ? "ok" : "fail"} ${result.model} ${result.durationMs}ms`);
    }
  });
  await Promise.all(workers);
  return results;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
