import type { Reminder, TodaySnapshot } from "@mem/memory-schema";
import type { EventStore, ReminderStore } from "@mem/memory-store";

export type GetTodaySnapshotDeps = {
  eventStore: EventStore;
  reminderStore: ReminderStore;
};

export type GetTodaySnapshotInput = {
  tenantId: string;
  elderId: string;
  now: string;
  timezone: string;
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

const TODAY_REMINDER_STATUSES: Reminder["status"][] = ["confirmed", "scheduled", "sent"];

export async function getTodaySnapshot(
  deps: GetTodaySnapshotDeps,
  input: GetTodaySnapshotInput,
): Promise<TodaySnapshot> {
  const now = new Date(input.now);
  const today = localDateParts(now, input.timezone);
  const yesterday = addLocalDays(today, -1);
  const tomorrow = addLocalDays(today, 1);
  const weekStart = addLocalDays(today, -6);

  const todayStart = zonedStartOfDayIso(today, input.timezone);
  const todayEnd = zonedStartOfDayIso(tomorrow, input.timezone);
  const yesterdayStart = zonedStartOfDayIso(yesterday, input.timezone);
  const weekStartIso = zonedStartOfDayIso(weekStart, input.timezone);

  const [todayReminders, yesterdayConfirmed, weekTopics] = await Promise.all([
    deps.reminderStore.findByRemindAtRange({
      tenantId: input.tenantId,
      elderId: input.elderId,
      fromIso: todayStart,
      toIso: todayEnd,
      statuses: TODAY_REMINDER_STATUSES,
    }),
    deps.reminderStore.findByConfirmedAtRange({
      tenantId: input.tenantId,
      elderId: input.elderId,
      fromIso: yesterdayStart,
      toIso: todayStart,
    }),
    deps.eventStore.aggregateByTypeWithin({
      tenantId: input.tenantId,
      elderId: input.elderId,
      fromIso: weekStartIso,
      limit: 5,
    }),
  ]);

  return {
    date: formatLocalDate(today),
    todayReminders,
    yesterdayConfirmed,
    weekTopics,
  };
}

function localDateParts(date: Date, timezone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
  };
}

function zonedStartOfDayIso(date: LocalDateParts, timezone: string): string {
  return zonedWallTimeToUtc(date, timezone).toISOString();
}

function zonedWallTimeToUtc(date: LocalDateParts, timezone: string): Date {
  const targetUtc = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0);
  let guess = targetUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedDateTimeParts(new Date(guess), timezone);
    const renderedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offset = renderedAsUtc - targetUtc;
    guess -= offset;
  }

  return new Date(guess);
}

function zonedDateTimeParts(date: Date, timezone: string): LocalDateParts & { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute"),
    second: numberPart(parts, "second"),
  };
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) throw new Error(`Missing ${type} from timezone formatter`);
  return Number(value);
}

function addLocalDays(date: LocalDateParts, days: number): LocalDateParts {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function formatLocalDate(date: LocalDateParts): string {
  return [
    String(date.year).padStart(4, "0"),
    String(date.month).padStart(2, "0"),
    String(date.day).padStart(2, "0"),
  ].join("-");
}
