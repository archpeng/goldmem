import type { FamilyTask, MemoryContextLink, MemoryEvent, Reminder, RiskFlagRecord } from "@mem/memory-schema";

export type AppliedMemoryPlan = {
  events: MemoryEvent[];
  reminderCandidates: Reminder[];
  contextLinks: MemoryContextLink[];
  riskFlags: RiskFlagRecord[];
  familyTasks: FamilyTask[];
  timings: Record<string, number>;
};
