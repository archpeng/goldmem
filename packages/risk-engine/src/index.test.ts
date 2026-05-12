import { describe, expect, it } from "vitest";
import type { MemoryPlan } from "@goldmem/memory-schema";
import { DefaultRiskEngine } from "./index.js";

describe("DefaultRiskEngine", () => {
  it("requires confirmation for medical, financial, fraud, and sensitive events", async () => {
    const engine = new DefaultRiskEngine();
    const plan = planWithEvents(["medical", "financial", "fraud_risk", "sensitive"]);

    const guarded = await engine.enforce(plan);

    expect(guarded.events.every((event) => event.requiresConfirmation)).toBe(true);
  });

  it("creates a high-urgency family review task for fraud risk", async () => {
    const engine = new DefaultRiskEngine();

    const guarded = await engine.enforce(planWithEvents(["fraud_risk"]));

    expect(guarded.familyTasks).toEqual([
      expect.objectContaining({
        type: "risk_review",
        urgency: "high",
        visibility: "shared_summary",
      }),
    ]);
  });

  it("requires human and family review for high-risk flags", async () => {
    const engine = new DefaultRiskEngine();
    const plan = basePlan({
      riskFlags: [
        riskFlag("password_or_code"),
        riskFlag("financial_transfer"),
        riskFlag("medication_change"),
      ],
    });

    const guarded = await engine.enforce(plan);

    expect(guarded.riskFlags.every((risk) => risk.requiresHumanConfirmation)).toBe(true);
    expect(guarded.riskFlags.every((risk) => risk.requiresFamilyReview)).toBe(true);
  });

  it("requires confirmation for missing or low-confidence reminder times", async () => {
    const engine = new DefaultRiskEngine();
    const plan = basePlan({
      reminderCandidates: [
        reminder({ remindAt: undefined, timeConfidence: 0 }),
        reminder({ remindAt: "2026-05-10T09:00:00.000Z", timeConfidence: 0.6 }),
      ],
    });

    const guarded = await engine.enforce(plan);

    expect(guarded.reminderCandidates.every((item) => item.confirmationRequired)).toBe(true);
  });
});

function planWithEvents(riskLevels: Array<MemoryPlan["events"][number]["riskLevel"]>): MemoryPlan {
  return basePlan({
    events: riskLevels.map((riskLevel, index) => ({
      type: "general",
      title: `Event ${index + 1}`,
      summary: `Event ${index + 1} summary.`,
      timeText: "未提到时间",
      timeConfidence: 0.8,
      entities: [],
      importance: 0.5,
      confidence: 0.8,
      riskLevel,
      requiresConfirmation: false,
      visibility: "private",
      evidence: [evidence()],
    })),
  });
}

function basePlan(input: Partial<MemoryPlan>): MemoryPlan {
  return {
    tenantId: "tenant-mvp",
    sourceId: "source-1",
    elderId: "elder-1",
    summary: "Summary",
    events: input.events ?? [],
    reminderCandidates: input.reminderCandidates ?? [],
    riskFlags: input.riskFlags ?? [],
    familyTasks: input.familyTasks ?? [],
    contextLinks: [],
    memoryUpdates: [],
    uncertainties: [],
    evidence: [evidence()],
    modelInfo: { provider: "test", model: "test", promptVersion: "test" },
    confidence: 0.9,
  };
}

function reminder(input: Partial<MemoryPlan["reminderCandidates"][number]>): MemoryPlan["reminderCandidates"][number] {
  return {
    title: "Reminder",
    timeText: input.timeText ?? "未提到时间",
    remindAt: input.remindAt,
    timeConfidence: input.timeConfidence ?? 0.9,
    confirmationRequired: false,
    suggestedConfirmers: [],
    confidence: 0.8,
    reason: "Reminder reason.",
  };
}

function riskFlag(type: MemoryPlan["riskFlags"][number]["type"]): MemoryPlan["riskFlags"][number] {
  return {
    type,
    severity: "high",
    summary: "Risk summary.",
    reason: "Risk reason.",
    requiresFamilyReview: false,
    requiresHumanConfirmation: false,
    evidence: [evidence()],
  };
}

function evidence() {
  return { sourceId: "source-1", quote: "source quote" };
}
