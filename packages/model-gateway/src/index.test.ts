import { describe, expect, it } from "vitest";
import { ElderTurnPlanSchema, MemoryAnswerSchema, MemoryPlanSchema, type ParsedMemoryQuery } from "@goldmem/memory-schema";
import { ModelGatewayError, OpenAIModelGateway, type GenerateMemoryAnswerInput, type GenerateMemoryPlanInput, type PlanElderTurnInput } from "./index.js";
import { normalizeMemoryAnswerResult } from "./normalizers/answer.js";
import { normalizeMemoryPlanResult } from "./normalizers/memory-plan.js";
import { normalizeParsedMemoryQueryResult } from "./normalizers/query.js";
import { normalizeElderTurnPlanResult } from "./normalizers/turn-plan.js";

describe("model-gateway normalization", () => {
  it("fails schema validation when answer text is missing", () => {
    const normalized = normalizeMemoryAnswerResult(
      { confidence: 0.8 },
      answerInput(),
    );

    expect(() => MemoryAnswerSchema.parse(normalized)).toThrow();
  });

  it("accepts explicit answer aliases without inventing fallback answer text", () => {
    const normalized = normalizeMemoryAnswerResult(
      { answer: "记忆显示您买了青菜。", confidence: "high" },
      answerInput(),
    );

    expect(MemoryAnswerSchema.parse(normalized).answerText).toBe("记忆显示您买了青菜。");
  });

  it("accepts nested answer text and percent confidence", () => {
    const normalized = normalizeMemoryAnswerResult(
      { answer: { text: "记忆显示您买了青菜。" }, confidence: "80%" },
      answerInput(),
    );

    const parsed = MemoryAnswerSchema.parse(normalized);
    expect(parsed.answerText).toBe("记忆显示您买了青菜。");
    expect(parsed.confidence).toBe(0.8);
  });

  it("uses evidence score when answer confidence is missing", () => {
    const normalized = normalizeMemoryAnswerResult(
      { answerText: "记忆显示您买了青菜。" },
      answerInput(),
    );

    expect(MemoryAnswerSchema.parse(normalized).confidence).toBe(0.9);
  });

  it("drops model matchedSources that are not backed by input evidence", () => {
    const normalized = normalizeMemoryAnswerResult(
      {
        answerText: "记忆显示您买了青菜。",
        confidence: 0.8,
        matchedSources: [
          { sourceId: "source-missing", summary: "模型编造的来源。", createdAt: "2026-05-10T09:00:00.000Z", canPlayAudio: true },
        ],
      },
      answerInput(),
    );

    const parsed = MemoryAnswerSchema.parse(normalized);
    expect(parsed.matchedSources).toEqual([
      expect.objectContaining({ sourceId: "source-1", summary: "老人买了青菜。" }),
    ]);
  });

  it("keeps model matchedSources when they are backed by input evidence", () => {
    const normalized = normalizeMemoryAnswerResult(
      {
        answerText: "记忆显示您买了青菜。",
        confidence: 0.8,
        matchedSources: [{ sourceId: "source-1", summary: "模型摘要。", canPlayAudio: false }],
      },
      answerInput(),
    );

    const parsed = MemoryAnswerSchema.parse(normalized);
    expect(parsed.matchedSources).toEqual([
      expect.objectContaining({ sourceId: "source-1", summary: "模型摘要。", retrievalSource: "postgres" }),
    ]);
  });

  it("normalizes structured temporal query intent without keyword fallback", () => {
    const normalized = normalizeParsedMemoryQueryResult(
      {
        intent: "recall_event",
        relationQueryIntent: "temporal_change",
        eventTypes: ["medication"],
        safetyTags: ["medication"],
        requiresSourceEvidence: true,
      },
      {
        tenantId: "tenant-mvp",
        elderId: "elder-1",
        query: "这个药现在怎么吃？",
        now: "2026-05-09T12:00:00.000Z",
        context: emptyContext(),
      },
    );

    expect(normalized).toEqual(expect.objectContaining({
      requiresTemporalEvidence: true,
      relationQueryIntent: "temporal_change",
    }));
  });

  it("fails schema validation when required event evidence is missing", () => {
    const normalized = normalizeMemoryPlanResult(
      {
        summary: "老人买了青菜。",
        events: [{
          title: "买青菜",
          summary: "老人买了青菜。",
          confidence: 0.8,
        }],
        modelInfo: { provider: "test", model: "test", promptVersion: "test" },
        confidence: 0.8,
      },
      planInput(),
      "test-model",
      "test-prompt",
    );

    expect(() => MemoryPlanSchema.parse(normalized)).toThrow();
  });

  it("adds source evidence to risk flags when the model omits risk evidence", () => {
    const normalized = normalizeMemoryPlanResult(
      {
        summary: "陌生人索要验证码。",
        events: [{
          title: "疑似诈骗",
          summary: "陌生人索要验证码。",
          timeText: "刚才",
          confidence: 0.8,
          evidence: ["陌生人索要验证码"],
        }],
        riskFlags: [{
          type: "fraud_suspected",
          severity: "high",
          summary: "陌生人索要验证码。",
          evidence: [],
        }],
      },
      planInput(),
      "test-model",
      "test-prompt",
    );

    expect(MemoryPlanSchema.parse(normalized).riskFlags[0]?.evidence).toEqual([
      expect.objectContaining({ sourceId: "source-1" }),
    ]);
  });

  it("normalizes explicit memory plan action decisions without inferring actions", () => {
    const normalized = normalizeMemoryPlanResult(
      {
        summary: "老人要去社区医院复查。",
        events: [{
          title: "社区医院复查",
          summary: "老人下周三下午三点要去社区医院复查血压。",
          timeText: "下周三下午三点",
          confidence: 0.8,
          evidence: ["下周三下午三点要去社区医院复查血压"],
        }],
        reminderCandidates: [{
          title: "社区医院复查血压",
          timeText: "下周三下午三点",
          confirmationRequired: false,
          reason: "医疗复查提醒需要待确认。",
        }],
        eventActionDecisions: [{
          eventIndex: "0",
          action: "create_reminder_candidate",
          reminderCandidateIndex: "0",
          reason: "这是一个未来医疗复查事项。",
          confidence: "high",
          evidence: ["下周三下午三点要去社区医院复查血压"],
        }],
        modelInfo: { provider: "test", model: "test", promptVersion: "test" },
        confidence: 0.8,
      },
      planInput(),
      "test-model",
      "test-prompt",
    );

    expect(MemoryPlanSchema.parse(normalized).eventActionDecisions[0]).toMatchObject({
      eventIndex: 0,
      action: "create_reminder_candidate",
      reminderCandidateIndex: 0,
      confidence: 0.9,
    });
  });

  it("normalizes relation enrichment signals without inventing evidence", () => {
    const normalized = normalizeMemoryPlanResult(
      {
        summary: "社区医院复查改期。",
        events: [{
          title: "社区医院复查改期",
          summary: "社区医院复查改到下周一上午九点。",
          timeText: "下周一上午九点",
          confidence: 0.8,
          evidence: ["改到下周一上午九点"],
        }],
        eventActionDecisions: [{
          eventIndex: 0,
          action: "family_review",
          reason: "医疗复查改期需要家人确认。",
          confidence: 0.8,
          evidence: ["改到下周一上午九点"],
        }],
        relationEnrichmentSignals: [
          {
            intent: "temporal_change",
            valueScore: "90%",
            confidence: "high",
            relatedEventIndexes: ["0"],
            relatedReminderCandidateIndexes: ["0"],
            reason: "这条记录改变了复查时间。",
            evidence: ["改到下周一上午九点"],
          },
          {
            intent: "hospital_keyword_case",
            valueScore: 1,
            confidence: 1,
            reason: "非法业务关键词 intent 应被丢弃。",
            evidence: ["社区医院"],
          },
        ],
      },
      planInput(),
      "test-model",
      "test-prompt",
    );

    expect(MemoryPlanSchema.parse(normalized).relationEnrichmentSignals).toEqual([
      expect.objectContaining({
        intent: "temporal_change",
        valueScore: 0.9,
        confidence: 0.9,
        relatedEventIndexes: [0],
        relatedReminderCandidateIndexes: [0],
      }),
    ]);
  });

  it("keeps relation enrichment signal evidence failures visible", () => {
    const normalized = normalizeMemoryPlanResult(
      {
        summary: "社区医院复查改期。",
        relationEnrichmentSignals: [{
          intent: "temporal_change",
          valueScore: 0.9,
          confidence: 0.8,
          relatedEventIndexes: [],
          reason: "缺少 evidence。",
          evidence: [],
        }],
      },
      planInput(),
      "test-model",
      "test-prompt",
    );

    expect(() => MemoryPlanSchema.parse(normalized)).toThrow();
  });

  it("normalizes elder turn routing plans without answering or writing truth", () => {
    const normalized = normalizeElderTurnPlanResult(
      { action: "recall", question: "我买了什么？", confidence: "high" },
      turnInput(),
    );

    expect(ElderTurnPlanSchema.parse(normalized)).toMatchObject({
      intent: "recall",
      queryText: "我买了什么？",
      confidence: 0.9,
    });
  });

  it("falls back invalid elder turn routing to clarification", () => {
    const normalized = normalizeElderTurnPlanResult(
      { intent: "chat" },
      turnInput(),
    );

    expect(ElderTurnPlanSchema.parse(normalized)).toMatchObject({
      intent: "clarify",
      clarifyingQuestion: "您想让我记住这件事，还是帮您查以前的记忆？",
    });
  });
});

