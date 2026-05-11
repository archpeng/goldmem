import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bell, Check, Clock, Mic, Pencil, RefreshCw, Search, Send, Sparkles } from "lucide-react";
import type { DebugTrace, ElderTurnResult, FamilyTask, MemoryAnswer, MemoryEvent, Reminder } from "@goldmem/memory-schema";
import {
  confirmReminder,
  getDebugTrace,
  listMvpData,
  sendElderTurn,
  sendFeedback,
  type MvpLists,
} from "./lib/api.js";
import { copy, translateRiskLevel } from "./lib/copy.js";
import { Alert } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";

type RequestState = {
  loading: boolean;
  message?: string;
  error?: string;
};

type ChatTurn = {
  id: string;
  text: string;
  result?: ElderTurnResult;
};

const DEFAULT_ELDER_ID = "elder-mvp";
const DEFAULT_ACTOR_ID = "elder-mvp";

export function App() {
  const [elderId, setElderId] = useState(DEFAULT_ELDER_ID);
  const [actorUserId, setActorUserId] = useState(DEFAULT_ACTOR_ID);
  const [inputText, setInputText] = useState<string>(copy.conversation.defaultInput);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [familyTasks, setFamilyTasks] = useState<FamilyTask[]>([]);
  const [confirmTimes, setConfirmTimes] = useState<Record<string, string>>({});
  const [debugTraceId, setDebugTraceId] = useState("");
  const [debugTrace, setDebugTrace] = useState<DebugTrace | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [state, setState] = useState<RequestState>({ loading: false });

  const today = useMemo(() => buildTodaySnapshot(events, reminders, familyTasks, new Date()), [events, reminders, familyTasks]);

  useEffect(() => {
    void refreshLists(elderId, setLists, setState, false);
  }, [elderId]);

  async function handleSubmit() {
    const text = inputText.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    setTurns((current) => [...current, { id, text }]);
    await runRequest(setState, copy.status.turnCompleted, async () => {
      const result = await sendElderTurn({ elderId, text });
      setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, result } : turn)));
      setDebugTraceId(result.traceId);
      setInputText("");
      setIsListening(false);
      await refreshLists(elderId, setLists, setState, false);
    });
  }

  async function handleConfirmReminder(reminder: Reminder) {
    await runRequest(setState, copy.status.reminderConfirmed, async () => {
      await confirmReminder({
        reminderId: reminder.id,
        actorUserId,
        remindAt: reminder.remindAt ?? toIso(confirmTimes[reminder.id]),
      });
      await refreshLists(elderId, setLists, setState, false);
    });
  }

  async function handleSendAnswerFeedback(answer: MemoryAnswer, correctionText: string) {
    const firstEvidence = answer.retrievedEvidence[0];
    const firstSource = answer.matchedSources[0] ?? firstEvidence;
    await runRequest(setState, copy.status.feedbackSaved, async () => {
      await sendFeedback({
        elderId,
        actorUserId,
        sourceId: firstSource?.sourceId,
        eventId: firstEvidence?.eventId,
        feedbackType: "answer_wrong",
        correction: {
          answerText: answer.answerText,
          correctionText: correctionText.trim(),
        },
      });
    });
  }

  async function handleLoadDebugTrace() {
    await runRequest(setState, "调试链路已加载。", async () => {
      setDebugTrace(await getDebugTrace(debugTraceId));
    });
  }

  function setLists(lists: MvpLists) {
    setEvents(lists.events);
    setReminders(lists.reminders);
    setFamilyTasks(lists.familyTasks);
  }

  return (
    <main className="min-h-screen bg-[#f4f7f5] px-3 py-4 text-slate-950 sm:px-5">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[430px] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-medium text-emerald-700">{copy.appKicker}</p>
              <h1 className="mt-1 text-3xl font-semibold leading-tight tracking-normal text-slate-950">{copy.appTitle}</h1>
            </div>
            <Button
              aria-label={copy.events.refresh}
              className="h-12 w-12 shrink-0 rounded-full"
              disabled={state.loading}
              size="icon"
              variant="secondary"
              onClick={() => void refreshLists(elderId, setLists, setState)}
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
          </div>
          <p className="mt-3 text-lg leading-8 text-slate-600">{copy.appDescription}</p>
        </header>

        {state.message || state.error ? (
          <Alert className="mx-4 mt-4 text-base leading-7" variant={state.error ? "destructive" : "default"}>
            {state.error ?? state.message}
          </Alert>
        ) : null}

        <section className="flex-1 overflow-y-auto px-4 py-4 pb-44">
          <TodaySnapshot snapshot={today} />

          <div className="mt-4 grid gap-4">
            {turns.length === 0 ? (
              <EmptyConversation onPickExample={setInputText} />
            ) : (
              turns.map((turn) => (
                <TurnCard
                  confirmTimes={confirmTimes}
                  key={turn.id}
                  loading={state.loading}
                  turn={turn}
                  onConfirmReminder={handleConfirmReminder}
                  onSendFeedback={handleSendAnswerFeedback}
                  onTimeChange={(id, value) => setConfirmTimes((current) => ({ ...current, [id]: value }))}
                />
              ))
            )}
          </div>

          {import.meta.env.DEV ? (
            <DevPanel
              actorUserId={actorUserId}
              debugTrace={debugTrace}
              debugTraceId={debugTraceId}
              elderId={elderId}
              loading={state.loading}
              onActorChange={setActorUserId}
              onDebugTraceIdChange={setDebugTraceId}
              onElderChange={setElderId}
              onLoadTrace={handleLoadDebugTrace}
            />
          ) : null}
        </section>

        <form
          className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur sm:absolute sm:inset-x-auto sm:w-[430px]"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="grid gap-3">
            <Textarea
              aria-label={copy.conversation.inputLabel}
              className="min-h-20 resize-none rounded-2xl text-lg leading-8"
              placeholder={copy.conversation.placeholder}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
            />
            <div className="grid grid-cols-[3.5rem_1fr] gap-3">
              <Button
                aria-label={copy.conversation.voiceAction}
                className={`h-14 rounded-full ${isListening ? "bg-red-600 text-white hover:bg-red-700" : ""}`}
                disabled={state.loading}
                size="icon"
                type="button"
                variant={isListening ? "default" : "secondary"}
                onClick={() => setIsListening((current) => !current)}
              >
                <Mic className="h-6 w-6" />
              </Button>
              <Button className="h-14 rounded-2xl text-lg" disabled={state.loading || !inputText.trim()} type="submit">
                <Send className="h-5 w-5" />
                {state.loading ? copy.conversation.thinking : copy.conversation.send}
              </Button>
            </div>
            {isListening ? <p className="text-center text-base font-medium text-red-700">{copy.conversation.listening}</p> : null}
          </div>
        </form>
      </div>
    </main>
  );
}

