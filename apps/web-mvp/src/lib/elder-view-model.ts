import type { MemoryAnswer, Reminder } from "@goldmem/memory-schema";
import { copy } from "./copy.js";

export type ElderTaskItem = {
  id: string;
  title: string;
  subtitle: string;
  description?: string;
  statusLabel: string;
  timeLabel?: string;
  reminder: Reminder;
};

export function buildTaskItems(reminders: Reminder[], now: Date): ElderTaskItem[] {
  const pendingReminders = reminders
    .filter(needsReminderConfirmation)
    .map((reminder) => reminderTask(reminder, copy.tasks.needsConfirmation));
  const pendingReminderIds = new Set(pendingReminders.map((item) => item.reminder?.id).filter(Boolean));
  const confirmedReminders = reminders
    .filter((reminder) => !pendingReminderIds.has(reminder.id))
    .filter((reminder) => isActiveReminder(reminder) && (reminder.status === "confirmed" || reminder.status === "scheduled"))
    .map((reminder) => reminderTask(reminder, copy.tasks.confirmedReminder));
  const todayReminders = reminders
    .filter((reminder) => !pendingReminderIds.has(reminder.id))
    .filter((reminder) => !confirmedReminders.some((item) => item.reminder?.id === reminder.id))
    .filter((reminder) => isActiveReminder(reminder) && reminder.remindAt && isSameLocalDay(new Date(reminder.remindAt), now))
    .map((reminder) => reminderTask(reminder, copy.tasks.todayReminder));

  return [...pendingReminders, ...confirmedReminders, ...todayReminders];
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

function reminderTask(reminder: Reminder, statusLabel: string): ElderTaskItem {
  return {
    id: `reminder:${reminder.id}`,
    title: reminder.title,
    subtitle: reminder.reason,
    description: reminder.description,
    statusLabel,
    timeLabel: reminder.remindAt ? formatDate(reminder.remindAt) : reminder.timeText,
    reminder,
  };
}

function isActiveReminder(reminder: Reminder): boolean {
  return !["done", "cancelled", "expired"].includes(reminder.status);
}

function isOpenReminder(reminder: Reminder): boolean {
  return !["confirmed", "scheduled", "sent", "done", "cancelled", "expired"].includes(reminder.status);
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
