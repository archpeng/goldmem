import { DEFAULT_TENANT_ID, type FamilyAssistTask, type FamilyTask, type MemoryEvent } from "@goldmem/memory-schema";
import type { AuditLog, EventStore, FamilyTaskStore } from "@goldmem/memory-store";

export type ListFamilyAssistTasksInput = {
  tenantId?: string;
  elderId: string;
  actorUserId: string;
  traceId?: string;
};

type ListFamilyAssistTasksDeps = {
  familyTaskStore: FamilyTaskStore;
  eventStore: EventStore;
  auditLog: AuditLog;
};

export async function listFamilyAssistTasksCommand(
  deps: ListFamilyAssistTasksDeps,
  input: ListFamilyAssistTasksInput,
): Promise<FamilyAssistTask[]> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const pendingTasks = await deps.familyTaskStore.listPending({ tenantId, elderId: input.elderId });
  const relatedEventIds = [...new Set(pendingTasks.map((task) => task.relatedEventId).filter(isString))];
  const relatedEvents = relatedEventIds.length
    ? await deps.eventStore.getByIds({ tenantId, eventIds: relatedEventIds })
    : [];
  const eventsById = new Map(relatedEvents.map((event) => [event.id, event]));
  const tasks = pendingTasks
    .filter((task) => canShareTaskWithFamily(task, eventsById))
    .map(toFamilyAssistTask);

  await deps.auditLog.record({
    type: "family_assist_tasks_viewed",
    tenantId,
    elderId: input.elderId,
    traceId: input.traceId,
    payload: {
      traceId: input.traceId,
      actorUserId: input.actorUserId,
      totalPendingTaskCount: pendingTasks.length,
      returnedTaskCount: tasks.length,
      hiddenTaskCount: pendingTasks.length - tasks.length,
      returnedTaskIds: tasks.map((task) => task.id),
    },
  });

  return tasks;
}

function canShareTaskWithFamily(task: FamilyTask, eventsById: Map<string, MemoryEvent>): boolean {
  if (task.type !== "reminder_confirm" && task.type !== "risk_review" && task.type !== "conflict_review") return false;
  if (task.visibility !== "shared_summary" && task.visibility !== "family_required") return false;
  if (task.visibility === "family_required") return true;
  if (!task.relatedEventId) return true;
  const event = eventsById.get(task.relatedEventId);
  if (!event) return false;
  return event.visibility === "shared_summary" || event.visibility === "family_required";
}

function toFamilyAssistTask(task: FamilyTask): FamilyAssistTask {
  return {
    id: task.id,
    title: task.title,
    summary: task.summary,
    type: task.type,
    urgency: task.urgency,
    status: task.status,
    visibility: task.visibility,
    createdAt: task.createdAt,
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
