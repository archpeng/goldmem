import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
type EvidenceSource = "postgres" | "semantic" | "context_link" | "graphiti" | "graphiti_provenance";

const EvidenceSourceSchema = z.enum(["postgres", "semantic", "context_link", "graphiti", "graphiti_provenance"]);

const GraphitiComparisonFixtureSchema = z.object({
  version: z.number(),
  description: z.string().optional(),
  minRawGraphitiQueries: z.number().int().nonnegative().default(3),
  seedNotes: z.array(z.object({ id: z.string(), transcript: z.string().min(1) })),
  queries: z.array(z.object({
    id: z.string(),
    query: z.string().min(1),
    expectedAnswerHints: z.array(z.string().min(1)).default([]),
    expectedAnswerAnyHints: z.array(z.array(z.string().min(1)).min(1)).default([]),
    expectedEvidenceHints: z.array(z.string().min(1)).default([]),
    forbiddenAnswerHints: z.array(z.string().min(1)).default([]),
    forbiddenEvidenceHints: z.array(z.string().min(1)).default([]),
    semanticAnswerExpectations: z.array(z.string().min(1)).default([]),
    semanticAnswerForbiddenClaims: z.array(z.string().min(1)).default([]),
    enabledExpectedEvidenceSources: z.array(EvidenceSourceSchema).default(["graphiti"]),
    minConfidence: z.number().min(0).max(1).default(0.4),
  })),
  riskExpectations: z.array(z.object({
    seedNoteId: z.string(),
    eventRiskLevel: z.string(),
    familyTaskType: z.string(),
  })).default([]),
  reminderExpectations: z.array(z.object({
    seedNoteId: z.string(),
    titleHint: z.string(),
    requiresConfirmation: z.boolean(),
  })).default([]),
  familyTaskExpectations: z.array(z.object({
    type: z.string().optional(),
    hint: z.string().min(1),
  })).default([]),
  forbidAutoConfirmedReminderHints: z.array(z.string().min(1)).default([]),
});

const SemanticJudgeResultSchema = z.object({
  pass: z.boolean(),
  reason: z.string().min(1),
  metExpectations: z.array(z.string()).default([]),
  violatedForbiddenClaims: z.array(z.string()).default([]),
});

const enabledBaseUrl = requiredEnv("GRAPHITI_E2E_ENABLED_BASE_URL").replace(/\/$/, "");
const disabledBaseUrl = requiredEnv("GRAPHITI_E2E_DISABLED_BASE_URL").replace(/\/$/, "");
const databaseUrl = requiredEnv("DATABASE_URL");
const graphitiBaseUrl = requiredEnv("GRAPHITI_BASE_URL");
const fixturePath = process.env.GRAPHITI_E2E_FIXTURE ?? join(process.cwd(), "e2e", "golden-graphiti-core.json");
const requestTimeoutMs = Number(process.env.GRAPHITI_E2E_TIMEOUT_MS ?? 600_000);
const modelRetries = Number(process.env.GRAPHITI_E2E_MODEL_RETRIES ?? process.env.GRAPHITI_E2E_PROVIDER_RETRIES ?? 2);
const graphitiDrainBatches = Number(process.env.GRAPHITI_E2E_DRAIN_BATCHES ?? 20);
const graphitiDrainBatchSize = Number(process.env.GRAPHITI_E2E_DRAIN_BATCH_SIZE ?? 20);
const graphitiSearchSettleMs = Number(process.env.GRAPHITI_E2E_SEARCH_SETTLE_MS ?? 1000);
const graphitiTimeoutMs = Number(process.env.GRAPHITI_TIMEOUT_MS ?? 60_000);
const tenantId = process.env.GRAPHITI_E2E_TENANT_ID ?? "tenant-mvp";
const elderIdBase = process.env.GRAPHITI_E2E_ELDER_ID ?? `graphiti-core-${Date.now()}`;
const fixture = GraphitiComparisonFixtureSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
const semanticJudge = createSemanticJudge();

