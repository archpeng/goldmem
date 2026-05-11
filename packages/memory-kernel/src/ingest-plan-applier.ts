import type { MemoryContextLink, MemoryEvent, MemoryPlan, PersonalContext, Reminder, RiskFlagRecord } from "@goldmem/memory-schema";
import type { PersonalContextStore } from "@goldmem/memory-store";
import { isString } from "./guards.js";
import type { ElderMemoryKernelDeps } from "./index.js";
import type { AppliedMemoryPlan } from "./ingest-types.js";
import { consumeProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";

export class MemoryPlanApplier {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async apply(plan: MemoryPlan, context: PersonalContext, traceId: string): Promise<AppliedMemoryPlan> {
    const startedAt = Date.now();
    const timings: Record<string, number> = {};
    const events: MemoryEvent[] = [];
    const reminders: Reminder[] = [];
    const contextLinks: MemoryContextLink[] = [];
    const riskFlags: RiskFlagRecord[] = [];

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
          traceId,
          payload: { traceId, warning: "Reminder relatedEventIndex out of range", reminder: draft },
        });
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
    timings.familyTaskWritesMs = Date.now() - familyTaskWritesStartedAt;

    const contextLinkWritesStartedAt = Date.now();
    for (const draft of plan.contextLinks) {
      const link = await this.applyContextLinkDraft(plan, draft, events, context, traceId);
      if (link) contextLinks.push(link);
    }
    timings.contextLinkWritesMs = Date.now() - contextLinkWritesStartedAt;

    const semanticWritesStartedAt = Date.now();
    await this.writeSemanticMemories(plan, events, traceId);
    timings.semanticWritesMs = Date.now() - semanticWritesStartedAt;
    timings.totalMs = Date.now() - startedAt;
    return { events, reminderCandidates: reminders, contextLinks, riskFlags, timings };
  }

  private async applyContextLinkDraft(
    plan: MemoryPlan,
    draft: MemoryPlan["contextLinks"][number],
    events: MemoryEvent[],
    context: Awaited<ReturnType<PersonalContextStore["buildContext"]>>,
    traceId: string,
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
      traceId,
      payload: { traceId, link },
    });

    return link;
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

  private async writeSemanticMemories(plan: MemoryPlan, events: MemoryEvent[], traceId: string): Promise<void> {
    for (const event of events) {
      await this.addSemanticMemory(plan, traceId, [
        `Title: ${event.title}`,
        `Summary: ${event.summary}`,
        `Type: ${event.type}`,
        `Risk: ${event.riskLevel}`,
        `Source: ${event.sourceId}`,
      ].join("\n"), {
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
        traceId,
      });
    }

    for (const update of plan.memoryUpdates.filter((item) => item.target === "semantic_memory")) {
      await this.addSemanticMemory(plan, traceId, update.content, {
        ...update.metadata,
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
        traceId,
      });
    }
  }

  private async addSemanticMemory(
    plan: MemoryPlan,
    traceId: string,
    memory: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      const embedding = await this.deps.modelGateway.embedText({ text: memory });
      await this.deps.semanticMemory.addMemory({
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        memory,
        embedding,
        metadata,
      });
    } catch (error) {
      await this.deps.auditLog.record({
        type: "semantic_memory_write_failed",
        tenantId: plan.tenantId,
        elderId: plan.elderId,
        sourceId: plan.sourceId,
        traceId,
        payload: {
          traceId,
          metadata,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          modelGateway: modelGatewayErrorPayload(error),
          providerTimings: consumeProviderTimings(this.deps.modelGateway),
        },
      });
    }
  }
}
