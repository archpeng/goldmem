import { randomUUID } from "node:crypto";
import {
  DEFAULT_TENANT_ID,
  type CreateFeedbackRequest,
  type FamilyTask,
  type Feedback,
  type Reminder,
} from "@goldmem/memory-schema";
import type { AuditLog, FamilyTaskStore, FeedbackStore } from "@goldmem/memory-store";
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

export type CreateFeedbackInput = CreateFeedbackRequest;

type ConfirmReminderDeps = {
  reminderEngine: ReminderEngine;
  auditLog: AuditLog;
};

type UpdateFamilyTaskStatusDeps = {
  familyTaskStore: FamilyTaskStore;
  auditLog: AuditLog;
};

type CreateFeedbackDeps = {
  feedbackStore: FeedbackStore;
  auditLog: AuditLog;
};

export async function confirmReminderCommand(deps: ConfirmReminderDeps, input: ConfirmReminderInput): Promise<Reminder> {
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
  deps: UpdateFamilyTaskStatusDeps,
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

export async function createFeedbackCommand(deps: CreateFeedbackDeps, input: CreateFeedbackInput): Promise<Feedback> {
  const traceId = input.traceId ?? randomUUID();
  const feedback = await deps.feedbackStore.create({
    tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
    elderId: input.elderId,
    actorUserId: input.actorUserId,
    sourceId: input.sourceId,
    eventId: input.eventId,
    feedbackType: input.feedbackType,
    correction: input.correction,
  });
  await deps.auditLog.record({
    type: "feedback_created",
    tenantId: feedback.tenantId,
    elderId: feedback.elderId,
    sourceId: feedback.sourceId,
    traceId,
    payload: {
      traceId,
      feedbackId: feedback.id,
      feedbackType: feedback.feedbackType,
      actorUserId: feedback.actorUserId,
      eventId: feedback.eventId,
    },
  });
  return feedback;
}
