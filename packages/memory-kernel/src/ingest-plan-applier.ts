import type { FamilyTask, MemoryContextLink, MemoryEvent, MemoryPlan, PersonalContext, Reminder, RiskFlagRecord } from "@mem/memory-schema";
import type { PersonalContextStore } from "@mem/memory-store";
import { isString } from "./guards.js";
import type { ElderMemoryKernelDeps } from "./index.js";
import type { AppliedMemoryPlan } from "./ingest-types.js";

export class MemoryPlanApplier {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async apply(plan: MemoryPlan, context: PersonalContext, traceId: string): Promise<AppliedMemoryPlan> {
    const startedAt = Date.now();
    const timings: Record<string, number> = {};
    const events: MemoryEvent[] = [];
    const reminders: Reminder[] = [];
    const contextLinks: MemoryContextLink[] = [];
    const riskFlags: RiskFlagRecord[] = [];
    const familyTasks: FamilyTask[] = [];

    const eventWritesStartedAt = Date.now();
    for (const draft of plan.events) {
      const event = await this.deps.eventStore.create({
        ...draft,
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
        status: draft.requiresConfirmation ? "needs_review" : "active",
      });
      events.push(event);
    }
    timings.eventWritesMs = Date.now() - eventWritesStartedAt;

    const reminderWritesStartedAt = Date.now();
    for (const decision of plan.eventActionDecisions) {
      if (decision.action !== "create_reminder_candidate" && decision.action !== "update_existing_reminder_candidate") {
        continue;
      }
      const draft = plan.reminderCandidates[decision.reminderCandidateIndex ?? -1];
      if (!draft) continue;
      const relatedEvent = events[decision.eventIndex];
      const reminder = await this.deps.reminderEngine.createCandidate({
        ...draft,
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
        eventId: relatedEvent?.id,
      });
      reminders.push(reminder);

      if (draft.confirmationRequired) {
        const task = await this.deps.familyTaskStore.create({
          elderId: plan.elderId,
          tenantId: plan.tenantId,
          title: `确认提醒：${draft.title}`,
          summary: draft.reason,
          type: "reminder_confirm",
          urgency: draft.timeConfidence < 0.7 ? "medium" : "low",
          visibility: reminderConfirmationVisibility(draft, relatedEvent),
          relatedEventId: relatedEvent?.id,
        });
        familyTasks.push(task);
      }
    }
    timings.reminderWritesMs = Date.now() - reminderWritesStartedAt;

    const riskFlagWritesStartedAt = Date.now();
    for (const risk of plan.riskFlags) {
      const riskFlag = await this.deps.riskFlagStore.create({
        ...risk,
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
      });
      riskFlags.push(riskFlag);
    }
    timings.riskFlagWritesMs = Date.now() - riskFlagWritesStartedAt;

    const familyTaskWritesStartedAt = Date.now();
    for (const task of plan.familyTasks) {
      const relatedEvent = typeof task.relatedEventIndex === "number" ? events[task.relatedEventIndex] : undefined;
      const createdTask = await this.deps.familyTaskStore.create({
        elderId: plan.elderId,
        tenantId: plan.tenantId,
        title: task.title,
        summary: task.summary,
        type: task.type,
        urgency: task.urgency,
        visibility: task.visibility,
        relatedEventId: relatedEvent?.id,
      });
      familyTasks.push(createdTask);
    }
    timings.familyTaskWritesMs = Date.now() - familyTaskWritesStartedAt;

    const contextLinkWritesStartedAt = Date.now();
    for (const draft of plan.contextLinks) {
      const result = await this.applyContextLinkDraft(plan, draft, events, context, traceId);
      if (result?.link) contextLinks.push(result.link);
      if (result?.task) familyTasks.push(result.task);
    }
    timings.contextLinkWritesMs = Date.now() - contextLinkWritesStartedAt;

    timings.totalMs = Date.now() - startedAt;
    return { events, reminderCandidates: reminders, contextLinks, riskFlags, familyTasks, timings };
  }

