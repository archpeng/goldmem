import { describe, expect, it } from "vitest";
import { MemoryAnswerSchema, MemoryPlanSchema, type ParsedMemoryQuery } from "@goldmem/memory-schema";
import type { GenerateMemoryAnswerInput, GenerateMemoryPlanInput } from "./index.js";
import { normalizeMemoryAnswerResult, normalizeMemoryPlanResult } from "./normalization.js";

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

function parsedQuery(): ParsedMemoryQuery {
  return {
    intent: "recall_event",
    requiresSourceEvidence: true,
    eventTypes: ["shopping"],
    entities: [],
  };
}
