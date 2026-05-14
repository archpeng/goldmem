import { useEffect, useMemo, useRef, useState } from "react";
import type { DebugTrace, MemoryAnswer, Reminder, TodaySnapshot } from "@mem/memory-schema";
import {
  confirmReminder,
  getIngestStatus,
  getDebugTrace,
  getTodaySnapshot,
  sendElderTurn,
  sendFeedback,
  type MvpLists,
} from "./lib/api.js";
import { createClientTurnId, formatConfirmedReminderText, refreshLists, runRequest, sleep, type RequestState } from "./lib/app-helpers.js";
import { copy } from "./lib/copy.js";
import { buildTaskItems, toIso } from "./lib/elder-view-model.js";
import {
  applyTextScaleToDocument,
  getAnswerCorrection,
  readTextScale,
  readLastSnapshotDismissed,
  setAnswerCorrection,
  writeLastSnapshotDismissed,
  writeTextScale,
  type AnswerCorrection,
  type ElderTextScale,
} from "./lib/local-prefs.js";
import { DevPanel } from "./components/dev-panel.js";
import { AppHeader } from "./components/app-header.js";
import { DraftCards, type DraftCard } from "./components/draft-cards.js";
import { ElderInputBar } from "./components/elder-input-bar.js";
import { LatestAnswer, TaskList } from "./components/elder-task-list.js";
import { SettingsPanel } from "./components/settings-panel.js";
import { TodaySnapshotCard } from "./components/today-snapshot.js";
import { WeekStrip } from "./components/week-strip.js";

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
  const [textScale, setTextScale] = useState<ElderTextScale>("normal");
  const [latestAnswerTraceId, setLatestAnswerTraceId] = useState<string>("");
  const [latestCorrection, setLatestCorrection] = useState<AnswerCorrection | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [todaySnapshot, setTodaySnapshot] = useState<TodaySnapshot | null>(null);
  const [state, setState] = useState<RequestState>({ loading: false });
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const submitInFlightRef = useRef<string | null>(null);
  const lastSubmittedRef = useRef<{ text: string; at: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const now = useMemo(() => new Date(), [reminders]);
  const taskItems = useMemo(() => buildTaskItems(reminders, now), [reminders, now]);

  useEffect(() => {
    const initial = readTextScale();
    setTextScale(initial);
    applyTextScaleToDocument(initial);
  }, []);

  useEffect(() => { void refreshLists(elderId, setLists, setState, false); }, [elderId]);

  useEffect(() => {
    let cancelled = false;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    getTodaySnapshot(elderId, timezone).then((snapshot) => {
      if (cancelled) return;
      setTodaySnapshot(readLastSnapshotDismissed() === snapshot.date ? null : snapshot);
    }).catch((error) => {
      if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { cancelled = true; };
  }, [elderId]);

  function handleToggleTextScale() {
    const next: ElderTextScale = textScale === "xl" ? "normal" : "xl";
    setTextScale(next);
    writeTextScale(next);
    applyTextScaleToDocument(next);
  }

  async function handleSubmit(text: string, options: { replaceDraftId?: string } = {}) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const nowMs = Date.now();
    const lastSubmitted = lastSubmittedRef.current;
    if (submitInFlightRef.current || (lastSubmitted?.text === trimmed && nowMs - lastSubmitted.at < 3_000)) return;
    const clientTurnId = createClientTurnId();
    const localDraftId = `draft:${clientTurnId}`;
    submitInFlightRef.current = trimmed;
    lastSubmittedRef.current = { text: trimmed, at: nowMs };
    const localDraft: DraftCard = { id: localDraftId, transcript: trimmed, status: "draft" };
    setDrafts((cur) => options.replaceDraftId
      ? cur.map((draft) => draft.id === options.replaceDraftId ? localDraft : draft)
      : [localDraft, ...cur]);
    const ok = await runRequest(setState, copy.status.turnCompleted, async () => {
      const result = await sendElderTurn({ elderId, text: trimmed, clientTurnId });
      const nextAnswer = result.answer ?? null;
      setLatestAnswer(nextAnswer);
      setLatestAnswerTraceId(nextAnswer ? result.traceId : "");
      setLatestCorrection(nextAnswer ? getAnswerCorrection(result.traceId) : null);
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
          window.setTimeout(() => {
            setDrafts((cur) => cur.map((draft) => draft.sourceId === sourceId ? { ...draft, fading: true } : draft));
            window.setTimeout(() => {
              setDrafts((cur) => cur.filter((draft) => draft.sourceId !== sourceId));
            }, 500);
          }, 2_000);
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

  async function retryDraft(failedDraft: DraftCard) {
    lastSubmittedRef.current = null;
    submitInFlightRef.current = null;
    await handleSubmit(failedDraft.transcript, { replaceDraftId: failedDraft.id });
  }

  function dismissDraft(draftId: string) {
    setDrafts((cur) => cur.filter((d) => d.id !== draftId));
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
    const trimmed = correctionText.trim();
    if (!trimmed) return;
    const firstEvidence = answer.retrievedEvidence[0];
    const firstSource = answer.matchedSources[0] ?? firstEvidence;
    const ok = await runRequest(setState, copy.status.feedbackSaved, async () => {
      await sendFeedback({
        elderId, actorUserId,
        sourceId: firstSource?.sourceId, eventId: firstEvidence?.eventId,
        feedbackType: "answer_wrong",
        correction: { answerText: answer.answerText, correctionText: trimmed },
      });
    });
    if (ok && latestAnswerTraceId) {
      setAnswerCorrection(latestAnswerTraceId, trimmed);
      setLatestCorrection({ correctionText: trimmed, correctedAt: Date.now() });
    }
  }

  async function handleLoadDebugTrace() {
    await runRequest(setState, "调试链路已加载。", async () => { setDebugTrace(await getDebugTrace(debugTraceId)); });
  }

  function setLists(lists: MvpLists) { setReminders(lists.reminders); }

  function dismissTodaySnapshot(date: string) {
    writeLastSnapshotDismissed(date);
    setTodaySnapshot(null);
  }

  const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-white">
        <AppHeader
          status={state}
          textScale={textScale}
          today={today}
          onToggleSettings={() => setShowSettings((value) => !value)}
          onToggleTextScale={handleToggleTextScale}
        />

        {showSettings ? (
          <SettingsPanel elderId={elderId} onClose={() => setShowSettings(false)} />
        ) : null}

        {/* 本周日历条 */}
        <WeekStrip now={now} />

        <section className="flex-1 overflow-y-auto px-4 pb-48 pt-2">
          {todaySnapshot ? <TodaySnapshotCard snapshot={todaySnapshot} onDismiss={dismissTodaySnapshot} /> : null}
          <DraftCards drafts={drafts} onRetry={retryDraft} onDismiss={dismissDraft} />
          {drafts.length && !taskItems.length ? null : (
            <TaskList
              confirmTimes={confirmTimes}
              items={taskItems}
              loading={state.loading}
              onConfirmReminder={handleConfirmReminder}
              onPickExample={(text) => {
                setInputText(text);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              onTimeChange={(id, value) => setConfirmTimes((cur) => ({ ...cur, [id]: value }))}
            />
          )}
          {latestAnswer ? (
            <LatestAnswer answer={latestAnswer} correction={latestCorrection} loading={state.loading} onSendFeedback={handleSendAnswerFeedback} />
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

        <ElderInputBar
          inputRef={inputRef}
          inputText={inputText}
          isListening={isListening}
          loading={state.loading}
          transcript={transcript}
          onInputChange={setInputText}
          onMicClick={handleMicClick}
          onSubmit={(text) => void handleSubmit(text)}
        />
      </div>
    </main>
  );
}
