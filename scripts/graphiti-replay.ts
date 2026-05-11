import { createPostgresStores } from "../packages/memory-store/src/index.js";
import { GraphitiTemporalMemoryStore } from "../packages/temporal-memory/src/index.js";
import { runGraphitiRetryBatch } from "./graphiti-retry.js";

const databaseUrl = requiredEnv("DATABASE_URL");
const graphitiBaseUrl = requiredEnv("GRAPHITI_BASE_URL");
const batchSize = Number(process.env.GRAPHITI_REPLAY_BATCH_SIZE ?? 10);

const postgres = createPostgresStores({ databaseUrl });
const temporalMemory = new GraphitiTemporalMemoryStore({
  baseUrl: graphitiBaseUrl,
  apiKey: process.env.GRAPHITI_API_KEY,
});

try {
  const result = await replayDueJobs({ once: true });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await postgres.close();
}

async function replayDueJobs(input: { once: boolean }) {
  const stats = await runGraphitiRetryBatch({ postgres, temporalMemory, batchSize });
  return { ok: true, ...stats, once: input.once };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