  private async applyContextLinkDraft(
    plan: MemoryPlan,
    draft: MemoryPlan["contextLinks"][number],
    events: MemoryEvent[],
    context: Awaited<ReturnType<PersonalContextStore["buildContext"]>>,
    traceId: string,
  ): Promise<{ link: MemoryContextLink; task?: FamilyTask } | undefined> {
    const fromEvent = events[draft.fromEventIndex];
    const toEvent = typeof draft.toEventIndex === "number" ? events[draft.toEventIndex] : undefined;
    const toEventId = toEvent?.id ?? draft.toEventId;
    const openReminders = context.openReminders ?? [];
    const allowedHistoricalEventIds = new Set([
      ...context.recentEvents.map((event) => event.eventId).filter(isString),
      ...(context.semanticCandidateEvents ?? []).map((event) => event.eventId).filter(isString),
      ...openReminders.map((reminder) => reminder.eventId).filter(isString),
    ]);
    const allowedReminderIds = new Set(openReminders.map((reminder) => reminder.reminderId));

    if (!fromEvent || !toEventId || fromEvent.id === toEventId) {
      await this.auditSkippedContextLink(plan, draft, "missing_or_self_event_reference", traceId);
      return undefined;
    }

    if (!events.some((event) => event.id === toEventId) && !allowedHistoricalEventIds.has(toEventId)) {
      await this.auditSkippedContextLink(plan, draft, "to_event_not_in_context", traceId);
      return undefined;
    }

    if (draft.reminderId && !allowedReminderIds.has(draft.reminderId)) {
      await this.auditSkippedContextLink(plan, draft, "reminder_not_in_context", traceId);
      return undefined;
    }

    if (draft.confidence < 0.5) {
      await this.auditSkippedContextLink(plan, draft, "confidence_below_persistence_threshold", traceId);
      return undefined;
    }

    const status = draft.reminderId
      ? "needs_confirmation"
      : draft.confidence >= 0.8 && draft.status === "active" ? "active" : "needs_confirmation";
    const link = await this.deps.contextLinkStore.create({
      tenantId: plan.tenantId,
      elderId: plan.elderId,
      fromEventId: fromEvent.id,
      toEventId,
      reminderId: draft.reminderId,
      type: draft.type,
      status,
      confidence: draft.confidence,
      reason: draft.reason,
      evidence: draft.evidence,
    });

    const task = status === "needs_confirmation"
      ? await this.deps.familyTaskStore.create({
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        title: draft.type === "fills_missing_time" ? "确认提醒时间关联" : "确认记忆上下文关联",
        summary: draft.reason,
        type: draft.reminderId ? "reminder_confirm" : "general_review",
        urgency: "medium",
        visibility: "shared_summary",
        relatedEventId: fromEvent.id,
      })
      : undefined;

    await this.deps.auditLog.record({
      type: "memory_context_link_created",
      tenantId: plan.tenantId,
      elderId: plan.elderId,
      sourceId: plan.sourceId,
      traceId,
      payload: { traceId, link },
    });

    return { link, task };
  }

  private async auditSkippedContextLink(
    plan: MemoryPlan,
    draft: MemoryPlan["contextLinks"][number],
    reason: string,
    traceId: string,
  ): Promise<void> {
    await this.deps.auditLog.record({
      type: "memory_context_link_skipped",
      tenantId: plan.tenantId,
      elderId: plan.elderId,
      sourceId: plan.sourceId,
      traceId,
      payload: { traceId, reason, contextLink: draft },
    });
  }

}

function reminderConfirmationVisibility(
  draft: MemoryPlan["reminderCandidates"][number],
  event: MemoryEvent | undefined,
): "shared_summary" | "family_required" {
  if (draft.suggestedConfirmers.some((confirmer) => confirmer.role === "family")) return "family_required";
  if (event?.riskLevel === "medical" || event?.riskLevel === "financial" || event?.riskLevel === "fraud_risk") {
    return "family_required";
  }
  return "shared_summary";
}
