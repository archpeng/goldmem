import type { MemoryPlan, PersonalContext } from "@mem/memory-schema";
import type { AuditLog } from "@mem/memory-store";

export class MemoryPlanCompletenessError extends Error {
  constructor(readonly problems: string[]) {
    super(`MemoryPlan completeness gate failed: ${problems.join("; ")}`);
    this.name = "MemoryPlanCompletenessError";
  }
}

export async function enforceMemoryPlanCompleteness(input: {
  plan: MemoryPlan;
  context: PersonalContext;
  now: string;
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

  const repairs = repairActionObligations(plan, decisionsByEvent, openReminderIds, input.now);
  if (repairs.length > 0) {
    await input.auditLog.record({
      type: "memory_plan_action_obligation_repaired",
      tenantId: plan.tenantId,
      elderId: plan.elderId,
      sourceId: plan.sourceId,
      traceId: input.traceId,
      payload: { traceId: input.traceId, repairs },
    });
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

  validateRelationEnrichmentSignals(plan, problems);

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

function validateRelationEnrichmentSignals(plan: MemoryPlan, problems: string[]): void {
  for (let signalIndex = 0; signalIndex < plan.relationEnrichmentSignals.length; signalIndex += 1) {
    const signal = plan.relationEnrichmentSignals[signalIndex];
    if (!signal) continue;
    for (const eventIndex of signal.relatedEventIndexes) {
      if (eventIndex >= plan.events.length) {
        problems.push(`relationEnrichmentSignal eventIndex out of range at signalIndex: ${signalIndex}`);
      }
    }
    for (const reminderIndex of signal.relatedReminderCandidateIndexes) {
      if (reminderIndex >= plan.reminderCandidates.length) {
        problems.push(`relationEnrichmentSignal reminderCandidateIndex out of range at signalIndex: ${signalIndex}`);
      }
    }
  }
}

type ActionObligationRepair = {
  obligation: "future_reminder_required" | "update_candidate_required";
  eventIndex: number;
  reminderCandidateIndex: number;
  originalAction?: MemoryPlan["eventActionDecisions"][number]["action"];
};

function repairActionObligations(
  plan: MemoryPlan,
  decisionsByEvent: Map<number, MemoryPlan["eventActionDecisions"][number]>,
  openReminderIds: Set<string>,
  now: string,
): ActionObligationRepair[] {
  const repairs: ActionObligationRepair[] = [];

  for (let eventIndex = 0; eventIndex < plan.events.length; eventIndex += 1) {
    const event = plan.events[eventIndex];
    const decision = decisionsByEvent.get(eventIndex);
    if (!event) continue;

    if (decision?.action === "update_existing_reminder_candidate" && decision.targetReminderId && openReminderIds.has(decision.targetReminderId)) {
      if (!validReminderIndex(plan, decision.reminderCandidateIndex)) {
        const reminderCandidateIndex = appendReminderCandidate(plan, event, eventIndex, "这是对已有提醒的改期或补充，系统补充为待确认更新候选。");
        decision.reminderCandidateIndex = reminderCandidateIndex;
        repairs.push({ obligation: "update_candidate_required", eventIndex, reminderCandidateIndex, originalAction: "update_existing_reminder_candidate" });
      }
      continue;
    }

    if (!requiresFutureReminder(event, now)) continue;

    if (decision?.action === "create_reminder_candidate" && validReminderIndex(plan, decision.reminderCandidateIndex)) {
      continue;
    }

    const reminderCandidateIndex = validReminderIndex(plan, decision?.reminderCandidateIndex)
      ? decision.reminderCandidateIndex
      : appendReminderCandidate(plan, event, eventIndex, "这是未来事项，系统补充为待确认提醒候选。");
    if (reminderCandidateIndex === undefined) continue;

    const originalAction = decision?.action;
    if (decision) {
      decision.action = "create_reminder_candidate";
      decision.reminderCandidateIndex = reminderCandidateIndex;
      decision.targetReminderId = undefined;
      decision.reason = "未来事项必须形成待确认提醒候选。";
    } else {
      const newDecision: MemoryPlan["eventActionDecisions"][number] = {
        eventIndex,
        action: "create_reminder_candidate",
        reminderCandidateIndex,
        reason: "未来事项必须形成待确认提醒候选。",
        confidence: event.confidence,
        evidence: event.evidence,
      };
      plan.eventActionDecisions.push(newDecision);
      decisionsByEvent.set(eventIndex, newDecision);
    }
    repairs.push({ obligation: "future_reminder_required", eventIndex, reminderCandidateIndex, originalAction });
  }

  return repairs;
}

function requiresFutureReminder(event: MemoryPlan["events"][number], now: string): boolean {
  return event.type === "appointment" && isFutureIso(event.eventTimeStart, now);
}

function isFutureIso(value: string | undefined, now: string): boolean {
  if (!value) return false;
  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  return Number.isFinite(valueMs) && Number.isFinite(nowMs) && valueMs > nowMs;
}

function validReminderIndex(plan: MemoryPlan, index: number | undefined): index is number {
  return index !== undefined && index >= 0 && index < plan.reminderCandidates.length;
}

function appendReminderCandidate(
  plan: MemoryPlan,
  event: MemoryPlan["events"][number],
  eventIndex: number,
  reason: string,
): number {
  const reminder: MemoryPlan["reminderCandidates"][number] = {
    title: event.title,
    description: event.summary,
    timeText: event.timeText,
    remindAt: event.eventTimeStart,
    timeConfidence: event.timeConfidence,
    relatedEventIndex: eventIndex,
    confirmationRequired: true,
    suggestedConfirmers: [{ role: "family" }],
    confidence: event.confidence,
    reason,
  };
  plan.reminderCandidates.push(reminder);
  return plan.reminderCandidates.length - 1;
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
