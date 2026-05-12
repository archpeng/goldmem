import { randomUUID } from "node:crypto";
import { DEFAULT_TENANT_ID, type FamilyTask, type Reminder } from "@goldmem/memory-schema";
import type { AuditLog, FamilyTaskStore } from "@goldmem/memory-store";
import type { ReminderEngine } from "@goldmem/reminder-engine";

export type ConfirmReminderInput = {
  tenantId?: string;
  reminderId: string;
  actorUserId: string;
  remindAt?: string;
  timezone?: string;
  traceId?: string;
};

export type UpdateFamilyTaskStatusInput = {
  tenantId?: string;
  taskId: string;
  actorUserId: string;
  action: "confirm" | "reject" | "needs_more_info";
  traceId?: string;
};

type ElderCommandDeps = {
  reminderEngine: ReminderEngine;
  familyTaskStore: FamilyTaskStore;
  auditLog: AuditLog;
};

export async function confirmReminderCommand(deps: ElderCommandDeps, input: ConfirmReminderInput): Promise<Reminder> {
  const traceId = input.traceId ?? randomUUID();
  const reminder = await deps.reminderEngine.confirmReminder({
    tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
    reminderId: input.reminderId,
    actorUserId: input.actorUserId,
    remindAt: input.remindAt,
    timezone: input.timezone,
  });
  await deps.auditLog.record({
    type: "reminder_confirmed",
    tenantId: reminder.tenantId,
    elderId: reminder.elderId,
    sourceId: reminder.sourceId,
    traceId,
    payload: {
      traceId,
      reminderId: reminder.id,
      actorUserId: input.actorUserId,
      status: reminder.status,
      confirmedAt: reminder.confirmedAt,
    },
  });
  return reminder;
}

export async function updateFamilyTaskStatusCommand(
  deps: ElderCommandDeps,
  input: UpdateFamilyTaskStatusInput,
): Promise<FamilyTask> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const traceId = input.traceId ?? randomUUID();
  const task = input.action === "confirm"
    ? await deps.familyTaskStore.confirm({ tenantId, taskId: input.taskId, actorUserId: input.actorUserId })
    : input.action === "reject"
      ? await deps.familyTaskStore.reject({ tenantId, taskId: input.taskId, actorUserId: input.actorUserId })
      : await deps.familyTaskStore.requestMoreInfo({ tenantId, taskId: input.taskId, actorUserId: input.actorUserId });
  await deps.auditLog.record({
    type: `family_task_${input.action === "needs_more_info" ? "needs_more_info" : `${input.action}ed`}`,
    tenantId: task.tenantId,
    elderId: task.elderId,
    traceId,
    payload: {
      traceId,
      taskId: task.id,
      actorUserId: input.actorUserId,
      status: task.status,
      confirmedAt: task.confirmedAt,
    },
  });
  return task;
}
