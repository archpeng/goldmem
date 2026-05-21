import { useEffect, useMemo, useRef, useState } from "react";
import { copy } from "./lib/copy.js";
import { buildTaskItems } from "./lib/elder-view-model.js";
import {
  applyTextScaleToDocument,
  readTextScale,
  writeTextScale,
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
import { useElderTurn } from "./hooks/use-elder-turn.js";
import { useSpeechRecognition } from "./hooks/use-speech-recognition.js";
import { useTodaySnapshot } from "./hooks/use-today-snapshot.js";

const DEFAULT_ELDER_ID = "elder-mvp";
const DEFAULT_ACTOR_ID = "elder-mvp";

export function App() {
  const [elderId, setElderId] = useState(DEFAULT_ELDER_ID);
  const [actorUserId, setActorUserId] = useState(DEFAULT_ACTOR_ID);
  const [textScale, setTextScale] = useState<ElderTextScale>("normal");
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    state,
    setState,
    reminders,
    drafts,
    confirmTimes,
    latestAnswer,
    latestCorrection,
    debugTraceId,
    setDebugTraceId,
    debugTrace,
    inputText,
    setInputText,
    setConfirmTimes,
    handleSubmit,
    retryDraft,
    dismissDraft,
    handleConfirmReminder,
    handleSendAnswerFeedback,
    handleLoadDebugTrace,
  } = useElderTurn(elderId, actorUserId);
  const speech = useSpeechRecognition(
    (text) => { void handleSubmit(text); },
    (message) => setState({ loading: false, error: message }),
  );
  const { todaySnapshot, dismissTodaySnapshot } = useTodaySnapshot(elderId, setState);

  const now = useMemo(() => new Date(), [reminders]);
  const taskItems = useMemo(() => buildTaskItems(reminders, now), [reminders, now]);
  const devPanelEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_PANEL === "true";

  useEffect(() => {
    const initial = readTextScale();
    setTextScale(initial);
    applyTextScaleToDocument(initial);
  }, []);

  function handleToggleTextScale() {
    const next: ElderTextScale = textScale === "xl" ? "normal" : "xl";
    setTextScale(next);
    writeTextScale(next);
    applyTextScaleToDocument(next);
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
          {devPanelEnabled ? (
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
          isListening={speech.isListening}
          loading={state.loading}
          transcript={speech.transcript}
          onInputChange={setInputText}
          onMicClick={speech.handleMicClick}
          onSubmit={(text) => void handleSubmit(text)}
        />
      </div>
    </main>
  );
}
