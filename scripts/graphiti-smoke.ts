import { buildTemporalGroupId } from "../packages/temporal-memory/src/index.js";

const baseUrl = requiredEnv("GRAPHITI_BASE_URL").replace(/\/$/, "");
const tenantId = process.env.GRAPHITI_SMOKE_TENANT_ID ?? "mem-smoke";
const elderId = process.env.GRAPHITI_SMOKE_ELDER_ID ?? "elder-smoke";
const groupId = buildTemporalGroupId({ tenantId, elderId });
const marker = `mem-graphiti-smoke-${Date.now()}`;

const health = await request<Record<string, unknown>>("GET", "/health");
if (health.ok !== true) throw new Error(`Graphiti health check failed: ${JSON.stringify(health)}`);

await requestFailure("POST", "/add_episode", 422, {
  name: `${groupId}:invalid-time:${marker}`,
  episode_body: { source: { id: `source-invalid-${marker}`, transcript: "invalid time should fail" }, events: [] },
  source: "json",
  source_description: "mem invalid datetime probe",
  reference_time: "not-a-date",
  group_id: groupId,
  metadata: {
    tenantId,
    elderId,
    groupId,
    sourceIds: [`source-invalid-${marker}`],
    eventIds: [],
    episodeType: "datetime_validation_probe",
  },
});

await request("POST", "/add_episode", {
  name: `${groupId}:smoke:${marker}`,
  episode_body: {
    source: {
      id: `source-${marker}`,
      type: "text",
      transcript: `张医生说 ${marker} 降压药改成晚饭后一片。`,
    },
    events: [
      {
        id: `event-${marker}`,
        type: "medication",
        title: "降压药用法调整",
        summary: `${marker} 降压药从早饭后改成晚饭后一片。`,
      },
    ],
  },
  source: "json",
  source_description: "mem Graphiti smoke episode",
  reference_time: new Date().toISOString(),
  group_id: groupId,
  metadata: {
    tenantId,
    elderId,
    groupId,
    sourceIds: [`source-${marker}`],
    eventIds: [`event-${marker}`],
    episodeType: "text_memory",
  },
});

const search = await request<{ facts?: Array<Record<string, unknown>> }>("POST", "/search_facts", {
  query: `${marker} 降压药后来怎么改？`,
  group_id: groupId,
  max_facts: 5,
  tenantId,
  elderId,
});

const facts = search.facts ?? [];
if (!facts.some((fact) => fact.sourceId === `source-${marker}` || fact.fact?.toString().includes(marker))) {
  throw new Error(`Graphiti smoke search did not return the smoke episode: ${JSON.stringify(search)}`);
}

console.log(`graphiti smoke ok: ${facts.length} fact(s), group=${groupId}`);

async function request<T = unknown>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(process.env.GRAPHITI_API_KEY ? { "x-api-key": process.env.GRAPHITI_API_KEY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function requestFailure(method: string, path: string, status: number, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(process.env.GRAPHITI_API_KEY ? { "x-api-key": process.env.GRAPHITI_API_KEY } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status !== status) throw new Error(`${method} ${path} expected ${status}, got ${response.status}: ${text}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
