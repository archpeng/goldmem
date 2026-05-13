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

describe("ElderMemoryKernel ingest", () => {
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
    expect(harness.memoryProcessingJobStore.jobs.filter((job) => job.type === "semantic_index_event")).toHaveLength(1);
    await harness.kernel.processMemoryProcessingJobs({ now, types: ["semantic_index_event"] });
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
});
