type Json = Record<string, unknown>;

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const elderId = process.env.MVP_ELDER_ID ?? `mvp-smoke-${Date.now()}`;
const actorUserId = process.env.MVP_ACTOR_USER_ID ?? elderId;

await request("GET", "/health");

const ingestTurn = await request("POST", "/elder/turn", {
  elderId,
  text: process.env.MVP_TRANSCRIPT ?? "我今天在市场买了青菜。请在明天上午9点提醒我给女儿打电话。",
});
const draft = (ingestTurn as Json).draft as Json | undefined;
if (!draft?.sourceId) throw new Error("draft.sourceId is required");
const ingest = await waitForIngestReady(String(draft.sourceId));
console.log("ingest", pick(ingest, ["sourceId", "summary", "status"]));
await waitForMemoryProcessingIdle();

const reminders = await request("GET", `/elder/reminders?elderId=${encodeURIComponent(elderId)}`) as Json[];
console.log("reminders", reminders.length);
if (reminders.length === 0) throw new Error("expected at least one reminder");

const firstReminder = reminders[0];
if (firstReminder?.id) {
  const remindAt = typeof firstReminder.remindAt === "string" ? firstReminder.remindAt : "2026-05-10T09:00:00.000Z";
  const confirmed = await request("POST", `/elder/reminders/${firstReminder.id}/confirm`, {
    actorUserId,
    remindAt,
  });
  console.log("confirmed", pick(confirmed, ["id", "status", "confirmedBy"]));
  if ((confirmed as Json).status !== "confirmed") throw new Error("expected confirmed reminder status");
}

const answerTurn = await request("POST", "/elder/turn", {
  elderId,
  text: process.env.MVP_QUERY ?? "我今天买了什么？",
});
const answer = (answerTurn as Json).answer;
if (!(answer as Json | undefined)?.answerText) throw new Error("answerText is required");
console.log("query", pick(answer, ["answerText", "confidence"]));

async function request(method: string, path: string, body?: Json): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  }
  return parsed;
}

function pick(value: unknown, keys: string[]): Json {
  const object = value as Json;
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

async function waitForIngestReady(sourceId: string): Promise<Json> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await request("GET", `/elder/sources/${encodeURIComponent(sourceId)}/ingest-status`) as Json;
    if (status.status === "ready") return status;
    if (status.status === "failed") throw new Error(`ingest failed: ${String(status.errorMessage ?? "unknown")}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`ingest did not become ready: ${sourceId}`);
}

async function waitForMemoryProcessingIdle(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const health = await request("GET", "/health") as Json;
    const stats = health.memoryProcessingJobs as Json | undefined;
    if (!stats) return;
    const active = Number(stats.pending ?? 0) + Number(stats.running ?? 0) + Number(stats.failed ?? 0);
    if (Number(stats.dead ?? 0) > 0) throw new Error(`memory processing jobs dead: ${JSON.stringify(stats)}`);
    if (active === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("memory processing jobs did not become idle");
}
