import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import OpenAI from "openai";
import { z } from "zod";
import { createPostgresStores } from "../packages/memory-store/src/index.js";
import {
  MemoryAnswerSchema,
  type FamilyAssistTask,
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
  profiles: z.array(z.object({
    id: z.string().min(1),
    description: z.string().optional(),
  })).default([]),
  minRawGraphitiQueries: z.number().int().nonnegative().default(3),
  seedNotes: z.array(z.object({
    id: z.string(),
    profile: z.string().min(1).optional(),
    transcript: z.string().min(1),
  })),
  queries: z.array(z.object({
    id: z.string(),
    profile: z.string().min(1).optional(),
    query: z.string().min(1),
    expectedAnswerHints: z.array(z.string().min(1)).default([]),
    expectedAnswerAnyHints: z.array(z.array(z.string().min(1)).min(1)).default([]),
    expectedEvidenceHints: z.array(z.string().min(1)).default([]),
    forbiddenAnswerHints: z.array(z.string().min(1)).default([]),
    forbiddenEvidenceHints: z.array(z.string().min(1)).default([]),
    disabledForbiddenAnswerHints: z.array(z.string().min(1)).default([]),
    semanticAnswerExpectations: z.array(z.string().min(1)).default([]),
    semanticAnswerForbiddenClaims: z.array(z.string().min(1)).default([]),
    enabledExpectedEvidenceSources: z.array(EvidenceSourceSchema).default(["graphiti"]),
    minConfidence: z.number().min(0).max(1).default(0.4),
  })),
  riskExpectations: z.array(z.object({
    seedNoteId: z.string(),
    eventRiskLevels: z.array(z.string().min(1)).min(1),
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
const ingestReadyTimeoutMs = Number(process.env.GRAPHITI_E2E_INGEST_READY_TIMEOUT_MS ?? 300_000);
const memoryProcessingIdleTimeoutMs = Number(process.env.GRAPHITI_E2E_MEMORY_IDLE_TIMEOUT_MS ?? 300_000);
const profileConcurrency = Math.max(1, Number(process.env.GRAPHITI_E2E_PROFILE_CONCURRENCY ?? 1));
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
      profile: enabled.profile,
      enabledSources: enabled.sources,
      disabledSources: disabled?.sources ?? [],
      graphitiRawAlignedCount: enabled.retrieval?.graphitiRawAlignedCount ?? 0,
      graphitiProvenanceAlignedCount: enabled.retrieval?.graphitiProvenanceAlignedCount ?? 0,
      enabledDurationMs: enabled.durationMs,
      disabledDurationMs: disabled?.durationMs,
      enabledAnswer: enabled.answerText,
      disabledAnswer: disabled?.answerText,
    };
  }),
  profiles: summarizeProfiles(enabledRun, disabledRun),
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
  await seedNotesByProfile(input, ingests);

  await waitForMemoryProcessingIdle(input.baseUrl);
  if (input.requireGraphitiWrites) await drainGraphitiJobs(input.label);

  const tenantQuery = `tenantId=${encodeURIComponent(tenantId)}&elderId=${encodeURIComponent(input.elderId)}`;
  const events = await request<MemoryEvent[]>(input.baseUrl, "GET", `/elder/events?${tenantQuery}`);
  const reminders = await request<Reminder[]>(input.baseUrl, "GET", `/elder/reminders?${tenantQuery}`);
  const familyTasks = await request<FamilyAssistTask[]>(input.baseUrl, "GET", `/family/elders/${encodeURIComponent(input.elderId)}/pending-tasks?tenantId=${encodeURIComponent(tenantId)}&actorUserId=graphiti-family`);
  assertFamilyAssistPrivacy(input.label, familyTasks);
  assertScenarioExpectations(input.label, ingests, reminders, familyTasks);

  const queryReports = [];
  const queryFailures: string[] = [];
  let rawGraphitiQueryCount = 0;
  let temporalEvidenceQueryCount = 0;

  for (const queryCase of fixture.queries) {
    try {
      console.log(`[${input.label}] query start: ${queryCase.id}`);
      const startedAt = Date.now();
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
        for (const hint of queryCase.disabledForbiddenAnswerHints) {
          assert(!textIncludes(answerText, hint), `[${input.label}] ${queryCase.id} disabled answer contained forbidden hint: ${hint}`);
        }
      }

      queryReports.push({
        id: queryCase.id,
        profile: queryCase.profile ?? "default",
        answerText: answer.answerText,
        confidence: answer.confidence,
        sources,
        retrieval,
        timings: extractTimings(debugTrace.auditTrail),
        durationMs: Date.now() - startedAt,
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

async function seedNotesByProfile(
  input: {
    label: string;
    baseUrl: string;
    elderId: string;
    requireGraphitiWrites: boolean;
  },
  ingests: Map<string, Awaited<ReturnType<typeof ingestNote>>>,
): Promise<void> {
  const groups = groupSeedNotes();
  let cursor = 0;
  const workerCount = Math.min(profileConcurrency, groups.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < groups.length) {
      const group = groups[cursor++];
      if (!group) return;
      for (const note of group.notes) {
        console.log(`[${input.label}] seed start: ${note.id}`);
        const result = await withModelRetry(`[${input.label}] seed ${note.id}`, () => ingestNote(input.baseUrl, input.elderId, note.transcript));
        assert(result.events.length > 0 || result.reminderCandidates.length > 0, `[${input.label}] seed ${note.id} produced no records`);
        if (input.requireGraphitiWrites) {
          assert(result.temporalMemory?.status === "queued" || result.temporalMemory?.status === "not_needed", `[${input.label}] seed ${note.id} returned invalid temporal memory status`);
        }
        ingests.set(note.id, result);
        console.log(`[${input.label}] seed ok: ${note.id} source=${result.sourceId} events=${result.events.length} reminders=${result.reminderCandidates.length} temporal=${result.temporalMemory?.status ?? "none"} submitMs=${result.submitMs} readyMs=${result.readyMs}`);
      }
    }
  }));
}

function groupSeedNotes(): Array<{ profile: string; notes: typeof fixture.seedNotes }> {
  const groups = new Map<string, typeof fixture.seedNotes>();
  for (const note of fixture.seedNotes) {
    const profile = note.profile ?? "default";
    const group = groups.get(profile) ?? [];
    group.push(note);
    groups.set(profile, group);
  }
  return [...groups.entries()].map(([profile, notes]) => ({ profile, notes }));
}

async function ingestNote(baseUrl: string, elderId: string, transcript: string) {
  const startedAt = Date.now();
  const turn = await request<{
    draft?: {
      sourceId: string;
      transcript: string;
      status: "queued" | "processing" | "ready" | "failed";
    };
  }>(baseUrl, "POST", "/elder/turn", {
    tenantId,
    elderId,
    text: transcript,
    clientTurnId: `graphiti-e2e-${elderId}-${Math.random().toString(36).slice(2)}`,
  });
  if (!turn.draft) throw new Error("Elder turn did not return draft for seed note");
  const submitMs = Date.now() - startedAt;
  const status = await waitForIngestReady(baseUrl, turn.draft.sourceId);
  const readyMs = Date.now() - startedAt;
  const tenantQuery = `tenantId=${encodeURIComponent(tenantId)}&elderId=${encodeURIComponent(elderId)}`;
  const events = (await request<MemoryEvent[]>(baseUrl, "GET", `/elder/events?${tenantQuery}`)).filter((event) => event.sourceId === turn.draft?.sourceId);
  const reminders = (await request<Reminder[]>(baseUrl, "GET", `/elder/reminders?${tenantQuery}`)).filter((reminder) => reminder.sourceId === turn.draft?.sourceId);
  return {
    traceId: status.traceId ?? "",
    sourceId: turn.draft.sourceId,
    summary: status.summary ?? turn.draft.transcript,
    events,
    reminderCandidates: reminders,
    temporalMemory: status.temporalMemory,
    submitMs,
    readyMs,
  };
}

async function waitForIngestReady(baseUrl: string, sourceId: string) {
  const deadline = Date.now() + ingestReadyTimeoutMs;
  while (Date.now() < deadline) {
    const status = await request<{
      sourceId: string;
      status: "queued" | "processing" | "ready" | "failed";
      traceId?: string;
      summary?: string;
      temporalMemory?: { status: "queued" | "not_needed" | "failed"; errorMessage?: string };
      errorMessage?: string;
    }>(baseUrl, "GET", `/elder/sources/${encodeURIComponent(sourceId)}/ingest-status?tenantId=${encodeURIComponent(tenantId)}`);
    if (status.status === "ready") return status;
    if (status.status === "failed") throw new Error(`Seed ingest failed: ${status.errorMessage ?? "unknown"}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Seed ingest did not become ready within ${ingestReadyTimeoutMs}ms: ${sourceId}`);
}

async function waitForMemoryProcessingIdle(baseUrl: string): Promise<void> {
  const deadline = Date.now() + memoryProcessingIdleTimeoutMs;
  while (Date.now() < deadline) {
    const health = await request<{ memoryProcessingJobs?: Record<string, number> }>(baseUrl, "GET", "/health");
    const stats = health.memoryProcessingJobs;
    if (!stats) return;
    const active = (stats.pending ?? 0) + (stats.running ?? 0) + (stats.failed ?? 0);
    if ((stats.dead ?? 0) > 0) throw new Error(`Memory processing jobs dead: ${JSON.stringify(stats)}`);
    if (active === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Memory processing jobs did not become idle within ${memoryProcessingIdleTimeoutMs}ms`);
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
  familyTasks: FamilyAssistTask[],
) {
  for (const expectation of fixture.riskExpectations) {
    const ingest = requiredIngest(ingests, expectation.seedNoteId);
    assert(
      ingest.events.some((event) => expectation.eventRiskLevels.includes(event.riskLevel)),
      `[${label}] expected ${expectation.seedNoteId} to create one of risk levels ${expectation.eventRiskLevels.join(",")}`,
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
    queryDurationP95Ms: p95(run.queryReports.map((report) => report.durationMs)),
  };
}

function summarizeProfiles(
  enabled: Awaited<ReturnType<typeof runApiScenario>>,
  disabled: Awaited<ReturnType<typeof runApiScenario>>,
) {
  const profiles = new Set([
    ...fixture.profiles.map((profile) => profile.id),
    ...enabled.queryReports.map((report) => report.profile),
    ...disabled.queryReports.map((report) => report.profile),
  ]);
  return [...profiles].sort().map((profile) => {
    const enabledReports = enabled.queryReports.filter((report) => report.profile === profile);
    const disabledReports = disabled.queryReports.filter((report) => report.profile === profile);
    return {
      profile,
      queries: enabledReports.length,
      enabledTemporalEvidenceQueries: enabledReports.filter((report) => report.sources.includes("graphiti") || report.sources.includes("graphiti_provenance")).length,
      disabledTemporalEvidenceQueries: disabledReports.filter((report) => report.sources.includes("graphiti") || report.sources.includes("graphiti_provenance")).length,
      enabledQueryP95Ms: p95(enabledReports.map((report) => report.durationMs)),
      disabledQueryP95Ms: p95(disabledReports.map((report) => report.durationMs)),
    };
  });
}

function assertFamilyAssistPrivacy(label: string, tasks: FamilyAssistTask[]): void {
  const allowedKeys = new Set(["id", "title", "summary", "type", "urgency", "status", "visibility", "createdAt"]);
  const forbiddenText = /raw_transcript|raw transcript|audioUrl|audio_url|fullEvidence|full evidence|debugTrace|debug trace|sourceId|eventId/i;
  for (const task of tasks) {
    for (const key of Object.keys(task as Record<string, unknown>)) {
      assert(allowedKeys.has(key), `[${label}] family assist task leaked field ${key}`);
    }
    assert(!forbiddenText.test(JSON.stringify(task)), `[${label}] family assist task leaked raw/debug/evidence marker`);
  }
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
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
