import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, gte } from "drizzle-orm";
import { buildEvalCandidates } from "../packages/memory-kernel/src/eval-candidates.js";
import { createPostgresStores } from "../packages/memory-store/src/index.js";
import * as schema from "../packages/memory-store/src/postgres-schema.js";

const tenantId = process.env.GOLDMEM_TENANT_ID;
const elderId = process.env.GOLDMEM_ELDER_ID;
const since = process.env.GOLDMEM_EVAL_SINCE;
const outputDir = process.env.GOLDMEM_EVAL_CANDIDATE_DIR ?? "evals/candidates";
const outputFile = process.env.GOLDMEM_EVAL_CANDIDATE_FILE ?? join(outputDir, `candidates-${new Date().toISOString().slice(0, 10)}.jsonl`);

const postgres = createPostgresStores({
  databaseUrl: requiredEnv("DATABASE_URL"),
  audioDir: process.env.GOLDMEM_AUDIO_DIR,
  publicAudioBaseUrl: process.env.GOLDMEM_AUDIO_BASE_URL,
});

try {
  const audits = await postgres.db
    .select()
    .from(schema.auditLogs)
    .where(and(
      tenantId ? eq(schema.auditLogs.tenantId, tenantId) : undefined,
      elderId ? eq(schema.auditLogs.elderId, elderId) : undefined,
      since ? gte(schema.auditLogs.createdAt, new Date(since)) : undefined,
    ));
  const feedback = await postgres.db
    .select()
    .from(schema.feedback)
    .where(and(
      tenantId ? eq(schema.feedback.tenantId, tenantId) : undefined,
      elderId ? eq(schema.feedback.elderId, elderId) : undefined,
      since ? gte(schema.feedback.createdAt, new Date(since)) : undefined,
    ));
  const candidates = buildEvalCandidates({
    audits: audits.map((audit) => ({
      id: audit.id,
      tenantId: audit.tenantId,
      elderId: audit.elderId,
      sourceId: audit.sourceId,
      type: audit.type,
      payload: audit.payload,
      createdAt: audit.createdAt.toISOString(),
    })),
    feedback: feedback.map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      elderId: item.elderId,
      sourceId: item.sourceId,
      eventId: item.eventId,
      actorUserId: item.actorUserId,
      feedbackType: item.feedbackType,
      correction: item.correction,
      createdAt: item.createdAt.toISOString(),
    })),
  });
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, candidates.map((candidate) => JSON.stringify(candidate)).join("\n") + "\n");
  console.log(`eval candidate export ok: ${candidates.length} candidate(s) -> ${outputFile}`);
} finally {
  await postgres.close();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
