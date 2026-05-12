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

describe("ElderMemoryKernel", () => {
  it("ingests a normal daily note without sharing it by default", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Went grocery shopping.",
        events: [
          buildEvent({
            title: "Bought vegetables",
            summary: "The elder bought vegetables at the market.",
            type: "shopping",
            riskLevel: "normal",
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "I bought vegetables at the market.",
      traceId: "trace-ingest-1",
    });

    expect(result.traceId).toBe("trace-ingest-1");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.visibility).toBe("private");
    expect(result.events[0]?.status).toBe("active");
    expect(harness.semanticMemory.memories).toHaveLength(1);
    expect(harness.semanticMemory.memories[0]?.metadata).toMatchObject({ traceId: "trace-ingest-1" });
    expect(harness.audit.records.at(-1)?.type).toBe("memory_ingest");
    expect(harness.audit.records.at(-1)).toMatchObject({
      traceId: "trace-ingest-1",
      payload: expect.objectContaining({ traceId: "trace-ingest-1" }),
    });
  });

  it("requires confirmation for ambiguous reminder times", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Needs a reminder but time is unclear.",
        events: [
          buildEvent({
            title: "Take a walk",
            summary: "The elder asked to be reminded to take a walk later.",
            type: "general",
            timeConfidence: 0.3,
          }),
        ],
        reminderCandidates: [
          buildReminderCandidate({
            title: "Take a walk",
            timeText: "later",
            remindAt: undefined,
            timeConfidence: 0.3,
            confirmationRequired: false,
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "create_reminder_candidate",
            reminderCandidateIndex: 0,
            reason: "The transcript asks for a reminder.",
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "Remind me to take a walk later.",
    });

    expect(result.reminderCandidates[0]?.status).toBe("pending_family_confirm");
    expect(result.reminderCandidates[0]?.confirmationRequired).toBe(true);
    expect(result.reminderCandidates[0]?.timeText).toBe("later");
    expect(result.reminderCandidates[0]?.timeConfidence).toBe(0.3);
    expect(harness.familyTasks.tasks[0]?.type).toBe("reminder_confirm");
  });

  it("rejects reminder actions when the model omits actionable time text", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Reminder action without time text.",
        events: [
          buildEvent({
            title: "社区医院复查",
            summary: "老人说下周三下午三点要去社区医院复查血压。",
            type: "appointment",
            timeText: "下周三下午三点",
          }),
        ],
        reminderCandidates: [
          buildReminderCandidate({
            title: "社区医院复查血压",
            timeText: "未提到时间",
            confirmationRequired: true,
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "create_reminder_candidate",
            reminderCandidateIndex: 0,
          }),
        ],
      }),
    );

    await expect(harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "下周三下午三点我要去社区医院复查血压。",
    })).rejects.toThrow("reminderCandidate missing actionable timeText");
  });

  it("fails visibly when an event has no action decision", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Appointment without a decision.",
        events: [
          buildEvent({
            title: "社区医院复查",
            summary: "老人说下周三下午三点要去社区医院复查血压。",
            type: "appointment",
          }),
        ],
        eventActionDecisions: [],
      }),
    );

    await expect(harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "下周三下午三点我要去社区医院复查血压。",
    })).rejects.toThrow("MemoryPlan completeness gate failed");

    expect(harness.eventStore.events).toHaveLength(0);
    expect(harness.audit.records.some((record) => record.type === "memory_plan_completeness_failed")).toBe(true);
  });

  it("repairs silent future appointment events into pending reminder candidates", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Future appointment without reminder action.",
        events: [
          buildEvent({
            title: "社区医院复查改期",
            summary: "社区医院复查改到下周一上午九点，医保卡还是要带。",
            type: "appointment",
            timeText: "下周一上午九点",
            eventTimeStart: "2099-05-18T01:00:00.000Z",
            riskLevel: "medical",
            requiresConfirmation: true,
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "none",
            reason: "The model missed the required reminder action.",
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "社区医院复查改到下周一上午九点，医保卡还是要带。",
    });

    expect(result.reminderCandidates).toHaveLength(1);
    expect(result.reminderCandidates[0]).toMatchObject({
      title: "社区医院复查改期",
      timeText: "下周一上午九点",
      remindAt: "2099-05-18T01:00:00.000Z",
      status: "pending_family_confirm",
      confirmationRequired: true,
    });
    expect(harness.audit.records.some((record) => record.type === "memory_plan_action_obligation_repaired")).toBe(true);
  });

  it("does not create reminders for past appointment events", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Past appointment.",
        events: [
          buildEvent({
            title: "上周社区医院复查",
            summary: "老人上周已经去社区医院复查血压。",
            type: "appointment",
            timeText: "上周",
            eventTimeStart: "2020-05-01T01:00:00.000Z",
            riskLevel: "medical",
            requiresConfirmation: true,
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "family_review",
            reason: "Past medical note only needs family review.",
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "上周我已经去社区医院复查血压。",
    });

    expect(result.reminderCandidates).toHaveLength(0);
    expect(harness.audit.records.some((record) => record.type === "memory_plan_action_obligation_repaired")).toBe(false);
  });

  it("rejects orphan reminder candidates that bypass event action decisions", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Reminder candidate without action.",
        events: [
          buildEvent({
            title: "社区医院复查",
            summary: "老人说下周三下午三点要去社区医院复查血压。",
            type: "appointment",
          }),
        ],
        reminderCandidates: [
          buildReminderCandidate({
            title: "社区医院复查",
            confirmationRequired: true,
          }),
        ],
      }),
    );

    await expect(harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "下周三下午三点我要去社区医院复查血压。",
    })).rejects.toThrow("orphan reminderCandidate");
  });

  it("forces confirmation for medical reminder actions", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Medical appointment reminder.",
        events: [
          buildEvent({
            title: "社区医院复查血压",
            summary: "老人说下周三下午三点要去社区医院复查血压。",
            type: "appointment",
            riskLevel: "medical",
            requiresConfirmation: false,
          }),
        ],
        reminderCandidates: [
          buildReminderCandidate({
            title: "社区医院复查血压",
            timeText: "下周三下午三点",
            confirmationRequired: false,
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "create_reminder_candidate",
            reminderCandidateIndex: 0,
            reason: "这是一个需要待确认的医疗复查提醒候选。",
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "下周三下午三点我要去社区医院复查血压。",
    });

    expect(result.reminderCandidates[0]).toMatchObject({
      status: "pending_family_confirm",
      confirmationRequired: true,
    });
    expect(harness.familyTasks.tasks.some((task) => task.type === "reminder_confirm")).toBe(true);
  });

  it("creates a pending update candidate without mutating the existing reminder", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Reminder update candidate.",
        events: [
          buildEvent({
            title: "复查改期",
            summary: "女儿确认社区医院复查改到下周一上午九点。",
            type: "appointment",
          }),
        ],
        reminderCandidates: [
          buildReminderCandidate({
            title: "社区医院复查改到下周一上午九点",
            timeText: "下周一上午九点",
            confirmationRequired: false,
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "update_existing_reminder_candidate",
            reminderCandidateIndex: 0,
            targetReminderId: "reminder-prior",
            reason: "这条输入在更新一个已有的复查提醒。",
          }),
        ],
        contextLinks: [
          {
            fromEventIndex: 0,
            toEventId: "event-prior",
            reminderId: "reminder-prior",
            type: "fills_missing_time",
            confidence: 0.9,
            status: "needs_confirmation",
            reason: "这条输入在更新已有复查提醒的时间。",
            evidence: [evidence()],
          },
        ],
      }),
    );
    harness.eventStore.events.push(memoryEvent({
      id: "event-prior",
      sourceId: "source-prior",
      title: "社区医院复查",
      summary: "原始社区医院复查提醒。",
    }));
    harness.personalContextStore.context = {
      ...emptyContext(),
      recentEvents: [
        {
          eventId: "event-prior",
          sourceId: "source-prior",
          title: "社区医院复查",
          summary: "原始社区医院复查提醒。",
          createdAt: now,
        },
      ],
      openReminders: [
        {
          reminderId: "reminder-prior",
          eventId: "event-prior",
          title: "社区医院复查",
          reason: "原始复查提醒。",
          status: "pending_family_confirm",
        },
      ],
    };

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "社区医院复查改到下周一上午九点。",
    });

    expect(result.reminderCandidates).toHaveLength(1);
    expect(result.reminderCandidates[0]).toMatchObject({
      title: "社区医院复查改到下周一上午九点",
      status: "pending_family_confirm",
      confirmationRequired: true,
    });
  });

  it("repairs reminder updates into pending candidates while keeping context links as evidence", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Added a reminder time detail.",
        events: [
          buildEvent({
            title: "下午三点提醒",
            summary: "老人补充说大约下午三点提醒一下。",
            type: "general",
            timeText: "下午三点",
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "update_existing_reminder_candidate",
            targetReminderId: "reminder-prior",
            reason: "这条输入补充已有提醒的时间。",
          }),
        ],
        contextLinks: [
          {
            fromEventIndex: 0,
            toEventId: "event-prior",
            reminderId: "reminder-prior",
            type: "fills_missing_time",
            confidence: 0.95,
            status: "active",
            reason: "这条下午三点是在补充之前下周一吃面条的提醒时间。",
            evidence: [evidence()],
          },
        ],
      }),
    );
    harness.eventStore.events.push(memoryEvent({
      id: "event-prior",
      sourceId: "source-prior",
      title: "下周一吃当地特色面条",
      summary: "老人说下周一准备出门吃当地特色面条，可能需要提醒，但没有具体几点。",
    }));
    harness.personalContextStore.context = {
      ...emptyContext(),
      recentEvents: [
        {
          eventId: "event-prior",
          sourceId: "source-prior",
          title: "下周一吃当地特色面条",
          summary: "老人说下周一准备出门吃当地特色面条，可能需要提醒，但没有具体几点。",
          createdAt: now,
        },
      ],
      openReminders: [
        {
          reminderId: "reminder-prior",
          eventId: "event-prior",
          title: "下周一吃面条提醒",
          reason: "时间不明确，需要确认。",
          status: "pending_family_confirm",
        },
      ],
    };

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "大约下午三点提醒我一下。",
    });

    expect(result.reminderCandidates).toHaveLength(1);
    expect(result.reminderCandidates[0]).toMatchObject({
      title: "下午三点提醒",
      timeText: "下午三点",
      status: "pending_family_confirm",
      confirmationRequired: true,
    });
    expect(harness.contextLinkStore.links[0]).toMatchObject({
      reminderId: "reminder-prior",
      type: "fills_missing_time",
      status: "needs_confirmation",
    });
    expect(harness.familyTasks.tasks.some((task) => task.type === "reminder_confirm")).toBe(true);
  });

  it("guards medication risk and persists the risk flag", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Medication changed.",
        events: [
          buildEvent({
            title: "Medication change",
            summary: "The elder mentioned changing medicine dosage.",
            type: "medication",
            riskLevel: "medical",
            requiresConfirmation: false,
          }),
        ],
        riskFlags: [
          {
            type: "medication_change",
            severity: "high",
            summary: "Medication dosage may have changed.",
            reason: "Medication changes need human confirmation.",
            requiresFamilyReview: false,
            requiresHumanConfirmation: false,
            evidence: [evidence()],
          },
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "The doctor changed my medicine dose.",
    });

    expect(result.events[0]?.requiresConfirmation).toBe(true);
    expect(result.events[0]?.visibility).toBe("shared_summary");
    expect(harness.riskFlags.flags[0]?.requiresFamilyReview).toBe(true);
    expect(harness.riskFlags.flags[0]?.requiresHumanConfirmation).toBe(true);
  });

  it("creates a family risk review task for fraud risk", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Possible transfer scam.",
        events: [
          buildEvent({
            title: "Suspicious transfer request",
            summary: "A stranger asked the elder to transfer money.",
            type: "finance",
            riskLevel: "fraud_risk",
            requiresConfirmation: false,
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "A stranger told me to transfer money.",
    });

    expect(result.events[0]?.visibility).toBe("family_required");
    expect(harness.familyTasks.tasks.some((task) => task.type === "risk_review")).toBe(true);
  });

  it("keeps sensitive private content private", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Private family note.",
        events: [
          buildEvent({
            title: "Private family conflict",
            summary: "The elder mentioned a sensitive family matter.",
            type: "family",
            riskLevel: "sensitive",
            requiresConfirmation: false,
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "I do not want to share this family matter.",
    });

    expect(result.events[0]?.requiresConfirmation).toBe(true);
    expect(result.events[0]?.visibility).toBe("private");
  });

  it("writes a production Graphiti temporal episode after business records are persisted", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    const harness = createHarness(
      buildPlan({
        summary: "Hospital follow-up.",
        events: [buildEvent({ title: "医院复查", summary: "周五下午去医院复查，需要带医保卡。", type: "appointment", riskLevel: "medical" })],
      }),
      temporalMemory,
    );

    const result = await harness.kernel.ingestText({
      tenantId: "tenant-a",
      elderId: "elder-1",
      transcript: "周五下午去医院复查，别忘了医保卡。",
    });

    expect(result.temporalMemory.status).toBe("queued");
    expect(result.temporalMemory.enqueueReason).toBe("hard_risk");
    expect(temporalMemory.episodes).toHaveLength(0);
    expect(harness.temporalMemoryJobStore.jobs).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        elderId: "elder-1",
        sourceId: "source-1",
        status: "pending",
        episode: expect.objectContaining({
          groupId: "tenant_tenant-a__elder_elder-1",
          sourceIds: ["source-1"],
          eventIds: ["event-1"],
        }),
      }),
    ]);
    expect(harness.audit.records.some((record) => record.type === "graphiti_enqueue_decision" && record.payload.reason === "hard_risk")).toBe(true);
    expect(harness.audit.records.at(-1)?.payload.result).toMatchObject({ temporalMemory: { status: "queued", enqueueReason: "hard_risk" } });
  });

  it("surfaces Graphiti enqueue failure without rolling back PostgreSQL truth", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Medication changed.",
        events: [buildEvent({ title: "药物调整", summary: "医生说药物用法可能有调整。", type: "medication", riskLevel: "medical" })],
      }),
    );
    harness.temporalMemoryJobStore.failEnqueue = true;

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "医生说这个药可能要调整。",
    });

    expect(result.events).toHaveLength(1);
    expect(result.temporalMemory.status).toBe("failed");
    expect(result.temporalMemory.errorCode).toBe("graphiti_enqueue_failed");
    expect(harness.temporalMemoryJobStore.jobs).toHaveLength(0);
    expect(harness.audit.records.some((record) => record.type === "graphiti_enqueue_failed" && record.traceId === result.traceId)).toBe(true);
    expect(harness.audit.records.at(-1)?.type).toBe("memory_ingest");
  });

  it("skips Graphiti queueing for low-value daily notes", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    const harness = createHarness(
      buildPlan({
        summary: "Bought vegetables.",
        events: [buildEvent({ title: "买青菜", summary: "老人买了青菜。", type: "shopping" })],
      }),
      temporalMemory,
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "今天买了青菜。",
    });

    expect(result.temporalMemory.status).toBe("not_needed");
    expect(temporalMemory.episodes).toHaveLength(0);
    expect(harness.temporalMemoryJobStore.jobs).toHaveLength(0);
  });

  it("does not queue Graphiti for ordinary reminder confirmation tasks without relation value", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Ordinary shopping reminder.",
        events: [buildEvent({ title: "买鸡蛋", summary: "老人明天上午去买鸡蛋。", type: "shopping" })],
        reminderCandidates: [
          buildReminderCandidate({
            title: "买鸡蛋",
            timeText: "明天上午",
            relatedEventIndex: 0,
            confirmationRequired: true,
            reason: "普通购物提醒需要确认时间。",
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "create_reminder_candidate",
            reminderCandidateIndex: 0,
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "明天上午去买鸡蛋。",
    });

    expect(result.reminderCandidates).toHaveLength(1);
    expect(harness.familyTasks.tasks).toHaveLength(1);
    expect(result.temporalMemory.status).toBe("not_needed");
    expect(result.temporalMemory.enqueueReason).toBe("not_needed");
  });

  it("queues Graphiti from valid relation enrichment signals without broad event-type rules", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Meal plan changed.",
        events: [buildEvent({ title: "面馆时间改了", summary: "吃面改到下周三下午三点。", type: "general" })],
        relationEnrichmentSignals: [
          buildRelationEnrichmentSignal({
            intent: "temporal_change",
            valueScore: 0.86,
            confidence: 0.78,
            relatedEventIndexes: [0],
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "吃面改到下周三下午三点。",
    });

    expect(result.temporalMemory.status).toBe("queued");
    expect(result.temporalMemory.enqueueReason).toBe("model_relation_signal");
    expect(result.temporalMemory.relationSignalIntents).toEqual(["temporal_change"]);
  });

  it("ignores low-confidence relation signals when no hard Graphiti signal exists", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "One-off call reminder.",
        events: [buildEvent({ title: "晚上打电话", summary: "老人晚上要给儿子打电话。", type: "general" })],
        relationEnrichmentSignals: [
          buildRelationEnrichmentSignal({
            intent: "same_matter_link",
            valueScore: 0.4,
            confidence: 0.5,
            relatedEventIndexes: [0],
          }),
        ],
      }),
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "晚上给儿子打电话。",
    });

    expect(result.temporalMemory.status).toBe("not_needed");
    expect(result.temporalMemory.enqueueReason).toBe("not_needed");
    expect(harness.temporalMemoryJobStore.jobs).toHaveLength(0);
  });

  it("rejects relation enrichment signals with out-of-range indexes", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Bad relation signal.",
        events: [buildEvent({ title: "普通记录", summary: "普通记录。", type: "general" })],
        relationEnrichmentSignals: [
          buildRelationEnrichmentSignal({ relatedEventIndexes: [1] }),
        ],
      }),
    );

    await expect(harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "普通记录。",
    })).rejects.toThrow("MemoryPlan completeness gate failed");
  });

  it("rejects reminder actions with mismatched event references", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Reminder references a missing event.",
        events: [
          buildEvent({
            title: "Call daughter",
            summary: "The elder asked to be reminded to call their daughter.",
          }),
        ],
        reminderCandidates: [
          buildReminderCandidate({
            title: "Call daughter",
            relatedEventIndex: 3,
            confirmationRequired: false,
          }),
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "create_reminder_candidate",
            reminderCandidateIndex: 0,
          }),
        ],
      }),
    );

    await expect(harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "Remind me to call my daughter tomorrow.",
    })).rejects.toThrow("MemoryPlan completeness gate failed");

    expect(harness.audit.records.some((record) => record.type === "memory_plan_completeness_failed")).toBe(true);
  });

  it("persists medium-confidence context links as confirmation-required relationships", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Added a reminder time detail.",
        events: [
          buildEvent({
            title: "下午三点提醒",
            summary: "老人补充说大约下午三点提醒一下。",
            type: "general",
          }),
        ],
        contextLinks: [
          {
            fromEventIndex: 0,
            toEventId: "event-prior",
            reminderId: "reminder-prior",
            type: "fills_missing_time",
            confidence: 0.68,
            status: "active",
            reason: "这条下午三点可能是在补充之前下周一吃面条的提醒时间。",
            evidence: [evidence()],
          },
        ],
      }),
    );
    harness.eventStore.events.push({
      ...memoryEvent({
        id: "event-prior",
        sourceId: "source-prior",
        title: "下周一吃当地特色面条",
        summary: "老人说下周一准备出门吃当地特色面条，可能需要提醒，但没有具体几点。",
      }),
    });
    harness.personalContextStore.context = {
      ...emptyContext(),
      recentEvents: [
        {
          eventId: "event-prior",
          sourceId: "source-prior",
          title: "下周一吃当地特色面条",
          summary: "老人说下周一准备出门吃当地特色面条，可能需要提醒，但没有具体几点。",
          createdAt: now,
        },
      ],
      openReminders: [
        {
          reminderId: "reminder-prior",
          eventId: "event-prior",
          title: "下周一吃面条提醒",
          reason: "时间不明确，需要确认。",
          status: "pending_family_confirm",
        },
      ],
    };

    await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "大约下午三点提醒我一下。",
    });

    expect(harness.contextLinkStore.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromEventId: "event-2",
          toEventId: "event-prior",
          reminderId: "reminder-prior",
          type: "fills_missing_time",
          status: "needs_confirmation",
        }),
      ]),
    );
    expect(harness.familyTasks.tasks.some((task) => task.type === "reminder_confirm")).toBe(true);
    expect(harness.reminderStore.reminders).toHaveLength(0);
  });

  it("skips low-confidence context links without creating business relationships", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Weak related note.",
        events: [buildEvent({ title: "可能相关", summary: "老人提到一个可能相关的事情。" })],
        contextLinks: [
          {
            fromEventIndex: 0,
            toEventId: "event-prior",
            type: "possibly_related",
            confidence: 0.3,
            status: "needs_confirmation",
            reason: "关系太弱。",
            evidence: [evidence()],
          },
        ],
      }),
    );
    harness.eventStore.events.push(memoryEvent({ id: "event-prior", sourceId: "source-prior" }));
    harness.personalContextStore.context = {
      ...emptyContext(),
      recentEvents: [{ eventId: "event-prior", title: "旧事件", summary: "旧事件摘要", createdAt: now }],
    };

    await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "这个可能也有点关系。",
    });

    expect(harness.contextLinkStore.links).toHaveLength(0);
    expect(harness.audit.records.some((record) => record.type === "memory_context_link_skipped")).toBe(true);
  });

  it("passes semantic semantic candidate events into memory plan context without using graph relations", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Semantic context candidate only.",
        events: [buildEvent({ title: "老字号吃饭提醒", summary: "老人提到下午三点去老字号吃饭。" })],
      }),
    );
    harness.eventStore.events.push(
      memoryEvent({
        id: "event-semantic",
        sourceId: "source-semantic",
        title: "老街面馆",
        summary: "老人想去老街那家面馆吃本地特色面，时间还没定。",
      }),
      memoryEvent({
        id: "event-other-elder",
        elderId: "elder-2",
        sourceId: "source-other",
        title: "其他老人事件",
        summary: "这条候选不属于当前老人。",
      }),
    );
    harness.semanticMemory.searchResults = [
      {
        memory: "Graph-like result with relations ignored.",
        score: 0.8,
        metadata: { eventId: "event-semantic", sourceId: "source-semantic" },
      },
      {
        memory: "Cross elder result must be ignored.",
        score: 0.9,
        metadata: { eventId: "event-other-elder", sourceId: "source-other" },
      },
    ];

    await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "下午三点提醒我去那家老字号吃饭。",
    });

    expect(harness.model.lastPlanContext?.semanticCandidateEvents).toEqual([
      expect.objectContaining({
        eventId: "event-semantic",
        title: "老街面馆",
      }),
    ]);
  });

  it("allows context links to target semantic candidate events", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Semantic candidate link.",
        events: [buildEvent({ title: "老字号吃饭提醒", summary: "老人提到下午三点去老字号吃饭。" })],
        contextLinks: [
          {
            fromEventIndex: 0,
            toEventId: "event-semantic",
            type: "possibly_related",
            confidence: 0.7,
            status: "needs_confirmation",
            reason: "老字号吃饭可能关联到之前老街面馆吃本地特色面的计划。",
            evidence: [evidence()],
          },
        ],
      }),
    );
    harness.eventStore.events.push(
      memoryEvent({
        id: "event-semantic",
        sourceId: "source-semantic",
        title: "老街面馆",
        summary: "老人想去老街那家面馆吃本地特色面，时间还没定。",
      }),
    );
    harness.semanticMemory.searchResults = [
      {
        memory: "老街面馆本地特色面",
        score: 0.82,
        metadata: { eventId: "event-semantic", sourceId: "source-semantic" },
      },
    ];

    await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "下午三点提醒我去那家老字号吃饭。",
    });

    expect(harness.contextLinkStore.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromEventId: "event-2",
          toEventId: "event-semantic",
          type: "possibly_related",
          status: "needs_confirmation",
        }),
      ]),
    );
    expect(harness.familyTasks.tasks.some((task) => task.type === "general_review")).toBe(true);
  });

  it("validates parsed query and answer model outputs", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["shopping"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answer = {
      answerText: "You bought vegetables at the market.",
      confidence: 0.9,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };
    harness.semanticMemory.searchResults = [
      {
        memory: "A compressed semantic fact.",
        score: 0.8,
        metadata: {
          sourceId: "source-1",
          eventId: "event-semantic",
          summary: "The elder bought vegetables at the market.",
          createdAt: now,
        },
      },
      {
        memory: "Provider-only semantic result without PostgreSQL metadata must not become final evidence.",
        score: 0.95,
      },
      {
        memory: "Semantic result with source id but no PostgreSQL summary must not become final evidence.",
        score: 0.9,
        metadata: {
          sourceId: "source-1",
          eventId: "event-semantic-no-summary",
        },
      },
    ];

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "What did I buy?",
      now,
    });

    expect(answer.answerText).toContain("vegetables");
    expect(answer.retrievedEvidence.some((item) => item.retrievalSource === "semantic")).toBe(true);
    expect(answer.retrievedEvidence.some((item) => item.summary === "The elder bought vegetables at the market.")).toBe(true);
    expect(answer.retrievedEvidence.some((item) => item.summary.includes("Provider-only semantic"))).toBe(false);
    expect(harness.audit.records.at(-1)?.type).toBe("memory_query");
    expect(harness.audit.records.at(-1)?.payload.retrieval).toEqual(
      expect.objectContaining({
        semanticCount: 3,
        semanticMetadataCount: 1,
        semanticUnlinkedCount: 2,
      }),
    );

    harness.model.parsedQuery = { intent: "not-valid" } as unknown as ParsedMemoryQuery;
    await expect(
      harness.kernel.queryMemory({
        elderId: "elder-1",
        query: "This should fail validation",
        now,
      }),
    ).rejects.toThrow();
  });

  it("keeps final matched sources bound to retrieved evidence", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["shopping"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answer = {
      answerText: "您买了青菜。",
      confidence: 0.9,
      matchedSources: [{
        sourceId: "source-hallucinated",
        createdAt: now,
        summary: "模型编造的来源。",
        canPlayAudio: true,
      }],
      retrievedEvidence: [],
      suggestedActions: [],
    };
    harness.eventStore.searchResults = [
      memoryEvent({
        id: "event-shopping",
        sourceId: "source-shopping",
        type: "shopping",
        title: "买青菜",
        summary: "老人买了青菜。",
      }),
    ];

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "我买了什么？",
      now,
    });

    expect(answer.matchedSources).toEqual([
      expect.objectContaining({ sourceId: "source-shopping", summary: "老人买了青菜。" }),
    ]);
    expect(answer.matchedSources.some((source) => source.sourceId === "source-hallucinated")).toBe(false);
  });

  it("falls back to evidence-bound answers when answer generation schema validation fails", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["shopping"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answerError = new ModelGatewayError("schema_validation_error", "bad answer shape");
    harness.eventStore.searchResults = [
      memoryEvent({
        id: "event-shopping",
        sourceId: "source-shopping",
        type: "shopping",
        title: "买青菜",
        summary: "老人买了青菜。",
      }),
    ];

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "我买了什么？",
      now,
    });

    expect(answer.answerText).toContain("老人买了青菜");
    expect(answer.matchedSources).toEqual([
      expect.objectContaining({ sourceId: "source-shopping", summary: "老人买了青菜。" }),
    ]);
    expect(harness.audit.records.some((record) => record.type === "memory_query_answer_generation_failed")).toBe(true);
    expect(harness.audit.records.at(-1)?.type).toBe("memory_query");
  });

  it("routes elder turns to memory writes without frontend intent branching", async () => {
    const harness = createHarness(buildPlan({
      summary: "老人买了青菜。",
      events: [buildEvent({ title: "买青菜", summary: "老人买了青菜。", type: "shopping" })],
    }));
    harness.model.turnPlan = {
      intent: "record",
      confidence: 0.9,
      recordText: "我今天买了青菜。",
    };

    const result = await harness.kernel.elderTurn({
      elderId: "elder-1",
      text: "我今天买了青菜。",
      now,
    });

    expect(result.turnType).toBe("record");
    expect(result.ingestResult?.summary).toBe("老人买了青菜。");
    expect(result.answer).toBeUndefined();
    expect(harness.sourceStore.sources).toHaveLength(1);
    expect(harness.audit.records.at(-1)?.type).toBe("elder_turn");
  });

  it("routes elder turns to recall with evidence-bound answers", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.model.turnPlan = {
      intent: "recall",
      confidence: 0.9,
      queryText: "我买了什么？",
    };
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["shopping"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answer = {
      answerText: "您买了青菜。",
      confidence: 0.9,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };
    harness.eventStore.searchResults = [
      memoryEvent({
        id: "event-shopping",
        sourceId: "source-shopping",
        type: "shopping",
        title: "买青菜",
        summary: "老人买了青菜。",
      }),
    ];

    const result = await harness.kernel.elderTurn({
      elderId: "elder-1",
      text: "我买了什么？",
      now,
    });

    expect(result.turnType).toBe("recall");
    expect(result.answer?.answerText).toBe("您买了青菜。");
    expect(result.ingestResult).toBeUndefined();
    expect(harness.sourceStore.sources).toHaveLength(0);
  });

  it("does not write truth when elder turn planning falls back to clarify", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.model.turnError = new ModelGatewayError("schema_validation_error", "bad turn plan");

    const result = await harness.kernel.elderTurn({
      elderId: "elder-1",
      text: "这个呢？",
      now,
    });

    expect(result.turnType).toBe("clarify");
    expect(harness.sourceStore.sources).toHaveLength(0);
    expect(harness.audit.records.some((record) => record.type === "elder_turn_plan_failed")).toBe(true);
    expect(harness.audit.records.at(-1)?.type).toBe("elder_turn");
  });

  it("uses source-aligned Graphiti evidence in queryMemory", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.facts = [
      {
        retrievalSource: "graphiti",
        origin: "graphiti_raw",
        sourceId: "source-graphiti",
        eventId: "event-graphiti",
        episodeId: "episode-graphiti",
        entityNames: ["降压药"],
        fact: "降压药用法后来从早饭后改成晚饭后。",
        validFrom: now,
        score: 0.86,
        reason: "Graphiti matched medication change history.",
      },
    ];
    const harness = createHarness(buildPlan({ summary: "No-op plan." }), temporalMemory);
    harness.sourceStore.sources.push({
      id: "source-graphiti",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "text",
      transcript: "张医生后来把降压药改成晚饭后一片。",
      createdAt: now,
    });
    harness.eventStore.events.push(memoryEvent({
      id: "event-graphiti",
      sourceId: "source-graphiti",
      type: "medication",
      title: "降压药用法调整",
      summary: "降压药用法后来从早饭后改成晚饭后。",
    }));
    harness.eventStore.searchResults = [];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["medication"],
      safetyTags: [],
      entities: [{ type: "medicine", name: "降压药", confidence: 0.8 }],
      timeRange: {
        start: "2026-05-10T00:00:00.000Z",
        end: "2026-05-11T00:00:00.000Z",
        confidence: 0.5,
      },
    };
    harness.model.answer = {
      answerText: "我找到一条长期关系记忆：降压药用法后来改成晚饭后。",
      confidence: 0.78,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "降压药后来有没有改过？",
      now,
    });

    expect(answer.retrievedEvidence).toEqual([
      expect.objectContaining({
        retrievalSource: "graphiti",
        sourceId: "source-graphiti",
        eventId: "event-graphiti",
        summary: "降压药用法后来从早饭后改成晚饭后。",
      }),
    ]);
    expect(temporalMemory.searches[0]?.timeRange).toEqual({
      start: "2026-05-10T00:00:00.000Z",
      end: "2026-05-11T00:00:00.000Z",
    });
    expect(temporalMemory.searches[0]?.timeRange).not.toHaveProperty("confidence");
    expect(harness.audit.records.at(-1)?.payload.retrieval).toMatchObject({
      graphitiCount: 1,
      graphitiAlignedCount: 1,
      graphitiRawCount: 1,
      graphitiRawAlignedCount: 1,
      evidenceCount: 1,
    });
  });

  it("labels Graphiti provenance fallback separately from raw temporal evidence", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.facts = [
      {
        retrievalSource: "graphiti",
        origin: "provenance_fallback",
        sourceId: "source-provenance",
        eventId: "event-provenance",
        episodeId: "episode-provenance",
        entityNames: ["降压药"],
        fact: "降压药相关 episode provenance 命中了查询。",
        validFrom: now,
        score: 0.72,
        reason: "Matched Graphiti episode provenance index.",
      },
    ];
    const harness = createHarness(buildPlan({ summary: "No-op plan." }), temporalMemory);
    harness.sourceStore.sources.push({
      id: "source-provenance",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "text",
      transcript: "降压药后来改成晚饭后。",
      createdAt: now,
    });
    harness.eventStore.events.push(memoryEvent({
      id: "event-provenance",
      sourceId: "source-provenance",
      type: "medication",
      title: "降压药用法调整",
      summary: "降压药后来改成晚饭后。",
    }));
    harness.eventStore.searchResults = [];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["medication"],
      safetyTags: [],
      entities: [{ type: "medicine", name: "降压药", confidence: 0.8 }],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "降压药后来有没有改过？",
      now,
    });

    expect(answer.retrievedEvidence).toEqual([
      expect.objectContaining({
        retrievalSource: "graphiti_provenance",
        sourceId: "source-provenance",
        eventId: "event-provenance",
      }),
    ]);
    expect(harness.audit.records.at(-1)?.payload.retrieval).toMatchObject({
      graphitiCount: 1,
      graphitiAlignedCount: 1,
      graphitiProvenanceCount: 1,
      graphitiProvenanceAlignedCount: 1,
    });
  });

  it("queries Graphiti for same-event relationship questions", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.facts = [
      {
        retrievalSource: "graphiti",
        origin: "graphiti_raw",
        sourceId: "source-meal",
        eventId: "event-meal",
        episodeId: "episode-meal",
        entityNames: ["老街面馆"],
        fact: "下周三吃饭提醒和医院复查可能是不同事项。",
        validFrom: now,
        score: 0.74,
        reason: "Graphiti matched same-event relationship question.",
      },
    ];
    const harness = createHarness(buildPlan({ summary: "No-op plan." }), temporalMemory);
    harness.sourceStore.sources.push({
      id: "source-meal",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "text",
      transcript: "下周三想去老街面馆吃饭。",
      createdAt: now,
    });
    harness.eventStore.events.push(memoryEvent({
      id: "event-meal",
      sourceId: "source-meal",
      type: "general",
      title: "老街面馆吃饭",
      summary: "下周三想去老街面馆吃饭。",
    }));
    harness.eventStore.searchResults = [];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "下周三下午三点那个吃饭提醒和医院复查是一回事吗？",
      now,
    });

    expect(temporalMemory.searches).toHaveLength(1);
    expect(answer.retrievedEvidence).toEqual([
      expect.objectContaining({
        retrievalSource: "graphiti",
        sourceId: "source-meal",
        eventId: "event-meal",
      }),
    ]);
  });

  it("does not query Graphiti for simple daily recall", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.facts = [
      {
        retrievalSource: "graphiti",
        origin: "graphiti_raw",
        sourceId: "source-graphiti",
        episodeId: "episode-graphiti",
        entityNames: [],
        fact: "这条长期关系记忆不应该参与简单当天回忆。",
        validFrom: now,
        score: 0.9,
        reason: "Should be gated out.",
      },
    ];
    const harness = createHarness(buildPlan({ summary: "No-op plan." }), temporalMemory);
    harness.eventStore.searchResults = [];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "今天我说过什么？",
      now,
    });

    expect(temporalMemory.searches).toHaveLength(0);
    expect(answer.confidence).toBe(0);
    expect(harness.model.answerCalls).toBe(0);
  });

  it("queries Graphiti for fraud and identity risk chain questions even when query parsing is generic", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.facts = [
      {
        retrievalSource: "graphiti",
        origin: "graphiti_raw",
        sourceId: "source-fraud",
        eventId: "event-fraud",
        episodeId: "episode-fraud",
        entityNames: ["验证码", "身份证号"],
        fact: "陌生人要求发送身份证号和验证码，属于疑似诈骗风险链。",
        validFrom: now,
        score: 0.88,
        reason: "Graphiti matched fraud risk history.",
      },
    ];
    const harness = createHarness(buildPlan({ summary: "No-op plan." }), temporalMemory);
    harness.sourceStore.sources.push({
      id: "source-fraud",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "text",
      transcript: "陌生人说帮我办补贴，让我发身份证号和验证码。",
      createdAt: now,
    });
    harness.eventStore.events.push(memoryEvent({
      id: "event-fraud",
      sourceId: "source-fraud",
      type: "finance",
      title: "疑似诈骗风险",
      summary: "陌生人要求发送身份证号和验证码。",
      riskLevel: "fraud_risk",
    }));
    harness.eventStore.searchResults = [];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answer = {
      answerText: "他让你发身份证号和验证码，这不安全。",
      confidence: 0.86,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
      safetyNote: "请先不要发送敏感信息。",
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "那个补贴的人让我发验证码，安全吗？",
      now,
    });

    expect(temporalMemory.searches).toHaveLength(1);
    expect(answer.retrievedEvidence).toEqual([
      expect.objectContaining({
        retrievalSource: "graphiti",
        sourceId: "source-fraud",
        eventId: "event-fraud",
      }),
    ]);
    expect(answer.answerText).toContain("家人");
    expect(answer.safetyNote).toContain("家人");
  });

  it("does not trigger query safety from sensitive words without structured risk metadata", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    const event = memoryEvent({
      id: "event-normal-code",
      sourceId: "source-normal-code",
      type: "general",
      title: "门禁验证码",
      summary: "老人说门禁验证码贴在冰箱旁边。",
      riskLevel: "normal",
    });
    harness.sourceStore.sources.push({
      id: "source-normal-code",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "text",
      transcript: "门禁验证码贴在冰箱旁边。",
      createdAt: now,
    });
    harness.eventStore.events.push(event);
    harness.eventStore.searchResults = [event];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answer = {
      answerText: "门禁验证码贴在冰箱旁边。",
      confidence: 0.8,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "门禁验证码在哪里？",
      now,
    });

    expect(answer.answerText).toBe("门禁验证码贴在冰箱旁边。");
    expect(answer.safetyNote).toBeUndefined();
  });

  it("drops Graphiti evidence that cannot be verified against PostgreSQL tenant and elder source records", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.facts = [
      {
        retrievalSource: "graphiti",
        origin: "graphiti_raw",
        sourceId: "source-other-tenant",
        eventId: "event-other-tenant",
        episodeId: "episode-other",
        entityNames: ["社区医院"],
        fact: "社区医院复查后来改期了。",
        validFrom: now,
        score: 0.9,
        reason: "Cross-tenant fact must be ignored.",
      },
    ];
    const harness = createHarness(buildPlan({ summary: "No-op plan." }), temporalMemory);
    harness.sourceStore.sources.push({
      id: "source-other-tenant",
      tenantId: "tenant-b",
      elderId: "elder-1",
      type: "text",
      transcript: "其他租户的复查记录。",
      createdAt: now,
    });
    harness.eventStore.events.push(memoryEvent({
      id: "event-other-tenant",
      tenantId: "tenant-b",
      sourceId: "source-other-tenant",
      type: "appointment",
      title: "其他租户复查",
      summary: "其他租户的社区医院复查改期。",
    }));
    harness.eventStore.searchResults = [];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["appointment"],
      safetyTags: [],
      entities: [{ type: "place", name: "社区医院", confidence: 0.8 }],
    };

    const answer = await harness.kernel.queryMemory({
      tenantId: "tenant-a",
      elderId: "elder-1",
      query: "社区医院复查后来有没有改期？",
      now,
    });

    expect(temporalMemory.searches).toHaveLength(1);
    expect(answer.confidence).toBe(0);
    expect(harness.audit.records.at(-1)?.payload.retrieval).toMatchObject({
      graphitiCount: 1,
      graphitiAlignedCount: 0,
      evidenceCount: 0,
    });
  });

  it("keeps semantic recall isolated by tenant even when elder ids match", async () => {
    const harness = createHarness(buildPlan({
      summary: "Tenant scoped memory.",
      events: [buildEvent({ title: "租户A记录", summary: "租户A说周五去社区医院。" })],
    }));
    await harness.kernel.ingestText({
      tenantId: "tenant-a",
      elderId: "elder-1",
      transcript: "周五去社区医院。",
    });

    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [],
    };
    harness.eventStore.searchResults = [];

    const answer = await harness.kernel.queryMemory({
      tenantId: "tenant-b",
      elderId: "elder-1",
      query: "我周五要去哪里？",
      now,
    });

    expect(answer.confidence).toBe(0);
    expect(harness.model.answerCalls).toBe(0);
  });

  it("returns a safe answer without calling answer generation when no evidence exists", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.eventStore.searchResults = [];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: [],
      safetyTags: [],
      entities: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "What happened yesterday?",
      now,
      traceId: "trace-query-no-evidence",
    });

    expect(answer.traceId).toBe("trace-query-no-evidence");
    expect(answer.confidence).toBe(0);
    expect(answer.safetyNote).toContain("没有找到可引用的来源依据");
    expect(harness.model.answerCalls).toBe(0);
    expect(harness.audit.records.at(-1)).toMatchObject({
      traceId: "trace-query-no-evidence",
      payload: expect.objectContaining({
        traceId: "trace-query-no-evidence",
        failureType: "no_evidence",
      }),
    });
  });

  it("keeps persisted context links out of final query evidence", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    const noodleEvent = memoryEvent({
      id: "event-noodle",
      sourceId: "source-noodle",
      title: "下周一吃当地特色面条",
      summary: "老人说下周一准备出门吃当地特色面条，可能需要提醒，但没说具体几点。",
    });
    const timeEvent = memoryEvent({
      id: "event-time",
      sourceId: "source-time",
      title: "下午三点提醒",
      summary: "老人补充说大约下午三点需要提醒。",
    });
    harness.eventStore.events.push(noodleEvent, timeEvent);
    harness.eventStore.searchResults = [noodleEvent];
    harness.contextLinkStore.links.push({
      id: "link-1",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      fromEventId: "event-time",
      toEventId: "event-noodle",
      reminderId: "reminder-noodle",
      type: "fills_missing_time",
      status: "needs_confirmation",
      confidence: 0.68,
      reason: "下午三点可能是补充下周一吃面条提醒的时间，需要确认。",
      evidence: [evidence()],
      createdAt: now,
    });
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "check_reminder",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answer = {
      answerText: "下周一吃特色面条有一条可能相关的下午3点提醒，但需要确认。",
      confidence: 0.76,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "我下周一出门吃面条有说几点吗？",
      now,
    });

    expect(answer.retrievedEvidence).toEqual([
      expect.objectContaining({ eventId: "event-noodle", retrievalSource: "postgres" }),
    ]);
    expect(answer.retrievedEvidence.some((item) => item.retrievalSource === "context_link")).toBe(false);
    expect(harness.contextLinkStore.links).toHaveLength(1);
    expect(harness.audit.records.at(-1)?.payload?.retrieval).toMatchObject({ contextLinkCount: 0 });
  });

  it("does not append context-link notes when generated answers omit linked event details", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    const noodleEvent = memoryEvent({
      id: "event-noodle",
      sourceId: "source-noodle",
      title: "下周一吃当地特色面条",
      summary: "老人说下周一准备出门吃当地特色面条，可能需要提醒，但没说具体几点。",
    });
    const timeEvent = memoryEvent({
      id: "event-time",
      sourceId: "source-time",
      title: "下午三点提醒",
      summary: "老人补充说大约下午三点需要提醒。",
    });
    harness.eventStore.events.push(noodleEvent, timeEvent);
    harness.eventStore.searchResults = [noodleEvent];
    harness.contextLinkStore.links.push({
      id: "link-1",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      fromEventId: "event-time",
      toEventId: "event-noodle",
      reminderId: "reminder-noodle",
      type: "fills_missing_time",
      status: "needs_confirmation",
      confidence: 0.68,
      reason: "下午三点可能是补充下周一吃面条提醒的时间，需要确认。",
      evidence: [evidence()],
      createdAt: now,
    });
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "check_reminder",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answer = {
      answerText: "有提到时间，像是大约下午三点，但还不算很确定。",
      confidence: 0.76,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "我下周一出门吃面条有说几点吗？",
      now,
    });

    expect(answer.answerText).toBe("有提到时间，像是大约下午三点，但还不算很确定。");
    expect(answer.answerText).not.toContain("补充说明");
    expect(answer.retrievedEvidence.some((item) => item.retrievalSource === "context_link")).toBe(false);
  });

  it("does not append context-link notes to ordinary PostgreSQL answers", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.eventStore.searchResults = [
      memoryEvent({
        id: "event-shopping",
        sourceId: "source-shopping",
        title: "买牙膏",
        summary: "老人说要买牙膏。",
      }),
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["shopping"],
      safetyTags: [],
      entities: [],
    };
    harness.model.answer = {
      answerText: "您说要买牙膏。",
      confidence: 0.8,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "我说要买什么？",
      now,
    });

    expect(answer.answerText).toBe("您说要买牙膏。");
  });

  it("uses event type as a ranking signal instead of a hard recall filter", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.eventStore.searchResults = [
      {
        id: "event-city-shopping",
        tenantId: "tenant-mvp",
        elderId: "elder-1",
        sourceId: "source-1",
        type: "shopping",
        title: "上午去城里买生活用品",
        summary: "老人说上午去一趟城里，想买生活用品，比如牙膏。",
        timeConfidence: 0.5,
        entities: [{ type: "place", name: "城里", aliases: [], confidence: 0.8 }],
        importance: 0.6,
        confidence: 0.8,
        riskLevel: "normal",
        requiresConfirmation: false,
        visibility: "private",
        evidence: [evidence()],
        status: "active",
        createdAt: now,
      },
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [{ type: "place", name: "城里", confidence: 0.5 }],
    };
    harness.model.answer = {
      answerText: "您说过去城里买生活用品，比如牙膏。",
      confidence: 0.8,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "我说过去城里做什么吗",
      now,
    });

    expect(answer.answerText).toContain("生活用品");
    expect(answer.retrievedEvidence[0]?.retrievalSource).toBe("postgres");
    expect(harness.model.answerCalls).toBe(1);
    const auditPayload = harness.audit.records.at(-1)?.payload;
    expect(auditPayload?.retrieval).toMatchObject({ postgresCount: 1, evidenceCount: 1 });
    expect(auditPayload?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "event-city-shopping",
          summary: "老人说上午去一趟城里，想买生活用品，比如牙膏。",
        }),
      ]),
    );
  });

  it("uses parsed time ranges as a structured evidence ranking signal", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.eventStore.searchResults = [
      memoryEvent({
        id: "event-yesterday",
        sourceId: "source-yesterday",
        type: "general",
        title: "昨天散步",
        summary: "老人昨天傍晚散步。",
        eventTimeStart: "2026-05-08T09:00:00.000Z",
        importance: 0.6,
        confidence: 0.8,
      }),
      memoryEvent({
        id: "event-today",
        sourceId: "source-today",
        type: "general",
        title: "今天散步",
        summary: "老人今天上午散步。",
        eventTimeStart: "2026-05-09T09:00:00.000Z",
        importance: 0.6,
        confidence: 0.8,
      }),
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      eventTypes: ["general"],
      safetyTags: [],
      entities: [],
      timeRange: {
        start: "2026-05-09T00:00:00.000Z",
        end: "2026-05-09T23:59:59.999Z",
        confidence: 0.9,
      },
    };
    harness.model.answer = {
      answerText: "今天上午散步。",
      confidence: 0.8,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "今天做了什么",
      now,
    });

    expect(answer.retrievedEvidence[0]).toEqual(expect.objectContaining({ eventId: "event-today" }));
  });

  it("audits failed ingests before creating business records", async () => {
    const harness = createHarness(buildPlan({ summary: "Invalid plan." }));
    harness.model.plan = { invalid: true } as unknown as MemoryPlan;

    await expect(
      harness.kernel.ingestText({
        elderId: "elder-1",
        transcript: "This should fail schema validation.",
      }),
    ).rejects.toThrow();

    expect(harness.eventStore.events).toHaveLength(0);
    expect(harness.reminderStore.reminders).toHaveLength(0);
    expect(harness.riskFlags.flags).toHaveLength(0);
    expect(harness.familyTasks.tasks).toHaveLength(0);
    expect(harness.audit.records.some((record) => record.type === "memory_ingest_failed")).toBe(true);
  });

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
