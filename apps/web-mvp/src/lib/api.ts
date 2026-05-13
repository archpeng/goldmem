import type { DebugTrace, ElderTurnResult, Feedback, IngestStatus, Reminder } from "@goldmem/memory-schema";

export type MvpLists = {
  reminders: Reminder[];
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
const requestTimeoutMs = 60_000;

export async function sendElderTurn(input: { elderId: string; text: string; clientTurnId?: string }): Promise<ElderTurnResult> {
  return request<ElderTurnResult>("/elder/turn", {
    method: "POST",
    body: {
      ...input,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
}

export async function sendFeedback(input: {
  elderId: string;
  actorUserId: string;
  sourceId?: string;
  eventId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
}): Promise<Feedback> {
  return request<Feedback>("/elder/feedback", {
    method: "POST",
    body: {
      tenantId: "tenant-mvp",
      elderId: input.elderId,
      actorUserId: input.actorUserId,
      sourceId: input.sourceId,
      eventId: input.eventId,
      feedbackType: input.feedbackType,
      correction: input.correction ?? {},
    },
  });
}

export async function listMvpData(elderId: string): Promise<MvpLists> {
  const encoded = encodeURIComponent(elderId);
  return { reminders: await request<Reminder[]>(`/elder/reminders?elderId=${encoded}`) };
}

export async function getIngestStatus(sourceId: string): Promise<IngestStatus> {
  return request<IngestStatus>(`/elder/sources/${encodeURIComponent(sourceId)}/ingest-status`);
}

export async function confirmReminder(input: {
  reminderId: string;
  actorUserId: string;
  remindAt?: string;
  timezone?: string;
}): Promise<Reminder> {
  return request<Reminder>(`/elder/reminders/${encodeURIComponent(input.reminderId)}/confirm`, {
    method: "POST",
    body: {
      actorUserId: input.actorUserId,
      remindAt: input.remindAt,
      timezone: input.timezone,
    },
  });
}

export async function getDebugTrace(traceId: string): Promise<DebugTrace> {
  return request<DebugTrace>(`/debug/traces/${encodeURIComponent(traceId)}`);
}

async function request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(toUserMessage(error instanceof Error ? error.message : String(error)));
  } finally {
    window.clearTimeout(timeoutId);
  }
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const message = typeof parsed === "object" && parsed && "message" in parsed ? String(parsed.message) : text;
    throw new Error(toUserMessage(message || `${options.method ?? "GET"} ${path} failed`));
  }
  return parsed as T;
}

function toUserMessage(message: string): string {
  if (message.includes("Cannot confirm reminder without remindAt")) return "请先补充提醒时间。";
  if (message.includes("elderId is required")) return "请填写老人 ID。";
  if (message.includes("schema_validation_error")) return "模型输出格式校验失败，请稍后重试。";
  if (message.includes("aborted") || message.includes("timeout") || message.includes("OpenAI JSON completion failed")) {
    return "模型服务响应较慢，请稍后再试。";
  }
  if (message.includes("fetch") || /^GET\s+\/.+failed$/.test(message) || /^POST\s+\/.+failed$/.test(message)) {
    return "暂时连不上记忆服务，请稍后再试。";
  }
  return message;
}