describe("OpenAIModelGateway operation timeouts", () => {
  it("uses the MemoryPlan-specific timeout for JSON completion failures", async () => {
    const gateway = new OpenAIModelGateway({
      apiKey: "test-key",
      model: "test-model",
      promptsDir: "../../prompts",
      timeoutMs: 20_000,
      operationTimeouts: { generateMemoryPlan: 60_000 },
    });
    const calls: Array<{ timeout?: number }> = [];
    const client = gateway as unknown as {
      client: {
        chat: {
          completions: {
            create: (_body: unknown, options?: { timeout?: number }) => Promise<unknown>;
          };
        };
      };
    };
    client.client.chat.completions.create = async (_body, options) => {
      calls.push({ timeout: options?.timeout });
      throw new Error("timeout");
    };

    await expect(gateway.generateMemoryPlan(planInput())).rejects.toMatchObject({
      name: "ModelGatewayError",
      code: "provider_error",
      details: expect.objectContaining({
        operation: "generateMemoryPlan",
        timeoutMs: 60_000,
        timeoutType: "client_timeout",
      }),
    } satisfies Partial<ModelGatewayError>);
    expect(calls).toEqual([{ timeout: 60_000 }]);
  });
});

function answerInput(): GenerateMemoryAnswerInput {
  return {
    query: "我买了什么？",
    parsedQuery: parsedQuery(),
    evidence: [{
      sourceId: "source-1",
      eventId: "event-1",
      createdAt: "2026-05-10T09:00:00.000Z",
      summary: "老人买了青菜。",
      score: 0.9,
      canPlayAudio: true,
      retrievalSource: "postgres",
    }],
    responseStyle: "elder_friendly_voice",
  };
}

function planInput(): GenerateMemoryPlanInput {
  return {
    tenantId: "tenant-mvp",
    elderId: "elder-1",
    sourceId: "source-1",
    transcript: "我买了青菜。",
    createdAt: "2026-05-10T09:00:00.000Z",
    timeContext: {
      createdAt: "2026-05-10T09:00:00.000Z",
      timezone: "Asia/Shanghai",
    },
    context: {
      recentEvents: [],
      semanticCandidateEvents: [],
      openReminders: [],
      semanticMemories: [],
      knownEntities: [],
      familyRelations: [],
      safetyPolicy: [],
    },
  };
}

function turnInput(): PlanElderTurnInput {
  return {
    tenantId: "tenant-mvp",
    elderId: "elder-1",
    text: "我买了什么？",
    now: "2026-05-10T09:00:00.000Z",
    context: emptyContext(),
  };
}

function parsedQuery(): ParsedMemoryQuery {
  return {
    intent: "recall_event",
    requiresSourceEvidence: true,
    requiresTemporalEvidence: false,
    relationQueryIntent: "none",
    eventTypes: ["shopping"],
    safetyTags: [],
    entities: [],
  };
}

function emptyContext() {
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
