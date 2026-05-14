import { describe, expect, it } from "vitest";
import type { MemoryPlan, MemorySource } from "@mem/memory-schema";
import { DefaultRiskEngine } from "./index.js";

describe("DefaultRiskEngine", () => {
  it("requires confirmation for medical, financial, fraud, and sensitive events", async () => {
    const engine = new DefaultRiskEngine();
    const plan = planWithEvents(["medical", "financial", "fraud_risk", "sensitive"]);

    const { plan: guarded } = await engine.enforce({ plan, source: source("普通记录。") });

    expect(guarded.events.every((event) => event.requiresConfirmation)).toBe(true);
  });

  it("creates a high-urgency family review task for fraud risk", async () => {
    const engine = new DefaultRiskEngine();

    const { plan: guarded } = await engine.enforce({ plan: planWithEvents(["fraud_risk"]), source: source("普通记录。") });

    expect(guarded.familyTasks).toEqual([
      expect.objectContaining({
        type: "risk_review",
        urgency: "high",
        visibility: "family_required",
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

    const { plan: guarded } = await engine.enforce({ plan, source: source("普通记录。") });

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

    const { plan: guarded } = await engine.enforce({ plan, source: source("普通记录。") });

    expect(guarded.reminderCandidates.every((item) => item.confirmationRequired)).toBe(true);
  });

  it("repairs model-missed password and identity safety risks from the source transcript", async () => {
    const engine = new DefaultRiskEngine();
    const plan = basePlan({
      events: [event({ riskLevel: "normal", requiresConfirmation: false })],
    });

    const result = await engine.enforce({
      plan,
      source: source("陌生人让我把身份证号和验证码发给他。"),
    });

    expect(result.plan.events[0]).toMatchObject({
      riskLevel: "fraud_risk",
      requiresConfirmation: true,
    });
    expect(result.plan.riskFlags.map((risk) => risk.type)).toEqual(expect.arrayContaining([
      "identity_document",
      "password_or_code",
      "fraud_suspected",
    ]));
    expect(result.plan.riskFlags.every((risk) => risk.requiresHumanConfirmation)).toBe(true);
    expect(result.plan.familyTasks.some((task) => task.type === "risk_review")).toBe(true);
    expect(JSON.stringify(result.repairs)).not.toContain("身份证号");
    expect(JSON.stringify(result.repairs)).not.toContain("验证码");
  });

  it("repairs model-missed medication safety risks from the source transcript", async () => {
    const engine = new DefaultRiskEngine();
    const plan = basePlan({
      events: [event({ type: "general", riskLevel: "normal", requiresConfirmation: false })],
    });

    const result = await engine.enforce({
      plan,
      source: source("医生说降压药剂量先减半，明天再看血压。"),
    });

    expect(result.plan.events[0]).toMatchObject({
      riskLevel: "medical",
      requiresConfirmation: true,
    });
    expect(result.plan.riskFlags.map((risk) => risk.type)).toEqual(expect.arrayContaining([
      "medication_change",
      "medical_advice",
    ]));
    expect(result.plan.riskFlags.find((risk) => risk.type === "medication_change")).toMatchObject({
      requiresFamilyReview: true,
      requiresHumanConfirmation: true,
    });
    expect(result.plan.familyTasks.some((task) => task.type === "risk_review")).toBe(false);
  });

  it("does not use deterministic safety scan as ordinary business understanding", async () => {
    const engine = new DefaultRiskEngine();
    const plan = basePlan({
      events: [event({ type: "general", riskLevel: "normal", requiresConfirmation: false })],
    });

    const result = await engine.enforce({
      plan,
      source: source("今天去城里买了青菜。"),
    });

    expect(result.plan.events[0]).toMatchObject({
      riskLevel: "normal",
      requiresConfirmation: false,
    });
    expect(result.plan.riskFlags).toHaveLength(0);
  });
});

function planWithEvents(riskLevels: Array<MemoryPlan["events"][number]["riskLevel"]>): MemoryPlan {
  return basePlan({
    events: riskLevels.map((riskLevel, index) => event({
      title: `Event ${index + 1}`,
      summary: `Event ${index + 1} summary.`,
      riskLevel,
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
    eventActionDecisions: [],
    riskFlags: input.riskFlags ?? [],
    familyTasks: input.familyTasks ?? [],
    contextLinks: [],
    relationEnrichmentSignals: [],
    memoryUpdates: [],
    uncertainties: [],
    evidence: [evidence()],
    modelInfo: { provider: "test", model: "test", promptVersion: "test" },
    confidence: 0.9,
  };
}

function event(input: Partial<MemoryPlan["events"][number]>): MemoryPlan["events"][number] {
  return {
    type: input.type ?? "general",
    title: input.title ?? "Event",
    summary: input.summary ?? "Event summary.",
    timeText: input.timeText ?? "未提到时间",
    timeConfidence: input.timeConfidence ?? 0.8,
    entities: input.entities ?? [],
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.8,
    riskLevel: input.riskLevel ?? "normal",
    requiresConfirmation: input.requiresConfirmation ?? false,
    visibility: input.visibility ?? "private",
    evidence: input.evidence ?? [evidence()],
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

function source(transcript: string): MemorySource {
  return {
    id: "source-1",
    tenantId: "tenant-mvp",
    elderId: "elder-1",
    type: "text",
    transcript,
    createdAt: "2026-05-09T12:00:00.000Z",
  };
}
