import type { ReactNode } from "react";
import { Bell, Clock, Sparkles } from "lucide-react";
import { copy } from "../lib/copy.js";
import type { TodaySnapshotData } from "../lib/elder-view-model.js";

export function TodaySnapshot({ snapshot }: { snapshot: TodaySnapshotData }) {
  return (
    <section className="rounded-2xl bg-emerald-950 px-5 py-5 text-white">
      <p className="text-base text-emerald-100">{copy.today.kicker}</p>
      <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-normal">
        {snapshot.pendingCount ? copy.today.hasActions : copy.today.noActions}
      </h2>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <Metric icon={<Bell className="h-5 w-5" />} label={copy.today.needsConfirmation} value={snapshot.pendingCount} />
        <Metric icon={<Clock className="h-5 w-5" />} label={copy.today.todayReminders} value={snapshot.todayReminderCount} />
        <Metric icon={<Sparkles className="h-5 w-5" />} label={copy.today.recentMemories} value={snapshot.recentMemoryCount} />
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-3">
      <div className="flex items-center gap-1 text-emerald-100">{icon}</div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="text-sm leading-5 text-emerald-100">{label}</p>
    </div>
  );
}
