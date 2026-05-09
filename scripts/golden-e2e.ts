import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  MemoryAnswerSchema,
  type FamilyTask,
  type MemoryEvent,
  type Reminder,
} from "../packages/memory-schema/src/index.js";

type Json = Record<string, unknown>;

const GoldenCaseSchema = z.object({
  version: z.number(),
  seedNotes: z.array(z.object({ id: z.string(), transcript: z.string().min(1) })),
  queries: z.array(
    z.object({
      id: z.string(),
      query: z.string().min(1),
      expectedAnswerHints: z.array(z.string().min(1)).default([]),
      expectedEvidenceHints: z.array(z.string().min(1)).default([]),
      allowedSources: z.array(z.enum(["postgres", "mem0"])).default(["postgres", "mem0"]),
      requiresMem0: z.boolean().default(false),
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
});

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const elderId = process.env.GOLDEN_E2E_ELDER_ID ?? `golden-e2e-${Date.now()}`;
const fixturePath = process.env.GOLDEN_E2E_FIXTURE ?? join(process.cwd(), "e2e", "golden-retrieval.json");
const requestTimeoutMs = Number(process.env.GOLDEN_E2E_TIMEOUT_MS ?? 600_000);
const fixture = GoldenCaseSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));

const health = await request<Json>("GET", "/health");
assert(health.ok === true, "API health check failed");
assert(health.mem0 === "configured", "Mem0 must be configured for golden E2E");

const ingests = new Map<string, Awaited<ReturnType<typeof ingestNote>>>();
for (const note of fixture.seedNotes) {
  console.log(`golden seed start: ${note.id}`);
  const result = await ingestNote(note.transcript);
  console.log(
    `golden seed ok: ${note.id} source=${result.sourceId} events=${result.events.length} reminders=${result.reminderCandidates.length}`,
  );
  ingests.set(note.id, result);
  assert(result.events.length > 0 || result.reminderCandidates.length > 0, `Seed note ${note.id} produced no records`);
}

const events = await request<MemoryEvent[]>("GET", `/elder/events?elderId=${encodeURIComponent(elderId)}`);
const reminders = await request<Reminder[]>("GET", `/elder/reminders?elderId=${encodeURIComponent(elderId)}`);
const familyTasks = await request<FamilyTask[]>("GET", `/family/elders/${encodeURIComponent(elderId)}/pending-tasks`);

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
      textIncludes(reminder.description, expectation.titleHint),
  );
  assert(Boolean(matched), `Expected reminder containing ${expectation.titleHint}`);
  assert(
    matched?.confirmationRequired === expectation.requiresConfirmation,
    `Expected reminder ${matched?.id} confirmationRequired=${expectation.requiresConfirmation}`,
  );
}

let mem0EvidenceQueries = 0;
for (const queryCase of fixture.queries) {
  console.log(`golden query start: ${queryCase.id}`);
  const answer = MemoryAnswerSchema.parse(await request<unknown>("POST", "/elder/query", {
    elderId,
    query: queryCase.query,
  }));
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
  for (const hint of queryCase.expectedEvidenceHints) {
    assert(textIncludes(evidenceText, hint), `${queryCase.id} evidence missing hint: ${hint}`);
  }

  if (evidenceSources.has("mem0")) mem0EvidenceQueries += 1;
  if (queryCase.requiresMem0) {
    assert(evidenceSources.has("mem0"), `${queryCase.id} expected Mem0 evidence`);
  }

  console.log(
    `golden query ok: ${queryCase.id} confidence=${answer.confidence} sources=${[...evidenceSources].join(",")}`,
  );
}

assert(mem0EvidenceQueries > 0, "Golden baseline did not exercise Mem0 evidence");
console.log(
  `golden e2e ok: elderId=${elderId} seeds=${fixture.seedNotes.length} events=${events.length} reminders=${reminders.length} familyTasks=${familyTasks.length} mem0Queries=${mem0EvidenceQueries}`,
);

async function ingestNote(transcript: string) {
  return request<{
    sourceId: string;
    summary: string;
    events: MemoryEvent[];
    reminderCandidates: Reminder[];
  }>("POST", "/elder/text-notes", {
    elderId,
    transcript,
    metadata: {
      appVersion: `golden-e2e-v${fixture.version}`,
    },
  });
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
