import { useEffect, useMemo, useState } from "react";
import { Mic, RefreshCw, Send } from "lucide-react";
import type { DebugTrace, FamilyTask, MemoryAnswer, MemoryEvent, Reminder } from "@goldmem/memory-schema";
import {
  confirmReminder,
  getDebugTrace,
  listMvpData,
  sendElderTurn,
  sendFeedback,
  type MvpLists,
} from "./lib/api.js";
import { copy } from "./lib/copy.js";
import { buildTodaySnapshot, toIso } from "./lib/elder-view-model.js";
import { Alert } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
import { DevPanel } from "./components/dev-panel.js";
import { EmptyConversation } from "./components/empty-conversation.js";
import { TodaySnapshot } from "./components/elder-today.js";
import { type ChatTurn, TurnCard } from "./components/elder-turn-cards.js";

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
