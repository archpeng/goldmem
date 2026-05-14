import type { TodaySnapshot } from "@mem/memory-schema";
import { copy } from "../lib/copy.js";

type Props = {
  snapshot: TodaySnapshot;
  onDismiss: (date: string) => void;
};

export function TodaySnapshotCard({ snapshot, onDismiss }: Props) {
  const todayTitles = snapshot.todayReminders.map((reminder) => reminder.title).slice(0, 3);
  const yesterdayTitles = snapshot.yesterdayConfirmed.map((reminder) => reminder.title).slice(0, 3);

  return (
    <section className="mt-2 rounded-2xl bg-slate-950 px-5 py-4 text-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-300">{copy.snapshot.title}</p>
          <p className="mt-1 text-base font-bold">
            {snapshot.todayReminders.length > 0
              ? `${copy.snapshot.todayPrefix} ${snapshot.todayReminders.length} ${copy.snapshot.todaySuffix}`
              : copy.snapshot.emptyToday}
          </p>
        </div>
        <button
          className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/20"
          type="button"
          onClick={() => onDismiss(snapshot.date)}
        >
          {copy.snapshot.dismiss}
        </button>
      </div>

      <div className="mt-3 space-y-2 text-sm leading-6 text-slate-200">
        <p>{todayTitles.length ? todayTitles.join("、") : copy.snapshot.emptyToday}</p>
        <p>
          {copy.snapshot.yesterdayLabel}
          {yesterdayTitles.length ? yesterdayTitles.join("、") : copy.snapshot.emptyYesterday}
        </p>
        <p>
          {copy.snapshot.weekLabel}
          {snapshot.weekTopics.length
            ? snapshot.weekTopics.map((topic) => `${topicLabel(topic.type)} ${topic.count}`).join("、")
            : copy.snapshot.emptyWeek}
        </p>
      </div>
    </section>
  );
}

function topicLabel(type: TodaySnapshot["weekTopics"][number]["type"]): string {
  return copy.eventTypes[type] ?? type;
}
