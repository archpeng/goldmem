import { createPostgresStores } from "../packages/memory-store/src/postgres.js";
import * as schema from "../packages/memory-store/src/postgres-schema.js";
import { OpenAIModelGateway } from "../packages/model-gateway/src/index.js";

const databaseUrl = requiredEnv("DATABASE_URL");
const postgres = createPostgresStores({ databaseUrl });
const modelGateway = new OpenAIModelGateway({
  apiKey: requiredEnv("OPENAI_API_KEY"),
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  baseURL: process.env.OPENAI_BASE_URL,
});

try {
  const events = await postgres.db.select().from(schema.memoryEvents);
  await postgres.pool.query("delete from semantic_memories");
  for (const event of events) {
    const memory = [
      `Title: ${event.title}`,
      `Summary: ${event.summary}`,
      `Type: ${event.type}`,
      `Risk: ${event.riskLevel}`,
      `Source: ${event.sourceId}`,
    ].join("\n");
    const embedding = await modelGateway.embedText({ text: memory });
    await postgres.semanticMemoryStore.addMemory({
      tenantId: event.tenantId,
      elderId: event.elderId,
      memory,
      embedding,
      metadata: {
        tenantId: event.tenantId,
        elderId: event.elderId,
        sourceId: event.sourceId,
        eventId: event.id,
        eventType: event.type,
        title: event.title,
        summary: event.summary,
        createdAt: event.createdAt.toISOString(),
        riskLevel: event.riskLevel,
        visibility: event.visibility,
      },
    });
  }

  console.log(`Rebuilt ${events.length} semantic memories`);
} finally {
  await postgres.close();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
