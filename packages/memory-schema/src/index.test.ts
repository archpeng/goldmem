import { describe, expect, it } from "vitest";
import {
  CreateFamilyReminderRequestSchema,
  MemoryAnswerSchema,
  MemoryPlanSchema,
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

  it("requires event evidence in MemoryPlan truth candidates", () => {
    expect(() => MemoryPlanSchema.parse({
      tenantId: "tenant-mvp",
      sourceId: "source-1",
      elderId: "elder-1",
      summary: "老人买了青菜。",
      events: [{
        type: "shopping",
        title: "买青菜",
        summary: "老人买了青菜。",
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

  it("requires retrieval evidence and bounded source metadata for answers", () => {
    expect(() => MemoryAnswerSchema.parse({
      answerText: "您买了青菜。",
      confidence: 0.8,
      retrievedEvidence: [{
        sourceId: "source-1",
        createdAt: "2026-05-11T00:00:00.000Z",
        summary: "老人买了青菜。",
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
        summary: "老人买了青菜。",
        canPlayAudio: true,
        retrievalSource: "postgres",
      }],
      retrievedEvidence: [{
        sourceId: "source-1",
        createdAt: "2026-05-11T00:00:00.000Z",
        summary: "老人买了青菜。",
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
    })).toThrow();
  });
});
