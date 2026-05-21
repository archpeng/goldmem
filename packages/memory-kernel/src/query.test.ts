import { describe, expect, it } from "vitest";
import { ELDER_THIRD_PERSON_PATTERN, type MemoryPlan, type ParsedMemoryQuery } from "@mem/memory-schema";
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

describe("ElderMemoryKernel query", () => {
  it("validates parsed query and answer model outputs", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
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
      answerText: "You bought vegetables at the market.",
      confidence: 0.9,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };
    harness.sourceStore.sources.push({
      id: "source-1",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "text",
      transcript: "I bought vegetables at the market.",
      createdAt: now,
    });
    harness.eventStore.events.push(memoryEvent({
      id: "event-semantic",
      sourceId: "source-1",
      title: "Current PostgreSQL shopping event",
      summary: "Current PostgreSQL summary says you bought vegetables.",
      type: "shopping",
    }));
    harness.semanticMemory.searchResults = [
      {
        memory: "A compressed semantic fact.",
        score: 0.8,
        metadata: {
          sourceId: "source-1",
          eventId: "event-semantic",
          summary: "Stale semantic index summary must not be used.",
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
    expect(answer.retrievedEvidence.some((item) => item.summary.includes("Current PostgreSQL summary"))).toBe(true);
    expect(answer.retrievedEvidence.some((item) => item.summary.includes("Stale semantic index"))).toBe(false);
    expect(answer.retrievedEvidence.some((item) => item.summary.includes("Provider-only semantic"))).toBe(false);
    expect(harness.audit.records.at(-1)?.type).toBe("memory_query");
    expect(harness.audit.records.at(-1)?.payload.retrieval).toEqual(
      expect.objectContaining({
        semanticCount: 3,
        semanticCandidateLinkedCount: 2,
        semanticAlignedCount: 1,
        semanticUnalignedCount: 2,
        semanticEvidenceCount: 1,
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
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
        summary: "你买了青菜。",
      }),
    ];

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "我买了什么？",
      now,
    });

    expect(answer.matchedSources).toEqual([
      expect.objectContaining({ sourceId: "source-shopping", summary: expect.stringContaining("你买了青菜。") }),
    ]);
    expect(JSON.stringify(answer)).not.toMatch(ELDER_THIRD_PERSON_PATTERN);
    expect(answer.matchedSources.some((source) => source.sourceId === "source-hallucinated")).toBe(false);
  });

  it("falls back to evidence-bound answers when answer generation schema validation fails", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
        summary: "你买了青菜。",
      }),
    ];

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "我买了什么？",
      now,
    });

    expect(answer.answerText).toContain("你买了青菜");
    expect(answer.matchedSources).toEqual([
      expect.objectContaining({ sourceId: "source-shopping", summary: expect.stringContaining("你买了青菜。") }),
    ]);
    expect(JSON.stringify(answer)).not.toMatch(ELDER_THIRD_PERSON_PATTERN);
    expect(harness.audit.records.some((record) => record.type === "memory_query_answer_generation_failed")).toBe(true);
    expect(harness.audit.records.at(-1)?.type).toBe("memory_query");
  });

  it("routes elder turns to memory writes without frontend intent branching", async () => {
    const harness = createHarness(buildPlan({
      summary: "你买了青菜。",
      events: [buildEvent({ title: "买青菜", summary: "你买了青菜。", type: "shopping" })],
    }));
    harness.model.turnPlan = {
      intent: "record",
      confidence: 0.9,
      recordText: "我今天买了青菜。",
      requiresIngestContextRecall: false,
    };

    const result = await harness.kernel.elderTurn({
      elderId: "elder-1",
      text: "我今天买了青菜。",
      now,
    });

    expect(result.turnType).toBe("record");
    expect(result.draft?.transcript).toBe("我今天买了青菜。");
    expect(result.ingestResult).toBeUndefined();
    expect(result.answer).toBeUndefined();
    expect(harness.sourceStore.sources).toHaveLength(1);
    expect(harness.memoryProcessingJobStore.jobs).toHaveLength(1);
    expect(harness.audit.records.at(-1)?.type).toBe("elder_turn");

    const sourceId = result.draft?.sourceId ?? "";
    expect(await harness.kernel.getIngestStatus({ sourceId })).toMatchObject({ status: "queued" });
    await harness.kernel.processMemoryProcessingJobs({ now, types: ["ingest_source"] });
    expect(await harness.kernel.getIngestStatus({ sourceId })).toMatchObject({
      status: "ready",
      summary: "你买了青菜。",
    });
    expect(harness.eventStore.events).toHaveLength(1);
    expect(harness.semanticMemory.searches).toHaveLength(0);
  });

  it("uses turn-plan context recall signal to decide semantic candidate search in background ingest", async () => {
    const harness = createHarness(buildPlan({
      summary: "改期。",
      events: [buildEvent({ title: "复查改期", summary: "复查改到下周三。", type: "appointment" })],
    }));
    harness.model.turnPlan = {
      intent: "record",
      confidence: 0.9,
      recordText: "上次那个复查改到下周三。",
      requiresIngestContextRecall: true,
    };
    harness.semanticMemory.searchResults = [];

    const result = await harness.kernel.elderTurn({
      elderId: "elder-1",
      text: "上次那个复查改到下周三。",
      now,
    });
    await harness.kernel.processMemoryProcessingJobs({ now, types: ["ingest_source"] });

    expect(result.draft?.sourceId).toBeTruthy();
    expect(harness.semanticMemory.searches).toHaveLength(1);
    expect(harness.model.lastPlanContext?.semanticCandidateEvents).toEqual([]);
  });

  it("routes elder turns to recall with evidence-bound answers", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.model.turnPlan = {
      intent: "recall",
      confidence: 0.9,
      queryText: "我买了什么？",
      requiresIngestContextRecall: false,
    };
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
        summary: "你买了青菜。",
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

  it("does not trigger query safety from sensitive words without structured risk metadata", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    const event = memoryEvent({
      id: "event-normal-code",
      sourceId: "source-normal-code",
      type: "general",
      title: "门禁验证码",
      summary: "你说门禁验证码贴在冰箱旁边。",
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
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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

  it("does not expose broad recall candidates when the answer model declines them as no evidence", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.eventStore.searchResults = [
      memoryEvent({
        id: "event-unrelated",
        sourceId: "source-unrelated",
        summary: "有人以办理补贴为名要求提供验证码。",
        riskLevel: "fraud_risk",
      }),
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
      eventTypes: ["general"],
      safetyTags: [],
      entities: [{ type: "unknown", name: "屋顶安装太阳能板", confidence: 0.5 }],
    };
    harness.model.answer = {
      answerText: "我没有找到可以回答这件事的记忆。",
      confidence: 0.3,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "请查一下记忆：我有没有说过要在屋顶安装太阳能板？",
      now,
      traceId: "trace-query-answer-declined-evidence",
    });

    expect(harness.model.answerCalls).toBe(1);
    expect(answer.confidence).toBe(0);
    expect(answer.matchedSources).toEqual([]);
    expect(answer.retrievedEvidence).toEqual([]);
    expect(answer.safetyNote).toContain("没有找到可引用的来源依据");
    expect(harness.audit.records.at(-1)).toMatchObject({
      traceId: "trace-query-answer-declined-evidence",
      payload: expect.objectContaining({
        failureType: "answer_declined_evidence",
        noEvidence: true,
        evidence: expect.arrayContaining([
          expect.objectContaining({ sourceId: "source-unrelated" }),
        ]),
        answer: expect.objectContaining({
          confidence: 0,
          retrievedEvidence: [],
          matchedSources: [],
        }),
      }),
    });
  });

  it("uses broad PostgreSQL fallback when relation evidence lacks query coverage", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    const unrelated = memoryEvent({
      id: "event-unrelated-fraud",
      sourceId: "source-unrelated-fraud",
      type: "finance",
      title: "银行卡密码风险",
      summary: "小敏提醒你不要把银行卡密码写给陌生人。",
      riskLevel: "fraud_risk",
      importance: 0.9,
    });
    const phoneRisk = memoryEvent({
      id: "event-medication-phone",
      sourceId: "source-medication-phone",
      type: "medication",
      title: "陌生电话要求停药",
      summary: "下午有个陌生电话说降压药可以直接停药，你没有确认，也不敢照着做。",
      riskLevel: "medical",
      requiresConfirmation: true,
      importance: 0.9,
    });
    const familyConfirmed = memoryEvent({
      id: "event-medication-family",
      sourceId: "source-medication-family",
      type: "medication",
      title: "小敏确认停药电话不可信",
      summary: "小敏确认张医生最新交代还是晚饭后一片，陌生电话说停药不可信。",
      riskLevel: "medical",
      requiresConfirmation: true,
      importance: 0.9,
    });
    harness.eventStore.searchResultsQueue = [
      [unrelated],
      [phoneRisk, familyConfirmed],
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      requiresTemporalEvidence: true,
      relationQueryIntent: "conflict_resolution",
      eventTypes: ["medication"],
      safetyTags: ["medication", "fraud"],
      entities: [
        { type: "unknown", name: "陌生电话", confidence: 0.5 },
        { type: "medicine", name: "停药", confidence: 0.5 },
      ],
    };
    harness.model.answer = {
      answerText: "这条陌生电话说停药的说法不可靠，小敏确认张医生的最新说法仍是晚饭后一片。",
      confidence: 0.85,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "陌生电话说停药这件事可靠吗？",
      now,
    });

    expect(harness.eventStore.searchInputs).toHaveLength(2);
    expect(harness.eventStore.searchInputs[0]).toMatchObject({ limit: 30 });
    expect(harness.eventStore.searchInputs[1]).toMatchObject({ limit: 30, query: "陌生电话说停药这件事可靠吗？" });
    expect(harness.eventStore.searchInputs[1]?.timeRange).toBeUndefined();
    expect(harness.eventStore.searchInputs[1]?.entityNames).toBeUndefined();
    expect(answer.retrievedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: "event-medication-phone" }),
        expect.objectContaining({ eventId: "event-medication-family" }),
      ]),
    );
    expect(harness.audit.records.at(-1)?.payload.retrieval).toEqual(
      expect.objectContaining({
        postgresFallbackUsed: true,
        postgresFallbackCount: 2,
        evidenceCoverageRequired: true,
        evidenceCoveragePassed: true,
      }),
    );
  });

  it("does not call the answer model when relation evidence coverage still fails", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    const unrelated = memoryEvent({
      id: "event-unrelated-fraud",
      sourceId: "source-unrelated-fraud",
      type: "finance",
      title: "银行卡密码风险",
      summary: "小敏提醒你不要把银行卡密码写给陌生人。",
      riskLevel: "fraud_risk",
      importance: 0.9,
    });
    harness.eventStore.searchResultsQueue = [
      [unrelated],
      [unrelated],
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      requiresTemporalEvidence: true,
      relationQueryIntent: "conflict_resolution",
      eventTypes: ["medication"],
      safetyTags: ["medication", "fraud"],
      entities: [
        { type: "unknown", name: "陌生电话", confidence: 0.5 },
        { type: "medicine", name: "停药", confidence: 0.5 },
      ],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "陌生电话说停药这件事可靠吗？",
      now,
    });

    expect(harness.model.answerCalls).toBe(0);
    expect(answer.confidence).toBe(0);
    expect(answer.retrievedEvidence).toEqual([]);
    expect(harness.audit.records.at(-1)?.payload).toEqual(
      expect.objectContaining({
        failureType: "insufficient_evidence_coverage",
        retrieval: expect.objectContaining({
          postgresFallbackUsed: true,
          evidenceCoveragePassed: false,
        }),
      }),
    );
  });

  it("uses evidence-bound fallback when relation answer generation declines covered evidence", async () => {
    const harness = createHarness(buildPlan({ summary: "No-op plan." }));
    harness.eventStore.searchResults = [
      memoryEvent({
        id: "event-medication-phone",
        sourceId: "source-medication-phone",
        type: "medication",
        title: "陌生电话要求停药",
        summary: "下午有个陌生电话说降压药可以直接停药，你没有确认，也不敢照着做。",
        riskLevel: "medical",
        requiresConfirmation: true,
        importance: 0.9,
      }),
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      requiresTemporalEvidence: true,
      relationQueryIntent: "safety_chain",
      eventTypes: ["medication"],
      safetyTags: ["medication", "fraud"],
      entities: [
        { type: "unknown", name: "陌生电话", confidence: 0.5 },
        { type: "medicine", name: "停药", confidence: 0.5 },
      ],
    };
    harness.model.answer = {
      answerText: "我没有找到可以回答这件事的记忆。",
      confidence: 0.2,
      matchedSources: [],
      retrievedEvidence: [],
      suggestedActions: [],
    };

    const answer = await harness.kernel.queryMemory({
      elderId: "elder-1",
      query: "陌生电话说停药这件事可靠吗？",
      now,
    });

    expect(harness.model.answerCalls).toBe(1);
    expect(answer.confidence).toBeGreaterThan(0);
    expect(answer.retrievedEvidence).toHaveLength(1);
    expect(answer.answerText).toContain("陌生电话");
    expect(harness.audit.records.some((record) => record.type === "memory_query_answer_decline_fallback_used")).toBe(true);
    expect(harness.audit.records.at(-1)?.payload).toEqual(
      expect.objectContaining({
        answerDeclineFallbackUsed: true,
        retrieval: expect.objectContaining({
          evidenceCoverageRequired: true,
          evidenceCoveragePassed: true,
        }),
      }),
    );
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
        summary: "你说上午去一趟城里，想买生活用品，比如牙膏。",
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
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
          summary: expect.stringContaining("你说上午去一趟城里，想买生活用品，比如牙膏。"),
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
        summary: "用户昨天傍晚散步。",
        eventTimeStart: "2026-05-08T09:00:00.000Z",
        importance: 0.6,
        confidence: 0.8,
      }),
      memoryEvent({
        id: "event-today",
        sourceId: "source-today",
        type: "general",
        title: "今天散步",
        summary: "用户今天上午散步。",
        eventTimeStart: "2026-05-09T09:00:00.000Z",
        importance: 0.6,
        confidence: 0.8,
      }),
    ];
    harness.semanticMemory.searchResults = [];
    harness.model.parsedQuery = {
      intent: "recall_event",
      requiresSourceEvidence: true,
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
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
});
