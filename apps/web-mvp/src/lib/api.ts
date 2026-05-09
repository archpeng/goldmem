import type { FamilyTask, MemoryAnswer, MemoryEvent, Reminder } from "@goldmem/memory-schema";

export type IngestResult = {
  sourceId: string;
  summary: string;
  events: MemoryEvent[];
  reminderCandidates: Reminder[];
  elderFacingCards: Array<{
    title: string;
    summary: string;
    needsConfirmation: boolean;
    riskLevel: string;
  }>;
};

export type MvpLists = {
  events: MemoryEvent[];
  reminders: Reminder[];
  familyTasks: FamilyTask[];
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

export async function createTextNote(input: { elderId: string; transcript: string }): Promise<IngestResult> {
  return request<IngestResult>("/elder/text-notes", {
    method: "POST",
    body: input,
  });
}

export async function queryMemory(input: { elderId: string; query: string }): Promise<MemoryAnswer> {
  return request<MemoryAnswer>("/elder/query", {
    method: "POST",
    body: input,
  });
}

export async function listMvpData(elderId: string): Promise<MvpLists> {
  const encoded = encodeURIComponent(elderId);
  const [events, reminders, familyTasks] = await Promise.all([
    request<MemoryEvent[]>(`/elder/events?elderId=${encoded}`),
    request<Reminder[]>(`/elder/reminders?elderId=${encoded}`),
    request<FamilyTask[]>(`/family/elders/${encoded}/pending-tasks`),
  ]);
  return { events, reminders, familyTasks };
}

export async function confirmReminder(input: {
  reminderId: string;
  actorUserId: string;
  remindAt?: string;
}): Promise<Reminder> {
  return request<Reminder>(`/elder/reminders/${encodeURIComponent(input.reminderId)}/confirm`, {
    method: "POST",
    body: {
      actorUserId: input.actorUserId,
      remindAt: input.remindAt,
    },
  });
}

export async function confirmFamilyTask(input: { taskId: string; actorUserId: string }): Promise<FamilyTask> {
  return request<FamilyTask>(`/family/tasks/${encodeURIComponent(input.taskId)}/confirm`, {
    method: "POST",
    body: {
      actorUserId: input.actorUserId,
    },
  });
}

async function request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
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
  if (message.includes("fetch")) return "无法连接后端服务，请确认 API server 已启动。";
  return message;
}
