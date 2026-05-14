import type { MemoryPlan } from "@mem/memory-schema";

export interface PermissionEngine {
  applyDefaultVisibility(plan: MemoryPlan, elderId: string): Promise<MemoryPlan>;
}

export class DefaultPermissionEngine implements PermissionEngine {
  async applyDefaultVisibility(plan: MemoryPlan): Promise<MemoryPlan> {
    const next = clonePlan(plan);

    for (const event of next.events) {
      if (event.riskLevel === "financial" || event.riskLevel === "fraud_risk") {
        event.visibility = "family_required";
      } else {
        event.visibility = "private";
      }
    }

    for (const task of next.familyTasks) {
      if (task.visibility === "shared_full") {
        task.visibility = "shared_summary";
      }
    }

    return next;
  }
}

function clonePlan(plan: MemoryPlan): MemoryPlan {
  return JSON.parse(JSON.stringify(plan)) as MemoryPlan;
}
