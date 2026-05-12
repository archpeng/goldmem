import type { ReactNode } from "react";
import { Bell, Clock, ShieldCheck, Sparkles } from "lucide-react";
import { copy } from "../lib/copy.js";
import type { ElderTaskFilter, TodaySnapshotData } from "../lib/elder-view-model.js";

type MetricConfig = {
  icon: ReactNode;
  key: Exclude<ElderTaskFilter, "all">;
  label: string;
  value: number;
};

export function TodaySnapshot({
  activeFilter,
  onFilterChange,
  snapshot,
}: {
  activeFilter: ElderTaskFilter;
  onFilterChange: (filter: ElderTaskFilter) => void;
  snapshot: TodaySnapshotData;
}) {
  const actionCount = snapshot.elderPendingCount + snapshot.familyPendingCount;
  const metrics: MetricConfig[] = [
    { icon: <Bell className="h-5 w-5" />, key: "elder_pending", label: copy.today.needsConfirmation, value: snapshot.elderPendingCount },
    { icon: <ShieldCheck className="h-5 w-5" />, key: "family_pending", label: copy.today.familyConfirmation, value: snapshot.familyPendingCount },
    { icon: <Clock className="h-5 w-5" />, key: "today", label: copy.today.todayReminders, value: snapshot.todayReminderCount },
    { icon: <Sparkles className="h-5 w-5" />, key: "recent", label: copy.today.recentMemories, value: snapshot.recentMemoryCount },
  ];

  return (
    <section className="rounded-2xl bg-white px-4 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-blue-600">{copy.today.kicker}</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight tracking-normal text-slate-950">
            {actionCount ? copy.today.hasActions : copy.today.noActions}
          </h2>
        </div>
        <div className="min-w-12 rounded-full bg-blue-600 px-3 py-1 text-center text-2xl font-bold leading-9 text-white">
          {actionCount}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {metrics.map((metric) => (
          <Metric
            active={activeFilter === metric.key}
            icon={metric.icon}
            key={metric.key}
            label={metric.label}
            value={metric.value}
            onClick={() => onFilterChange(activeFilter === metric.key ? "all" : metric.key)}
          />
        ))}
      </div>
    </section>
  );
}

function Metric({ active, icon, label, onClick, value }: { active: boolean; icon: ReactNode; label: string; onClick: () => void; value: number }) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-xl px-3 py-2 text-left transition ${active ? "bg-blue-600 text-white" : "bg-[#f2f2f7] text-slate-950"}`}
      type="button"
      onClick={onClick}
    >
      <div className={`flex items-center gap-1 ${active ? "text-white/80" : "text-slate-500"}`}>{icon}</div>
      <p className="mt-1 text-xl font-bold">{value}</p>
      <p className={`text-xs leading-4 ${active ? "text-white/80" : "text-slate-500"}`}>{label}</p>
    </button>
  );
}
