import { describe, expect, it } from "vitest";
import {
  CreateFamilyReminderRequestSchema,
  ElderTurnRequestSchema,
  MemoryAnswerSchema,
  MemoryPlanSchema,
  MemorySourceSchema,
  ParsedMemoryQuerySchema,
} from "./index.js";

describe("memory-schema safety contracts", () => {
  it("keeps family reminder writes idempotency-capable at the API boundary", () => {
    expect(CreateFamilyReminderRequestSchema.parse({
      elderId: "elder-1",
      actorUserId: "family-1",
      title: "提醒妈妈量血压",
      idempotencyKey: "family-reminder-1",
    })).toEqual(expect.objectContaining({
      tenantId: "tenant-mvp",
      reason: "Family-created reminder.",
      idempotencyKey: "family-reminder-1",
    }));
  });

  it("accepts client turn ids for elder turn source idempotency", () => {
    expect(ElderTurnRequestSchema.parse({
      elderId: "elder-1",
      text: "今天下午五点下班。",
      clientTurnId: "turn-1",
    })).toMatchObject({
      tenantId: "tenant-mvp",
      clientTurnId: "turn-1",
    });

    expect(MemorySourceSchema.parse({
      id: "source-1",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "text",
      transcript: "今天下午五点下班。",
      createdAt: "2026-05-11T08:00:00.000Z",
      metadata: { timezone: "Asia/Shanghai", clientTurnId: "turn-1" },
    }).metadata?.clientTurnId).toBe("turn-1");
  });

  it("requires event evidence in MemoryPlan truth candidates", () => {
    expect(() => MemoryPlanSchema.parse({
      tenantId: "tenant-mvp",
      sourceId: "source-1",
      elderId: "elder-1",
      summary: "你买了青菜。",
      events: [{
        type: "shopping",
        title: "买青菜",
        summary: "你买了青菜。",
        timeConfidence: 0.8,
        importance: 0.5,
        confidence: 0.8,
        riskLevel: "normal",
        requiresConfirmation: false,
      }],
      modelInfo: { provider: "test", model: "test", promptVersion: "test" },
      confidence: 0.8,
    })).toThrow();
  });

  it("accepts explicit event action decisions in MemoryPlan", () => {
    const parsed = MemoryPlanSchema.parse({
      tenantId: "tenant-mvp",
      sourceId: "source-1",
      elderId: "elder-1",
      summary: "你要去社区医院复查。",
      events: [{
        type: "appointment",
        title: "社区医院复查",
        summary: "你下周三下午三点要去社区医院复查血压。",
        timeText: "下周三下午三点",
        timeConfidence: 0.8,
        entities: [],
        importance: 0.7,
        confidence: 0.8,
        riskLevel: "medical",
        requiresConfirmation: true,
        evidence: [{ sourceId: "source-1", quote: "下周三下午三点要去社区医院复查血压" }],
      }],
      reminderCandidates: [{
        title: "社区医院复查血压",
        timeText: "下周三下午三点",
        timeConfidence: 0.8,
        relatedEventIndex: 0,
        confirmationRequired: true,
        suggestedConfirmers: [{ role: "family" }],
        confidence: 0.8,
        reason: "医疗复查提醒需要待确认。",
      }],
      eventActionDecisions: [{
        eventIndex: 0,
        action: "create_reminder_candidate",
        reminderCandidateIndex: 0,
        reason: "这是一个未来医疗复查事项。",
        confidence: 0.8,
        evidence: [{ sourceId: "source-1", quote: "下周三下午三点要去社区医院复查血压" }],
      }],
      modelInfo: { provider: "test", model: "test", promptVersion: "test" },
      confidence: 0.8,
    });

    expect(parsed.eventActionDecisions[0]?.action).toBe("create_reminder_candidate");
  });

  it("accepts evidence-backed relation enrichment signals in MemoryPlan", () => {
    const parsed = MemoryPlanSchema.parse({
      tenantId: "tenant-mvp",
      sourceId: "source-1",
      elderId: "elder-1",
      summary: "社区医院复查改期。",
      events: [{
        type: "appointment",
        title: "社区医院复查改期",
        summary: "社区医院复查改到下周一上午九点。",
        timeText: "下周一上午九点",
        timeConfidence: 0.8,
        entities: [],
        importance: 0.8,
        confidence: 0.8,
        riskLevel: "medical",
        requiresConfirmation: true,
        evidence: [{ sourceId: "source-1", quote: "改到下周一上午九点" }],
      }],
      eventActionDecisions: [{
        eventIndex: 0,
        action: "family_review",
        reason: "医疗复查改期需要确认。",
        confidence: 0.8,
        evidence: [{ sourceId: "source-1", quote: "改到下周一上午九点" }],
      }],
      relationEnrichmentSignals: [{
        intent: "temporal_change",
        valueScore: 0.9,
        confidence: 0.8,
        relatedEventIndexes: [0],
        reason: "这条记录改变了复查时间。",
        evidence: [{ sourceId: "source-1", quote: "改到下周一上午九点" }],
      }],
      modelInfo: { provider: "test", model: "test", promptVersion: "test" },
      confidence: 0.8,
    });

    expect(parsed.relationEnrichmentSignals[0]?.intent).toBe("temporal_change");
  });

  it("requires evidence on relation enrichment signals", () => {
    expect(() => MemoryPlanSchema.parse({
      tenantId: "tenant-mvp",
      sourceId: "source-1",
      elderId: "elder-1",
      summary: "社区医院复查改期。",
      relationEnrichmentSignals: [{
        intent: "temporal_change",
        valueScore: 0.9,
        confidence: 0.8,
        relatedEventIndexes: [],
        reason: "缺少证据。",
        evidence: [],
      }],
      modelInfo: { provider: "test", model: "test", promptVersion: "test" },
      confidence: 0.8,
    })).toThrow();
  });

  it("requires retrieval evidence and bounded source metadata for answers", () => {
    expect(() => MemoryAnswerSchema.parse({
      answerText: "您买了青菜。",
      confidence: 0.8,
      retrievedEvidence: [{
        sourceId: "source-1",
        createdAt: "2026-05-11T00:00:00.000Z",
        summary: "你买了青菜。",
        score: 1.2,
        canPlayAudio: true,
        retrievalSource: "postgres",
      }],
    })).toThrow();

    expect(MemoryAnswerSchema.parse({
      answerText: "您买了青菜。",
      confidence: 0.8,
      matchedSources: [{
        sourceId: "source-1",
        createdAt: "2026-05-11T00:00:00.000Z",
        summary: "你买了青菜。",
        canPlayAudio: true,
        retrievalSource: "postgres",
      }],
      retrievedEvidence: [{
        sourceId: "source-1",
        createdAt: "2026-05-11T00:00:00.000Z",
        summary: "你买了青菜。",
        score: 0.9,
        canPlayAudio: true,
        retrievalSource: "postgres",
      }],
    }).retrievedEvidence).toHaveLength(1);
  });

  it("requires confidence on parsed time ranges used for recall ranking", () => {
    expect(() => ParsedMemoryQuerySchema.parse({
      intent: "ask_today",
      timeRange: {
        start: "2026-05-11T00:00:00.000Z",
        end: "2026-05-11T23:59:59.999Z",
      },
      requiresSourceEvidence: true,
      requiresTemporalEvidence: false,
      relationQueryIntent: "none",
    })).toThrow();
  });
});
