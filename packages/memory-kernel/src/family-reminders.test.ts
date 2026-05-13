import { describe, expect, it } from "vitest";
import type { MemoryPlan, ParsedMemoryQuery } from "@goldmem/memory-schema";
import { ModelGatewayError } from "@goldmem/model-gateway";
import {
  RecordingTemporalMemoryStore,
  buildEvent,
  buildEventActionDecision,
  buildPlan,
  buildRelationEnrichmentSignal,
  buildReminderCandidate,
  createHarness,
  emptyContext,
  evidence,
  memoryEvent,
  now,
} from "../test/harness.js";

describe("ElderMemoryKernel family-reminders", () => {
  it("creates family reminders through Kernel-owned orchestration with audit", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));

    const reminder = await harness.kernel.createFamilyReminder({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      actorUserId: "family-1",
      title: "提醒妈妈明天量血压",
      remindAt: "2026-05-11T09:00:00.000Z",
      reason: "Family-created reminder.",
      idempotencyKey: "family-reminder-1",
      traceId: "trace-family-reminder-1",
    });

    expect(harness.sourceStore.sources[0]).toMatchObject({
      type: "family_input",
      transcript: "提醒妈妈明天量血压",
    });
    expect(reminder).toMatchObject({
      status: "pending_family_confirm",
      confirmationRequired: true,
      remindAt: "2026-05-11T09:00:00.000Z",
    });
    expect(harness.audit.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "family_reminder_created",
          traceId: "trace-family-reminder-1",
          payload: expect.objectContaining({
            reminderId: reminder.id,
            actorUserId: "family-1",
            hasRemindAt: true,
            idempotencyKey: "family-reminder-1",
            traceId: "trace-family-reminder-1",
          }),
        }),
      ]),
    );
  });

  it("reuses idempotent family reminder commands without duplicate truth writes", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));
    const input = {
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      actorUserId: "family-1",
      title: "提醒妈妈明天量血压",
      remindAt: "2026-05-11T09:00:00.000Z",
      reason: "Family-created reminder.",
      idempotencyKey: "family-reminder-repeat",
    };

    const first = await harness.kernel.createFamilyReminder(input);
    const second = await harness.kernel.createFamilyReminder(input);

    expect(second.id).toBe(first.id);
    expect(harness.sourceStore.sources).toHaveLength(1);
    expect(harness.reminderStore.reminders).toHaveLength(1);
    expect(harness.audit.records.filter((record) => record.type === "family_reminder_created")).toHaveLength(1);
  });

  it("confirms reminders through Kernel-owned command audit", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));
    const reminder = await harness.reminderStore.create({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      sourceId: "source-1",
      title: "上午去城里买生活用品",
      status: "pending_elder_confirm",
      confirmationRequired: true,
      confidence: 0.8,
      reason: "Needs elder confirmation.",
    });

    const confirmed = await harness.kernel.confirmReminder({
      tenantId: "tenant-mvp",
      reminderId: reminder.id,
      actorUserId: "elder-1",
      remindAt: "2026-05-11T19:00:00.000Z",
      traceId: "trace-confirm-reminder",
    });

    expect(confirmed).toMatchObject({
      status: "confirmed",
      confirmationRequired: false,
      confirmedBy: "elder-1",
      remindAt: "2026-05-11T19:00:00.000Z",
    });
    expect(harness.audit.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "reminder_confirmed",
        traceId: "trace-confirm-reminder",
        payload: expect.objectContaining({ reminderId: reminder.id, actorUserId: "elder-1" }),
      }),
    ]));
  });

  it("updates family task status through Kernel-owned command audit", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));
    const task = await harness.familyTasks.create({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "general_review",
      title: "请确认复查时间",
      summary: "你提到复查时间可能改了。",
      visibility: "shared_summary",
      urgency: "medium",
    });

    const updated = await harness.kernel.updateFamilyTaskStatus({
      tenantId: "tenant-mvp",
      taskId: task.id,
      actorUserId: "family-1",
      action: "needs_more_info",
      traceId: "trace-family-task-status",
    });

    expect(updated).toMatchObject({ status: "needs_more_info", confirmedBy: "family-1" });
    expect(harness.audit.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "family_task_needs_more_info",
        traceId: "trace-family-task-status",
        payload: expect.objectContaining({ taskId: task.id, actorUserId: "family-1" }),
      }),
    ]));
  });

  it("lists only summary-safe pending family assist tasks with audit", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));
    harness.eventStore.events.push(
      memoryEvent({ id: "event-shared", visibility: "family_required" }),
      memoryEvent({ id: "event-private", visibility: "private" }),
    );
    await harness.familyTasks.create({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "risk_review",
      title: "请确认转账风险",
      summary: "这件事需要你确认风险。",
      visibility: "family_required",
      urgency: "high",
      relatedEventId: "event-shared",
    });
    await harness.familyTasks.create({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "general_review",
      title: "私人事项",
      summary: "这件事不能给家人看。",
      visibility: "shared_summary",
      urgency: "low",
      relatedEventId: "event-private",
    });
    await harness.familyTasks.create({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "general_review",
      title: "内部事项",
      summary: "这件事没有分享权限。",
      visibility: "private",
      urgency: "low",
    });

    const tasks = await harness.kernel.listFamilyAssistTasks({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      actorUserId: "family-1",
      traceId: "trace-family-assist",
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        title: "请确认转账风险",
        visibility: "family_required",
      }),
    ]);
    expect(tasks[0]).not.toHaveProperty("relatedEventId");
    expect(harness.audit.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "family_assist_tasks_viewed",
        traceId: "trace-family-assist",
        payload: expect.objectContaining({
          actorUserId: "family-1",
          totalPendingTaskCount: 3,
          returnedTaskCount: 1,
          hiddenTaskCount: 2,
        }),
      }),
    ]));
  });

  it("keeps medical event truth private while exposing only the confirmation task summary", async () => {
    const harness = createHarness(buildPlan({
      summary: "降压药提醒需要确认。",
      events: [buildEvent({
        type: "medication",
        title: "降压药调整",
        summary: "你提到降压药可能调整了。",
        riskLevel: "medical",
      })],
      reminderCandidates: [buildReminderCandidate({
        title: "确认降压药服用时间",
        confirmationRequired: true,
        relatedEventIndex: 0,
        reason: "降压药调整需要先确认。",
      })],
      eventActionDecisions: [buildEventActionDecision({
        eventIndex: 0,
        action: "create_reminder_candidate",
        reminderCandidateIndex: 0,
      })],
    }));

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "医生说降压药可能要改，帮我提醒确认一下。",
      traceId: "trace-medical-family-assist",
    });
    const tasks = await harness.kernel.listFamilyAssistTasks({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      actorUserId: "family-1",
    });

    expect(result.events[0]?.visibility).toBe("private");
    expect(tasks).toEqual([
      expect.objectContaining({
        type: "reminder_confirm",
        visibility: "family_required",
        summary: "降压药调整需要先确认。",
      }),
    ]);
    expect(tasks[0]).not.toHaveProperty("relatedEventId");
  });

  it("creates elder feedback through Kernel-owned command audit", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));

    const feedback = await harness.kernel.createFeedback({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      actorUserId: "elder-1",
      sourceId: "source-1",
      eventId: "event-1",
      feedbackType: "answer_wrong",
      correction: { expected: "菠菜" },
      traceId: "trace-feedback",
    });

    expect(feedback).toMatchObject({ id: "feedback-1", feedbackType: "answer_wrong" });
    expect(harness.feedbackStore.feedback).toHaveLength(1);
    expect(harness.audit.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "feedback_created",
        traceId: "trace-feedback",
        payload: expect.objectContaining({
          feedbackId: feedback.id,
          actorUserId: "elder-1",
          eventId: "event-1",
        }),
      }),
    ]));
  });

  it("surfaces feedback persistence failures without writing success audit", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));
    harness.feedbackStore.failCreate = true;

    await expect(harness.kernel.createFeedback({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      actorUserId: "elder-1",
      sourceId: "source-1",
      feedbackType: "answer_wrong",
      correction: { expected: "菠菜" },
      traceId: "trace-feedback-failed",
    })).rejects.toThrow("Feedback create failed");

    expect(harness.audit.records.some((record) => record.type === "feedback_created")).toBe(false);
  });

  it("rolls back family reminder command writes and audits failure when reminder creation fails", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));
    harness.familyReminderCommands.failReminderCreate = true;

    await expect(harness.kernel.createFamilyReminder({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      actorUserId: "family-1",
      title: "提醒妈妈明天量血压",
      reason: "Family-created reminder.",
      idempotencyKey: "family-reminder-fail-reminder",
    })).rejects.toThrow("Reminder command create failed");

    expect(harness.sourceStore.sources).toHaveLength(0);
    expect(harness.reminderStore.reminders).toHaveLength(0);
    expect(harness.audit.records).toEqual([
      expect.objectContaining({ type: "family_reminder_create_failed" }),
    ]);
  });

  it("rolls back family reminder command writes when success audit fails", async () => {
    const harness = createHarness(buildPlan({ summary: "Unused plan." }));
    harness.familyReminderCommands.failAudit = true;

    await expect(harness.kernel.createFamilyReminder({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      actorUserId: "family-1",
      title: "提醒妈妈明天量血压",
      reason: "Family-created reminder.",
      idempotencyKey: "family-reminder-fail-audit",
    })).rejects.toThrow("Reminder command audit failed");

    expect(harness.sourceStore.sources).toHaveLength(0);
    expect(harness.reminderStore.reminders).toHaveLength(0);
    expect(harness.audit.records).toEqual([
      expect.objectContaining({ type: "family_reminder_create_failed" }),
    ]);
  });
});
