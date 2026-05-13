type Json = Record<string, unknown>;

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const tenantId = process.env.PERF_E2E_TENANT_ID ?? "tenant-mvp";
const elderId = process.env.PERF_E2E_ELDER_ID ?? `performance-e2e-${Date.now()}`;
const requestTimeoutMs = Number(process.env.PERF_E2E_TIMEOUT_MS ?? 240_000);
const maxAckMs = Number(process.env.PERF_E2E_MAX_ACK_MS ?? 5000);
const text = process.env.PERF_E2E_TEXT ?? "明天下午三点去社区医院复查，记得带医保卡。";
const clientTurnId = `performance-e2e-${Date.now()}`;

const health = await request<Json>("GET", "/health");
const first = await submitTurn(clientTurnId);
if (!first.draft?.sourceId) throw new Error("performance e2e first turn did not return draft");
if (first.ackMs > maxAckMs) throw new Error(`source/draft ack too slow: ${first.ackMs}ms > ${maxAckMs}ms`);

const duplicate = await submitTurn(clientTurnId);
if (duplicate.draft?.sourceId !== first.draft.sourceId) {
  throw new Error(`clientTurnId idempotency failed: ${first.draft.sourceId} != ${duplicate.draft?.sourceId}`);
}

const readyStartedAt = Date.now();
const ingestStatus = await waitForIngestReady(first.draft.sourceId);
const readyMs = Date.now() - readyStartedAt;

console.log(JSON.stringify({
  ok: true,
  tenantId,
  elderId,
  health: {
    model: health.model,
    graphiti: health.graphiti,
    semanticMemory: health.semanticMemory,
    memoryProcessingJobs: health.memoryProcessingJobs,
    graphitiRetryJobs: health.graphitiRetryJobs,
  },
  timings: {
    firstAckMs: first.ackMs,
    duplicateAckMs: duplicate.ackMs,
    readyWaitMs: readyMs,
  },
  sourceId: first.draft.sourceId,
  ingestStatus,
}, null, 2));

async function submitTurn(id: string): Promise<{
  ackMs: number;
  draft?: { sourceId: string; status: "queued" | "processing" | "ready" | "failed" };
}> {
  const startedAt = Date.now();
  const result = await request<{ draft?: { sourceId: string; status: "queued" | "processing" | "ready" | "failed" } }>("POST", "/elder/turn", {
    tenantId,
    elderId,
    actorUserId: elderId,
    clientTurnId: id,
    text,
  });
  return { ...result, ackMs: Date.now() - startedAt };
}

async function waitForIngestReady(sourceId: string): Promise<Json> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await request<Json>("GET", `/elder/sources/${encodeURIComponent(sourceId)}/ingest-status?tenantId=${encodeURIComponent(tenantId)}`);
    if (status.status === "ready") return status;
    if (status.status === "failed") throw new Error(`performance e2e ingest failed: ${String(status.errorMessage ?? "unknown")}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`performance e2e ingest did not become ready: ${sourceId}`);
}

async function request<T>(method: string, path: string, body?: Json): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${responseText}`);
  return (responseText ? JSON.parse(responseText) : {}) as T;
}