const enabledRun = await runApiScenario({
  label: "graphiti",
  baseUrl: enabledBaseUrl,
  elderId: `${elderIdBase}-graphiti`,
  expectedGraphitiHealth: "ok",
  requireGraphitiWrites: true,
});
const disabledRun = await runApiScenario({
  label: "no-graphiti",
  baseUrl: disabledBaseUrl,
  elderId: `${elderIdBase}-no-graphiti`,
  expectedGraphitiHealth: "missing_config",
  requireGraphitiWrites: false,
});

assert(enabledRun.rawGraphitiQueryCount >= fixture.minRawGraphitiQueries, `Graphiti raw temporal evidence under threshold: expected >=${fixture.minRawGraphitiQueries}, got ${enabledRun.rawGraphitiQueryCount}`);
assert(enabledRun.temporalEvidenceQueryCount === fixture.queries.length, `Graphiti enabled run did not return temporal evidence for every query: ${enabledRun.temporalEvidenceQueryCount}/${fixture.queries.length}`);
assert(disabledRun.temporalEvidenceQueryCount === 0, `Graphiti disabled run returned temporal evidence in ${disabledRun.temporalEvidenceQueryCount} query/queryies`);
const failures = [...enabledRun.queryFailures, ...disabledRun.queryFailures];

console.log(JSON.stringify({
  ok: failures.length === 0,
  fixture: fixturePath,
  tenantId,
  enabled: summarizeRun(enabledRun),
  disabled: summarizeRun(disabledRun),
  comparison: enabledRun.queryReports.map((enabled) => {
    const disabled = disabledRun.queryReports.find((item) => item.id === enabled.id);
    return {
      id: enabled.id,
      enabledSources: enabled.sources,
      disabledSources: disabled?.sources ?? [],
      graphitiRawAlignedCount: enabled.retrieval?.graphitiRawAlignedCount ?? 0,
      graphitiProvenanceAlignedCount: enabled.retrieval?.graphitiProvenanceAlignedCount ?? 0,
      enabledAnswer: enabled.answerText,
      disabledAnswer: disabled?.answerText,
    };
  }),
  failures,
}, null, 2));

assert(failures.length === 0, `Graphiti comparison E2E had query failures:\n${failures.join("\n")}`);

