import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { HttpMem0RecallStore } from "../packages/memory-store/src/http-adapters.js";
import * as schema from "../packages/memory-store/src/postgres-schema.js";

const databaseUrl = requiredEnv("DATABASE_URL");
const mem0BaseUrl = requiredEnv("MEM0_BASE_URL");
const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });
const recallMemory = new HttpMem0RecallStore({
  baseUrl: mem0BaseUrl,
  apiKey: process.env.MEM0_API_KEY,
});

try {
  const events = await db.select().from(schema.memoryEvents);
  for (const event of events) {
    await recallMemory.addMemory({
      tenantId: event.tenantId,
      elderId: event.elderId,
      memory: [
        `Title: ${event.title}`,
        `Summary: ${event.summary}`,
        `Type: ${event.type}`,
        `Risk: ${event.riskLevel}`,
        `Source: ${event.sourceId}`,
      ].join("\n"),
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
  await pool.end();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
