import type { FamilyTask, MemoryAnswer, MemoryEvent, Reminder } from "@goldmem/memory-schema";
import { copy } from "./copy.js";

export type TodaySnapshotData = {
  pendingCount: number;
  todayReminderCount: number;
  recentMemoryCount: number;
};

export function buildTodaySnapshot(events: MemoryEvent[], reminders: Reminder[], familyTasks: FamilyTask[], now: Date): TodaySnapshotData {
  return {
    pendingCount: reminders.filter(needsReminderConfirmation).length + familyTasks.filter((task) => task.status === "pending").length,
    todayReminderCount: reminders.filter((reminder) => isActiveReminder(reminder) && reminder.remindAt && isSameLocalDay(new Date(reminder.remindAt), now)).length,
    recentMemoryCount: dedupeRecentMemories(events).length,
  };
}

export function needsReminderConfirmation(reminder: Reminder): boolean {
  return (
    reminder.confirmationRequired ||
    !reminder.remindAt ||
    reminder.status === "candidate" ||
    reminder.status === "pending_elder_confirm" ||
    reminder.status === "pending_family_confirm"
  );
}

export function selectTrustEvidence(answer: MemoryAnswer) {
  const items = answer.matchedSources.length ? answer.matchedSources : answer.retrievedEvidence;
  return items.slice(0, 3);
}

export function recallStateLabel(answer: MemoryAnswer): string {
  if (answer.confidence >= 0.65 && answer.retrievedEvidence.some((item) => item.retrievalSource === "postgres" || item.retrievalSource === "semantic")) {
    return copy.recall.certainTitle;
  }
  return copy.recall.possibleTitle;
}

export function trustEvidenceLabel(source: "postgres" | "semantic" | "context_link" | "graphiti" | "graphiti_provenance" | undefined): string {
  if (source === "context_link") return copy.recall.contextLinkEvidence;
  if (source === "graphiti" || source === "graphiti_provenance") return copy.recall.graphitiEvidence;
  return copy.recall.recordedEvidence;
}

export function quickReminderTimes(): Array<{ label: string; value: string }> {
  const now = new Date();
  return [
    { label: copy.reminders.quickTimes.morning, value: toDateTimeLocalValue(now, 7) },
    { label: copy.reminders.quickTimes.noon, value: toDateTimeLocalValue(now, 12) },
    { label: copy.reminders.quickTimes.evening, value: toDateTimeLocalValue(now, 19) },
  ];
}

export function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isActiveReminder(reminder: Reminder): boolean {
  return !["done", "cancelled", "expired"].includes(reminder.status);
}

function dedupeRecentMemories(events: MemoryEvent[]): MemoryEvent[] {
  const seen = new Set<string>();
  return events
    .filter((event) => event.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((event) => {
      const key = `${event.title}:${event.summary}`.replace(/\s+/g, "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function toDateTimeLocalValue(base: Date, hour: number): string {
  const value = new Date(base);
  value.setHours(hour, 0, 0, 0);
  if (value.getTime() < base.getTime()) value.setDate(value.getDate() + 1);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:00`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
