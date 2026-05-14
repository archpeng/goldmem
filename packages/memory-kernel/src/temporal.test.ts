import { describe, expect, it } from "vitest";
import { NullTemporalMemoryStore } from "@mem/temporal-memory";
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

  it("includes structured reminder and context-link time provenance", () => {
    const episode = buildMemorySourceTemporalEpisode({
      tenantId: "tenant-1",
      elderId: "elder-1",
      source,
      events: [event],
      reminders: [{
        id: "reminder-1",
        tenantId: "tenant-1",
        elderId: "elder-1",
        sourceId: "source-1",
        eventId: "event-1",
        title: "医院复查",
        timeText: "周五下午",
        remindAt: "2026-05-15T07:00:00.000Z",
        timeConfidence: 0.6,
        status: "pending_family_confirm",
        confirmationRequired: true,
        confidence: 0.8,
        reason: "医疗复查提醒需要确认。",
        createdAt: "2026-05-11T10:00:02.000Z",
      }],
      contextLinks: [{
        id: "link-1",
        tenantId: "tenant-1",
        elderId: "elder-1",
        fromEventId: "event-1",
        toEventId: "event-prior",
        reminderId: "reminder-1",
        type: "fills_missing_time",
        status: "needs_confirmation",
        confidence: 0.7,
        reason: "可能补充了已有复查提醒的时间。",
        evidence: [{ sourceId: "source-1", quote: "周五下午" }],
        createdAt: "2026-05-11T10:00:03.000Z",
      }],
    });

    expect(episode.content).toMatchObject({
      reminders: [{ id: "reminder-1", timeText: "周五下午", timeConfidence: 0.6 }],
      contextLinks: [{ id: "link-1", reminderId: "reminder-1", type: "fills_missing_time" }],
    });
    expect(episode.metadata?.temporalAnchors).toMatchObject({
      reminderIds: ["reminder-1"],
      contextLinkIds: ["link-1"],
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
