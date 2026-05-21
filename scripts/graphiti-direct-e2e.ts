import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import {
  GraphitiTemporalMemoryStore,
  buildTemporalGroupId,
  type AddTemporalEpisodeInput,
} from "../packages/temporal-memory/src/index.js";

type Json = Record<string, unknown>;
type Fact = {
  origin?: "graphiti_raw" | "provenance_fallback";
  sourceId?: string;
  eventId?: string;
  episodeId?: string;
  fact?: string;
};
type SearchFactsResponse = {
  facts?: Fact[];
  rawGraphitiCount?: number;
  provenanceFallbackCount?: number;
};
type TimelineResponse = {
  timeline?: Array<{ sourceId?: string; eventId?: string; episodeId?: string; fact?: string; occurredAt?: string }>;
};
type CurrentFactsResponse = {
  facts?: Fact[];
};

const env = { ...loadDotEnv(".env"), ...process.env };
const baseUrl = requiredEnv("GRAPHITI_BASE_URL").replace(/\/$/, "");
const databaseUrl = requiredEnv("DATABASE_URL");
const requestTimeoutMs = Number(env.GRAPHITI_DIRECT_TIMEOUT_MS ?? 120_000);
const marker = `graphiti-direct-${Date.now()}`;
const tenantId = env.GRAPHITI_DIRECT_TENANT_ID ?? `tenant-${marker}`;
const elderA = env.GRAPHITI_DIRECT_ELDER_A_ID ?? `elder-a-${marker}`;
const elderB = env.GRAPHITI_DIRECT_ELDER_B_ID ?? `elder-b-${marker}`;
const groupA = buildTemporalGroupId({ tenantId, elderId: elderA });
const groupB = buildTemporalGroupId({ tenantId, elderId: elderB });

const temporalMemory = new GraphitiTemporalMemoryStore({
  baseUrl,
  apiKey: env.GRAPHITI_API_KEY,
  timeoutMs: requestTimeoutMs,
});
const pool = new Pool({ connectionString: databaseUrl });

try {
  const health = await request<Json>("GET", "/health");
  assert(health.ok === true, `Graphiti sidecar health check failed: ${JSON.stringify(health)}`);

  const original = buildEpisode({
    elderId: elderA,
    groupId: groupA,
    sourceId: `${marker}-source-original`,
    eventId: `${marker}-event-original`,
    occurredAt: "2026-05-01T09:00:00.000Z",
    title: "降压药旧说法",
    summary: `${marker} 历史事实：降压药旧说法是早饭后一片。`,
  });
  const changed = buildEpisode({
    elderId: elderA,
    groupId: groupA,
    sourceId: `${marker}-source-changed`,
    eventId: `${marker}-event-changed`,
    occurredAt: "2026-05-08T09:00:00.000Z",
    title: "降压药当前说法",
    summary: `${marker} 当前有效事实：降压药已经改成晚饭后一片，早饭后一片是旧说法。`,
  });
  const elderBChanged = buildEpisode({
    elderId: elderB,
    groupId: groupB,
    sourceId: `${marker}-source-other-elder`,
    eventId: `${marker}-event-other-elder`,
    occurredAt: "2026-05-08T09:00:00.000Z",
    title: "另一位成员降压药说法",
    summary: `${marker} 另一位成员当前说法：降压药是午饭后一片。`,
  });

  await temporalMemory.addEpisode(original);
  await temporalMemory.addEpisode(changed);
  await temporalMemory.addEpisode(elderBChanged);

  const expectedEpisodeNames = [episodeName(original), episodeName(changed), episodeName(elderBChanged)];
  await waitForProvenance(expectedEpisodeNames);
  await assertEpisodeProvenance(groupA, [original, changed]);
  await assertEpisodeProvenance(groupB, [elderBChanged]);

  const currentSearch = await waitForFacts({
    groupId: groupA,
    elderId: elderA,
    query: `${marker} 降压药 现在 当前 晚饭后 早饭后`,
  });
  const historicalSearch = await waitForFacts({
    groupId: groupA,
    elderId: elderA,
    query: `${marker} 降压药 历史 旧说法 早饭后`,
  });
  const crossElderSearch = await waitForFacts({
    groupId: groupA,
    elderId: elderA,
    query: `${marker} 午饭后 另一位成员 降压药`,
  });

  assertFactFrom(currentSearch.facts ?? [], changed.sourceIds[0], "current fact search must include the current episode");
  assertFactFrom(historicalSearch.facts ?? [], original.sourceIds[0], "historical fact search must include the historical episode");
  assertNoFactFrom(crossElderSearch.facts ?? [], elderBChanged.sourceIds[0], "group A search must not leak elder B episode");

  const timeline = await request<TimelineResponse>("POST", "/entity_timeline", {
    group_id: groupA,
    tenantId,
    elderId: elderA,
    entityName: "降压药",
    entityType: "medicine",
    limit: 10,
  });
  assertFactFrom(timeline.timeline ?? [], changed.sourceIds[0], "entity timeline must include the current episode");
  assertFactFrom(timeline.timeline ?? [], original.sourceIds[0], "entity timeline must include the historical episode");

  const currentFacts = await request<CurrentFactsResponse>("POST", "/current_facts", {
    group_id: groupA,
    tenantId,
    elderId: elderA,
    entities: [{ name: "降压药", type: "medicine" }],
    limit: 10,
  });
  assertFactFrom(currentFacts.facts ?? [], changed.sourceIds[0], "current facts must include the current episode");
  assertNoFactFrom(currentFacts.facts ?? [], elderBChanged.sourceIds[0], "current facts must not leak elder B episode");

  const rawGraphitiCount = [
    currentSearch.rawGraphitiCount ?? 0,
    historicalSearch.rawGraphitiCount ?? 0,
    crossElderSearch.rawGraphitiCount ?? 0,
  ].reduce((total, count) => total + count, 0);

  console.log(JSON.stringify({
    ok: true,
    marker,
    tenantId,
    elderA,
    elderB,
    groupA,
    rawGraphitiCount,
    provenanceFallbackCount: [
      currentSearch.provenanceFallbackCount ?? 0,
      historicalSearch.provenanceFallbackCount ?? 0,
      crossElderSearch.provenanceFallbackCount ?? 0,
    ].reduce((total, count) => total + count, 0),
    bridgeCapabilities: {
      currentFacts: "provenance_fallback_visible",
      entityTimeline: "provenance_fallback_visible",
    },
  }, null, 2));
} finally {
  await pool.end().catch(() => undefined);
}

