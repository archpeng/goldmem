import type { MemoryContextLink, MemoryEvent, Reminder, RiskFlagRecord } from "@goldmem/memory-schema";

export type AppliedMemoryPlan = {
  events: MemoryEvent[];
  reminderCandidates: Reminder[];
  contextLinks: MemoryContextLink[];
  riskFlags: RiskFlagRecord[];
  timings: Record<string, number>;
};
