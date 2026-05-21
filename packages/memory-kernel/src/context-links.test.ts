import { describe, expect, it } from "vitest";
import type { MemoryPlan, ParsedMemoryQuery } from "@mem/memory-schema";
import { ModelGatewayError } from "@mem/model-gateway";
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

describe("ElderMemoryKernel context-links", () => {
  it("repairs reminder updates into pending candidates while keeping context links as evidence", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Added a reminder time detail.",
        events: [
          buildEvent({
            title: "下午三点提醒",
            summary: "用户补充说大约下午三点提醒一下。",
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
      summary: "你下周一准备出门吃当地特色面条，可能需要提醒，但没有具体几点。",
    }));
    harness.personalContextStore.context = {
      ...emptyContext(),
      recentEvents: [
        {
          eventId: "event-prior",
          sourceId: "source-prior",
          title: "下周一吃当地特色面条",
          summary: "你下周一准备出门吃当地特色面条，可能需要提醒，但没有具体几点。",
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

  it("repairs valid reminder updates that omit target reminder context links", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Confirmed a corrected appointment.",
        events: [
          buildEvent({
            title: "牙科复查时间确认",
            summary: "小敏确认牙科复查按周五上午十点。",
            type: "appointment",
            timeText: "未提到时间",
            timeConfidence: 0.3,
          }),
        ],
        reminderCandidates: [
          {
            title: "牙科复查时间确认",
            description: "小敏确认牙科复查按周五上午十点。",
            timeText: "未提到时间",
            timeConfidence: 0.3,
            relatedEventIndex: 0,
            confirmationRequired: true,
            suggestedConfirmers: [{ role: "family" }],
            confidence: 0.8,
            reason: "这条输入确认并更新已有牙科复查提醒。",
          },
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "update_existing_reminder_candidate",
            targetReminderId: "reminder-prior",
            reminderCandidateIndex: 0,
            reason: "这条输入确认并更新已有牙科复查提醒。",
          }),
        ],
        contextLinks: [],
      }),
    );
    harness.eventStore.events.push(memoryEvent({
      id: "event-prior",
      sourceId: "source-prior",
      title: "牙科复查",
      summary: "牙科复查改到周五上午十点。",
      type: "appointment",
      timeText: "周五上午十点",
      eventTimeStart: "2026-05-15T10:00:00.000Z",
    }));
    harness.personalContextStore.context = {
      ...emptyContext(),
      recentEvents: [
        {
          eventId: "event-prior",
          sourceId: "source-prior",
          title: "牙科复查",
          summary: "牙科复查改到周五上午十点。",
          createdAt: now,
        },
      ],
      openReminders: [
        {
          reminderId: "reminder-prior",
          eventId: "event-prior",
          title: "牙科复查",
          reason: "待确认的牙科复查提醒。",
          timeText: "周五上午十点",
          remindAt: "2026-05-15T10:00:00.000Z",
          timeConfidence: 0.9,
          status: "pending_family_confirm",
        },
      ],
    };

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "小敏确认牙科复查按周五上午十点。",
    });

    expect(result.reminderCandidates[0]).toMatchObject({
      timeText: "周五上午十点",
      remindAt: "2026-05-15T10:00:00.000Z",
      timeConfidence: 0.9,
      confirmationRequired: true,
    });
    expect(harness.contextLinkStore.links[0]).toMatchObject({
      toEventId: "event-prior",
      reminderId: "reminder-prior",
      status: "needs_confirmation",
    });
    expect(harness.audit.records.some((record) => record.type === "memory_plan_context_link_repaired")).toBe(true);
    expect(harness.audit.records.some((record) => record.type === "memory_plan_update_time_repaired")).toBe(true);
  });

  it("keeps reminder updates pending when the target reminder has no event or actionable time", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Added reminder details without a time.",
        events: [
          buildEvent({
            title: "牙科复查携带物品",
            summary: "牙科复查要带医保卡和病历本。",
            type: "appointment",
            timeText: "未提到时间",
            timeConfidence: 0.3,
          }),
        ],
        reminderCandidates: [
          {
            title: "牙科复查携带物品",
            description: "牙科复查要带医保卡和病历本。",
            timeText: "未提到时间",
            timeConfidence: 0.3,
            relatedEventIndex: 0,
            confirmationRequired: true,
            suggestedConfirmers: [{ role: "family" }],
            confidence: 0.8,
            reason: "这是对已有提醒的补充，但没有新的具体时间。",
          },
        ],
        eventActionDecisions: [
          buildEventActionDecision({
            eventIndex: 0,
            action: "update_existing_reminder_candidate",
            targetReminderId: "reminder-without-event",
            reminderCandidateIndex: 0,
            reason: "这条输入补充已有提醒。",
          }),
        ],
      }),
    );
    harness.personalContextStore.context = {
      ...emptyContext(),
      openReminders: [
        {
          reminderId: "reminder-without-event",
          title: "牙科复查",
          reason: "已有提醒缺少关联事件。",
          timeText: "未提到时间",
          timeConfidence: 0.3,
          status: "pending_family_confirm",
        },
      ],
    };

    const result = await harness.kernel.ingestText({
      elderId: "elder-1",
      transcript: "牙科复查要带医保卡和病历本。",
    });

    expect(result.reminderCandidates[0]).toMatchObject({
      status: "pending_family_confirm",
      confirmationRequired: true,
      remindAt: undefined,
      timeText: "未提到时间",
    });
    expect(harness.contextLinkStore.links).toHaveLength(0);
    expect(harness.audit.records.some((record) => record.type === "memory_plan_completeness_failed")).toBe(false);
  });

  it("persists medium-confidence context links as confirmation-required relationships", async () => {
    const harness = createHarness(
      buildPlan({
        summary: "Added a reminder time detail.",
        events: [
          buildEvent({
            title: "下午三点提醒",
            summary: "用户补充说大约下午三点提醒一下。",
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
        summary: "你下周一准备出门吃当地特色面条，可能需要提醒，但没有具体几点。",
      }),
    });
    harness.personalContextStore.context = {
      ...emptyContext(),
      recentEvents: [
        {
          eventId: "event-prior",
          sourceId: "source-prior",
          title: "下周一吃当地特色面条",
          summary: "你下周一准备出门吃当地特色面条，可能需要提醒，但没有具体几点。",
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
        events: [buildEvent({ title: "可能相关", summary: "你提到一个可能相关的事情。" })],
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
        events: [buildEvent({ title: "老字号吃饭提醒", summary: "你提到下午三点去老字号吃饭。" })],
      }),
    );
    harness.eventStore.events.push(
      memoryEvent({
        id: "event-semantic",
        sourceId: "source-semantic",
        title: "老街面馆",
        summary: "用户想去老街那家面馆吃本地特色面，时间还没定。",
      }),
      memoryEvent({
        id: "event-other-elder",
        elderId: "elder-2",
        sourceId: "source-other",
        title: "其他用户事件",
        summary: "这条候选不属于当前用户。",
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
        events: [buildEvent({ title: "老字号吃饭提醒", summary: "你提到下午三点去老字号吃饭。" })],
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
        summary: "用户想去老街那家面馆吃本地特色面，时间还没定。",
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

  it("keeps persisted context links out of final query evidence", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    const noodleEvent = memoryEvent({
      id: "event-noodle",
      sourceId: "source-noodle",
      title: "下周一吃当地特色面条",
      summary: "你下周一准备出门吃当地特色面条，可能需要提醒，但没说具体几点。",
    });
    const timeEvent = memoryEvent({
      id: "event-time",
      sourceId: "source-time",
      title: "下午三点提醒",
      summary: "用户补充说大约下午三点需要提醒。",
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
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
      summary: "你下周一准备出门吃当地特色面条，可能需要提醒，但没说具体几点。",
    });
    const timeEvent = memoryEvent({
      id: "event-time",
      sourceId: "source-time",
      title: "下午三点提醒",
      summary: "用户补充说大约下午三点需要提醒。",
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
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
        summary: "你要买牙膏。",
      }),
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
});
