import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, RefreshCw } from "lucide-react";
import type { DebugTrace, MemoryAnswer, Reminder } from "@goldmem/memory-schema";
import {
  confirmReminder,
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

type RequestState = {
  loading: boolean;
  message?: string;
  error?: string;
};

const DEFAULT_ELDER_ID = "elder-mvp";
const DEFAULT_ACTOR_ID = "elder-mvp";

export function App() {
  const [elderId, setElderId] = useState(DEFAULT_ELDER_ID);
  const [actorUserId, setActorUserId] = useState(DEFAULT_ACTOR_ID);
  const [latestAnswer, setLatestAnswer] = useState<MemoryAnswer | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [confirmTimes, setConfirmTimes] = useState<Record<string, string>>({});
  const [debugTraceId, setDebugTraceId] = useState("");
  const [debugTrace, setDebugTrace] = useState<DebugTrace | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [state, setState] = useState<RequestState>({ loading: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const now = useMemo(() => new Date(), [reminders]);
  const taskItems = useMemo(() => buildTaskItems(reminders, now), [reminders, now]);

  useEffect(() => {
    void refreshLists(elderId, setLists, setState, false);
  }, [elderId]);

  async function handleSubmit(text: string) {
    if (!text.trim()) return;
    await runRequest(setState, copy.status.turnCompleted, async () => {
      const result = await sendElderTurn({ elderId, text: text.trim() });
      setLatestAnswer(result.answer ?? null);
      setDebugTraceId(result.traceId);
      setTranscript("");
      setIsListening(false);
      await refreshLists(elderId, setLists, setState, false);
    });
  }

  function handleMicClick() {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = Array.from(event.results).map((r: any) => r[0].transcript).join("");
      setTranscript(text);
    };
    rec.onend = () => {
      setIsListening(false);
      setTranscript((current) => {
        if (current.trim()) void handleSubmit(current);
        return current;
      });
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
    setReminders((current) => current.map((item) => item.id === reminder.id ? {
      ...item,
      remindAt,
      timeText: confirmedText,
      reason: confirmedText ? `已按确认时间设置提醒：${confirmedText}。` : item.reason,
      status: "confirmed" as const,
      confirmationRequired: false,
      confirmedBy: actorUserId,
      confirmedAt: new Date().toISOString(),
    } : item));
    const ok = await runRequest(setState, copy.status.reminderConfirmed, async () => {
      const confirmed = await confirmReminder({
        reminderId: reminder.id,
        actorUserId,
        remindAt,
        timezone,
      });
      setReminders((current) => current.map((item) => item.id === confirmed.id ? confirmed : item));
      await refreshLists(elderId, setLists, setState, false);
    });
    if (!ok) setReminders(previousReminders);
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
    setReminders(lists.reminders);
  }

  return (
    <main className="min-h-screen bg-[#efefef] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col overflow-hidden bg-[#efefef]">
        {/* 顶部汇总卡片 */}
        <div className="mx-4 mt-6 rounded-2xl bg-white px-5 py-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{copy.tasks.title}</p>
          <p className="mt-1 text-[2.5rem] font-bold leading-none tracking-tight text-slate-950">{taskItems.length}</p>
          {state.message || state.error ? (
            <p className={`mt-2 flex items-center gap-1.5 text-xs ${state.error ? "text-red-500" : "text-slate-400"}`}>
              <RefreshCw className="h-3 w-3" />
              {state.error ?? state.message}
            </p>
          ) : null}
          <button
            className="mt-4 w-full rounded-xl bg-slate-950 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            disabled={state.loading}
            type="button"
            onClick={() => void refreshLists(elderId, setLists, setState)}
          >
            {state.loading ? copy.conversation.thinking : copy.events.refresh}
          </button>
        </div>

        <section className="flex-1 overflow-y-auto px-4 py-3 pb-28">
          <TaskList
            confirmTimes={confirmTimes}
            items={taskItems}
            loading={state.loading}
            onConfirmReminder={handleConfirmReminder}
            onTimeChange={(id, value) => setConfirmTimes((current) => ({ ...current, [id]: value }))}
          />

          {latestAnswer ? (
            <LatestAnswer answer={latestAnswer} loading={state.loading} onSendFeedback={handleSendAnswerFeedback} />
          ) : null}

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

        {/* 浮动语音按钮 */}
        <div className="fixed bottom-0 inset-x-0 z-20 mx-auto w-full max-w-[430px] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:absolute sm:inset-x-auto sm:w-[430px]">
          {isListening && transcript ? (
            <p className="mb-3 px-5 text-center text-sm font-light italic text-slate-500">{transcript}</p>
          ) : null}
          {isListening ? (
            <p className="mb-3 text-center text-xs text-slate-400">{copy.conversation.listening}</p>
          ) : null}
          <div className="flex justify-center">
            <button
              aria-label={copy.conversation.voiceAction}
              className={`h-14 w-14 rounded-full shadow-lg transition-all ${isListening ? "bg-slate-950 text-white scale-110" : "bg-white text-slate-950 hover:bg-slate-50"} ${state.loading ? "opacity-50" : ""}`}
              disabled={state.loading}
              type="button"
              onClick={handleMicClick}
            >
              <Mic className="mx-auto h-6 w-6" />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function formatConfirmedReminderText(remindAt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(remindAt));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}年${Number(value("month"))}月${Number(value("day"))}日 ${value("hour")}:${value("minute")}`;
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
): Promise<boolean> {
  setState({ loading: true });
  try {
    await action();
    setState({ loading: false, message: showStatus ? successMessage : undefined });
    return true;
  } catch (error) {
    setState({
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
