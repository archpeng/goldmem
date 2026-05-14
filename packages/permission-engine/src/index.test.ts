import { describe, expect, it } from "vitest";
import type { MemoryPlan } from "@mem/memory-schema";
import { DefaultPermissionEngine } from "./index.js";

describe("DefaultPermissionEngine", () => {
  it("keeps normal events private even when they require confirmation", async () => {
    const engine = new DefaultPermissionEngine();
    const plan = basePlan({
      events: [
        event({ riskLevel: "normal", requiresConfirmation: false }),
        event({ riskLevel: "normal", requiresConfirmation: true }),
      ],
    });

    const permissioned = await engine.applyDefaultVisibility(plan, "elder-1");

    expect(permissioned.events[0]?.visibility).toBe("private");
    expect(permissioned.events[1]?.visibility).toBe("private");
  });

  it("applies deterministic visibility for risk levels", async () => {
    const engine = new DefaultPermissionEngine();
    const plan = basePlan({
      events: [
        event({ riskLevel: "medical" }),
        event({ riskLevel: "financial" }),
        event({ riskLevel: "fraud_risk" }),
        event({ riskLevel: "sensitive" }),
      ],
    });

    const permissioned = await engine.applyDefaultVisibility(plan, "elder-1");

    expect(permissioned.events.map((item) => item.visibility)).toEqual([
      "private",
      "family_required",
      "family_required",
      "private",
    ]);
  });

  it("downgrades family task full sharing to summary sharing", async () => {
    const engine = new DefaultPermissionEngine();
    const plan = basePlan({
      familyTasks: [{
        type: "risk_review",
        title: "Review risk",
        summary: "Risk summary.",
        urgency: "high",
        visibility: "shared_full",
      }],
    });

    const permissioned = await engine.applyDefaultVisibility(plan, "elder-1");

    expect(permissioned.familyTasks[0]?.visibility).toBe("shared_summary");
  });

  it("keeps high-risk family tasks family-required", async () => {
    const engine = new DefaultPermissionEngine();
    const plan = basePlan({
      familyTasks: [{
        type: "risk_review",
        title: "Review risk",
        summary: "Risk summary.",
        urgency: "high",
        visibility: "family_required",
      }],
    });

    const permissioned = await engine.applyDefaultVisibility(plan, "elder-1");

    expect(permissioned.familyTasks[0]?.visibility).toBe("family_required");
  });
});

function basePlan(input: Partial<MemoryPlan>): MemoryPlan {
  return {
    tenantId: "tenant-mvp",
    sourceId: "source-1",
    elderId: "elder-1",
    summary: "Summary",
    events: input.events ?? [],
    reminderCandidates: [],
    eventActionDecisions: [],
    riskFlags: [],
    familyTasks: input.familyTasks ?? [],
    contextLinks: [],
    relationEnrichmentSignals: [],
    memoryUpdates: [],
    uncertainties: [],
    evidence: [{ sourceId: "source-1", quote: "source quote" }],
    modelInfo: { provider: "test", model: "test", promptVersion: "test" },
    confidence: 0.9,
  };
}

function event(input: Partial<MemoryPlan["events"][number]>): MemoryPlan["events"][number] {
  return {
    type: "general",
    title: "Event",
    summary: "Event summary.",
    timeText: "未提到时间",
    timeConfidence: 0.8,
    entities: [],
    importance: 0.5,
    confidence: 0.8,
    riskLevel: input.riskLevel ?? "normal",
    requiresConfirmation: input.requiresConfirmation ?? false,
    visibility: input.visibility ?? "private",
    evidence: [{ sourceId: "source-1", quote: "source quote" }],
  };
}
