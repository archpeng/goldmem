import type { FamilyTask, MemoryAnswer, MemoryEvent, Reminder } from "@goldmem/memory-schema";
import { copy } from "./copy.js";

export type TodaySnapshotData = {
  elderPendingCount: number;
  familyPendingCount: number;
  todayReminderCount: number;
  recentMemoryCount: number;
};

export type ElderTaskFilter = "all" | "elder_pending" | "family_pending" | "today" | "recent";

export type ElderTaskItem = {
  id: string;
  kind: "reminder" | "family_task" | "event";
  title: string;
  subtitle: string;
  statusLabel: string;
  timeLabel?: string;
  urgent: boolean;
  reminder?: Reminder;
};

export function buildTodaySnapshot(events: MemoryEvent[], reminders: Reminder[], familyTasks: FamilyTask[], now: Date): TodaySnapshotData {
  return {
    elderPendingCount: reminders.filter(needsReminderConfirmation).length,
    familyPendingCount: familyTasks.filter((task) => task.status === "pending").length,
    todayReminderCount: reminders.filter((reminder) => isActiveReminder(reminder) && reminder.remindAt && isSameLocalDay(new Date(reminder.remindAt), now)).length,
    recentMemoryCount: dedupeRecentMemories(events).length,
  };
}

export function buildTaskItems(events: MemoryEvent[], reminders: Reminder[], familyTasks: FamilyTask[], now: Date): ElderTaskItem[] {
  const pendingReminders = reminders
    .filter(needsReminderConfirmation)
    .map((reminder) => reminderTask(reminder, copy.tasks.needsConfirmation, true));
  const pendingFamilyTasks = familyTasks
    .filter((task) => task.status === "pending")
    .map((task) => ({
      id: `family:${task.id}`,
      kind: "family_task" as const,
      title: task.title,
      subtitle: task.summary,
      statusLabel: copy.tasks.familyWaiting,
      urgent: task.urgency === "high",
    }));
  const pendingReminderIds = new Set(pendingReminders.map((item) => item.reminder?.id).filter(Boolean));
  const confirmedReminders = reminders
    .filter((reminder) => !pendingReminderIds.has(reminder.id))
    .filter((reminder) => isActiveReminder(reminder) && (reminder.status === "confirmed" || reminder.status === "scheduled"))
    .map((reminder) => reminderTask(reminder, copy.tasks.confirmedReminder, false));
  const todayReminders = reminders
    .filter((reminder) => !pendingReminderIds.has(reminder.id))
    .filter((reminder) => !confirmedReminders.some((item) => item.reminder?.id === reminder.id))
    .filter((reminder) => isActiveReminder(reminder) && reminder.remindAt && isSameLocalDay(new Date(reminder.remindAt), now))
    .map((reminder) => reminderTask(reminder, copy.tasks.todayReminder, false));
  const recentEvents = dedupeRecentMemories(events).map((event) => ({
    id: `event:${event.id}`,
    kind: "event" as const,
    title: event.title,
    subtitle: event.summary,
    statusLabel: copy.tasks.recentMemory,
    timeLabel: formatDate(event.createdAt),
    urgent: event.requiresConfirmation || event.riskLevel !== "normal",
  }));

  return [...pendingReminders, ...pendingFamilyTasks, ...confirmedReminders, ...todayReminders, ...recentEvents];
}

export function filterTaskItems(items: ElderTaskItem[], filter: ElderTaskFilter, now: Date): ElderTaskItem[] {
  if (filter === "elder_pending") {
    return items.filter((item) => item.kind === "reminder" && item.statusLabel === copy.tasks.needsConfirmation);
  }
  if (filter === "family_pending") {
    return items.filter((item) => item.kind === "family_task" && item.statusLabel === copy.tasks.familyWaiting);
  }
  if (filter === "today") {
    return items.filter((item) => item.reminder?.remindAt && isSameLocalDay(new Date(item.reminder.remindAt), now));
  }
  if (filter === "recent") {
    return items.filter((item) => item.kind === "event");
  }
  return items;
}

export function needsReminderConfirmation(reminder: Reminder): boolean {
  if (!isOpenReminder(reminder)) return false;
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

function reminderTask(reminder: Reminder, statusLabel: string, urgent: boolean): ElderTaskItem {
  return {
    id: `reminder:${reminder.id}`,
    kind: "reminder",
    title: reminder.title,
    subtitle: reminder.reason,
    statusLabel,
    timeLabel: reminder.remindAt ? formatDate(reminder.remindAt) : reminder.timeText,
    urgent,
    reminder,
  };
}

function isActiveReminder(reminder: Reminder): boolean {
  return !["done", "cancelled", "expired"].includes(reminder.status);
}

function isOpenReminder(reminder: Reminder): boolean {
  return !["confirmed", "scheduled", "sent", "done", "cancelled", "expired"].includes(reminder.status);
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