function TodaySnapshot({ snapshot }: { snapshot: TodaySnapshotData }) {
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

function EmptyConversation({ onPickExample }: { onPickExample: (value: string) => void }) {
  const examples = [copy.conversation.exampleRecord, copy.conversation.exampleRecall, copy.conversation.exampleMixed];
  return (
    <section className="grid gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
      <p className="text-xl font-semibold leading-8 text-slate-950">{copy.conversation.emptyTitle}</p>
      <p className="text-lg leading-8 text-slate-600">{copy.conversation.emptyBody}</p>
      <div className="grid gap-2">
        {examples.map((example) => (
          <Button className="h-auto justify-start rounded-xl px-4 py-3 text-left text-base leading-7" key={example} type="button" variant="secondary" onClick={() => onPickExample(example)}>
            {example}
          </Button>
        ))}
      </div>
    </section>
  );
}

function TurnCard({
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

function DevPanel({
  actorUserId,
  debugTrace,
  debugTraceId,
  elderId,
  loading,
  onActorChange,
  onDebugTraceIdChange,
  onElderChange,
  onLoadTrace,
}: {
  actorUserId: string;
  debugTrace: DebugTrace | null;
  debugTraceId: string;
  elderId: string;
  loading: boolean;
  onActorChange: (value: string) => void;
  onDebugTraceIdChange: (value: string) => void;
  onElderChange: (value: string) => void;
  onLoadTrace: () => void | Promise<void>;
}) {
  return (
    <details className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
      <summary className="cursor-pointer text-base font-medium text-slate-700">开发工具</summary>
      <div className="mt-4 grid gap-3">
        <Field label="老人 ID">
          <Input value={elderId} onChange={(event) => onElderChange(event.target.value)} />
        </Field>
        <Field label="老人操作人">
          <Input value={actorUserId} onChange={(event) => onActorChange(event.target.value)} />
        </Field>
        <Field label="traceId">
          <Input value={debugTraceId} onChange={(event) => onDebugTraceIdChange(event.target.value)} />
        </Field>
        <Button disabled={loading || !debugTraceId.trim()} variant="secondary" onClick={() => void onLoadTrace()}>
          查询调试链路
        </Button>
        {debugTrace ? (
          <pre className="max-h-72 overflow-auto rounded-xl bg-white p-3 text-xs leading-5">
            {JSON.stringify(debugTrace, null, 2)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-600">
      {label}
      {children}
    </label>
  );
}

type TodaySnapshotData = {
  pendingCount: number;
  todayReminderCount: number;
  recentMemoryCount: number;
};

function buildTodaySnapshot(events: MemoryEvent[], reminders: Reminder[], familyTasks: FamilyTask[], now: Date): TodaySnapshotData {
  return {
    pendingCount: reminders.filter(needsReminderConfirmation).length + familyTasks.filter((task) => task.status === "pending").length,
    todayReminderCount: reminders.filter((reminder) => isActiveReminder(reminder) && reminder.remindAt && isSameLocalDay(new Date(reminder.remindAt), now)).length,
    recentMemoryCount: dedupeRecentMemories(events).length,
  };
}

function needsReminderConfirmation(reminder: Reminder): boolean {
  return (
    reminder.confirmationRequired ||
    !reminder.remindAt ||
    reminder.status === "candidate" ||
    reminder.status === "pending_elder_confirm" ||
    reminder.status === "pending_family_confirm"
  );
}

function isActiveReminder(reminder: Reminder): boolean {
  return !["done", "cancelled", "expired"].includes(reminder.status);
}

function dedupeRecentMemories(events: MemoryEvent[]): MemoryEvent[] {
  const seen = new Set<string>();
  return events
    .filter((event) => event.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((event) => {
      const key = `${event.title}:${event.summary}`.replace(/\s+/g, "").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function selectTrustEvidence(answer: MemoryAnswer) {
  const items = answer.matchedSources.length ? answer.matchedSources : answer.retrievedEvidence;
  return items.slice(0, 3);
}

function recallStateLabel(answer: MemoryAnswer): string {
  if (answer.confidence >= 0.65 && answer.retrievedEvidence.some((item) => item.retrievalSource === "postgres" || item.retrievalSource === "mem0")) {
    return copy.recall.certainTitle;
  }
  return copy.recall.possibleTitle;
}

function trustEvidenceLabel(source: "postgres" | "mem0" | "context_link" | "graphiti" | undefined): string {
  if (source === "context_link") return copy.recall.contextLinkEvidence;
  if (source === "graphiti") return copy.recall.graphitiEvidence;
  return copy.recall.recordedEvidence;
}

function quickReminderTimes(): Array<{ label: string; value: string }> {
  const now = new Date();
  return [
    { label: copy.reminders.quickTimes.morning, value: toDateTimeLocalValue(now, 7) },
    { label: copy.reminders.quickTimes.noon, value: toDateTimeLocalValue(now, 12) },
    { label: copy.reminders.quickTimes.evening, value: toDateTimeLocalValue(now, 19) },
  ];
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

async function refreshLists(
  elderId: string,
  setLists: (lists: MvpLists) => void,
  setState: (state: RequestState) => void,
  showStatus = true,
) {
  if (!elderId.trim()) return;
  if (!showStatus) {
    try {
      setLists(await listMvpData(elderId));
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  await runRequest(setState, copy.status.refreshed, async () => {
    setLists(await listMvpData(elderId));
  }, showStatus);
}

async function runRequest(
  setState: (state: RequestState) => void,
  successMessage: string,
  action: () => Promise<void>,
  showStatus = true,
) {
  setState({ loading: true });
  try {
    await action();
    setState({ loading: false, message: showStatus ? successMessage : undefined });
  } catch (error) {
    setState({
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
