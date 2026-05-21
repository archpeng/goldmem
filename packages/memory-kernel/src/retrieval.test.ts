import { describe, expect, it } from "vitest";
import type { MemoryEvent, ParsedMemoryQuery } from "@mem/memory-schema";
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
    const semantic: RetrievedEvidence = item({
      score: 0.8,
      sourceId: "semantic-source",
      eventId: "semantic-event",
      summary: "语义召回已由 PostgreSQL 对齐，下周一上午九点，医保卡仍需携带。",
      retrievalSource: "semantic",
      eventType: "appointment",
      riskLevel: "medical",
      requiresConfirmation: true,
    });

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

  it("orders newer evidence first for temporal relationship queries", () => {
    const historical = item({
      sourceId: "source-historical",
      eventId: "event-historical",
      summary: "历史记录：复查原来是周三下午。",
      score: 0.82,
      retrievalSource: "postgres",
      createdAt: "2026-05-01T08:00:00.000Z",
    });
    const current = item({
      sourceId: "source-current",
      eventId: "event-current",
      summary: "当前记录：复查后来改到周五上午十点。",
      score: 0.74,
      retrievalSource: "postgres",
      createdAt: "2026-05-03T08:00:00.000Z",
    });

    const merged = mergeRetrievedEvidence([historical, current], { prioritizeCurrentEvidence: true });

    expect(merged[0]).toEqual(expect.objectContaining({ eventId: "event-current" }));
    expect(merged[1]).toEqual(expect.objectContaining({ eventId: "event-historical" }));
  });

  it("uses PostgreSQL event creation time for aligned temporal evidence ordering", () => {
    const historical = memoryEvent({
      id: "event-historical",
      sourceId: "source-historical",
      title: "牙科复查原始记录",
      summary: "牙科复查原来记成周三下午。",
      createdAt: "2026-05-01T08:00:00.000Z",
    });
    const current = memoryEvent({
      id: "event-current",
      sourceId: "source-current",
      title: "牙科复查确认记录",
      summary: "小敏确认牙科复查改为周五上午十点。",
      createdAt: "2026-05-03T08:00:00.000Z",
    });

    const merged = mergeEvidence(
      [historical, current],
      [],
      [{
        retrievalSource: "graphiti",
        origin: "provenance_fallback",
        sourceId: historical.sourceId,
        eventId: historical.id,
        episodeId: "episode-historical",
        entityNames: ["牙科复查"],
        fact: "牙科复查原来是周三下午。",
        validFrom: "2026-05-10T08:00:00.000Z",
        score: 1,
        reason: "Graphiti provenance matched historical record.",
        metadata: { eventCreatedAt: historical.createdAt },
      }],
      {
        ...parsedQuery(),
        requiresTemporalEvidence: true,
        relationQueryIntent: "temporal_change",
      },
      "牙科复查到底是周三还是周五？",
      now,
    );

    expect(merged[0]).toEqual(expect.objectContaining({ eventId: "event-current" }));
    expect(merged.find((entry) => entry.retrievalSource === "graphiti_provenance")?.createdAt).toBe(historical.createdAt);
  });

  it("keeps confirmation-state diversity for reminder classification queries", () => {
    const requiresConfirmation = Array.from({ length: 12 }, (_, index) => item({
      sourceId: `source-confirm-${index}`,
      eventId: `event-confirm-${index}`,
      summary: `需要确认的事项 ${index}`,
      score: 1,
      requiresConfirmation: true,
      retrievalSource: "postgres",
    }));
    const privateNote = item({
      sourceId: "source-private",
      eventId: "event-private",
      summary: "只是自己记录的私人事项。",
      score: 0.96,
      requiresConfirmation: false,
      retrievalSource: "postgres",
    });

    const merged = mergeRetrievedEvidence([...requiresConfirmation, privateNote], {
      preserveConfirmationDiversity: true,
    });

    expect(merged).toHaveLength(12);
    expect(merged.some((entry) => entry.requiresConfirmation === false)).toBe(true);
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
    createdAt: input.createdAt ?? now,
    summary: input.summary ?? "Evidence summary.",
    score: input.score ?? 0.5,
    canPlayAudio: true,
    retrievalSource: input.retrievalSource ?? "postgres",
    eventType: input.eventType,
    riskLevel: input.riskLevel,
    requiresConfirmation: input.requiresConfirmation,
  };
}
