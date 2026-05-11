import { describe, expect, it } from "vitest";
import { buildDailyConsolidationTemporalEpisode, deriveTemporalLifecycleFacts } from "./consolidation.js";

const source = {
  id: "source-1",
  tenantId: "tenant-1",
  elderId: "elder-1",
  type: "text" as const,
  transcript: "今天复查改到下周一上午九点。",
  createdAt: "2026-05-11T03:00:00.000Z",
};

const event = {
  id: "event-1",
  tenantId: "tenant-1",
  elderId: "elder-1",
  sourceId: "source-1",
  type: "appointment" as const,
  title: "复查改期",
  summary: "社区医院复查改到下周一上午九点。",
  timeConfidence: 0.8,
  entities: [],
  importance: 0.8,
  confidence: 0.9,
  riskLevel: "medical" as const,
  requiresConfirmation: true,
  visibility: "shared_summary" as const,
  evidence: [{ sourceId: "source-1" }],
  status: "needs_review" as const,
  createdAt: "2026-05-11T03:00:01.000Z",
};

describe("buildDailyConsolidationTemporalEpisode", () => {
  it("builds a stable idempotent daily Graphiti episode from PostgreSQL truth records", () => {
    const first = buildDailyConsolidationTemporalEpisode({
      tenantId: "tenant-1",
      elderId: "elder-1",
      date: "2026-05-11",
      sources: [source],
      events: [event],
      traceId: "trace-daily-1",
    });
    const second = buildDailyConsolidationTemporalEpisode({
      tenantId: "tenant-1",
      elderId: "elder-1",
      date: "2026-05-11",
      sources: [source],
      events: [event],
      traceId: "trace-daily-1",
    });

    expect(first).toMatchObject({
      tenantId: "tenant-1",
      elderId: "elder-1",
      groupId: "tenant_tenant-1__elder_elder-1",
      episodeType: "daily_consolidation",
      sourceIds: ["source-1"],
      eventIds: ["event-1"],
      metadata: {
        traceId: "trace-daily-1",
        writeMode: "daily_consolidation",
        date: "2026-05-11",
      },
    });
    expect(first.metadata?.idempotencyKey).toBe(second.metadata?.idempotencyKey);
    expect(first.content.summary).toContain("1 条来源");
  });

  it("derives only the three supported temporal lifecycle fact types", () => {
    const medicationOriginal = { ...event, id: "event-med-1", type: "medication" as const, summary: "早饭后一片。", createdAt: "2026-05-11T01:00:00.000Z" };
    const medicationChanged = { ...event, id: "event-med-2", type: "medication" as const, summary: "晚饭后一片。", createdAt: "2026-05-11T02:00:00.000Z" };
    const appointmentOriginal = { ...event, id: "event-appt-1", type: "appointment" as const, summary: "周五下午复查。", createdAt: "2026-05-11T03:00:00.000Z" };
    const appointmentChanged = { ...event, id: "event-appt-2", type: "appointment" as const, summary: "改到下周一上午九点。", createdAt: "2026-05-11T04:00:00.000Z" };

    const facts = deriveTemporalLifecycleFacts({
      tenantId: "tenant-1",
      elderId: "elder-1",
      date: "2026-05-11",
      sources: [source],
      events: [medicationOriginal, medicationChanged, appointmentOriginal, appointmentChanged],
      familyTasks: [{
        id: "task-1",
        tenantId: "tenant-1",
        elderId: "elder-1",
        type: "risk_review",
        title: "家属确认",
        summary: "小敏确认了复查变化。",
        status: "confirmed",
        visibility: "shared_summary",
        urgency: "medium",
        relatedEventId: "event-appt-2",
        confirmedAt: "2026-05-11T05:00:00.000Z",
        createdAt: "2026-05-11T05:00:00.000Z",
      }],
    });

    expect(facts.map((fact) => fact.relationType)).toEqual([
      "medication_changed",
      "medication_changed",
      "appointment_rescheduled",
      "family_confirmed",
    ]);
    expect(facts[1]).toMatchObject({ previousFact: "早饭后一片。", currentFact: "晚饭后一片。" });
    expect(facts[2]).toMatchObject({ previousFact: "周五下午复查。", currentFact: "改到下周一上午九点。" });
  });
});
