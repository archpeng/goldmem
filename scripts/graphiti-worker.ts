import { setTimeout as sleep } from "node:timers/promises";
import { createPostgresStores } from "../packages/memory-store/src/index.js";
import { GraphitiTemporalMemoryStore } from "../packages/temporal-memory/src/index.js";
import { runGraphitiRetryBatch } from "./graphiti-retry.js";

const databaseUrl = requiredEnv("DATABASE_URL");
const graphitiBaseUrl = requiredEnv("GRAPHITI_BASE_URL");
const batchSize = Number(process.env.GRAPHITI_WORKER_BATCH_SIZE ?? 10);
const pollMs = Number(process.env.GRAPHITI_WORKER_POLL_MS ?? 5000);

const postgres = createPostgresStores({ databaseUrl });
const temporalMemory = new GraphitiTemporalMemoryStore({
  baseUrl: graphitiBaseUrl,
  apiKey: process.env.GRAPHITI_API_KEY,
});

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

console.log(`graphiti worker start: batch=${batchSize} pollMs=${pollMs}`);
try {
  while (!stopping) {
    const stats = await runGraphitiRetryBatch({ postgres, temporalMemory, batchSize });
    if (stats.claimed > 0) console.log(`graphiti worker batch: ${JSON.stringify(stats)}`);
    await sleep(pollMs);
  }
} finally {
  await postgres.close();
  console.log("graphiti worker stopped");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
