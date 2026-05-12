import { useState } from "react";
import { Bell, Check, Send } from "lucide-react";
import type { MemoryAnswer, Reminder } from "@goldmem/memory-schema";
import { copy } from "../lib/copy.js";
import {
  formatDate,
  quickReminderTimes,
  selectTrustEvidence,
  trustEvidenceLabel,
  type ElderTaskItem,
} from "../lib/elder-view-model.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Textarea } from "./ui/textarea.js";

export function TaskList({
  confirmTimes,
  items,
  loading,
  onConfirmReminder,
  onTimeChange,
}: {
  confirmTimes: Record<string, string>;
  items: ElderTaskItem[];
  loading: boolean;
  onConfirmReminder: (reminder: Reminder) => void | Promise<void>;
  onTimeChange: (id: string, value: string) => void;
}) {
  const [urgentIds, setUrgentIds] = useState<Set<string>>(() => new Set());
  const urgentItems = items.filter((item) => urgentIds.has(item.id));
  const normalItems = items.filter((item) => !urgentIds.has(item.id));
  const sections = [
    { title: copy.tasks.urgent, items: urgentItems },
    { title: copy.tasks.needsConfirmation, items: normalItems.filter((item) => item.statusLabel === copy.tasks.needsConfirmation) },
    { title: copy.tasks.confirmedReminder, items: normalItems.filter((item) => item.statusLabel === copy.tasks.confirmedReminder) },
    { title: copy.tasks.todayReminder, items: normalItems.filter((item) => item.statusLabel === copy.tasks.todayReminder) },
  ].filter((section) => section.items.length);
  const toggleUrgent = (id: string) => {
    setUrgentIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[1.65rem] font-bold leading-tight text-slate-950">{copy.tasks.title}</h2>
        <span className="text-base font-semibold text-slate-500">{items.length}</span>
      </div>

      {items.length ? (
        <div>
          {sections.map((section) => (
            <div className="mt-3" key={section.title}>
              <div className="flex items-center justify-between px-1 pb-1">
                <h3 className="text-sm font-semibold text-slate-500">{section.title}</h3>
                <span className="text-sm font-medium text-slate-400">{section.items.length}</span>
              </div>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
                <div className="divide-y divide-slate-200">
                  {section.items.map((item) => (
                    <TaskRow
                      confirmTime={confirmTimes[item.reminder.id] ?? ""}
                      item={item}
                      key={item.id}
                      loading={loading}
                      onConfirmReminder={onConfirmReminder}
                      onTimeChange={onTimeChange}
                      onToggleUrgent={toggleUrgent}
                      urgent={urgentIds.has(item.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-white px-4 py-5 shadow-sm">
          <p className="text-lg font-semibold text-slate-950">{copy.tasks.emptyTitle}</p>
          <p className="mt-1 text-base leading-7 text-slate-600">{copy.tasks.emptyBody}</p>
        </div>
      )}
    </section>
  );
}

function TaskRow({
  confirmTime,
  item,
  loading,
  onConfirmReminder,
  onTimeChange,
  onToggleUrgent,
  urgent,
}: {
  confirmTime: string;
  item: ElderTaskItem;
  loading: boolean;
  onConfirmReminder: (reminder: Reminder) => void | Promise<void>;
  onTimeChange: (id: string, value: string) => void;
  onToggleUrgent: (id: string) => void;
  urgent: boolean;
}) {
  const { reminder } = item;
  const canConfirm = reminder.status !== "confirmed" && reminder.status !== "scheduled";
  return (
    <article className={`transition-all duration-300 ease-out motion-safe:animate-[urgent-rise_260ms_ease-out] ${urgent ? "bg-orange-50 px-4 py-4 shadow-[inset_3px_0_0_#ea580c]" : "bg-white px-4 py-4"}`}>
      <div className="grid grid-cols-[1.55rem_1fr] gap-3">
        <div className="pt-1">
          <button
            aria-label={urgent ? `${item.title} 取消紧急` : `${item.title} 标记紧急`}
            className={`block h-[1.2rem] w-[1.2rem] rounded-full border-2 transition-colors ${urgent ? "border-orange-600 bg-orange-500" : "border-slate-400 bg-white"}`}
            type="button"
            onClick={() => onToggleUrgent(item.id)}
          />
        </div>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[1.08rem] font-semibold leading-7 text-slate-950">{item.title}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${urgent ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-700"}`}>
              {urgent ? "紧急" : item.statusLabel}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-sm leading-5 text-slate-500">
            {taskIcon()}
            {item.timeLabel ? <span className="shrink-0 font-medium text-slate-600">{item.timeLabel}</span> : null}
            <span className="min-w-0 break-words">{item.subtitle}</span>
          </div>
          {item.description && item.description !== item.subtitle ? (
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
          ) : null}
        </div>
      </div>

      {canConfirm && !reminder.remindAt ? (
        <div className="ml-10 mt-3 grid gap-2">
          <div className="grid grid-cols-3 gap-2">
            {quickReminderTimes().map((item) => (
              <Button
                className="h-9 rounded-xl text-xs shadow-none"
                key={item.label}
                type="button"
                variant={confirmTime === item.value ? "default" : "secondary"}
                onClick={() => onTimeChange(reminder.id, item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <Input
            aria-label={`${reminder.title} 的提醒时间`}
            className="h-10 rounded-xl bg-slate-100 text-sm shadow-none"
            type="datetime-local"
            value={confirmTime}
            onChange={(event) => onTimeChange(reminder.id, event.target.value)}
          />
        </div>
      ) : null}

      {canConfirm ? (
        <Button
          className="ml-10 mt-3 h-10 rounded-xl bg-slate-950 text-sm shadow-none hover:bg-slate-800"
          disabled={loading || (!reminder.remindAt && !confirmTime)}
          onClick={() => void onConfirmReminder(reminder)}
        >
          <Check className="h-4 w-4" />
          {copy.reminders.confirm}
        </Button>
      ) : null}
    </article>
  );
}

export function LatestAnswer({
  answer,
  loading,
  onSendFeedback,
}: {
  answer: MemoryAnswer;
  loading: boolean;
  onSendFeedback: (answer: MemoryAnswer, correctionText: string) => void | Promise<void>;
}) {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const evidence = selectTrustEvidence(answer).slice(0, 2);

  return (
    <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">{copy.tasks.latestAnswer}</p>
      <p className="mt-1 text-lg font-semibold leading-7 text-slate-950">{answer.confidence === 0 ? copy.recall.noEvidenceBody : answer.answerText}</p>
      {evidence.length ? (
        <div className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-xl bg-slate-100">
          {evidence.map((item) => (
            <div className="px-3 py-2" key={`${item.sourceId}:${item.summary}`}>
              <p className="text-xs font-medium text-slate-500">{trustEvidenceLabel(item.retrievalSource)} · {formatDate(item.createdAt)}</p>
              <p className="mt-0.5 text-sm leading-6 text-slate-700">{item.summary}</p>
            </div>
          ))}
        </div>
      ) : null}
      {answer.confidence > 0 && (isCorrecting ? (
        <form
          className="mt-3 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onSendFeedback(answer, correctionText);
          }}
        >
          <Textarea
            aria-label={copy.recall.correctionLabel}
            className="min-h-20 rounded-xl bg-slate-100 text-base leading-7 shadow-none"
            placeholder={copy.recall.correctionPlaceholder}
            value={correctionText}
            onChange={(event) => setCorrectionText(event.target.value)}
          />
          <Button className="h-11 rounded-xl bg-slate-950 text-base shadow-none hover:bg-slate-800" disabled={loading || !correctionText.trim()} type="submit">
            <Send className="h-4 w-4" />
            {copy.recall.sendCorrection}
          </Button>
        </form>
      ) : (
        <Button className="mt-3 h-10 rounded-xl text-sm shadow-none" variant="secondary" onClick={() => setIsCorrecting(true)}>
          {copy.recall.correct}
        </Button>
      ))}
    </section>
  );
}

function taskIcon() {
  return <Bell className="h-3.5 w-3.5 shrink-0" />;
}
