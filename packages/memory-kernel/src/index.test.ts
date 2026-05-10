import { describe, expect, it } from "vitest";
import { ElderMemoryKernel, type ElderMemoryKernelDeps } from "./index.js";
import type {
  FamilyTask,
  MemoryAnswer,
  MemoryContextLink,
  MemoryEvent,
  MemoryPlan,
  MemorySource,
  ParsedMemoryQuery,
  Reminder,
} from "@goldmem/memory-schema";
import type { GenerateMemoryPlanInput, ModelGateway, PersonalContext, TranscriptionResult } from "@goldmem/model-gateway";
import type {
  AuditLog,
  ContextLinkStore,
  CreateContextLinkInput,
  CreateEventInput,
  CreateReminderInput,
  CreateRiskFlagInput,
  CreateSourceInput,
  EventStore,
  FamilyTaskStore,
  MemoryRecallResult,
  PersonalContextStore,
  ReminderStore,
  RiskFlagStore,
  SemanticMemoryStore,
  SourceStore,
} from "@goldmem/memory-store";
import { DefaultPermissionEngine } from "@goldmem/permission-engine";
import { DefaultReminderEngine } from "@goldmem/reminder-engine";
import { DefaultRiskEngine } from "@goldmem/risk-engine";

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
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.visibility).toBe("private");
    expect(result.events[0]?.status).toBe("active");
    expect(harness.semanticMemory.memories).toHaveLength(1);
    expect(harness.audit.records.at(-1)?.type).toBe("memory_ingest");
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
    });

    expect(answer.confidence).toBe(0);
    expect(answer.safetyNote).toContain("No source evidence");
    expect(harness.model.answerCalls).toBe(0);
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

function createHarness(plan: MemoryPlan) {
  const sourceStore = new InMemorySourceStore();
  const eventStore = new InMemoryEventStore();
  const reminderStore = new InMemoryReminderStore();
  const familyTasks = new InMemoryFamilyTaskStore();
  const riskFlags = new InMemoryRiskFlagStore();
  const contextLinkStore = new InMemoryContextLinkStore(eventStore);
  const semanticMemory = new InMemorySemanticMemoryStore();
  const audit = new InMemoryAuditLog();
  const personalContextStore = new FakePersonalContextStore();
  const model = new FakeModelGateway(plan);

  const deps: ElderMemoryKernelDeps = {
    sourceStore,
    eventStore,
    contextLinkStore,
    reminderEngine: new DefaultReminderEngine(reminderStore),
    familyTaskStore: familyTasks,
    riskFlagStore: riskFlags,
    semanticMemory,
    personalContextStore,
    modelGateway: model,
    riskEngine: new DefaultRiskEngine(),
    permissionEngine: new DefaultPermissionEngine(),
    auditLog: audit,
  };

  return {
    kernel: new ElderMemoryKernel(deps),
    sourceStore,
    eventStore,
    reminderStore,
    contextLinkStore,
    familyTasks,
    riskFlags,
    semanticMemory,
    audit,
    personalContextStore,
    model,
  };
}

function buildPlan(input: Partial<MemoryPlan>): MemoryPlan {
  return {
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
  lastPlanContext?: PersonalContext;

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

  async parseMemoryQuery(): Promise<ParsedMemoryQuery> {
    return this.parsedQuery;
  }

  async generateMemoryAnswer(): Promise<MemoryAnswer> {
    this.answerCalls += 1;
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

  async get(sourceId: string): Promise<MemorySource | null> {
    return this.sources.find((source) => source.id === sourceId) ?? null;
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

  async search(): Promise<MemoryEvent[]> {
    return this.searchResults ?? this.events;
  }

  async getByIds(eventIds: string[]): Promise<MemoryEvent[]> {
    return this.events.filter((event) => eventIds.includes(event.id));
  }
}

class InMemoryContextLinkStore implements ContextLinkStore {
  links: MemoryContextLink[] = [];

  constructor(private readonly eventStore: InMemoryEventStore) {}

  async create(input: CreateContextLinkInput): Promise<MemoryContextLink> {
    const fromEvent = this.eventStore.events.find((event) => event.id === input.fromEventId);
    const toEvent = this.eventStore.events.find((event) => event.id === input.toEventId);
    if (!fromEvent || !toEvent) throw new Error("Context link event reference not found");
    if (fromEvent.elderId !== input.elderId || toEvent.elderId !== input.elderId) {
      throw new Error("Context link events must belong to the same elder");
    }
    const link = { ...input, id: `link-${this.links.length + 1}`, createdAt: now };
    this.links.push(link);
    return link;
  }

  async listByEventIds(input: { elderId: string; eventIds: string[] }): Promise<MemoryContextLink[]> {
    const ids = new Set(input.eventIds);
    return this.links.filter(
      (link) => link.elderId === input.elderId && (ids.has(link.fromEventId) || ids.has(link.toEventId)),
    );
  }

  async listByElder(elderId: string): Promise<MemoryContextLink[]> {
    return this.links.filter((link) => link.elderId === elderId);
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

  async get(reminderId: string): Promise<Reminder | null> {
    return this.reminders.find((reminder) => reminder.id === reminderId) ?? null;
  }

  async listByElder(elderId: string): Promise<Reminder[]> {
    return this.reminders.filter((reminder) => reminder.elderId === elderId);
  }

  async update(reminderId: string, patch: Partial<Reminder>): Promise<Reminder> {
    const reminder = await this.get(reminderId);
    if (!reminder) throw new Error(`Reminder not found: ${reminderId}`);
    Object.assign(reminder, patch);
    return reminder;
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

  async listPending(elderId: string): Promise<FamilyTask[]> {
    return this.tasks.filter((task) => task.elderId === elderId && task.status === "pending");
  }

  async confirm(taskId: string, actorUserId: string): Promise<FamilyTask> {
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Family task not found: ${taskId}`);
    task.status = "confirmed";
    task.confirmedBy = actorUserId;
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

  async searchMemory(): Promise<MemoryRecallResult[]> {
    if (this.searchResults) return this.searchResults;
    return this.memories.map((memory) => ({
      memory: memory.memory,
      metadata: memory.metadata,
      score: 0.7,
    }));
  }
}

class InMemoryAuditLog implements AuditLog {
  records: Array<Parameters<AuditLog["record"]>[0]> = [];

  async record(input: Parameters<AuditLog["record"]>[0]): Promise<void> {
    this.records.push(input);
  }
}
