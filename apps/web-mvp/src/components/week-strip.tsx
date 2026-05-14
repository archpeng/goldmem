export function WeekStrip({ now }: { now: Date }) {
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const today = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - today);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + index);
    return { label: days[index], date: date.getDate(), isToday: index === today };
  });

  return (
    <div className="flex items-center justify-between px-6 py-3">
      {week.map((day) => (
        <div className="flex flex-col items-center gap-1" key={day.date}>
          <span className="text-[10px] font-medium text-slate-400">{day.label}</span>
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${day.isToday ? "bg-slate-950 text-white" : "text-slate-500"}`}>
            {day.date}
          </span>
        </div>
      ))}
    </div>
  );
}
