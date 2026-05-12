import type { MemoryPlan, PersonalContext } from "@goldmem/memory-schema";
import type { AuditLog } from "@goldmem/memory-store";

export class MemoryPlanCompletenessError extends Error {
  constructor(readonly problems: string[]) {
    super(`MemoryPlan completeness gate failed: ${problems.join("; ")}`);
    this.name = "MemoryPlanCompletenessError";
  }
}

export async function enforceMemoryPlanCompleteness(input: {
  plan: MemoryPlan;
  context: PersonalContext;
  traceId: string;
  auditLog: AuditLog;
}): Promise<MemoryPlan> {
  const plan = clonePlan(input.plan);
  const problems: string[] = [];
  const decisionsByEvent = new Map<number, MemoryPlan["eventActionDecisions"][number]>();
  const referencedReminderIndexes = new Set<number>();
  const openReminderIds = new Set((input.context.openReminders ?? []).map((reminder) => reminder.reminderId));

  for (const decision of plan.eventActionDecisions) {
    if (decision.eventIndex >= plan.events.length) {
      problems.push(`eventActionDecision eventIndex out of range: ${decision.eventIndex}`);
      continue;
    }
    if (decisionsByEvent.has(decision.eventIndex)) {
      problems.push(`duplicate eventActionDecision for eventIndex: ${decision.eventIndex}`);
      continue;
    }
    decisionsByEvent.set(decision.eventIndex, decision);
  }

  for (let eventIndex = 0; eventIndex < plan.events.length; eventIndex += 1) {
    validateEventTime(plan, eventIndex, problems);
    const decision = decisionsByEvent.get(eventIndex);
    if (!decision) {
      problems.push(`missing eventActionDecision for eventIndex: ${eventIndex}`);
      continue;
    }

    if (decision.action === "create_reminder_candidate") {
      validateReminderDecision(plan, decision, eventIndex, referencedReminderIndexes, openReminderIds, problems);
      continue;
    }

    if (decision.action === "update_existing_reminder_candidate") {
      validateUpdateDecision(plan, decision, eventIndex, referencedReminderIndexes, openReminderIds, problems);
      continue;
    }

    if (decision.reminderCandidateIndex !== undefined) {
      problems.push(`non-reminder action has reminderCandidateIndex at eventIndex: ${eventIndex}`);
    }
    if (decision.targetReminderId !== undefined) {
      problems.push(`non-update action has targetReminderId at eventIndex: ${eventIndex}`);
    }
  }

  for (let index = 0; index < plan.reminderCandidates.length; index += 1) {
    if (!referencedReminderIndexes.has(index)) {
      problems.push(`orphan reminderCandidate without eventActionDecision: ${index}`);
    }
  }

  if (problems.length > 0) {
    await input.auditLog.record({
      type: "memory_plan_completeness_failed",
      tenantId: plan.tenantId,
      elderId: plan.elderId,
      sourceId: plan.sourceId,
      traceId: input.traceId,
      payload: { traceId: input.traceId, problems, plan },
    });
    throw new MemoryPlanCompletenessError(problems);
  }

  return plan;
}

function validateReminderDecision(
  plan: MemoryPlan,
  decision: MemoryPlan["eventActionDecisions"][number],
  eventIndex: number,
  referencedReminderIndexes: Set<number>,
  openReminderIds: Set<string>,
  problems: string[],
): void {
  const reminderIndex = decision.reminderCandidateIndex;
  if (reminderIndex === undefined || reminderIndex >= plan.reminderCandidates.length) {
    problems.push(`reminder action missing valid reminderCandidateIndex at eventIndex: ${eventIndex}`);
    return;
  }
  if (referencedReminderIndexes.has(reminderIndex)) {
    problems.push(`duplicate reminderCandidateIndex reference: ${reminderIndex}`);
    return;
  }
  referencedReminderIndexes.add(reminderIndex);

  const reminder = plan.reminderCandidates[reminderIndex];
  if (!reminder) return;
  if (reminder.relatedEventIndex !== undefined && reminder.relatedEventIndex !== eventIndex) {
    problems.push(`reminderCandidate relatedEventIndex mismatch at index: ${reminderIndex}`);
    return;
  }
  reminder.relatedEventIndex = eventIndex;

  validateReminderTime(reminder, reminderIndex, problems);

  if (decision.action === "update_existing_reminder_candidate") {
    if (!decision.targetReminderId || !openReminderIds.has(decision.targetReminderId)) {
      problems.push(`update action targetReminderId not found in open reminders at eventIndex: ${eventIndex}`);
    }
    reminder.confirmationRequired = true;
    ensureFamilyConfirmer(reminder);
  }

  if (!reminder.remindAt || reminder.timeConfidence < 0.7) {
    reminder.confirmationRequired = true;
    ensureFamilyConfirmer(reminder);
  }

  const event = plan.events[eventIndex];
  if (event?.requiresConfirmation || event?.riskLevel !== "normal") {
    reminder.confirmationRequired = true;
    ensureFamilyConfirmer(reminder);
  }
}

function validateUpdateDecision(
  plan: MemoryPlan,
  decision: MemoryPlan["eventActionDecisions"][number],
  eventIndex: number,
  referencedReminderIndexes: Set<number>,
  openReminderIds: Set<string>,
  problems: string[],
): void {
  if (!decision.targetReminderId || !openReminderIds.has(decision.targetReminderId)) {
    problems.push(`update action targetReminderId not found in open reminders at eventIndex: ${eventIndex}`);
    return;
  }

  const linked = plan.contextLinks.some(
    (link) =>
      link.fromEventIndex === eventIndex &&
      link.reminderId === decision.targetReminderId,
  );
  if (!linked) {
    problems.push(`update action missing context link to target reminder at eventIndex: ${eventIndex}`);
  }

  if (decision.reminderCandidateIndex !== undefined) {
    validateReminderDecision(plan, decision, eventIndex, referencedReminderIndexes, openReminderIds, problems);
  }
}

function validateEventTime(plan: MemoryPlan, eventIndex: number, problems: string[]): void {
  const event = plan.events[eventIndex];
  if (!event) return;
  if (!hasModelTimeText(event.timeText)) {
    problems.push(`event missing timeText at eventIndex: ${eventIndex}`);
  }
  if (event.eventTimeStart && isNoTimeText(event.timeText)) {
    problems.push(`event has eventTimeStart but no timeText at eventIndex: ${eventIndex}`);
  }
}

function validateReminderTime(
  reminder: MemoryPlan["reminderCandidates"][number],
  reminderIndex: number,
  problems: string[],
): void {
  if (!hasModelTimeText(reminder.timeText) || isNoTimeText(reminder.timeText)) {
    problems.push(`reminderCandidate missing actionable timeText at index: ${reminderIndex}`);
  }
  if (reminder.remindAt && isNoTimeText(reminder.timeText)) {
    problems.push(`reminderCandidate has remindAt but no timeText at index: ${reminderIndex}`);
  }
}

function ensureFamilyConfirmer(reminder: MemoryPlan["reminderCandidates"][number]): void {
  if (!reminder.suggestedConfirmers.some((confirmer) => confirmer.role === "family")) {
    reminder.suggestedConfirmers.push({ role: "family" });
  }
}

function hasModelTimeText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNoTimeText(value: string | undefined): boolean {
  return value?.trim() === "未提到时间";
}

function clonePlan(plan: MemoryPlan): MemoryPlan {
  return JSON.parse(JSON.stringify(plan)) as MemoryPlan;
}
