import type { MemoryPlan } from "@goldmem/memory-schema";
import type { AppliedMemoryPlan } from "./ingest-types.js";

export type TemporalEnqueueReason =
  | "hard_risk"
  | "hard_context_link"
  | "hard_family_task"
  | "model_relation_signal"
  | "not_needed";

export type TemporalEnqueueDecision = {
  shouldEnqueue: boolean;
  reason: TemporalEnqueueReason;
  signals: MemoryPlan["relationEnrichmentSignals"];
};

export function decideTemporalEnqueue(plan: MemoryPlan, applied: AppliedMemoryPlan): TemporalEnqueueDecision {
  const signals = validRelationSignals(plan);
  if (hasHardRiskSignal(applied)) return { shouldEnqueue: true, reason: "hard_risk", signals };
  if (applied.contextLinks.length > 0) return { shouldEnqueue: true, reason: "hard_context_link", signals };
  if (hasHighValueFamilyTask(applied)) return { shouldEnqueue: true, reason: "hard_family_task", signals };
  if (signals.some((signal) => signal.valueScore >= 0.7 && signal.confidence >= 0.6)) {
    return { shouldEnqueue: true, reason: "model_relation_signal", signals };
  }
  return { shouldEnqueue: false, reason: "not_needed", signals };
}

function hasHighValueFamilyTask(applied: AppliedMemoryPlan): boolean {
  const eventsById = new Map(applied.events.map((event) => [event.id, event]));
  return applied.familyTasks.some((task) => {
    if (task.type !== "reminder_confirm") return true;
    const event = task.relatedEventId ? eventsById.get(task.relatedEventId) : undefined;
    return Boolean(event && (event.riskLevel !== "normal" || event.type === "medication" || event.type === "finance"));
  });
}

function hasHardRiskSignal(applied: AppliedMemoryPlan): boolean {
  if (applied.riskFlags.length > 0) return true;
  if (applied.events.some((event) => event.riskLevel !== "normal" || event.type === "medication" || event.type === "finance")) return true;

  const eventsById = new Map(applied.events.map((event) => [event.id, event]));
  return applied.reminderCandidates.some((reminder) => {
    const event = reminder.eventId ? eventsById.get(reminder.eventId) : undefined;
    return reminder.confirmationRequired && Boolean(event && event.riskLevel !== "normal");
  });
}

function validRelationSignals(plan: MemoryPlan): MemoryPlan["relationEnrichmentSignals"] {
  return plan.relationEnrichmentSignals.filter(
    (signal) =>
      signal.evidence.length > 0 &&
      signal.relatedEventIndexes.every((index) => index < plan.events.length) &&
      signal.relatedReminderCandidateIndexes.every((index) => index < plan.reminderCandidates.length),
  );
}
