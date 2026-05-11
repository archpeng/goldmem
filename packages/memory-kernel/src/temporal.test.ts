import { describe, expect, it } from "vitest";
import { NullTemporalMemoryStore } from "@goldmem/temporal-memory";
import { buildMemorySourceTemporalEpisode, writeMemorySourceTemporalEpisode } from "./temporal.js";

const source = {
  id: "source-1",
  elderId: "elder-1",
  type: "text" as const,
  transcript: "周五下午女儿带我去医院复查，别忘了拿医保卡。",
  createdAt: "2026-05-11T10:00:00.000Z",
};

const event = {
  id: "event-1",
  elderId: "elder-1",
  sourceId: "source-1",
  type: "appointment" as const,
  title: "医院复查",
  summary: "周五下午女儿陪同去医院复查，需要带医保卡。",
  timeText: "周五下午",
  timeConfidence: 0.6,
  entities: [{ type: "person" as const, name: "女儿", aliases: [], confidence: 0.8 }],
  importance: 0.8,
  confidence: 0.85,
  riskLevel: "medical" as const,
  requiresConfirmation: true,
  visibility: "shared_summary" as const,
  evidence: [{ sourceId: "source-1", quote: "周五下午女儿带我去医院复查" }],
  status: "needs_review" as const,
  createdAt: "2026-05-11T10:00:01.000Z",
};

describe("buildMemorySourceTemporalEpisode", () => {
  it("builds a tenant-scoped episode for production Graphiti writes", () => {
    const episode = buildMemorySourceTemporalEpisode({
      tenantId: "tenant-1",
      elderId: "elder-1",
      source,
      events: [event],
    });

    expect(episode.groupId).toBe("tenant_tenant-1__elder_elder-1");
    expect(episode.tenantId).toBe("tenant-1");
    expect(episode.episodeType).toBe("text_memory");
    expect(episode.sourceIds).toEqual(["source-1"]);
    expect(episode.eventIds).toEqual(["event-1"]);
    expect(episode.metadata?.writeMode).toBe("production_ingest");
    expect(episode.content).toMatchObject({
      source: { id: "source-1" },
      events: [{ id: "event-1", type: "appointment", riskLevel: "medical" }],
    });
  });

  it("surfaces NullTemporalMemoryStore as a missing Graphiti dependency", async () => {
    await expect(
      writeMemorySourceTemporalEpisode({
        temporalMemory: new NullTemporalMemoryStore(),
        tenantId: "tenant-1",
        elderId: "elder-1",
        source,
        events: [event],
      }),
    ).rejects.toThrow("Graphiti temporal memory is not configured");
  });
});
