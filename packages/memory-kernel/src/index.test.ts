import { describe, expect, it } from "vitest";
import { ElderMemoryKernel, type ElderMemoryKernelDeps } from "./index.js";
import type {
  FamilyTask,
  ElderTurnPlan,
  MemoryAnswer,
  MemoryContextLink,
  MemoryEvent,
  MemoryPlan,
  MemorySource,
  ParsedMemoryQuery,
  PersonalContext,
  Reminder,
} from "@goldmem/memory-schema";
import { ModelGatewayError, type GenerateMemoryPlanInput, type ModelGateway, type PlanElderTurnInput, type TranscriptionResult } from "@goldmem/model-gateway";
import type {
  AuditLog,
  ContextLinkStore,
  CreateContextLinkInput,
  CreateEventInput,
  CreateFamilyReminderCommandInput,
  CreateFamilyReminderCommandResult,
  CreateReminderInput,
  CreateRiskFlagInput,
  CreateSourceInput,
  EventStore,
  FamilyReminderCommandStore,
  FamilyTaskStore,
  MemoryRecallResult,
  PersonalContextStore,
  ReminderStore,
  RiskFlagStore,
  SemanticMemoryStore,
  SourceStore,
  TemporalMemoryJob,
  TemporalMemoryJobStore,
} from "@goldmem/memory-store";
import { DefaultPermissionEngine } from "@goldmem/permission-engine";
import { DefaultReminderEngine } from "@goldmem/reminder-engine";
import { DefaultRiskEngine } from "@goldmem/risk-engine";
import { NullTemporalMemoryStore, type AddTemporalEpisodeInput, type TemporalEvidence, type TemporalMemoryStore } from "@goldmem/temporal-memory";

