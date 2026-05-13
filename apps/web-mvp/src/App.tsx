import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Send } from "lucide-react";
import type { DebugTrace, MemoryAnswer, Reminder } from "@goldmem/memory-schema";
import {
  confirmReminder,
  getIngestStatus,
  getDebugTrace,
  listMvpData,
  sendElderTurn,
  sendFeedback,
  type MvpLists,
} from "./lib/api.js";
import { copy } from "./lib/copy.js";
import { buildTaskItems, toIso } from "./lib/elder-view-model.js";
import { DevPanel } from "./components/dev-panel.js";
import { LatestAnswer, TaskList } from "./components/elder-task-list.js";

type RequestState = { loading: boolean; message?: string; error?: string };
type DraftCard = {
  id: string;
  sourceId?: string;
  transcript: string;
  status: "draft" | "queued" | "processing" | "ready" | "failed";
  summary?: string;
  errorMessage?: string;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionResultEventLike = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const DEFAULT_ELDER_ID = "elder-mvp";
const DEFAULT_ACTOR_ID = "elder-mvp";

export function App() {
  const [elderId, setElderId] = useState(DEFAULT_ELDER_ID);
  const [actorUserId, setActorUserId] = useState(DEFAULT_ACTOR_ID);
  const [latestAnswer, setLatestAnswer] = useState<MemoryAnswer | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [confirmTimes, setConfirmTimes] = useState<Record<string, string>>({});
  const [debugTraceId, setDebugTraceId] = useState("");
  const [debugTrace, setDebugTrace] = useState<DebugTrace | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [inputText, setInputText] = useState("");
  const [state, setState] = useState<RequestState>({ loading: false });
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const submitInFlightRef = useRef<string | null>(null);
  const lastSubmittedRef = useRef<{ text: string; at: number } | null>(null);

  const now = useMemo(() => new Date(), [reminders]);
  const taskItems = useMemo(() => buildTaskItems(reminders, now), [reminders, now]);

  useEffect(() => { void refreshLists(elderId, setLists, setState, false); }, [elderId]);

  async function handleSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const nowMs = Date.now();
    const lastSubmitted = lastSubmittedRef.current;
    if (submitInFlightRef.current || (lastSubmitted?.text === trimmed && nowMs - lastSubmitted.at < 3_000)) return;
    const clientTurnId = createClientTurnId();
    const localDraftId = `draft:${clientTurnId}`;
    submitInFlightRef.current = trimmed;
    lastSubmittedRef.current = { text: trimmed, at: nowMs };
    setDrafts((cur) => [{ id: localDraftId, transcript: trimmed, status: "draft" }, ...cur]);
    const ok = await runRequest(setState, copy.status.turnCompleted, async () => {
      const result = await sendElderTurn({ elderId, text: trimmed, clientTurnId });
      setLatestAnswer(result.answer ?? null);
      setDebugTraceId(result.traceId);
      if (result.draft) {
        setDrafts((cur) => cur.map((draft) => draft.id === localDraftId ? {
          id: result.draft!.sourceId,
          sourceId: result.draft!.sourceId,
          transcript: result.draft!.transcript,
          status: result.draft!.status,
        } : draft));
        void pollIngestStatus(result.draft.sourceId);
      } else {
        setDrafts((cur) => cur.filter((draft) => draft.id !== localDraftId));
      }
      setTranscript("");
      transcriptRef.current = "";
      setInputText("");
      setIsListening(false);
      await refreshLists(elderId, setLists, setState, false);
    });
    if (!ok) {
      setDrafts((cur) => cur.map((draft) => draft.id === localDraftId ? { ...draft, status: "failed" } : draft));
    }
    if (submitInFlightRef.current === trimmed) submitInFlightRef.current = null;
  }

  async function pollIngestStatus(sourceId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(2_000);
      try {
        const status = await getIngestStatus(sourceId);
        setDrafts((cur) => cur.map((draft) => draft.sourceId === sourceId ? {
          ...draft,
          status: status.status,
          summary: status.summary,
          errorMessage: status.errorMessage,
        } : draft));
        if (status.status === "ready") {
          await refreshLists(elderId, setLists, setState, false);
          if (status.reminderIds.length > 0) setDrafts((cur) => cur.filter((draft) => draft.sourceId !== sourceId));
          return;
        }
        if (status.status === "failed") return;
      } catch (error) {
        setDrafts((cur) => cur.map((draft) => draft.sourceId === sourceId ? {
          ...draft,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        } : draft));
        return;
      }
    }
  }

  function handleMicClick() {
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const speechWindow = window as WindowWithSpeechRecognition;
    const SpeechRecognitionApi = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      setState({ loading: false, error: "当前浏览器不支持语音输入，请使用文字输入。" });
      return;
    }
    const rec = new SpeechRecognitionApi();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    transcriptRef.current = "";
    setTranscript("");
    rec.onresult = (e) => {
      const nextTranscript = Array.from(e.results).map((result) => result[0].transcript).join("");
      transcriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
    };
    rec.onend = () => {
      setIsListening(false);
      const finalTranscript = transcriptRef.current.trim();
      if (finalTranscript) void handleSubmit(finalTranscript);
    };
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }

  async function handleConfirmReminder(reminder: Reminder) {
    const previousReminders = reminders;
    const remindAt = reminder.remindAt ?? toIso(confirmTimes[reminder.id]);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const confirmedText = remindAt ? formatConfirmedReminderText(remindAt, timezone) : undefined;
    setReminders((cur) => cur.map((item) => item.id === reminder.id ? {
      ...item, remindAt, timeText: confirmedText,
      reason: confirmedText ? `已按确认时间设置提醒：${confirmedText}。` : item.reason,
      status: "confirmed" as const, confirmationRequired: false,
      confirmedBy: actorUserId, confirmedAt: new Date().toISOString(),
    } : item));
    const ok = await runRequest(setState, copy.status.reminderConfirmed, async () => {
      const confirmed = await confirmReminder({ reminderId: reminder.id, actorUserId, remindAt, timezone });
      setReminders((cur) => cur.map((item) => item.id === confirmed.id ? confirmed : item));
      await refreshLists(elderId, setLists, setState, false);
    });
    if (!ok) setReminders(previousReminders);
  }

  async function handleSendAnswerFeedback(answer: MemoryAnswer, correctionText: string) {
    const firstEvidence = answer.retrievedEvidence[0];
    const firstSource = answer.matchedSources[0] ?? firstEvidence;
    await runRequest(setState, copy.status.feedbackSaved, async () => {
      await sendFeedback({
        elderId, actorUserId,
        sourceId: firstSource?.sourceId, eventId: firstEvidence?.eventId,
        feedbackType: "answer_wrong",
        correction: { answerText: answer.answerText, correctionText: correctionText.trim() },
      });
    });
  }

  async function handleLoadDebugTrace() {
    await runRequest(setState, "调试链路已加载。", async () => { setDebugTrace(await getDebugTrace(debugTraceId)); });
  }

  function setLists(lists: MvpLists) { setReminders(lists.reminders); }

  const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-white">
        {/* Header */}
        <header className="px-6 pb-2 pt-8">
          <p className="text-sm text-slate-400">{today}</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight text-slate-900">{copy.appTitle}</h1>
          {state.error ? (
            <p className="mt-2 text-xs text-red-400">{state.error}</p>
          ) : state.message ? (
            <p className="mt-2 text-xs text-slate-400">{state.message}</p>
          ) : null}
        </header>

        {/* 本周日历条 */}
        <WeekStrip now={now} />

        <section className="flex-1 overflow-y-auto px-4 pb-48 pt-2">
          <DraftCards drafts={drafts} />
          {drafts.length && !taskItems.length ? null : (
            <TaskList
              confirmTimes={confirmTimes}
              items={taskItems}
              loading={state.loading}
              onConfirmReminder={handleConfirmReminder}
              onTimeChange={(id, value) => setConfirmTimes((cur) => ({ ...cur, [id]: value }))}
            />
          )}
          {latestAnswer ? (
            <LatestAnswer answer={latestAnswer} loading={state.loading} onSendFeedback={handleSendAnswerFeedback} />
          ) : null}
          {import.meta.env.DEV ? (
            <DevPanel
              actorUserId={actorUserId} debugTrace={debugTrace} debugTraceId={debugTraceId}
              elderId={elderId} loading={state.loading}
              onActorChange={setActorUserId} onDebugTraceIdChange={setDebugTraceId}
              onElderChange={setElderId} onLoadTrace={handleLoadDebugTrace}
            />
          ) : null}
        </section>

        <div className="fixed bottom-0 inset-x-0 z-20 mx-auto w-full max-w-[430px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:absolute sm:inset-x-auto sm:w-[430px]">
          {isListening && transcript ? (
            <p className="mb-2 px-4 text-center text-sm text-slate-500">{transcript}</p>
          ) : null}
          <form
            className="rounded-[1.75rem] border border-slate-100 bg-white/95 p-2 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit(inputText);
            }}
          >
            <label className="sr-only" htmlFor="elder-turn-input">{copy.conversation.inputLabel}</label>
            <textarea
              aria-label={copy.conversation.inputLabel}
              className="max-h-28 min-h-14 w-full resize-none rounded-3xl border-0 bg-slate-50 px-4 py-3 text-base leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:bg-slate-100"
              disabled={state.loading}
              id="elder-turn-input"
              placeholder={copy.conversation.placeholder}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                aria-label={copy.conversation.voiceAction}
                className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold text-white shadow-sm transition-all ${isListening ? "scale-[1.02] bg-slate-700" : "bg-slate-950 hover:bg-slate-800"} ${state.loading ? "opacity-50" : ""}`}
                disabled={state.loading}
                type="button"
                onClick={handleMicClick}
              >
                <Mic className={`h-5 w-5 ${isListening ? "animate-pulse" : ""}`} />
                {isListening ? copy.conversation.listening : copy.conversation.voiceAction}
              </button>
              <button
                aria-label={copy.conversation.send}
                className="flex h-12 w-14 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm transition-colors hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
                disabled={state.loading || !inputText.trim()}
                type="submit"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

function DraftCards({ drafts }: { drafts: DraftCard[] }) {
  if (!drafts.length) return null;
  return (
    <div className="mt-2 space-y-3">
      {drafts.map((draft) => (
        <div className="rounded-2xl bg-slate-100 px-5 py-4" key={draft.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-bold leading-snug text-slate-900">{draft.summary ?? draft.transcript}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{draft.transcript}</p>
            </div>
            <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">
              {draftStatusLabel(draft)}
            </span>
          </div>
          {draft.errorMessage ? <p className="mt-2 text-xs text-red-500">{draft.errorMessage}</p> : null}
        </div>
      ))}
    </div>
  );
}

function draftStatusLabel(draft: DraftCard): string {
  if (draft.status === "draft") return copy.tasks.draft;
  if (draft.status === "ready") return copy.tasks.remembered;
  if (draft.status === "failed") return copy.tasks.organizeFailed;
  return copy.tasks.organizing;
}

function WeekStrip({ now }: { now: Date }) {
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const today = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - today);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return { label: days[i], date: d.getDate(), isToday: i === today };
  });
  return (
    <div className="flex items-center justify-between px-6 py-3">
      {week.map((d) => (
        <div className="flex flex-col items-center gap-1" key={d.date}>
          <span className="text-[10px] font-medium text-slate-400">{d.label}</span>
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${d.isToday ? "bg-slate-950 text-white" : "text-slate-500"}`}>
            {d.date}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatConfirmedReminderText(remindAt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone, year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(remindAt));
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${v("year")}年${Number(v("month"))}月${Number(v("day"))}日 ${v("hour")}:${v("minute")}`;
}

async function refreshLists(elderId: string, setLists: (l: MvpLists) => void, setState: (s: RequestState) => void, showStatus = true) {
  if (!elderId.trim()) return;
  if (!showStatus) {
    try { setLists(await listMvpData(elderId)); }
    catch (error) { setState({ loading: false, error: error instanceof Error ? error.message : String(error) }); }
    return;
  }
  await runRequest(setState, copy.status.refreshed, async () => { setLists(await listMvpData(elderId)); }, showStatus);
}

async function runRequest(setState: (s: RequestState) => void, successMessage: string, action: () => Promise<void>, showStatus = true): Promise<boolean> {
  setState({ loading: true });
  try {
    await action();
    setState({ loading: false, message: showStatus ? successMessage : undefined });
    return true;
  } catch (error) {
    setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createClientTurnId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `turn:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
