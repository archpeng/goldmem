import type { MemoryPlan } from "@goldmem/memory-schema";

export interface PermissionEngine {
  applyDefaultVisibility(plan: MemoryPlan, elderId: string): Promise<MemoryPlan>;
}

export class DefaultPermissionEngine implements PermissionEngine {
  async applyDefaultVisibility(plan: MemoryPlan): Promise<MemoryPlan> {
    const next: MemoryPlan = structuredClone(plan);

    for (const event of next.events) {
      if (event.riskLevel === "normal") {
        event.visibility = event.requiresConfirmation ? "shared_summary" : "private";
      }

      if (event.riskLevel === "medical") {
        event.visibility = "shared_summary";
      }

      if (event.riskLevel === "financial" || event.riskLevel === "fraud_risk") {
        event.visibility = "family_required";
      }

      if (event.riskLevel === "sensitive") {
        event.visibility = "private";
      }
    }

    for (const task of next.familyTasks) {
      if (task.type === "risk_review") {
        task.visibility = "shared_summary";
      }
    }

    return next;
  }
}
