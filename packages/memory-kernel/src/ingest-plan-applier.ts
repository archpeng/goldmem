import type { MemoryContextLink, MemoryEvent, MemoryPlan, PersonalContext, Reminder, RiskFlagRecord } from "@goldmem/memory-schema";
import type { PersonalContextStore } from "@goldmem/memory-store";
import { isString } from "./guards.js";
import type { ElderMemoryKernelDeps } from "./index.js";
import type { AppliedMemoryPlan } from "./ingest-types.js";

export class MemoryPlanApplier {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async apply(plan: MemoryPlan, context: PersonalContext): Promise<AppliedMemoryPlan> {
    const events: MemoryEvent[] = [];
    const reminders: Reminder[] = [];
    const contextLinks: MemoryContextLink[] = [];
    const riskFlags: RiskFlagRecord[] = [];

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

    for (const draft of plan.reminderCandidates) {
      const relatedEvent = typeof draft.relatedEventIndex === "number" ? events[draft.relatedEventIndex] : undefined;
      const reminder = await this.deps.reminderEngine.createCandidate({
        ...draft,
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
        eventId: relatedEvent?.id,
      });
      reminders.push(reminder);

      if (draft.confirmationRequired) {
        await this.deps.familyTaskStore.create({
          elderId: plan.elderId,
          tenantId: plan.tenantId,
          title: `Confirm reminder: ${draft.title}`,
          summary: draft.reason,
          type: "reminder_confirm",
          urgency: draft.timeConfidence < 0.7 ? "medium" : "low",
          visibility: "shared_summary",
          relatedEventId: relatedEvent?.id,
        });
      }

      if (typeof draft.relatedEventIndex === "number" && draft.relatedEventIndex >= events.length) {
        await this.deps.auditLog.record({
          type: "memory_plan_warning",
          tenantId: plan.tenantId,
          elderId: plan.elderId,
          sourceId: plan.sourceId,
          payload: { warning: "Reminder relatedEventIndex out of range", reminder: draft },
        });
      }
    }

    for (const risk of plan.riskFlags) {
      const riskFlag = await this.deps.riskFlagStore.create({
        ...risk,
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
      });
      riskFlags.push(riskFlag);
    }

    for (const task of plan.familyTasks) {
      const relatedEvent = typeof task.relatedEventIndex === "number" ? events[task.relatedEventIndex] : undefined;
      await this.deps.familyTaskStore.create({
        elderId: plan.elderId,
        tenantId: plan.tenantId,
        title: task.title,
        summary: task.summary,
        type: task.type,
        urgency: task.urgency,
        visibility: task.visibility,
        relatedEventId: relatedEvent?.id,
      });
    }

    for (const draft of plan.contextLinks) {
      const link = await this.applyContextLinkDraft(plan, draft, events, context);
      if (link) contextLinks.push(link);
    }

    await this.writeSemanticMemories(plan, events);
    return { events, reminderCandidates: reminders, contextLinks, riskFlags };
  }

  private async applyContextLinkDraft(
    plan: MemoryPlan,
    draft: MemoryPlan["contextLinks"][number],
    events: MemoryEvent[],
    context: Awaited<ReturnType<PersonalContextStore["buildContext"]>>,
  ): Promise<MemoryContextLink | undefined> {
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
      await this.auditSkippedContextLink(plan, draft, "missing_or_self_event_reference");
      return undefined;
    }

    if (!events.some((event) => event.id === toEventId) && !allowedHistoricalEventIds.has(toEventId)) {
      await this.auditSkippedContextLink(plan, draft, "to_event_not_in_context");
      return undefined;
    }

    if (draft.reminderId && !allowedReminderIds.has(draft.reminderId)) {
      await this.auditSkippedContextLink(plan, draft, "reminder_not_in_context");
      return undefined;
    }

    if (draft.confidence < 0.5) {
      await this.auditSkippedContextLink(plan, draft, "confidence_below_persistence_threshold");
      return undefined;
    }

    const status = draft.confidence >= 0.8 && draft.status === "active" ? "active" : "needs_confirmation";
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

    if (status === "needs_confirmation") {
      await this.deps.familyTaskStore.create({
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        title: draft.type === "fills_missing_time" ? "确认提醒时间关联" : "确认记忆上下文关联",
        summary: draft.reason,
        type: draft.type === "fills_missing_time" && draft.reminderId ? "reminder_confirm" : "general_review",
        urgency: "medium",
        visibility: "shared_summary",
        relatedEventId: fromEvent.id,
      });
    }

    await this.deps.auditLog.record({
      type: "memory_context_link_created",
      tenantId: plan.tenantId,
      elderId: plan.elderId,
      sourceId: plan.sourceId,
      payload: { link },
    });

    return link;
  }

  private async auditSkippedContextLink(
    plan: MemoryPlan,
    draft: MemoryPlan["contextLinks"][number],
    reason: string,
  ): Promise<void> {
    await this.deps.auditLog.record({
      type: "memory_context_link_skipped",
      tenantId: plan.tenantId,
      elderId: plan.elderId,
      sourceId: plan.sourceId,
      payload: { reason, contextLink: draft },
    });
  }

  private async writeSemanticMemories(plan: MemoryPlan, events: MemoryEvent[]): Promise<void> {
    for (const event of events) {
      await this.deps.semanticMemory.addMemory({
        tenantId: event.tenantId,
        elderId: event.elderId,
        memory: [
          `Title: ${event.title}`,
          `Summary: ${event.summary}`,
          `Type: ${event.type}`,
          `Risk: ${event.riskLevel}`,
          `Source: ${event.sourceId}`,
        ].join("\n"),
        metadata: {
          tenantId: event.tenantId,
          elderId: event.elderId,
          sourceId: event.sourceId,
          eventId: event.id,
          eventType: event.type,
          title: event.title,
          summary: event.summary,
          createdAt: event.createdAt,
          riskLevel: event.riskLevel,
          visibility: event.visibility,
        },
      });
    }

    for (const update of plan.memoryUpdates.filter((item) => item.target === "semantic_memory")) {
      await this.deps.semanticMemory.addMemory({
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        memory: update.content,
        metadata: { ...update.metadata, tenantId: plan.tenantId, elderId: plan.elderId, sourceId: plan.sourceId },
      });
    }
  }
}