function buildEpisode(input: {
  elderId: string;
  groupId: string;
  sourceId: string;
  eventId: string;
  occurredAt: string;
  title: string;
  summary: string;
}): AddTemporalEpisodeInput {
  return {
    tenantId,
    elderId: input.elderId,
    groupId: input.groupId,
    episodeType: "text_memory",
    occurredAt: input.occurredAt,
    sourceIds: [input.sourceId],
    eventIds: [input.eventId],
    content: {
      source: {
        id: input.sourceId,
        type: "text",
        transcript: input.summary,
      },
      events: [
        {
          id: input.eventId,
          type: "medication",
          title: input.title,
          summary: input.summary,
        },
      ],
    },
    metadata: {
      scenario: "graphiti_direct_layered_validation",
      marker,
      eventTypes: ["medication"],
      entityNames: ["降压药"],
      riskLevel: "medical",
    },
  };
}

async function waitForProvenance(episodeNames: string[]): Promise<void> {
  const deadline = Date.now() + requestTimeoutMs;
  while (Date.now() < deadline) {
    const rows = await provenanceRows(episodeNames);
    if (rows.length === episodeNames.length) return;
    await delay(1000);
  }
  throw new Error(`Graphiti provenance rows did not appear: ${episodeNames.join(", ")}`);
}

async function assertEpisodeProvenance(groupId: string, episodes: AddTemporalEpisodeInput[]): Promise<void> {
  const rows = await provenanceRows(episodes.map(episodeName));
  for (const episode of episodes) {
    const row = rows.find((candidate) => candidate.episode_name === episodeName(episode));
    assert(row, `Missing provenance row for ${episodeName(episode)}`);
    assert(row.group_id === groupId, `Unexpected provenance group for ${episodeName(episode)}: ${row.group_id}`);
    assert(jsonArray(row.source_ids).includes(episode.sourceIds[0]), `Missing source provenance for ${episodeName(episode)}`);
    assert(jsonArray(row.event_ids).includes(episode.eventIds[0]), `Missing event provenance for ${episodeName(episode)}`);
  }
}

async function provenanceRows(episodeNames: string[]) {
  const result = await pool.query<{
    episode_name: string;
    group_id: string;
    source_ids: unknown;
    event_ids: unknown;
  }>(
    `
    select episode_name, group_id, source_ids, event_ids
    from graphiti_episode_provenance
    where episode_name = any($1::text[])
    `,
    [episodeNames],
  );
  return result.rows;
}

async function waitForFacts(input: { groupId: string; elderId: string; query: string }): Promise<SearchFactsResponse> {
  const deadline = Date.now() + requestTimeoutMs;
  let last: SearchFactsResponse = {};
  while (Date.now() < deadline) {
    last = await request<SearchFactsResponse>("POST", "/search_facts", {
      query: input.query,
      group_id: input.groupId,
      tenantId,
      elderId: input.elderId,
      max_facts: 10,
    });
    if ((last.facts ?? []).length > 0) return last;
    await delay(1000);
  }
  throw new Error(`Graphiti search returned no facts for query: ${input.query}; last=${JSON.stringify(last)}`);
}

async function request<T = unknown>(method: string, path: string, body?: Json): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(env.GRAPHITI_API_KEY ? { "x-api-key": env.GRAPHITI_API_KEY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function episodeName(input: AddTemporalEpisodeInput): string {
  return `${input.tenantId}:${input.elderId}:${input.episodeType}:${input.sourceIds[0] ?? input.occurredAt}`;
}

function assertFactFrom(facts: Array<{ sourceId?: string }>, sourceId: string | undefined, message: string): void {
  assert(Boolean(sourceId), `${message}: missing expected source id`);
  assert(facts.some((fact) => fact.sourceId === sourceId), `${message}: ${sourceId}`);
}

function assertNoFactFrom(facts: Array<{ sourceId?: string }>, sourceId: string | undefined, message: string): void {
  assert(Boolean(sourceId), `${message}: missing forbidden source id`);
  assert(!facts.some((fact) => fact.sourceId === sourceId), `${message}: ${sourceId}`);
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  }
  return [];
}

function loadDotEnv(path: string): NodeJS.ProcessEnv {
  try {
    const output: NodeJS.ProcessEnv = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      output[key] = stripQuotes(rawValue);
    }
    return output;
  } catch {
    return {};
  }
}

function stripQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function requiredEnv(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