const now = "2026-05-09T12:00:00.000Z";

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
        reminderCandidates: [
          buildReminderCandidate({
            title: "Take a walk",
            timeText: "later",
            remindAt: undefined,
            timeConfidence: 0.3,
            confirmationRequired: false,
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
    expect(harness.familyTasks.tasks[0]?.type).toBe("reminder_confirm");
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
        events: [buildEvent({ title: "医院复查", summary: "周五下午去医院复查，需要带医保卡。", type: "appointment" })],
      }),
      temporalMemory,
    );

    const result = await harness.kernel.ingestText({
      tenantId: "tenant-a",
      elderId: "elder-1",
      transcript: "周五下午去医院复查，别忘了医保卡。",
    });

    expect(result.temporalMemory.status).toBe("written");
    expect(temporalMemory.episodes).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        elderId: "elder-1",
        groupId: "tenant_tenant-a__elder_elder-1",
        sourceIds: ["source-1"],
        eventIds: ["event-1"],
      }),
    ]);
    expect(harness.audit.records.at(-1)?.payload.result).toMatchObject({ temporalMemory: { status: "written" } });
  });

  it("surfaces Graphiti write failure without rolling back PostgreSQL truth", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.failAdd = true;
    const harness = createHarness(
      buildPlan({
        summary: "Medication changed.",
        events: [buildEvent({ title: "药物调整", summary: "医生说药物用法可能有调整。", type: "medication", riskLevel: "medical" })],
      }),
      temporalMemory,
    );

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "医生说这个药可能要调整。",
    });

    expect(result.events).toHaveLength(1);
    expect(result.temporalMemory.status).toBe("failed");
    expect(result.temporalMemory.retryQueued).toBe(true);
    expect(result.temporalMemory.retryJobId).toBe("temporal-job-1");
    expect(harness.temporalMemoryJobStore.jobs).toEqual([
      expect.objectContaining({
        id: "temporal-job-1",
        tenantId: "tenant-mvp",
        elderId: "elder-1",
        sourceId: "source-1",
        status: "pending",
        episode: expect.objectContaining({
          metadata: expect.objectContaining({ traceId: result.traceId }),
        }),
      }),
    ]);
    expect(harness.audit.records.some((record) => record.type === "graphiti_write_failed" && record.traceId === result.traceId)).toBe(true);
    expect(harness.audit.records.at(-1)?.type).toBe("memory_ingest");
  });

  it("audits out-of-range reminder event references", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Reminder references a missing event.",
        reminderCandidates: [
          buildReminderCandidate({
            title: "Call daughter",
            relatedEventIndex: 3,
            confirmationRequired: false,
          }),
        ],
      }),
    );

    await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "Remind me to call my daughter tomorrow.",
    });

    expect(harness.audit.records.some((record) => record.type === "memory_plan_warning")).toBe(true);
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

  it("passes Mem0 semantic candidate events into memory plan context without using graph relations", async () => {
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
        memory: "A compressed Mem0 fact.",
        score: 0.8,
        metadata: {
          sourceId: "source-1",
          eventId: "event-semantic",
          summary: "The elder bought vegetables at the market.",
          createdAt: now,
        },
        retrievalSignals: { semanticScore: 0.8, keywordScore: 0.4 },
      },
      {
        memory: "Provider-only Mem0 result without PostgreSQL metadata must not become final evidence.",
        score: 0.95,
        provider: "mem0",
        retrievalSignals: { entityScore: 0.9, rerankScore: 0.85 },
      },
    ];

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "What did I buy?",
      now,
    });

    expect(answer.answerText).toContain("vegetables");
    expect(answer.retrievedEvidence.some((item) => item.retrievalSource === "mem0")).toBe(true);
    expect(answer.retrievedEvidence.some((item) => item.summary === "The elder bought vegetables at the market.")).toBe(true);
    expect(answer.retrievedEvidence.some((item) => item.summary.includes("Provider-only Mem0"))).toBe(false);
    expect(harness.audit.records.at(-1)?.type).toBe("memory_query");
    expect(harness.audit.records.at(-1)?.payload.retrieval).toEqual(
      expect.objectContaining({
        mem0Count: 2,
        mem0MetadataCount: 1,
        mem0UnlinkedCount: 1,
        mem0SignalCount: 2,
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
      entities: [{ type: "medicine", name: "降压药", confidence: 0.8 }],
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
    expect(harness.audit.records.at(-1)?.payload.retrieval).toMatchObject({
      graphitiCount: 1,
      graphitiAlignedCount: 1,
      evidenceCount: 1,
    });
  });

  it("does not query Graphiti for simple daily recall", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.facts = [
      {
        retrievalSource: "graphiti",
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
      entities: [],
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
  });

  it("drops Graphiti evidence that cannot be verified against PostgreSQL tenant and elder source records", async () => {
    const temporalMemory = new RecordingTemporalMemoryStore();
    temporalMemory.facts = [
      {
        retrievalSource: "graphiti",
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

  it("keeps Mem0 recall isolated by tenant even when elder ids match", async () => {
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
    expect(answer.safetyNote).toContain("No source evidence");
    expect(harness.model.answerCalls).toBe(0);
    expect(harness.audit.records.at(-1)).toMatchObject({
      traceId: "trace-query-no-evidence",
      payload: expect.objectContaining({
        traceId: "trace-query-no-evidence",
        failureType: "no_evidence",
      }),
    });
  });

  it("expands query evidence through persisted context links", async () => {
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

    expect(answer.retrievedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: "event-noodle", retrievalSource: "postgres" }),
        expect.objectContaining({
          eventId: "event-time",
          retrievalSource: "context_link",
          summary: expect.stringContaining("下午三点"),
        }),
      ]),
    );
    expect(harness.audit.records.at(-1)?.payload?.retrieval).toMatchObject({ contextLinkCount: 2 });
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

function createHarness(plan: MemoryPlan, temporalMemory: TemporalMemoryStore = new NullTemporalMemoryStore()) {
  const sourceStore = new InMemorySourceStore();
  const eventStore = new InMemoryEventStore();
  const reminderStore = new InMemoryReminderStore();
  const audit = new InMemoryAuditLog();
  const familyReminderCommands = new InMemoryFamilyReminderCommandStore(sourceStore, reminderStore, audit);
  const familyTasks = new InMemoryFamilyTaskStore();
  const riskFlags = new InMemoryRiskFlagStore();
  const contextLinkStore = new InMemoryContextLinkStore(eventStore);
  const semanticMemory = new InMemorySemanticMemoryStore();
  const temporalMemoryJobStore = new InMemoryTemporalMemoryJobStore();
  const personalContextStore = new FakePersonalContextStore();
  const model = new FakeModelGateway(plan);

  const deps: ElderMemoryKernelDeps = {
    sourceStore,
    eventStore,
    contextLinkStore,
    reminderEngine: new DefaultReminderEngine(reminderStore),
    familyReminderCommandStore: familyReminderCommands,
    familyTaskStore: familyTasks,
    riskFlagStore: riskFlags,
    semanticMemory,
    personalContextStore,
    modelGateway: model,
    riskEngine: new DefaultRiskEngine(),
    permissionEngine: new DefaultPermissionEngine(),
    auditLog: audit,
    temporalMemory,
    temporalMemoryJobStore,
  };

  return {
    kernel: new ElderMemoryKernel(deps),
    sourceStore,
    eventStore,
    reminderStore,
    familyReminderCommands,
    contextLinkStore,
    familyTasks,
    riskFlags,
    semanticMemory,
    audit,
    temporalMemoryJobStore,
    personalContextStore,
    model,
  };
}

function buildPlan(input: Partial<MemoryPlan>): MemoryPlan {
  return {
    tenantId: input.tenantId ?? "tenant-mvp",
    sourceId: "source-1",
    elderId: "elder-1",
    summary: input.summary ?? "Summary",
    events: input.events ?? [],
    reminderCandidates: input.reminderCandidates ?? [],
    riskFlags: input.riskFlags ?? [],
    familyTasks: input.familyTasks ?? [],
    contextLinks: input.contextLinks ?? [],
    memoryUpdates: input.memoryUpdates ?? [],
    uncertainties: input.uncertainties ?? [],
    evidence: input.evidence ?? [evidence()],
    modelInfo: input.modelInfo ?? {
      provider: "fake",
      model: "fake-memory-plan",
      promptVersion: "test",
    },
    confidence: input.confidence ?? 0.9,
  };
}

function memoryEvent(input: Partial<MemoryEvent>): MemoryEvent {
  return {
    id: input.id ?? "event-existing",
    tenantId: input.tenantId ?? "tenant-mvp",
    elderId: input.elderId ?? "elder-1",
    sourceId: input.sourceId ?? "source-existing",
    type: input.type ?? "general",
    title: input.title ?? "Existing event",
    summary: input.summary ?? "Existing event summary.",
    timeText: input.timeText,
    eventTimeStart: input.eventTimeStart,
    eventTimeEnd: input.eventTimeEnd,
    timeConfidence: input.timeConfidence ?? 0.7,
    entities: input.entities ?? [],
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.8,
    riskLevel: input.riskLevel ?? "normal",
    requiresConfirmation: input.requiresConfirmation ?? false,
    visibility: input.visibility ?? "private",
    evidence: input.evidence ?? [evidence()],
    status: input.status ?? "active",
    createdAt: input.createdAt ?? now,
  };
}

function buildEvent(input: Partial<MemoryPlan["events"][number]>): MemoryPlan["events"][number] {
  return {
    type: input.type ?? "general",
    title: input.title ?? "Event",
    summary: input.summary ?? "Event summary.",
    timeText: input.timeText,
    eventTimeStart: input.eventTimeStart,
    eventTimeEnd: input.eventTimeEnd,
    timeConfidence: input.timeConfidence ?? 0.8,
    entities: input.entities ?? [],
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.8,
    riskLevel: input.riskLevel ?? "normal",
    requiresConfirmation: input.requiresConfirmation ?? false,
    visibility: input.visibility ?? "private",
    evidence: input.evidence ?? [evidence()],
  };
}

function buildReminderCandidate(
  input: Partial<MemoryPlan["reminderCandidates"][number]>,
): MemoryPlan["reminderCandidates"][number] {
  return {
    title: input.title ?? "Reminder",
    description: input.description,
    timeText: input.timeText ?? "tomorrow",
    remindAt: input.remindAt ?? "2026-05-10T09:00:00.000Z",
    timeConfidence: input.timeConfidence ?? 0.9,
    relatedEventIndex: input.relatedEventIndex,
    confirmationRequired: input.confirmationRequired ?? false,
    suggestedConfirmers: input.suggestedConfirmers ?? [],
    confidence: input.confidence ?? 0.8,
    reason: input.reason ?? "The transcript requested a reminder.",
  };
}

function evidence() {
  return {
    sourceId: "source-1",
    quote: "source quote",
    startChar: 0,
    endChar: 12,
  };
}

class FakeModelGateway implements ModelGateway {
  answerCalls = 0;
  answerError?: Error;
  turnError?: Error;
  lastPlanContext?: PersonalContext;
  lastTurnInput?: PlanElderTurnInput;

  turnPlan: ElderTurnPlan = {
    intent: "clarify",
    confidence: 0.5,
    clarifyingQuestion: "您想让我记住这件事，还是帮您查以前的记忆？",
  };

  parsedQuery: ParsedMemoryQuery = {
    intent: "unknown",
    requiresSourceEvidence: true,
    eventTypes: [],
    entities: [],
  };

  answer: MemoryAnswer = {
    answerText: "I found one memory.",
    confidence: 0.8,
    matchedSources: [],
    retrievedEvidence: [],
    suggestedActions: [],
  };

  constructor(public plan: MemoryPlan) {}

  async transcribe(): Promise<TranscriptionResult> {
    return { text: "transcribed text", confidence: 0.9 };
  }

  async generateMemoryPlan(input: GenerateMemoryPlanInput): Promise<MemoryPlan> {
    this.lastPlanContext = input.context;
    return this.plan;
  }

  async planElderTurn(input: PlanElderTurnInput): Promise<ElderTurnPlan> {
    this.lastTurnInput = input;
    if (this.turnError) throw this.turnError;
    return this.turnPlan;
  }

  async parseMemoryQuery(): Promise<ParsedMemoryQuery> {
    return this.parsedQuery;
  }

  async generateMemoryAnswer(): Promise<MemoryAnswer> {
    this.answerCalls += 1;
    if (this.answerError) throw this.answerError;
    return this.answer;
  }
}

class FakePersonalContextStore implements PersonalContextStore {
  context: PersonalContext = emptyContext();

  async buildContext(): Promise<PersonalContext> {
    return this.context;
  }
}

function emptyContext(): PersonalContext {
  return {
    recentEvents: [],
    semanticCandidateEvents: [],
    openReminders: [],
    semanticMemories: [],
    knownEntities: [],
    familyRelations: [],
    safetyPolicy: [],
  };
}

class InMemorySourceStore implements SourceStore {
  sources: MemorySource[] = [];

  async saveAudio(): Promise<string> {
    return "https://example.com/audio.wav";
  }

  async create(input: CreateSourceInput): Promise<MemorySource> {
    const source = { ...input, id: `source-${this.sources.length + 1}` };
    this.sources.push(source);
    return source;
  }

  async get(input: { tenantId: string; sourceId: string }): Promise<MemorySource | null> {
    return this.sources.find((source) => source.tenantId === input.tenantId && source.id === input.sourceId) ?? null;
  }
}

class InMemoryEventStore implements EventStore {
  events: MemoryEvent[] = [];
  searchResults?: MemoryEvent[];

  async create(input: CreateEventInput): Promise<MemoryEvent> {
    const event = {
      ...input,
      id: `event-${this.events.length + 1}`,
      createdAt: now,
    };
    this.events.push(event);
    return event;
  }

  async search(input: Parameters<EventStore["search"]>[0]): Promise<MemoryEvent[]> {
    return this.searchResults ?? this.events.filter((event) => event.tenantId === input.tenantId && event.elderId === input.elderId);
  }

  async getByIds(input: { tenantId: string; eventIds: string[] }): Promise<MemoryEvent[]> {
    return this.events.filter((event) => event.tenantId === input.tenantId && input.eventIds.includes(event.id));
  }
}

class InMemoryContextLinkStore implements ContextLinkStore {
  links: MemoryContextLink[] = [];

  constructor(private readonly eventStore: InMemoryEventStore) {}

  async create(input: CreateContextLinkInput): Promise<MemoryContextLink> {
    const fromEvent = this.eventStore.events.find((event) => event.id === input.fromEventId);
    const toEvent = this.eventStore.events.find((event) => event.id === input.toEventId);
    if (!fromEvent || !toEvent) throw new Error("Context link event reference not found");
    if (fromEvent.tenantId !== input.tenantId || toEvent.tenantId !== input.tenantId || fromEvent.elderId !== input.elderId || toEvent.elderId !== input.elderId) {
      throw new Error("Context link events must belong to the same tenant and elder");
    }
    const link = { ...input, id: `link-${this.links.length + 1}`, createdAt: now };
    this.links.push(link);
    return link;
  }

  async listByEventIds(input: { tenantId: string; elderId: string; eventIds: string[] }): Promise<MemoryContextLink[]> {
    const ids = new Set(input.eventIds);
    return this.links.filter(
      (link) => link.tenantId === input.tenantId && link.elderId === input.elderId && (ids.has(link.fromEventId) || ids.has(link.toEventId)),
    );
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<MemoryContextLink[]> {
    return this.links.filter((link) => link.tenantId === input.tenantId && link.elderId === input.elderId);
  }
}

class InMemoryReminderStore implements ReminderStore {
  reminders: Reminder[] = [];

  async create(input: CreateReminderInput): Promise<Reminder> {
    const reminder = {
      ...input,
      id: `reminder-${this.reminders.length + 1}`,
      createdAt: now,
    };
    this.reminders.push(reminder);
    return reminder;
  }

  async get(input: { tenantId: string; reminderId: string }): Promise<Reminder | null> {
    return this.reminders.find((reminder) => reminder.tenantId === input.tenantId && reminder.id === input.reminderId) ?? null;
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<Reminder[]> {
    return this.reminders.filter((reminder) => reminder.tenantId === input.tenantId && reminder.elderId === input.elderId);
  }

  async update(input: { tenantId: string; reminderId: string; patch: Partial<Reminder> }): Promise<Reminder> {
    const reminder = await this.get(input);
    if (!reminder) throw new Error(`Reminder not found: ${input.reminderId}`);
    Object.assign(reminder, input.patch);
    return reminder;
  }
}

class InMemoryFamilyReminderCommandStore implements FamilyReminderCommandStore {
  failReminderCreate = false;
  failAudit = false;
  private readonly commands = new Map<string, CreateFamilyReminderCommandResult>();

  constructor(
    private readonly sourceStore: InMemorySourceStore,
    private readonly reminderStore: InMemoryReminderStore,
    private readonly auditLog: InMemoryAuditLog,
  ) {}

  async create(input: CreateFamilyReminderCommandInput): Promise<CreateFamilyReminderCommandResult> {
    const commandKey = input.idempotencyKey
      ? `${input.source.tenantId}:${input.source.elderId}:${input.idempotencyKey}`
      : undefined;
    if (commandKey) {
      const existing = this.commands.get(commandKey);
      if (existing) return { ...existing, reused: true };
    }

    const sourceSnapshot = [...this.sourceStore.sources];
    const reminderSnapshot = [...this.reminderStore.reminders];
    const auditSnapshot = [...this.auditLog.records];
    try {
      const source = await this.sourceStore.create(input.source);
      if (this.failReminderCreate) throw new Error("Reminder command create failed");
      const reminder = await this.reminderStore.create({ ...input.reminder, sourceId: source.id });
      if (this.failAudit) throw new Error("Reminder command audit failed");
      await this.auditLog.record({
        ...input.audit,
        sourceId: source.id,
        payload: { ...input.audit.payload, sourceId: source.id, reminderId: reminder.id },
      });

      const result = { source, reminder, reused: false };
      if (commandKey) this.commands.set(commandKey, result);
      return result;
    } catch (error) {
      this.sourceStore.sources = sourceSnapshot;
      this.reminderStore.reminders = reminderSnapshot;
      this.auditLog.records = auditSnapshot;
      throw error;
    }
  }
}

class InMemoryFamilyTaskStore implements FamilyTaskStore {
  tasks: FamilyTask[] = [];

  async create(input: Parameters<FamilyTaskStore["create"]>[0]): Promise<FamilyTask> {
    const task: FamilyTask = {
      ...input,
      id: `task-${this.tasks.length + 1}`,
      type: input.type as FamilyTask["type"],
      urgency: input.urgency as FamilyTask["urgency"],
      visibility: input.visibility as FamilyTask["visibility"],
      status: "pending",
      createdAt: now,
    };
    this.tasks.push(task);
    return task;
  }

  async listPending(input: { tenantId: string; elderId: string }): Promise<FamilyTask[]> {
    return this.tasks.filter((task) => task.tenantId === input.tenantId && task.elderId === input.elderId && task.status === "pending");
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<FamilyTask[]> {
    return this.tasks.filter((task) => task.tenantId === input.tenantId && task.elderId === input.elderId);
  }

  async confirm(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "confirmed" });
  }

  async reject(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "rejected" });
  }

  async requestMoreInfo(input: { tenantId: string; taskId: string; actorUserId: string }): Promise<FamilyTask> {
    return this.updateStatus({ ...input, status: "needs_more_info" });
  }

  private updateStatus(input: {
    tenantId: string;
    taskId: string;
    actorUserId: string;
    status: FamilyTask["status"];
  }): FamilyTask {
    const task = this.tasks.find((item) => item.tenantId === input.tenantId && item.id === input.taskId);
    if (!task) throw new Error(`Family task not found: ${input.taskId}`);
    task.status = input.status;
    task.confirmedBy = input.actorUserId;
    task.confirmedAt = now;
    return task;
  }
}

class InMemoryRiskFlagStore implements RiskFlagStore {
  flags: CreateRiskFlagInput[] = [];

  async create(input: CreateRiskFlagInput) {
    this.flags.push(input);
    return { ...input, id: `risk-${this.flags.length}`, createdAt: now };
  }
}

class InMemorySemanticMemoryStore implements SemanticMemoryStore {
  memories: Array<Parameters<SemanticMemoryStore["addMemory"]>[0]> = [];
  searchResults?: MemoryRecallResult[];

  async addMemory(input: Parameters<SemanticMemoryStore["addMemory"]>[0]): Promise<void> {
    this.memories.push(input);
  }

  async searchMemory(input: Parameters<SemanticMemoryStore["searchMemory"]>[0]): Promise<MemoryRecallResult[]> {
    if (this.searchResults) return this.searchResults;
    return this.memories
      .filter((memory) => memory.tenantId === input.tenantId && memory.elderId === input.elderId)
      .map((memory) => ({
        memory: memory.memory,
        metadata: memory.metadata,
        score: 0.7,
      }));
  }
}

class RecordingTemporalMemoryStore implements TemporalMemoryStore {
  episodes: AddTemporalEpisodeInput[] = [];
  facts: TemporalEvidence[] = [];
  searches: Parameters<TemporalMemoryStore["searchFacts"]>[0][] = [];
  failAdd = false;

  async addEpisode(input: AddTemporalEpisodeInput): Promise<void> {
    if (this.failAdd) throw new Error("Graphiti unavailable");
    this.episodes.push(input);
  }

  async searchFacts(input: Parameters<TemporalMemoryStore["searchFacts"]>[0]): Promise<TemporalEvidence[]> {
    this.searches.push(input);
    return this.facts;
  }

  async getEntityTimeline() {
    return [];
  }

  async getCurrentFacts() {
    return [];
  }
}

class InMemoryTemporalMemoryJobStore implements TemporalMemoryJobStore {
  jobs: TemporalMemoryJob[] = [];

  async enqueue(input: Parameters<TemporalMemoryJobStore["enqueue"]>[0]): Promise<TemporalMemoryJob> {
    const nowIso = now;
    const job: TemporalMemoryJob = {
      id: `temporal-job-${this.jobs.length + 1}`,
      tenantId: input.tenantId,
      elderId: input.elderId,
      sourceId: input.sourceId,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      nextRunAt: input.nextRunAt ?? nowIso,
      episode: input.episode,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.jobs.push(job);
    return job;
  }

  async claimDue(input: Parameters<TemporalMemoryJobStore["claimDue"]>[0]): Promise<TemporalMemoryJob[]> {
    const nowMs = new Date(input.now).getTime();
    const due = this.jobs
      .filter((job) => (job.status === "pending" || job.status === "failed") && new Date(job.nextRunAt).getTime() <= nowMs)
      .slice(0, input.limit);
    for (const job of due) {
      job.status = "running";
      job.lockedAt = input.now;
      job.updatedAt = input.now;
    }
    return due;
  }

  async markSucceeded(input: Parameters<TemporalMemoryJobStore["markSucceeded"]>[0]): Promise<TemporalMemoryJob> {
    const job = this.requireJob(input.jobId);
    job.status = "succeeded";
    job.lockedAt = undefined;
    job.lastError = undefined;
    job.updatedAt = now;
    return job;
  }

  async markFailed(input: Parameters<TemporalMemoryJobStore["markFailed"]>[0]): Promise<TemporalMemoryJob> {
    const job = this.requireJob(input.jobId);
    job.attempts += 1;
    job.status = input.dead || job.attempts >= job.maxAttempts ? "dead" : "failed";
    job.lockedAt = undefined;
    job.lastError = input.errorMessage;
    job.nextRunAt = input.nextRunAt;
    job.updatedAt = now;
    return job;
  }

  async stats(input: Parameters<TemporalMemoryJobStore["stats"]>[0] = {}) {
    const output = { pending: 0, running: 0, succeeded: 0, failed: 0, dead: 0 };
    for (const job of this.jobs) {
      if (input?.tenantId && job.tenantId !== input.tenantId) continue;
      if (input?.elderId && job.elderId !== input.elderId) continue;
      output[job.status] += 1;
    }
    return output;
  }

  private requireJob(jobId: string): TemporalMemoryJob {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Temporal job not found: ${jobId}`);
    return job;
  }
}

class InMemoryAuditLog implements AuditLog {
  records: Array<Parameters<AuditLog["record"]>[0]> = [];

  async record(input: Parameters<AuditLog["record"]>[0]): Promise<void> {
    this.records.push(input);
  }
}
