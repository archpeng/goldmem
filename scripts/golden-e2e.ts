import { readFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { createPostgresStores } from "../packages/memory-store/src/index.js";
import {
  MemoryAnswerSchema,
  type FamilyTask,
  type MemoryEvent,
  type Reminder,
} from "../packages/memory-schema/src/index.js";
import { GraphitiTemporalMemoryStore } from "../packages/temporal-memory/src/index.js";
import { runGraphitiRetryBatch } from "./graphiti-retry.js";

type Json = Record<string, unknown>;

const GoldenCaseSchema = z.object({
  version: z.number(),
  seedNotes: z.array(z.object({ id: z.string(), transcript: z.string().min(1) })),
  queries: z.array(
    z.object({
      id: z.string(),
      query: z.string().min(1),
      expectedAnswerHints: z.array(z.string().min(1)).default([]),
      expectedAnswerAnyHints: z.array(z.array(z.string().min(1)).min(1)).default([]),
      semanticAnswerExpectations: z.array(z.string().min(1)).default([]),
      semanticAnswerForbiddenClaims: z.array(z.string().min(1)).default([]),
      expectedEvidenceHints: z.array(z.string().min(1)).default([]),
      forbiddenAnswerHints: z.array(z.string().min(1)).default([]),
      forbiddenEvidenceHints: z.array(z.string().min(1)).default([]),
      allowedSources: z.array(z.enum(["postgres", "semantic", "context_link", "graphiti", "graphiti_provenance"])).default(["postgres", "semantic", "graphiti", "graphiti_provenance"]),
      expectedEvidenceSources: z.array(z.enum(["postgres", "semantic", "context_link", "graphiti", "graphiti_provenance"])).default([]),
      requiresSemantic: z.boolean().default(false),
      minConfidence: z.number().min(0).max(1).default(0.4),
    }),
  ),
  riskExpectations: z
    .array(
      z.object({
        seedNoteId: z.string(),
        eventRiskLevel: z.string(),
        familyTaskType: z.string(),
      }),
    )
    .default([]),
  reminderExpectations: z
    .array(
      z.object({
        seedNoteId: z.string(),
        titleHint: z.string(),
        requiresConfirmation: z.boolean(),
      }),
    )
    .default([]),
  temporalExpectations: z.array(z.object({
    seedNoteId: z.string(),
    status: z.enum(["queued", "not_needed", "failed"]),
    enqueueReason: z.enum(["hard_risk", "hard_context_link", "hard_family_task", "model_relation_signal", "not_needed"]).optional(),
  })).default([]),
  familyTaskExpectations: z.array(z.object({ type: z.string().optional(), hint: z.string().min(1) })).default([]),
  familyTaskActionExpectations: z.array(z.object({
    type: z.string().optional(),
    hint: z.string().min(1),
    action: z.enum(["confirm", "reject", "needs_more_info"]),
    expectedStatus: z.enum(["confirmed", "rejected", "needs_more_info"]),
  })).default([]),
  forbidAutoConfirmedReminderHints: z.array(z.string().min(1)).default([]),
});

const SemanticJudgeResultSchema = z.object({
  pass: z.boolean(),
  reason: z.string().min(1),
  metExpectations: z.array(z.string()).default([]),
  violatedForbiddenClaims: z.array(z.string()).default([]),
});

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const tenantId = process.env.GOLDEN_E2E_TENANT_ID ?? "tenant-mvp";
const elderId = process.env.GOLDEN_E2E_ELDER_ID ?? `golden-e2e-${Date.now()}`;
const fixturePath = process.env.GOLDEN_E2E_FIXTURE ?? join(process.cwd(), "e2e", "golden-retrieval.json");
const requestTimeoutMs = Number(process.env.GOLDEN_E2E_TIMEOUT_MS ?? 600_000);
const graphitiDrainBatches = Number(process.env.GOLDEN_E2E_DRAIN_BATCHES ?? 20);
const graphitiDrainBatchSize = Number(process.env.GOLDEN_E2E_DRAIN_BATCH_SIZE ?? 20);
const graphitiSearchSettleMs = Number(process.env.GOLDEN_E2E_SEARCH_SETTLE_MS ?? 5000);
const graphitiTimeoutMs = Number(process.env.GRAPHITI_TIMEOUT_MS ?? 60_000);
const fixture = GoldenCaseSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
const semanticJudge = createSemanticJudge();
const graphitiMode = process.env.GOLDEN_E2E_GRAPHITI_MODE
  ?? (fixturePath.includes("graphiti") || fixturePath.includes("context-links") ? "required" : "optional");

const health = await request<Json>("GET", "/health");
assert(health.ok === true, "API health check failed");
assert(health.semanticMemory === "pgvector", "Semantic recall index must be pgvector for golden E2E");
const expectedApiModel = process.env.GOLDEN_E2E_API_MODEL ?? "gpt-4.1-mini";
assert(health.model === expectedApiModel, `Golden E2E requires API model ${expectedApiModel}; current API model is ${String(health.model)}`);
if (graphitiMode === "required") {
  assert(health.graphiti === "ok", "Graphiti must be healthy for this golden E2E fixture");
}
if (graphitiMode === "disabled") {
  assert(
    health.graphiti === "missing_config",
    `This golden fixture must run against a Graphiti-disabled API; current API graphiti health is ${String(health.graphiti)}`,
  );
}

const ingests = new Map<string, Awaited<ReturnType<typeof ingestNote>>>();
for (const note of fixture.seedNotes) {
  console.log(`golden seed start: ${note.id}`);
  const result = await ingestNote(note.transcript);
  console.log(
    `golden seed ok: ${note.id} source=${result.sourceId} events=${result.events.length} reminders=${result.reminderCandidates.length}`,
  );
  assert(Boolean(result.traceId), `Seed note ${note.id} did not return traceId`);
  ingests.set(note.id, result);
  assert(result.events.length > 0 || result.reminderCandidates.length > 0, `Seed note ${note.id} produced no records`);
  if (fixturePath.includes("graphiti")) {
    assert(result.temporalMemory?.status === "queued" || result.temporalMemory?.status === "not_needed", `Seed note ${note.id} returned invalid temporal memory status`);
  }
}

if (graphitiMode === "required") await drainGraphitiJobs();

const tenantQuery = `tenantId=${encodeURIComponent(tenantId)}&elderId=${encodeURIComponent(elderId)}`;
const events = await request<MemoryEvent[]>("GET", `/elder/events?${tenantQuery}`);
const reminders = await request<Reminder[]>("GET", `/elder/reminders?${tenantQuery}`);
const familyTasks = await request<FamilyTask[]>("GET", `/family/elders/${encodeURIComponent(elderId)}/tasks?tenantId=${encodeURIComponent(tenantId)}`);

for (const expectation of fixture.riskExpectations) {
  const ingest = requiredIngest(ingests, expectation.seedNoteId);
  assert(
    ingest.events.some((event) => event.riskLevel === expectation.eventRiskLevel),
    `Expected ${expectation.seedNoteId} to create risk level ${expectation.eventRiskLevel}`,
  );
  assert(
    familyTasks.some((task) => task.type === expectation.familyTaskType),
    `Expected family task type ${expectation.familyTaskType}`,
  );
}

for (const expectation of fixture.reminderExpectations) {
  const matched = reminders.find(
    (reminder) =>
      textIncludes(reminder.title, expectation.titleHint) ||
      textIncludes(reminder.reason, expectation.titleHint) ||
      textIncludes(reminder.description, expectation.titleHint) ||
      textIncludes(reminder.timeText, expectation.titleHint),
  );
  assert(Boolean(matched), `Expected reminder containing ${expectation.titleHint}`);
  assert(
    matched?.confirmationRequired === expectation.requiresConfirmation,
    `Expected reminder ${matched?.id} confirmationRequired=${expectation.requiresConfirmation}`,
  );
}

for (const expectation of fixture.temporalExpectations) {
  const ingest = requiredIngest(ingests, expectation.seedNoteId);
  assert(
    ingest.temporalMemory?.status === expectation.status,
    `Expected ${expectation.seedNoteId} temporalMemory.status=${expectation.status}, got ${String(ingest.temporalMemory?.status)}`,
  );
  if (expectation.enqueueReason) {
    assert(
      ingest.temporalMemory?.enqueueReason === expectation.enqueueReason,
      `Expected ${expectation.seedNoteId} enqueueReason=${expectation.enqueueReason}, got ${String(ingest.temporalMemory?.enqueueReason)}`,
    );
  }
}

for (const expectation of fixture.familyTaskExpectations) {
  assert(
    familyTasks.some((task) => {
      const text = `${task.title}\n${task.summary}`;
      return (!expectation.type || task.type === expectation.type) && textIncludes(text, expectation.hint);
    }),
    `Expected family task containing ${expectation.hint}`,
  );
}

for (const expectation of fixture.familyTaskActionExpectations) {
  const task = familyTasks.find((item) => {
    const text = `${item.title}\n${item.summary}`;
    return (!expectation.type || item.type === expectation.type) && textIncludes(text, expectation.hint);
  });
  assert(Boolean(task), `Expected actionable family task containing ${expectation.hint}`);
  const path = expectation.action === "confirm"
    ? `/family/tasks/${encodeURIComponent(task.id)}/confirm`
    : expectation.action === "reject"
      ? `/family/tasks/${encodeURIComponent(task.id)}/reject`
      : `/family/tasks/${encodeURIComponent(task.id)}/needs-more-info`;
  const updated = await request<FamilyTask>("POST", path, { tenantId, actorUserId: "golden-family" });
  assert(updated.status === expectation.expectedStatus, `Expected family task ${task.id} status ${expectation.expectedStatus}`);
}

for (const hint of fixture.forbidAutoConfirmedReminderHints) {
  assert(
    !reminders.some(
      (reminder) =>
        (reminder.status === "confirmed" || reminder.status === "scheduled") &&
        (textIncludes(reminder.title, hint) || textIncludes(reminder.reason, hint) || textIncludes(reminder.description, hint)),
    ),
    `Reminder containing ${hint} was auto-confirmed or scheduled`,
  );
}

let semanticEvidenceQueries = 0;
for (const queryCase of fixture.queries) {
  console.log(`golden query start: ${queryCase.id}`);
  const turn = await request<{ traceId: string; answer?: unknown }>("POST", "/elder/turn", {
    tenantId,
    elderId,
    text: queryCase.query,
  });
  const answer = MemoryAnswerSchema.parse(turn.answer);
  assert(Boolean(answer.traceId), `${queryCase.id} did not return traceId`);
  const debugTrace = await request<{ auditTrail?: unknown[] }>("GET", `/debug/traces/${encodeURIComponent(answer.traceId ?? "")}?tenantId=${encodeURIComponent(tenantId)}`);
  assert((debugTrace.auditTrail?.length ?? 0) > 0, `${queryCase.id} debug trace did not read back audit trail`);
  const answerText = normalizeText(answer.answerText);
  const evidenceText = normalizeText(answer.retrievedEvidence.map((item) => item.summary).join("\n"));
  const evidenceSources = new Set(answer.retrievedEvidence.map((item) => item.retrievalSource));

  assert(answer.confidence >= queryCase.minConfidence, `${queryCase.id} confidence too low: ${answer.confidence}`);
  assert(answer.retrievedEvidence.length > 0, `${queryCase.id} returned no retrieved evidence`);
  assert(
    answer.retrievedEvidence.every((item) => queryCase.allowedSources.includes(item.retrievalSource)),
    `${queryCase.id} returned unexpected retrieval source`,
  );

  for (const hint of queryCase.expectedAnswerHints) {
    assert(textIncludes(answerText, hint), `${queryCase.id} answer missing hint: ${hint}`);
  }
  for (const hints of queryCase.expectedAnswerAnyHints) {
    assert(
      hints.some((hint) => textIncludes(answerText, hint)),
      `${queryCase.id} answer missing any hint: ${hints.join(" | ")}`,
    );
  }
  if (queryCase.semanticAnswerExpectations.length || queryCase.semanticAnswerForbiddenClaims.length) {
    const judgment = await semanticJudge({
      queryId: queryCase.id,
      query: queryCase.query,
      answerText: answer.answerText,
      evidence: answer.retrievedEvidence.map((item) => ({
        summary: item.summary,
        retrievalSource: item.retrievalSource,
      })),
      expectations: queryCase.semanticAnswerExpectations,
      forbiddenClaims: queryCase.semanticAnswerForbiddenClaims,
    });
    assert(judgment.pass, `${queryCase.id} semantic answer check failed: ${judgment.reason}`);
    console.log(`golden semantic ok: ${queryCase.id} ${judgment.reason}`);
  }
  for (const hint of queryCase.expectedEvidenceHints) {
    assert(textIncludes(evidenceText, hint), `${queryCase.id} evidence missing hint: ${hint}`);
  }
  for (const hint of queryCase.forbiddenAnswerHints) {
    assert(!textIncludes(answerText, hint), `${queryCase.id} answer contained forbidden hint: ${hint}`);
  }
  for (const hint of queryCase.forbiddenEvidenceHints) {
    assert(!textIncludes(evidenceText, hint), `${queryCase.id} evidence contained forbidden hint: ${hint}`);
  }
  for (const source of queryCase.expectedEvidenceSources) {
    assert(evidenceSources.has(source), `${queryCase.id} expected evidence source: ${source}`);
  }

  if (evidenceSources.has("semantic")) semanticEvidenceQueries += 1;
  if (queryCase.requiresSemantic) {
    assert(evidenceSources.has("semantic"), `${queryCase.id} expected Semantic evidence`);
  }

  console.log(
    `golden query ok: ${queryCase.id} confidence=${answer.confidence} sources=${[...evidenceSources].join(",")}`,
  );
}

assert(semanticEvidenceQueries > 0, "Golden baseline did not exercise Semantic evidence");
console.log(
  `golden e2e ok: elderId=${elderId} seeds=${fixture.seedNotes.length} events=${events.length} reminders=${reminders.length} familyTasks=${familyTasks.length} semanticQueries=${semanticEvidenceQueries}`,
);

async function ingestNote(transcript: string) {
  const turn = await request<{
    ingestResult?: {
      traceId: string;
      sourceId: string;
      summary: string;
      events: MemoryEvent[];
      reminderCandidates: Reminder[];
      temporalMemory?: {
        status: "queued" | "not_needed" | "failed";
        enqueueReason?: "hard_risk" | "hard_context_link" | "hard_family_task" | "model_relation_signal" | "not_needed";
        errorMessage?: string;
      };
    };
  }>("POST", "/elder/turn", {
    tenantId,
    elderId,
    text: transcript,
  });
  if (!turn.ingestResult) throw new Error("Elder turn did not return ingestResult for seed note");
  return turn.ingestResult;
}

async function drainGraphitiJobs(): Promise<void> {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const graphitiBaseUrl = requiredEnv("GRAPHITI_BASE_URL");
  const postgres = createPostgresStores({ databaseUrl });
  const temporalMemory = new GraphitiTemporalMemoryStore({
    baseUrl: graphitiBaseUrl,
    apiKey: process.env.GRAPHITI_API_KEY,
    timeoutMs: graphitiTimeoutMs,
  });
  try {
    for (let attempt = 0; attempt < graphitiDrainBatches; attempt += 1) {
      const stats = await runGraphitiRetryBatch({ postgres, temporalMemory, batchSize: graphitiDrainBatchSize });
      if (stats.failed > 0 || stats.dead > 0) throw new Error(`Graphiti temporal job drain failed: ${JSON.stringify(stats)}`);
      if (stats.claimed === 0) {
        if (graphitiSearchSettleMs > 0) await new Promise((resolve) => setTimeout(resolve, graphitiSearchSettleMs));
        return;
      }
      console.log(`golden graphiti drain batch: ${JSON.stringify(stats)}`);
    }
    throw new Error(`Graphiti temporal job drain exceeded ${graphitiDrainBatches} batches`);
  } finally {
    await postgres.close();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request<T>(method: string, path: string, body?: Json): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return parsed as T;
}

function requiredIngest(ingests: Map<string, Awaited<ReturnType<typeof ingestNote>>>, id: string) {
  const ingest = ingests.get(id);
  if (!ingest) throw new Error(`Missing seed ingest result: ${id}`);
  return ingest;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function textIncludes(value: string | undefined, hint: string): boolean {
  return normalizeText(value ?? "").includes(normalizeText(hint));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function createSemanticJudge() {
  const apiKey = process.env.OPENAI_API_KEY;
  let client: OpenAI | undefined;

  return async (input: {
    queryId: string;
    query: string;
    answerText: string;
    evidence: Array<{ summary: string; retrievalSource: string }>;
    expectations: string[];
    forbiddenClaims: string[];
  }): Promise<z.infer<typeof SemanticJudgeResultSchema>> => {
    if (!apiKey) {
      throw new Error("Semantic answer checks require OPENAI_API_KEY");
    }
    client ??= new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined });

    const response = await client.chat.completions.create({
      model: process.env.GOLDEN_E2E_JUDGE_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are a strict semantic judge for GoldMem golden E2E tests.",
            "Judge meaning, not exact wording. Do not require fixed substrings.",
            "Use only the question, answer, and provided evidence summaries.",
            "Pass only if every expected meaning is clearly expressed and none of the forbidden claims are present.",
            "Return strict JSON: {\"pass\": boolean, \"reason\": string, \"metExpectations\": string[], \"violatedForbiddenClaims\": string[]}.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
    });

    const content = response.choices[0]?.message.content;
    assert(content, `${input.queryId} semantic judge returned empty response`);
    return SemanticJudgeResultSchema.parse(JSON.parse(content));
  };
}
