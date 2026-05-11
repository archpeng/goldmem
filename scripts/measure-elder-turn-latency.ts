type JsonRecord = Record<string, unknown>;

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const model = process.env.OPENAI_MODEL ?? "unknown";
const elderId = process.env.LATENCY_ELDER_ID ?? `latency-${Date.now()}`;
const recordText = process.env.LATENCY_RECORD_TEXT ?? "我把蓝色钥匙放在门口鞋柜上了。";
const queryText = process.env.LATENCY_QUERY_TEXT ?? "我的蓝色钥匙放在哪里？";

const record = await runTurn("record", recordText);
const recall = await runTurn("recall", queryText);

console.log(JSON.stringify({
  model,
  baseUrl,
  elderId,
  cases: [record, recall],
}, null, 2));

async function runTurn(label: string, text: string): Promise<JsonRecord> {
  const traceId = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/elder/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ elderId, text, traceId }),
  });
  const bodyText = await response.text();
  const clientMs = Date.now() - startedAt;
  const body = bodyText ? JSON.parse(bodyText) as JsonRecord : {};
  const trace = await fetchTrace(traceId);

  return {
    label,
    text,
    status: response.status,
    clientMs,
    traceId,
    turnType: stringValue(body.turnType),
    error: response.ok ? undefined : body,
    timings: extractTimings(trace),
    failures: extractFailures(trace),
  };
}

async function fetchTrace(traceId: string): Promise<JsonRecord | undefined> {
  const response = await fetch(`${baseUrl}/debug/traces/${encodeURIComponent(traceId)}`);
  if (!response.ok) return undefined;
  return await response.json() as JsonRecord;
}

function extractTimings(trace: JsonRecord | undefined): JsonRecord {
  const auditTrail = arrayValue(trace?.auditTrail);
  const latest = (type: string) => [...auditTrail].reverse().find((audit) => recordValue(audit)?.type === type);
  return {
    elderTurn: recordValue(recordValue(latest("elder_turn"))?.payload)?.timings,
    ingest: recordValue(recordValue(latest("memory_ingest"))?.payload)?.timings,
    query: recordValue(recordValue(latest("memory_query"))?.payload)?.timings,
  };
}

function extractFailures(trace: JsonRecord | undefined): JsonRecord[] {
  return arrayValue(trace?.auditTrail)
    .map(recordValue)
    .filter((audit): audit is JsonRecord => Boolean(audit) && stringValue(audit.type)?.includes("failed") === true)
    .map((audit) => ({
      type: audit.type,
      payload: recordValue(audit.payload),
    }));
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
