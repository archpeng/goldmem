import { describe, expect, it } from "vitest";
import { buildTemporalGroupId, NullTemporalMemoryStore } from "./index.js";

describe("NullTemporalMemoryStore", () => {
  it("keeps the MVP path independent from Graphiti", async () => {
    const store = new NullTemporalMemoryStore();

    await expect(
      store.addEpisode({
        groupId: "tenant-a:elder-a",
        tenantId: "tenant-a",
        elderId: "elder-a",
        episodeType: "voice_memory",
        occurredAt: new Date("2026-05-11T00:00:00.000Z").toISOString(),
        sourceIds: ["source-1"],
        eventIds: ["event-1"],
        content: "Elder said there may be a hospital follow-up.",
      }),
    ).resolves.toBeUndefined();

    await expect(
      store.searchFacts({
        groupId: "tenant-a:elder-a",
        tenantId: "tenant-a",
        elderId: "elder-a",
        query: "这个药后来有没有改过？",
      }),
    ).resolves.toEqual([]);

    await expect(
      store.getEntityTimeline({
        groupId: "tenant-a:elder-a",
        tenantId: "tenant-a",
        elderId: "elder-a",
        entityName: "降压药",
      }),
    ).resolves.toEqual([]);

    await expect(
      store.getCurrentFacts({
        groupId: "tenant-a:elder-a",
        tenantId: "tenant-a",
        elderId: "elder-a",
      }),
    ).resolves.toEqual([]);
  });
});

describe("buildTemporalGroupId", () => {
  it("uses tenant-scoped group id when tenantId is present", () => {
    expect(buildTemporalGroupId({ tenantId: "tenant-a", elderId: "elder-a" })).toBe("tenant-a:elder-a");
  });

  it("falls back to elder id for MVP callers without tenantId", () => {
    expect(buildTemporalGroupId({ elderId: "elder-a" })).toBe("elder-a");
  });
});