async function runApiScenario(input: {
  label: string;
  baseUrl: string;
  elderId: string;
  expectedGraphitiHealth: "ok" | "missing_config";
  requireGraphitiWrites: boolean;
}) {
  const health = await request<Json>(input.baseUrl, "GET", "/health");
  assert(health.ok === true, `${input.label} API health check failed`);
  assert(health.semanticMemory === "pgvector", `${input.label} API semantic memory must be pgvector`);
  assert(health.graphiti === input.expectedGraphitiHealth, `${input.label} API graphiti health expected ${input.expectedGraphitiHealth}, got ${String(health.graphiti)}`);
  if (process.env.GRAPHITI_E2E_API_MODEL) {
    assert(health.model === process.env.GRAPHITI_E2E_API_MODEL, `${input.label} API model expected ${process.env.GRAPHITI_E2E_API_MODEL}, got ${String(health.model)}`);
  }

  const ingests = new Map<string, Awaited<ReturnType<typeof ingestNote>>>();
  for (const note of fixture.seedNotes) {
    console.log(`[${input.label}] seed start: ${note.id}`);
    const result = await withModelRetry(`[${input.label}] seed ${note.id}`, () => ingestNote(input.baseUrl, input.elderId, note.transcript));
    assert(result.events.length > 0 || result.reminderCandidates.length > 0, `[${input.label}] seed ${note.id} produced no records`);
    if (input.requireGraphitiWrites) {
      assert(result.temporalMemory?.status === "queued" || result.temporalMemory?.status === "not_needed", `[${input.label}] seed ${note.id} returned invalid temporal memory status`);
    }
    ingests.set(note.id, result);
    console.log(`[${input.label}] seed ok: ${note.id} source=${result.sourceId} events=${result.events.length} reminders=${result.reminderCandidates.length} temporal=${result.temporalMemory?.status ?? "none"}`);
  }

  if (input.requireGraphitiWrites) await drainGraphitiJobs(input.label);

  const tenantQuery = `tenantId=${encodeURIComponent(tenantId)}&elderId=${encodeURIComponent(input.elderId)}`;
  const events = await request<MemoryEvent[]>(input.baseUrl, "GET", `/elder/events?${tenantQuery}`);
  const reminders = await request<Reminder[]>(input.baseUrl, "GET", `/elder/reminders?${tenantQuery}`);
  const familyTasks = await request<FamilyTask[]>(input.baseUrl, "GET", `/family/elders/${encodeURIComponent(input.elderId)}/tasks?tenantId=${encodeURIComponent(tenantId)}`);
  assertScenarioExpectations(input.label, ingests, reminders, familyTasks);

  const queryReports = [];
  const queryFailures: string[] = [];
  let rawGraphitiQueryCount = 0;
  let temporalEvidenceQueryCount = 0;

  for (const queryCase of fixture.queries) {
    try {
      console.log(`[${input.label}] query start: ${queryCase.id}`);
      const turn = await withModelRetry(`[${input.label}] query ${queryCase.id}`, () =>
        request<{ traceId: string; answer?: unknown }>(input.baseUrl, "POST", "/elder/turn", {
          tenantId,
          elderId: input.elderId,
          text: queryCase.query,
        }),
      );
      const answer = MemoryAnswerSchema.parse(turn.answer);
      const debugTrace = await request<{ auditTrail?: unknown[] }>(
        input.baseUrl,
        "GET",
        `/debug/traces/${encodeURIComponent(answer.traceId ?? turn.traceId)}?tenantId=${encodeURIComponent(tenantId)}`,
      );
      const retrieval = extractRetrieval(debugTrace.auditTrail);
      const sources = [...new Set(answer.retrievedEvidence.map((item) => item.retrievalSource))] as EvidenceSource[];
      const answerText = normalizeText(answer.answerText);
      const evidenceText = normalizeText(answer.retrievedEvidence.map((item) => item.summary).join("\n"));
      const hasTemporalEvidence = sources.includes("graphiti") || sources.includes("graphiti_provenance");
      if (hasTemporalEvidence) temporalEvidenceQueryCount += 1;
      if (sources.includes("graphiti")) rawGraphitiQueryCount += 1;

      assert(answer.retrievedEvidence.length > 0, `[${input.label}] ${queryCase.id} returned no evidence`);
      assert(!sources.includes("context_link"), `[${input.label}] ${queryCase.id} returned context_link evidence after query expansion was disabled`);
      if (input.requireGraphitiWrites) {
        assert(answer.confidence >= queryCase.minConfidence, `[${input.label}] ${queryCase.id} confidence too low: ${answer.confidence}`);
        assert(hasTemporalEvidence, `[${input.label}] ${queryCase.id} returned no Graphiti temporal evidence`);
        assert((retrieval?.graphitiAlignedCount ?? 0) > 0, `[${input.label}] ${queryCase.id} debug retrieval has no aligned Graphiti evidence`);
        for (const source of queryCase.enabledExpectedEvidenceSources) {
          assert(sources.includes(source), `[${input.label}] ${queryCase.id} expected evidence source ${source}`);
        }
        assertHints(queryCase.id, input.label, answerText, evidenceText, queryCase);
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
          assert(judgment.pass, `[${input.label}] ${queryCase.id} semantic answer check failed: ${judgment.reason}`);
        }
      } else {
        assert(!hasTemporalEvidence, `[${input.label}] ${queryCase.id} returned Graphiti evidence while Graphiti is disabled`);
        assert((retrieval?.graphitiCount ?? 0) === 0, `[${input.label}] ${queryCase.id} debug retrieval has graphitiCount=${String(retrieval?.graphitiCount)}`);
      }

      queryReports.push({
        id: queryCase.id,
        answerText: answer.answerText,
        confidence: answer.confidence,
        sources,
        retrieval,
        timings: extractTimings(debugTrace.auditTrail),
      });
      console.log(`[${input.label}] query ok: ${queryCase.id} confidence=${answer.confidence} sources=${sources.join(",")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      queryFailures.push(message);
      console.error(`[${input.label}] query failed: ${queryCase.id}: ${message}`);
    }
  }

  return {
    label: input.label,
    baseUrl: input.baseUrl,
    elderId: input.elderId,
    events: events.length,
    reminders: reminders.length,
    familyTasks: familyTasks.length,
    rawGraphitiQueryCount,
    temporalEvidenceQueryCount,
    queryReports,
    queryFailures,
  };
}

async function ingestNote(baseUrl: string, elderId: string, transcript: string) {
  const turn = await request<{
    ingestResult?: {
      traceId: string;
      sourceId: string;
      summary: string;
      events: MemoryEvent[];
      reminderCandidates: Reminder[];
      temporalMemory?: { status: "queued" | "not_needed" | "failed"; errorMessage?: string };
    };
  }>(baseUrl, "POST", "/elder/turn", {
    tenantId,
    elderId,
    text: transcript,
  });
  if (!turn.ingestResult) throw new Error("Elder turn did not return ingestResult for seed note");
  return turn.ingestResult;
}

async function drainGraphitiJobs(label: string): Promise<void> {
  const postgres = createPostgresStores({ databaseUrl });
  const temporalMemory = new GraphitiTemporalMemoryStore({
    baseUrl: graphitiBaseUrl,
    apiKey: process.env.GRAPHITI_API_KEY,
    timeoutMs: graphitiTimeoutMs,
  });
  try {
    for (let attempt = 0; attempt < graphitiDrainBatches; attempt += 1) {
      const stats = await runGraphitiRetryBatch({
        postgres,
        temporalMemory,
        batchSize: graphitiDrainBatchSize,
      });
      if (stats.failed > 0 || stats.dead > 0) {
        throw new Error(`[${label}] Graphiti temporal job drain failed: ${JSON.stringify(stats)}`);
      }
      if (stats.claimed === 0) {
        if (graphitiSearchSettleMs > 0) await delay(graphitiSearchSettleMs);
        return;
      }
      console.log(`[${label}] graphiti drain batch: ${JSON.stringify(stats)}`);
    }
    throw new Error(`[${label}] Graphiti temporal job drain exceeded ${graphitiDrainBatches} batches`);
  } finally {
    await postgres.close();
  }
}

async function withModelRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= modelRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= modelRetries || !isRetryableModelError(error)) break;
      const delayMs = 1000 * (attempt + 1);
      console.warn(`${label} model retry ${attempt + 1}/${modelRetries}: ${error instanceof Error ? error.message : String(error)}`);
      await delay(delayMs);
    }
  }
  throw lastError;
}

function isRetryableModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("provider_error") ||
    message.includes("schema_validation_error") ||
    message.includes("OpenAI JSON completion failed") ||
    message.includes("output failed schema validation") ||
    message.includes("Request timed out")
  );
}

function assertScenarioExpectations(
  label: string,
  ingests: Map<string, Awaited<ReturnType<typeof ingestNote>>>,
  reminders: Reminder[],
  familyTasks: FamilyTask[],
) {
  for (const expectation of fixture.riskExpectations) {
    const ingest = requiredIngest(ingests, expectation.seedNoteId);
    assert(
      ingest.events.some((event) => event.riskLevel === expectation.eventRiskLevel),
      `[${label}] expected ${expectation.seedNoteId} to create risk level ${expectation.eventRiskLevel}`,
    );
    assert(
      familyTasks.some((task) => task.type === expectation.familyTaskType),
      `[${label}] expected family task type ${expectation.familyTaskType}`,
    );
  }

  for (const expectation of fixture.reminderExpectations) {
    const matched = reminders.find(
      (reminder) =>
        textIncludes(reminder.title, expectation.titleHint) ||
        textIncludes(reminder.reason, expectation.titleHint) ||
        textIncludes(reminder.description, expectation.titleHint),
    );
    assert(Boolean(matched), `[${label}] expected reminder containing ${expectation.titleHint}`);
    assert(
      matched?.confirmationRequired === expectation.requiresConfirmation,
      `[${label}] expected reminder ${matched?.id} confirmationRequired=${expectation.requiresConfirmation}`,
    );
  }

  for (const expectation of fixture.familyTaskExpectations) {
    assert(
      familyTasks.some((task) => {
        const text = `${task.title}\n${task.summary}`;
        return (!expectation.type || task.type === expectation.type) && textIncludes(text, expectation.hint);
      }),
      `[${label}] expected family task containing ${expectation.hint}`,
    );
  }

  for (const hint of fixture.forbidAutoConfirmedReminderHints) {
    assert(
      !reminders.some(
        (reminder) =>
          (reminder.status === "confirmed" || reminder.status === "scheduled") &&
          (textIncludes(reminder.title, hint) || textIncludes(reminder.reason, hint) || textIncludes(reminder.description, hint)),
      ),
      `[${label}] reminder containing ${hint} was auto-confirmed or scheduled`,
    );
  }
}

function assertHints(
  queryId: string,
  label: string,
  answerText: string,
  evidenceText: string,
  queryCase: z.infer<typeof GraphitiComparisonFixtureSchema>["queries"][number],
) {
  for (const hint of queryCase.expectedAnswerHints) {
    assert(textIncludes(answerText, hint), `[${label}] ${queryId} answer missing hint: ${hint}`);
  }
  for (const hints of queryCase.expectedAnswerAnyHints) {
    assert(
      hints.some((hint) => textIncludes(answerText, hint)),
      `[${label}] ${queryId} answer missing any hint: ${hints.join(" | ")}`,
    );
  }
  for (const hint of queryCase.expectedEvidenceHints) {
    assert(textIncludes(evidenceText, hint), `[${label}] ${queryId} evidence missing hint: ${hint}`);
  }
  for (const hint of queryCase.forbiddenAnswerHints) {
    assert(!textIncludes(answerText, hint), `[${label}] ${queryId} answer contained forbidden hint: ${hint}`);
  }
  for (const hint of queryCase.forbiddenEvidenceHints) {
    assert(!textIncludes(evidenceText, hint), `[${label}] ${queryId} evidence contained forbidden hint: ${hint}`);
  }
}

async function request<T>(baseUrl: string, method: string, path: string, body?: Json): Promise<T> {
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

function extractRetrieval(auditTrail: unknown[] | undefined): Record<string, number> | undefined {
  const payload = latestAuditPayload(auditTrail, "memory_query");
  const retrieval = recordValue(payload?.retrieval);
  if (!retrieval) return undefined;
  return Object.fromEntries(
    Object.entries(retrieval)
      .filter(([, value]) => typeof value === "number"),
  ) as Record<string, number>;
}

function extractTimings(auditTrail: unknown[] | undefined): Record<string, unknown> | undefined {
  const payload = latestAuditPayload(auditTrail, "memory_query");
  return recordValue(payload?.timings);
}

function latestAuditPayload(auditTrail: unknown[] | undefined, type: string): Record<string, unknown> | undefined {
  const records = (auditTrail ?? [])
    .map(recordValue)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .filter((record) => record.type === type);
  return recordValue(records.at(-1)?.payload);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function summarizeRun(run: Awaited<ReturnType<typeof runApiScenario>>) {
  return {
    baseUrl: run.baseUrl,
    elderId: run.elderId,
    events: run.events,
    reminders: run.reminders,
    familyTasks: run.familyTasks,
    rawGraphitiQueryCount: run.rawGraphitiQueryCount,
    temporalEvidenceQueryCount: run.temporalEvidenceQueryCount,
  };
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
      model: process.env.GRAPHITI_E2E_JUDGE_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are a strict semantic judge for GoldMem Graphiti A/B E2E tests.",
            "Judge meaning, not exact wording. Do not require fixed substrings.",
            "Use only the question, answer, and provided evidence summaries.",
            "Pass only if every expected meaning is clearly expressed and none of the forbidden claims are present.",
            "Return strict JSON: {\"pass\": boolean, \"reason\": string, \"metExpectations\": string[], \"violatedForbiddenClaims\": string[]}.",
          ].join("\n"),
        },
        { role: "user", content: JSON.stringify(input) },
      ],
    });

    const content = response.choices[0]?.message.content;
    assert(content, `${input.queryId} semantic judge returned empty response`);
    return SemanticJudgeResultSchema.parse(JSON.parse(content));
  };
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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}
