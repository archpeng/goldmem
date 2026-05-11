type Json = Record<string, unknown>;

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const elderId = process.env.MVP_ELDER_ID ?? "elder-mvp";
const actorUserId = process.env.MVP_ACTOR_USER_ID ?? "elder-mvp";

await request("GET", "/health");

const ingestTurn = await request("POST", "/elder/turn", {
  elderId,
  text: process.env.MVP_TRANSCRIPT ?? "I bought vegetables at the market and need to call my daughter tomorrow morning.",
});
const ingest = (ingestTurn as Json).ingestResult;
console.log("ingest", pick(ingest, ["sourceId", "summary"]));

const reminders = await request("GET", `/elder/reminders?elderId=${encodeURIComponent(elderId)}`) as Json[];
console.log("reminders", reminders.length);

const firstReminder = reminders[0];
if (firstReminder?.id) {
  const remindAt = typeof firstReminder.remindAt === "string" ? firstReminder.remindAt : "2026-05-10T09:00:00.000Z";
  const confirmed = await request("POST", `/elder/reminders/${firstReminder.id}/confirm`, {
    actorUserId,
    remindAt,
  });
  console.log("confirmed", pick(confirmed, ["id", "status", "confirmedBy"]));
}

const answerTurn = await request("POST", "/elder/turn", {
  elderId,
  text: process.env.MVP_QUERY ?? "What did I buy?",
});
const answer = (answerTurn as Json).answer;
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
