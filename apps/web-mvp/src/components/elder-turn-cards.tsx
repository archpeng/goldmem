import { useState } from "react";
import { Check, Pencil, Search, Send } from "lucide-react";
import type { ElderTurnResult, MemoryAnswer, Reminder } from "@goldmem/memory-schema";
import { copy, translateRiskLevel } from "../lib/copy.js";
import {
  formatDate,
  quickReminderTimes,
  recallStateLabel,
  selectTrustEvidence,
  trustEvidenceLabel,
} from "../lib/elder-view-model.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Textarea } from "./ui/textarea.js";

export type ChatTurn = {
  id: string;
  text: string;
  result?: ElderTurnResult;
};

export function TurnCard({
  confirmTimes,
  loading,
  turn,
  onConfirmReminder,
  onSendFeedback,
  onTimeChange,
}: {
  confirmTimes: Record<string, string>;
  loading: boolean;
  turn: ChatTurn;
  onConfirmReminder: (reminder: Reminder) => void | Promise<void>;
  onSendFeedback: (answer: MemoryAnswer, correctionText: string) => void | Promise<void>;
  onTimeChange: (id: string, value: string) => void;
}) {
  return (
    <article className="grid gap-3">
      <div className="ml-auto max-w-[86%] rounded-2xl bg-emerald-700 px-4 py-3 text-lg leading-8 text-white">
        {turn.text}
      </div>
      {turn.result ? (
        <div className="grid gap-3">
          <p className="mr-auto max-w-[92%] rounded-2xl bg-slate-100 px-4 py-3 text-lg leading-8 text-slate-900">{turn.result.message}</p>
          {turn.result.ingestResult ? (
            <IngestResultCard
              confirmTimes={confirmTimes}
              loading={loading}
              result={turn.result.ingestResult}
              onConfirmReminder={onConfirmReminder}
              onTimeChange={onTimeChange}
            />
          ) : null}
          {turn.result.answer ? <AnswerCard answer={turn.result.answer} loading={loading} onSendFeedback={onSendFeedback} /> : null}
        </div>
      ) : (
        <p className="mr-auto rounded-2xl bg-slate-100 px-4 py-3 text-lg leading-8 text-slate-600">{copy.conversation.thinking}</p>
      )}
    </article>
  );
}

