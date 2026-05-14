import { useState } from "react";
import { Check, CheckCheck, Clock, Send } from "lucide-react";
import type { MemoryAnswer, Reminder } from "@mem/memory-schema";
import { copy } from "../lib/copy.js";
import type { AnswerCorrection } from "../lib/local-prefs.js";
import {
  formatDate,
  needsReminderConfirmation,
  quickReminderTimes,
  selectTrustEvidence,
  trustEvidenceLabel,
  type ElderTaskItem,
} from "../lib/elder-view-model.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Textarea } from "./ui/textarea.js";

function cardBg(statusLabel: string, urgent: boolean): string {
  if (urgent) return "bg-[#F5C8C8]";
  if (statusLabel === copy.tasks.needsConfirmation) return "bg-[#F5E6D3]";
  if (statusLabel === copy.tasks.confirmedReminder) return "bg-[#C8DCF0]";
  return "bg-[#F5F0C0]";
}

export function TaskList({
  confirmTimes,
  items,
  loading,
  onConfirmReminder,
  onTimeChange,
  onPickExample,
}: {
  confirmTimes: Record<string, string>;
  items: ElderTaskItem[];
  loading: boolean;
  onConfirmReminder: (reminder: Reminder) => void | Promise<void>;
  onTimeChange: (id: string, value: string) => void;
  onPickExample?: (text: string) => void;
}) {
  const [urgentIds, setUrgentIds] = useState<Set<string>>(() => new Set());
  const toggleUrgent = (id: string) => {
    setUrgentIds((cur) => { const next = new Set(cur); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  if (!items.length) {
    return <EmptyExamples onPick={onPickExample} />;
  }

  const sortedItems = [...items].sort((a, b) => Number(urgentIds.has(b.id)) - Number(urgentIds.has(a.id)));

  return (
    <div className="mt-2 space-y-3">
      {sortedItems.map((item) => (
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
  );
}

function EmptyExamples({ onPick }: { onPick?: (text: string) => void }) {
  return (
    <div className="mt-6 px-1">
      <p className="mb-3 px-2 text-sm text-slate-500">{copy.examples.hint}</p>
      <div className="space-y-2">
        {copy.examples.items.map((text) => (
          <button
            aria-label={`示例 ${text}`}
            className="block w-full rounded-2xl bg-slate-50 px-4 py-3 text-left text-base leading-relaxed text-slate-700 hover:bg-slate-100"
            key={text}
            type="button"
            onClick={() => onPick?.(text)}
          >
            <span className="mr-2 text-xs text-slate-400">试试说</span>
            {text}
          </button>
        ))}
      </div>
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
  const canConfirm = needsReminderConfirmation(reminder);
  const hasTime = !!(reminder.remindAt || confirmTime);
  const bg = cardBg(item.statusLabel, urgent);

  return (
    <div className={`rounded-2xl px-5 py-4 ${bg}`}>
      <div className="flex items-start justify-between gap-3">
        {/* 左侧内容 */}
        <button
          aria-label={urgent ? `${item.title} 取消紧急` : `${item.title} 标记紧急`}
          className="min-w-0 flex-1 text-left"
          type="button"
          onClick={() => onToggleUrgent(item.id)}
        >
          <p className="text-base font-bold leading-snug text-slate-900">{item.title}</p>
          {urgent ? <p className="mt-1 text-xs font-semibold text-orange-700">{copy.tasks.urgent}</p> : null}
          {item.subtitle ? <p className="mt-1 text-xs leading-5 text-slate-500">{item.subtitle}</p> : null}
          {item.timeLabel ? (
            <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
              <Clock className="h-3 w-3" />
              {item.timeLabel}
            </p>
          ) : null}
        </button>

        {/* 右侧圆形按钮 */}
        {canConfirm ? (
          <button
            aria-label={`${item.title} ${copy.reminders.confirm}`}
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${hasTime ? "bg-slate-950 text-white hover:bg-slate-800" : "bg-white/60 text-slate-400"}`}
            disabled={loading || !hasTime}
            type="button"
            onClick={() => void onConfirmReminder(reminder)}
          >
            <Check className="h-4 w-4" />
          </button>
        ) : (
          <div
            aria-label={`${item.title} ${copy.tasks.confirmedReminder}`}
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white"
            role="img"
          >
            <CheckCheck className="h-4 w-4" />
          </div>
        )}
      </div>

      {/* 待确认时间选择 */}
      {canConfirm && !reminder.remindAt ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            {quickReminderTimes().map((t) => (
              <button
                className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors ${confirmTime === t.value ? "bg-slate-950 text-white" : "bg-white/70 text-slate-600 hover:bg-white"}`}
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
            className="h-9 rounded-xl border-0 bg-white/70 text-xs shadow-none"
            type="datetime-local"
            value={confirmTime}
            onChange={(e) => onTimeChange(reminder.id, e.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function LatestAnswer({
  answer,
  correction,
  loading,
  onSendFeedback,
}: {
  answer: MemoryAnswer;
  correction?: AnswerCorrection | null;
  loading: boolean;
  onSendFeedback: (answer: MemoryAnswer, correctionText: string) => void | Promise<void>;
}) {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionText, setCorrectionText] = useState("");
  const evidence = selectTrustEvidence(answer).slice(0, 2);
  const isCorrected = !!correction;

  return (
    <div className="mt-3 rounded-2xl border-l-4 border-blue-300 bg-slate-50 px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{copy.tasks.latestAnswer}</p>
        {isCorrected ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            {copy.recall.appliedTag}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-base font-bold leading-snug text-slate-900">
        {isCorrected ? correction!.correctionText : (answer.confidence === 0 ? copy.recall.noEvidenceBody : answer.answerText)}
      </p>
      {isCorrected ? (
        <p className="mt-2 text-xs text-slate-500">{copy.recall.appliedNote}</p>
      ) : null}
      {isCorrected ? (
        <div className="mt-2 rounded-xl bg-white px-4 py-3">
          <p className="text-xs text-slate-400">{copy.recall.originalAnswerLabel}</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">{answer.answerText}</p>
        </div>
      ) : null}
      {evidence.length ? (
        <div className="mt-3 space-y-2">
          {evidence.map((item) => (
            <div className="rounded-xl bg-white px-4 py-3" key={`${item.sourceId}:${item.summary}`}>
              <p className="text-xs text-slate-400">{trustEvidenceLabel(item.retrievalSource)} · {formatDate(item.createdAt)}</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-600">{item.summary}</p>
            </div>
          ))}
        </div>
      ) : null}
      {!isCorrected && answer.confidence > 0 && (isCorrecting ? (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void onSendFeedback(answer, correctionText); }}>
          <Textarea
            aria-label={copy.recall.correctionLabel}
            className="min-h-16 rounded-xl bg-white text-sm shadow-none"
            placeholder={copy.recall.correctionPlaceholder}
            value={correctionText}
            onChange={(e) => setCorrectionText(e.target.value)}
          />
          <Button className="w-full rounded-xl bg-slate-950 text-sm shadow-none hover:bg-slate-800" disabled={loading || !correctionText.trim()} type="submit">
            <Send className="h-3.5 w-3.5" />
            {copy.recall.sendCorrection}
          </Button>
        </form>
      ) : (
        <button className="mt-3 rounded-xl bg-white px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100" type="button" onClick={() => setIsCorrecting(true)}>
          {copy.recall.correct}
        </button>
      ))}
    </div>
  );
}
