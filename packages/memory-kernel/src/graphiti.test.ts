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

describe("ElderMemoryKernel graphiti", () => {
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
      requiresTemporalEvidence: true,
      relationQueryIntent: "temporal_change",
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
      requiresTemporalEvidence: true,
      relationQueryIntent: "temporal_change",
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
      requiresTemporalEvidence: true,
      relationQueryIntent: "same_matter_link",
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
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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

  it("queries Graphiti for structured fraud and identity risk chain questions", async () => {
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
      requiresTemporalEvidence: true,
      relationQueryIntent: "safety_chain",
      eventTypes: ["general"],
      safetyTags: ["fraud", "identity"],
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
      requiresTemporalEvidence: true,
      relationQueryIntent: "temporal_change",
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
});
