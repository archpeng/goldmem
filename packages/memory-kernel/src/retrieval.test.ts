import { describe, expect, it } from "vitest";
import type { MemoryEvent, ParsedMemoryQuery } from "@mem/memory-schema";
import type { MemoryRecallResult } from "@mem/memory-store";
import type { RetrievedEvidence } from "@mem/model-gateway";
import { mergeEvidence, mergeRetrievedEvidence } from "./retrieval.js";
import { now } from "../test/harness.js";

describe("retrieval evidence merge", () => {
  it("keeps structured title and time text in answer evidence", () => {
    const event = memoryEvent({
      title: "社区医院复查时间改为下周一上午九点",
      summary: "你女儿小敏确认了复查时间变更，医保卡仍需携带。",
      timeText: "下周一上午九点",
    });
    const semantic: MemoryRecallResult = {
      memory: "semantic memory",
      score: 0.8,
      metadata: {
        sourceId: "semantic-source",
        eventId: "semantic-event",
        title: "语义召回标题包含下周一上午九点",
        summary: "语义召回摘要只说复查改期，医保卡仍需携带。",
        timeText: "下周一上午九点",
        createdAt: now,
        eventType: "appointment",
        riskLevel: "medical",
        requiresConfirmation: true,
      },
    };

    const merged = mergeEvidence([event], [semantic], [], parsedQuery(), "社区医院复查是不是改期了？", now);

    expect(merged.find((entry) => entry.retrievalSource === "postgres")?.summary).toContain("下周一上午九点");
    expect(merged.find((entry) => entry.retrievalSource === "semantic")?.summary).toContain("下周一上午九点");
  });

  it("preserves aligned raw Graphiti evidence when temporal evidence is required", () => {
    const evidence = [
      ...Array.from({ length: 10 }, (_, index) => item({
        sourceId: `source-postgres-${index}`,
        eventId: `event-postgres-${index}`,
        summary: `Postgres evidence ${index}`,
        score: 1,
        retrievalSource: "postgres",
      })),
      item({
        sourceId: "source-provenance",
        eventId: "event-provenance",
        summary: "Graphiti provenance fallback.",
        score: 1,
        retrievalSource: "graphiti_provenance",
      }),
      item({
        sourceId: "source-semantic",
        eventId: "event-semantic",
        summary: "Semantic evidence.",
        score: 0.99,
        retrievalSource: "semantic",
      }),
      item({
        sourceId: "source-graphiti",
        eventId: "event-graphiti",
        summary: "Raw Graphiti temporal evidence.",
        score: 0.2,
        retrievalSource: "graphiti",
      }),
    ];

    const merged = mergeRetrievedEvidence(evidence, { preserveRawGraphiti: true });

    expect(merged).toHaveLength(12);
    expect(merged.some((entry) => entry.retrievalSource === "graphiti")).toBe(true);
    expect(merged.some((entry) => entry.retrievalSource === "semantic")).toBe(false);
  });

  it("does not force raw Graphiti evidence into simple recall results", () => {
    const evidence = [
      ...Array.from({ length: 12 }, (_, index) => item({
        sourceId: `source-postgres-${index}`,
        eventId: `event-postgres-${index}`,
        summary: `Postgres evidence ${index}`,
        score: 1,
        retrievalSource: "postgres",
      })),
      item({
        sourceId: "source-graphiti",
        eventId: "event-graphiti",
        summary: "Raw Graphiti temporal evidence.",
        score: 0.2,
        retrievalSource: "graphiti",
      }),
    ];

    const merged = mergeRetrievedEvidence(evidence);

    expect(merged).toHaveLength(12);
    expect(merged.some((entry) => entry.retrievalSource === "graphiti")).toBe(false);
  });

  it("does not invent Graphiti evidence when no raw Graphiti item exists", () => {
    const evidence = Array.from({ length: 13 }, (_, index) => item({
      sourceId: `source-${index}`,
      eventId: `event-${index}`,
      summary: `Evidence ${index}`,
      score: 1 - index / 100,
      retrievalSource: index === 12 ? "semantic" : "postgres",
    }));

    const merged = mergeRetrievedEvidence(evidence, { preserveRawGraphiti: true });

    expect(merged).toHaveLength(12);
    expect(merged.some((entry) => entry.retrievalSource === "graphiti")).toBe(false);
  });
});

function parsedQuery(): ParsedMemoryQuery {
  return {
    intent: "recall_event",
    entities: [],
    eventTypes: ["appointment"],
    safetyTags: [],
    requiresTemporalEvidence: false,
    relationQueryIntent: "none",
    requiresSourceEvidence: true,
  };
}

function memoryEvent(input: Partial<MemoryEvent>): MemoryEvent {
  return {
    id: input.id ?? "event",
    tenantId: input.tenantId ?? "tenant-mvp",
    elderId: input.elderId ?? "elder",
    sourceId: input.sourceId ?? "source",
    type: input.type ?? "appointment",
    title: input.title ?? "事件标题",
    summary: input.summary ?? "事件摘要。",
    timeText: input.timeText ?? "未提到时间",
    timeConfidence: input.timeConfidence ?? 0.8,
    entities: input.entities ?? [],
    importance: input.importance ?? 0.7,
    confidence: input.confidence ?? 0.9,
    riskLevel: input.riskLevel ?? "medical",
    requiresConfirmation: input.requiresConfirmation ?? true,
    visibility: input.visibility ?? "private",
    evidence: input.evidence ?? [{ sourceId: input.sourceId ?? "source" }],
    status: input.status ?? "active",
    createdAt: input.createdAt ?? now,
    eventTimeStart: input.eventTimeStart,
    eventTimeEnd: input.eventTimeEnd,
  };
}

function item(input: Partial<RetrievedEvidence>): RetrievedEvidence {
  return {
    sourceId: input.sourceId ?? "source",
    eventId: input.eventId,
    createdAt: now,
    summary: input.summary ?? "Evidence summary.",
    score: input.score ?? 0.5,
    canPlayAudio: true,
    retrievalSource: input.retrievalSource ?? "postgres",
    eventType: input.eventType,
    riskLevel: input.riskLevel,
    requiresConfirmation: input.requiresConfirmation,
  };
}
