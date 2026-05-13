import { z } from "zod";

type Json = Record<string, unknown>;

const FamilyAssistTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  type: z.string(),
  urgency: z.string(),
  status: z.string(),
  visibility: z.string(),
  createdAt: z.string(),
}).strict();

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const tenantId = process.env.PRIVACY_E2E_TENANT_ID ?? "tenant-mvp";
const elderId = process.env.PRIVACY_E2E_ELDER_ID ?? `privacy-e2e-${Date.now()}`;
const actorUserId = process.env.PRIVACY_E2E_ACTOR_USER_ID ?? "privacy-family";
const requestTimeoutMs = Number(process.env.PRIVACY_E2E_TIMEOUT_MS ?? 240_000);

const seed = await request<{ draft?: { sourceId: string } }>("POST", "/elder/turn", {
  tenantId,
  elderId,
  actorUserId: elderId,
  clientTurnId: `privacy-e2e-${Date.now()}`,
  text: "有人说可以帮我办补贴，让我把银行卡密码和手机验证码发给他，我还没有发。",
});
if (!seed.draft?.sourceId) throw new Error("privacy e2e seed did not return draft");
await waitForIngestReady(seed.draft.sourceId);

const tasks = await request<unknown[]>(
  "GET",
  `/family/elders/${encodeURIComponent(elderId)}/pending-tasks?tenantId=${encodeURIComponent(tenantId)}&actorUserId=${encodeURIComponent(actorUserId)}`,
);
if (tasks.length === 0) throw new Error("privacy e2e expected at least one high-risk family assist task");

const parsed = tasks.map((task) => FamilyAssistTaskSchema.parse(task));
const raw = JSON.stringify(tasks);
const forbidden = /raw_transcript|audioUrl|audio_url|fullEvidence|debugTrace|sourceId|eventId|traceId/i;
if (forbidden.test(raw)) throw new Error(`family assist DTO leaked forbidden internal/raw field: ${raw}`);

console.log(JSON.stringify({
  ok: true,
  tenantId,
  elderId,
  familyAssistTasks: parsed.length,
  taskTypes: [...new Set(parsed.map((task) => task.type))],
}, null, 2));

async function waitForIngestReady(sourceId: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await request<{ status: "queued" | "processing" | "ready" | "failed"; errorMessage?: string }>(
      "GET",
      `/elder/sources/${encodeURIComponent(sourceId)}/ingest-status?tenantId=${encodeURIComponent(tenantId)}`,
    );
    if (status.status === "ready") return;
    if (status.status === "failed") throw new Error(`privacy e2e ingest failed: ${status.errorMessage ?? "unknown"}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`privacy e2e ingest did not become ready: ${sourceId}`);
}

async function request<T>(method: string, path: string, body?: Json): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}
