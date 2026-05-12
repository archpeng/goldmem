import { useState } from "react";
import { Check, Send } from "lucide-react";
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
  const toggleUrgent = (id: string) => {
    setUrgentIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!items.length) {
    return (
      <div className="mt-3 rounded-2xl bg-white px-5 py-6 shadow-sm">
        <p className="text-sm text-slate-400">{copy.tasks.emptyBody}</p>
      </div>
    );
  }

  const sections = [
    { title: copy.tasks.needsConfirmation, items: items.filter((i) => i.statusLabel === copy.tasks.needsConfirmation && !urgentIds.has(i.id)) },
    { title: copy.tasks.urgent, items: items.filter((i) => urgentIds.has(i.id)) },
    { title: copy.tasks.confirmedReminder, items: items.filter((i) => i.statusLabel === copy.tasks.confirmedReminder && !urgentIds.has(i.id)) },
    { title: copy.tasks.todayReminder, items: items.filter((i) => i.statusLabel === copy.tasks.todayReminder && !urgentIds.has(i.id)) },
  ].filter((s) => s.items.length);

  return (
    <div className="mt-3 space-y-3">
      {sections.map((section) => (
        <div className="rounded-2xl bg-white px-5 py-4 shadow-sm" key={section.title}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">{section.title}</p>
          <div className="space-y-2">
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
      ))}
    </div>
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
    <div className={`rounded-xl px-4 py-3 ${urgent ? "bg-orange-50" : "bg-slate-50"}`}>
      {/* 主行：标题 + 时间 */}
      <div className="flex items-center justify-between gap-3">
        <button
          className="min-w-0 flex-1 text-left"
          type="button"
          onClick={() => onToggleUrgent(item.id)}
        >
          <span className={`block truncate text-sm font-medium ${urgent ? "text-orange-700" : "text-slate-900"}`}>
            {item.title}
          </span>
        </button>
        {item.timeLabel ? (
          <span className="shrink-0 text-xs font-medium text-slate-500">{item.timeLabel}</span>
        ) : (
          <span className="shrink-0 text-xs text-slate-400">待定</span>
        )}
      </div>

      {/* reason */}
      {item.subtitle ? (
        <p className="mt-1 text-xs leading-5 text-slate-400">{item.subtitle}</p>
      ) : null}

      {/* 待确认：时间选择 */}
      {canConfirm && !reminder.remindAt ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            {quickReminderTimes().map((t) => (
              <button
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${confirmTime === t.value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                key={t.label}
                type="button"
                onClick={() => onTimeChange(reminder.id, t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Input
            aria-label={`${reminder.title} 的提醒时间`}
            className="h-9 rounded-lg bg-white text-xs shadow-none"
            type="datetime-local"
            value={confirmTime}
            onChange={(e) => onTimeChange(reminder.id, e.target.value)}
          />
        </div>
      ) : null}

      {/* 确认按钮 */}
      {canConfirm ? (
        <button
          className="mt-3 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-semibold text-white transition-opacity disabled:opacity-40"
          disabled={loading || (!reminder.remindAt && !confirmTime)}
          type="button"
          onClick={() => void onConfirmReminder(reminder)}
        >
          <Check className="mr-1.5 inline h-3.5 w-3.5" />
          {copy.reminders.confirm}
        </button>
      ) : null}
    </div>
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
    <div className="mt-3 rounded-2xl bg-white px-5 py-4 shadow-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">{copy.tasks.latestAnswer}</p>
      <p className="text-sm font-medium leading-6 text-slate-900">
        {answer.confidence === 0 ? copy.recall.noEvidenceBody : answer.answerText}
      </p>
      {evidence.length ? (
        <div className="mt-3 space-y-2">
          {evidence.map((item) => (
            <div className="rounded-xl bg-slate-50 px-4 py-3" key={`${item.sourceId}:${item.summary}`}>
              <p className="text-xs text-slate-400">{trustEvidenceLabel(item.retrievalSource)} · {formatDate(item.createdAt)}</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-600">{item.summary}</p>
            </div>
          ))}
        </div>
      ) : null}
      {answer.confidence > 0 && (isCorrecting ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => { e.preventDefault(); void onSendFeedback(answer, correctionText); }}
        >
          <Textarea
            aria-label={copy.recall.correctionLabel}
            className="min-h-16 rounded-xl bg-slate-50 text-sm shadow-none"
            placeholder={copy.recall.correctionPlaceholder}
            value={correctionText}
            onChange={(e) => setCorrectionText(e.target.value)}
          />
          <Button className="w-full rounded-xl bg-slate-900 text-sm shadow-none hover:bg-slate-800" disabled={loading || !correctionText.trim()} type="submit">
            <Send className="h-3.5 w-3.5" />
            {copy.recall.sendCorrection}
          </Button>
        </form>
      ) : (
        <button
          className="mt-3 w-full rounded-xl bg-slate-50 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
          type="button"
          onClick={() => setIsCorrecting(true)}
        >
          {copy.recall.correct}
        </button>
      ))}
    </div>
  );
}
