import type { MemoryPlan } from "@goldmem/memory-schema";

export interface RiskEngine {
  enforce(plan: MemoryPlan): Promise<MemoryPlan>;
}

export class DefaultRiskEngine implements RiskEngine {
  async enforce(plan: MemoryPlan): Promise<MemoryPlan> {
    const next: MemoryPlan = structuredClone(plan);

    for (const event of next.events) {
      if (["medical", "financial", "fraud_risk", "sensitive"].includes(event.riskLevel)) {
        event.requiresConfirmation = true;
      }

      if (event.riskLevel === "fraud_risk") {
        next.familyTasks.push({
          type: "risk_review",
          title: "Possible fraud or financial risk needs review",
          summary: event.summary,
          urgency: "high",
          visibility: "shared_summary",
        });
      }
    }

    for (const reminder of next.reminderCandidates) {
      if (!reminder.remindAt || reminder.timeConfidence < 0.7) {
        reminder.confirmationRequired = true;
      }
    }

    for (const risk of next.riskFlags) {
      if (["password_or_code", "financial_transfer", "medication_change"].includes(risk.type)) {
        risk.requiresHumanConfirmation = true;
        risk.requiresFamilyReview = true;
      }
    }

    return next;
  }
}