function IngestResultCard({
  confirmTimes,
  loading,
  result,
  onConfirmReminder,
  onTimeChange,
}: {
  confirmTimes: Record<string, string>;
  loading: boolean;
  result: NonNullable<ElderTurnResult["ingestResult"]>;
  onConfirmReminder: (reminder: Reminder) => void | Promise<void>;
  onTimeChange: (id: string, value: string) => void;
}) {
  const cards = result.elderFacingCards.length
    ? result.elderFacingCards
    : result.events.map((event) => ({
      title: event.title,
      summary: event.summary,
      needsConfirmation: event.status === "needs_review",
      riskLevel: event.riskLevel,
    }));

  return (
    <section className="grid gap-3 rounded-2xl border border-emerald-100 bg-white p-4">
      <div className="flex items-center gap-2 text-emerald-700">
        <Check className="h-5 w-5" />
        <h3 className="text-xl font-semibold">{copy.capture.understoodTitle}</h3>
      </div>
      {cards.length ? cards.map((card) => (
        <div className="rounded-xl bg-emerald-50 px-4 py-3" key={`${card.title}:${card.summary}`}>
          <p className="text-lg font-semibold leading-7 text-slate-950">{card.title}</p>
          <p className="mt-1 text-lg leading-8 text-slate-700">{card.summary}</p>
          {card.riskLevel !== "normal" ? (
            <p className="mt-2 text-base leading-7 text-amber-800">{copy.risk.attention}：{translateRiskLevel(card.riskLevel)}</p>
          ) : null}
        </div>
      )) : (
        <p className="text-lg leading-8 text-slate-700">{result.summary}</p>
      )}
      {result.reminderCandidates.length ? (
        <div className="grid gap-3">
          <p className="text-base font-medium text-slate-600">{copy.capture.reminderCandidates}</p>
          {result.reminderCandidates.map((reminder) => (
            <ReminderCard
              confirmTime={confirmTimes[reminder.id] ?? ""}
              key={reminder.id}
              loading={loading}
              reminder={reminder}
              onConfirm={() => void onConfirmReminder(reminder)}
              onTimeChange={(value) => onTimeChange(reminder.id, value)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AnswerCard({
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
  const evidence = selectTrustEvidence(answer);
  const noEvidence = answer.confidence === 0 || (answer.matchedSources.length === 0 && answer.retrievedEvidence.length === 0);

  return (
    <section className="grid gap-4 rounded-2xl border border-sky-100 bg-white p-4">
      <div className="flex items-center gap-2 text-sky-700">
        <Search className="h-5 w-5" />
        <h3 className="text-xl font-semibold">{noEvidence ? copy.recall.missingTitle : recallStateLabel(answer)}</h3>
      </div>
      <p className="text-2xl font-semibold leading-9 text-slate-950">{noEvidence ? copy.recall.noEvidenceBody : answer.answerText}</p>
      {evidence.length ? (
        <div className="grid gap-2">
          <p className="text-base font-medium text-slate-600">{copy.recall.basis}</p>
          {evidence.map((item) => (
            <div className="rounded-xl bg-slate-50 px-4 py-3" key={`${item.sourceId}:${item.summary}`}>
              <p className="text-sm font-medium text-slate-500">{trustEvidenceLabel(item.retrievalSource)}</p>
              <p className="mt-1 text-lg leading-8 text-slate-800">{item.summary}</p>
              <p className="mt-1 text-sm text-slate-500">{formatDate(item.createdAt)}</p>
            </div>
          ))}
        </div>
      ) : null}
      {!noEvidence && (isCorrecting ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onSendFeedback(answer, correctionText);
          }}
        >
          <label className="grid gap-2 text-base font-medium text-slate-700">
            {copy.recall.correctionLabel}
            <Textarea
              className="min-h-28 rounded-xl text-lg leading-8"
              placeholder={copy.recall.correctionPlaceholder}
              value={correctionText}
              onChange={(event) => setCorrectionText(event.target.value)}
            />
          </label>
          <Button className="h-12 rounded-xl text-base" disabled={loading || !correctionText.trim()} type="submit">
            <Send className="h-4 w-4" />
            {copy.recall.sendCorrection}
          </Button>
        </form>
      ) : (
        <Button className="h-12 rounded-xl text-base" variant="secondary" onClick={() => setIsCorrecting(true)}>
          <Pencil className="h-4 w-4" />
          {copy.recall.correct}
        </Button>
      ))}
    </section>
  );
}

function ReminderCard({
  confirmTime,
  loading,
  reminder,
  onConfirm,
  onTimeChange,
}: {
  confirmTime: string;
  loading: boolean;
  reminder: Reminder;
  onConfirm: () => void;
  onTimeChange: (value: string) => void;
}) {
  return (
    <article className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div>
        <p className="text-base font-medium text-amber-800">{reminder.remindAt ? copy.reminders.readyToConfirm : copy.reminders.timeNeeded}</p>
        <h4 className="mt-2 text-xl font-semibold leading-7 text-slate-950">{reminder.title}</h4>
        <p className="mt-2 text-lg leading-8 text-slate-700">{reminder.reason}</p>
        {reminder.remindAt ? <p className="mt-2 text-base font-medium text-slate-600">{formatDate(reminder.remindAt)}</p> : null}
      </div>
      {!reminder.remindAt ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-2">
            {quickReminderTimes().map((item) => (
              <Button
                className="h-12 rounded-xl text-sm sm:text-base"
                key={item.label}
                type="button"
                variant={confirmTime === item.value ? "default" : "secondary"}
                onClick={() => onTimeChange(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <Input
            aria-label={`${reminder.title} 的提醒时间`}
            className="h-14 rounded-xl text-lg"
            type="datetime-local"
            value={confirmTime}
            onChange={(event) => onTimeChange(event.target.value)}
          />
        </div>
      ) : null}
      <Button className="h-14 rounded-xl text-lg" disabled={loading || reminder.status === "confirmed" || (!reminder.remindAt && !confirmTime)} onClick={onConfirm}>
        <Check className="h-5 w-5" />
        {copy.reminders.confirm}
      </Button>
    </article>
  );
}
