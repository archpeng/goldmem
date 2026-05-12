import { useEffect, useMemo, useState } from "react";
import { Mic, RefreshCw, Send } from "lucide-react";
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
import { Alert } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
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
  const [inputText, setInputText] = useState("");
  const [latestAnswer, setLatestAnswer] = useState<MemoryAnswer | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [confirmTimes, setConfirmTimes] = useState<Record<string, string>>({});
  const [debugTraceId, setDebugTraceId] = useState("");
  const [debugTrace, setDebugTrace] = useState<DebugTrace | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [state, setState] = useState<RequestState>({ loading: false });

  const now = useMemo(() => new Date(), [reminders]);
  const taskItems = useMemo(() => buildTaskItems(reminders, now), [reminders, now]);

  useEffect(() => {
    void refreshLists(elderId, setLists, setState, false);
  }, [elderId]);

  async function handleSubmit() {
    const text = inputText.trim();
    if (!text) return;
    await runRequest(setState, copy.status.turnCompleted, async () => {
      const result = await sendElderTurn({ elderId, text });
      setLatestAnswer(result.answer ?? null);
      setDebugTraceId(result.traceId);
      setInputText("");
      setIsListening(false);
      await refreshLists(elderId, setLists, setState, false);
    });
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
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col overflow-hidden bg-slate-100">
        <header className="px-5 pb-2 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-[2rem] font-bold leading-tight tracking-normal text-slate-950">{copy.appTitle}</h1>
            </div>
            <Button
              aria-label={copy.events.refresh}
              className="h-10 w-10 shrink-0 rounded-full bg-white text-slate-950 shadow-none hover:bg-slate-50"
              disabled={state.loading}
              size="icon"
              variant="secondary"
              onClick={() => void refreshLists(elderId, setLists, setState)}
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
          </div>
        </header>

        {state.message || state.error ? (
          <Alert className="mx-4 mt-3 rounded-2xl bg-white text-base leading-7 shadow-none" variant={state.error ? "destructive" : "default"}>
            {state.error ?? state.message}
          </Alert>
        ) : null}

        <section className="flex-1 overflow-y-auto px-4 py-3 pb-40">
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

        <form
          className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] border-t border-slate-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur sm:absolute sm:inset-x-auto sm:w-[430px]"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="grid gap-2">
            <Textarea
              aria-label={copy.conversation.inputLabel}
              className="min-h-16 resize-none rounded-2xl bg-slate-100 text-lg leading-7 shadow-none"
              placeholder={copy.conversation.placeholder}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
            />
            <div className="grid grid-cols-[3.25rem_1fr] gap-2">
              <Button
                aria-label={copy.conversation.voiceAction}
                className={`h-12 rounded-full shadow-none ${isListening ? "bg-slate-950 text-white hover:bg-slate-800" : "bg-slate-100 text-slate-950 hover:bg-slate-200"}`}
                disabled={state.loading}
                size="icon"
                type="button"
                variant={isListening ? "default" : "secondary"}
                onClick={() => setIsListening((current) => !current)}
              >
                <Mic className="h-6 w-6" />
              </Button>
              <Button className="h-12 rounded-2xl bg-slate-950 text-base shadow-none hover:bg-slate-800" disabled={state.loading || !inputText.trim()} type="submit">
                <Send className="h-5 w-5" />
                {state.loading ? copy.conversation.thinking : copy.conversation.send}
              </Button>
            </div>
            {isListening ? <p className="text-center text-base font-medium text-slate-700">{copy.conversation.listening}</p> : null}
          </div>
        </form>
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
