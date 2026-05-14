import { describe, expect, it } from "vitest";
import type { RetrievedEvidence } from "@mem/model-gateway";
import { mergeRetrievedEvidence } from "./retrieval.js";
import { now } from "../test/harness.js";

describe("retrieval evidence merge", () => {
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
