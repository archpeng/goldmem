import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTemporalGroupId,
  GraphitiTemporalMemoryStore,
  NullTemporalMemoryStore,
  TemporalMemoryNotConfiguredError,
  parseAddTemporalEpisodeInput,
} from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NullTemporalMemoryStore", () => {
  it("surfaces missing Graphiti config instead of silently succeeding", async () => {
    const store = new NullTemporalMemoryStore();

    await expect(
      store.addEpisode({
        groupId: "tenant_tenant-a__elder_elder-a",
        tenantId: "tenant-a",
        elderId: "elder-a",
        episodeType: "voice_memory",
        occurredAt: new Date("2026-05-11T00:00:00.000Z").toISOString(),
        sourceIds: ["source-1"],
        eventIds: ["event-1"],
        content: { summary: "Elder said there may be a hospital follow-up." },
      }),
    ).rejects.toBeInstanceOf(TemporalMemoryNotConfiguredError);

    await expect(
      store.searchFacts({
        groupId: "tenant_tenant-a__elder_elder-a",
        tenantId: "tenant-a",
        elderId: "elder-a",
        query: "这个药后来有没有改过？",
      }),
    ).rejects.toBeInstanceOf(TemporalMemoryNotConfiguredError);

    await expect(
      store.getEntityTimeline({
        groupId: "tenant_tenant-a__elder_elder-a",
        tenantId: "tenant-a",
        elderId: "elder-a",
        entityName: "降压药",
        entityType: "medicine",
      }),
    ).rejects.toBeInstanceOf(TemporalMemoryNotConfiguredError);

    await expect(
      store.getCurrentFacts({
        groupId: "tenant_tenant-a__elder_elder-a",
        tenantId: "tenant-a",
        elderId: "elder-a",
      }),
    ).rejects.toBeInstanceOf(TemporalMemoryNotConfiguredError);
  });
});

describe("buildTemporalGroupId", () => {
  it("requires tenant-scoped Graphiti-safe group ids", () => {
    expect(buildTemporalGroupId({ tenantId: "tenant-a", elderId: "elder-a" })).toBe("tenant_tenant-a__elder_elder-a");
    expect(buildTemporalGroupId({ tenantId: "tenant:a", elderId: "老人-1" })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("parseAddTemporalEpisodeInput", () => {
  it("validates persisted temporal jobs before replaying them", () => {
    expect(parseAddTemporalEpisodeInput({
      groupId: "tenant_tenant-a__elder_elder-a",
      tenantId: "tenant-a",
      elderId: "elder-a",
      episodeType: "text_memory",
      occurredAt: "2026-05-11T00:00:00.000Z",
      sourceIds: ["source-1"],
      eventIds: ["event-1"],
      content: { summary: "周五复查。" },
      metadata: { source: "kernel" },
    })).toEqual(expect.objectContaining({
      episodeType: "text_memory",
      occurredAt: "2026-05-11T00:00:00.000Z",
      sourceIds: ["source-1"],
      eventIds: ["event-1"],
    }));

    expect(() => parseAddTemporalEpisodeInput({
      groupId: "tenant_tenant-a__elder_elder-a",
      tenantId: "tenant-a",
      elderId: "elder-a",
      episodeType: "unknown",
      occurredAt: "not-a-date",
      sourceIds: [],
      eventIds: ["event-1"],
      content: { summary: "bad" },
    })).toThrow();
  });
});

describe("GraphitiTemporalMemoryStore", () => {
  it("writes JSON episodes with tenant scoped metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const store = new GraphitiTemporalMemoryStore({ baseUrl: "https://graphiti.example", apiKey: "key-1" });

    await store.addEpisode({
      groupId: "tenant_tenant-a__elder_elder-a",
      tenantId: "tenant-a",
      elderId: "elder-a",
      episodeType: "text_memory",
      occurredAt: "2026-05-11T00:00:00.000Z",
      sourceIds: ["source-1"],
      eventIds: ["event-1"],
      content: { summary: "周五复查，需要带医保卡。" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graphiti.example/add_episode",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "key-1" }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      source: "json",
      group_id: "tenant_tenant-a__elder_elder-a",
      metadata: {
        tenantId: "tenant-a",
        elderId: "elder-a",
        groupId: "tenant_tenant-a__elder_elder-a",
        sourceIds: ["source-1"],
        eventIds: ["event-1"],
      },
    });
  });

  it("normalizes only source-aligned Graphiti facts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          facts: [
            {
              id: "fact-1",
              origin: "provenance_fallback",
              fact: "降压药从早饭后改为晚饭后。",
              score: 0.87,
              entity_names: ["降压药"],
              metadata: { sourceId: "source-1", eventId: "event-1", episodeId: "episode-1" },
            },
            {
              id: "fact-unlinked",
              fact: "没有来源的事实不能进入 GoldMem evidence。",
              score: 0.99,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const store = new GraphitiTemporalMemoryStore({ baseUrl: "https://graphiti.example" });

    const facts = await store.searchFacts({
      groupId: "tenant_tenant-a__elder_elder-a",
      tenantId: "tenant-a",
      elderId: "elder-a",
      query: "这个药后来有没有改过？",
      timeRange: {
        start: "2026-05-10T00:00:00.000Z",
        end: "2026-05-11T00:00:00.000Z",
        confidence: 0.5,
      } as never,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.timeRange).toEqual({
      start: "2026-05-10T00:00:00.000Z",
      end: "2026-05-11T00:00:00.000Z",
    });
    expect(facts).toEqual([
      expect.objectContaining({
        retrievalSource: "graphiti",
        origin: "provenance_fallback",
        sourceId: "source-1",
        eventId: "event-1",
        episodeId: "episode-1",
        fact: "降压药从早饭后改为晚饭后。",
      }),
    ]);
  });
});
