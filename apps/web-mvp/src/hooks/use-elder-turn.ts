import { useEffect, useRef, useState } from "react";
import type { MemoryAnswer, Reminder } from "@mem/memory-schema";
import {
  confirmReminder,
  getDebugTrace,
  getIngestStatus,
  sendElderTurn,
  sendFeedback,
  type MvpLists,
  type RedactedDebugTrace,
} from "../lib/api.js";
import { createClientTurnId, formatConfirmedReminderText, refreshLists, runRequest, sleep, type RequestState } from "../lib/app-helpers.js";
import { copy } from "../lib/copy.js";
import { getAnswerCorrection, setAnswerCorrection, type AnswerCorrection } from "../lib/local-prefs.js";
import { toIso } from "../lib/elder-view-model.js";
import type { DraftCard } from "../components/draft-cards.js";

export function useElderTurn(elderId: string, actorUserId: string) {
  const [latestAnswer, setLatestAnswer] = useState<MemoryAnswer | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [confirmTimes, setConfirmTimes] = useState<Record<string, string>>({});
  const [debugTraceId, setDebugTraceId] = useState("");
  const [debugTrace, setDebugTrace] = useState<RedactedDebugTrace | null>(null);
  const [inputText, setInputText] = useState("");
  const [latestAnswerTraceId, setLatestAnswerTraceId] = useState("");
  const [latestCorrection, setLatestCorrection] = useState<AnswerCorrection | null>(null);
  const [state, setState] = useState<RequestState>({ loading: false });
  const submitInFlightRef = useRef<string | null>(null);
  const lastSubmittedRef = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    void refreshLists(elderId, setLists, setState, false);
  }, [elderId]);

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
    setDrafts((current) => options.replaceDraftId
      ? current.map((draft) => draft.id === options.replaceDraftId ? localDraft : draft)
      : [localDraft, ...current]);

    const ok = await runRequest(setState, copy.status.turnCompleted, async () => {
      const result = await sendElderTurn({ elderId, text: trimmed, clientTurnId });
      const nextAnswer = result.answer ?? null;
      setLatestAnswer(nextAnswer);
      setLatestAnswerTraceId(nextAnswer ? result.traceId : "");
      setLatestCorrection(nextAnswer ? getAnswerCorrection(result.traceId) : null);
      setDebugTraceId(result.traceId);
      if (result.draft) {
        setDrafts((current) => current.map((draft) => draft.id === localDraftId ? {
          id: result.draft!.sourceId,
          sourceId: result.draft!.sourceId,
          transcript: result.draft!.transcript,
          status: result.draft!.status,
        } : draft));
        void pollIngestStatus(result.draft.sourceId);
      } else {
        setDrafts((current) => current.filter((draft) => draft.id !== localDraftId));
      }
      setInputText("");
      await refreshLists(elderId, setLists, setState, false);
    });

    if (!ok) {
      setDrafts((current) => current.map((draft) => draft.id === localDraftId ? { ...draft, status: "failed" } : draft));
    }
    if (submitInFlightRef.current === trimmed) submitInFlightRef.current = null;
  }

  async function retryDraft(failedDraft: DraftCard) {
    lastSubmittedRef.current = null;
    submitInFlightRef.current = null;
    await handleSubmit(failedDraft.transcript, { replaceDraftId: failedDraft.id });
  }

  function dismissDraft(draftId: string) {
    setDrafts((current) => current.filter((draft) => draft.id !== draftId));
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
      const confirmed = await confirmReminder({ reminderId: reminder.id, actorUserId, remindAt, timezone });
      setReminders((current) => current.map((item) => item.id === confirmed.id ? confirmed : item));
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
        elderId,
        actorUserId,
        sourceId: firstSource?.sourceId,
        eventId: firstEvidence?.eventId,
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
    await runRequest(setState, "调试链路已加载。", async () => {
      setDebugTrace(await getDebugTrace(debugTraceId));
    });
  }

  return {
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
  };

  function setLists(lists: MvpLists) {
    setReminders(lists.reminders);
  }

  async function pollIngestStatus(sourceId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(2_000);
      try {
        const status = await getIngestStatus(sourceId);
        setDrafts((current) => current.map((draft) => draft.sourceId === sourceId ? {
          ...draft,
          status: status.status,
          summary: status.summary,
          errorMessage: status.errorMessage,
        } : draft));
        if (status.status === "ready") {
          await refreshLists(elderId, setLists, setState, false);
          window.setTimeout(() => {
            setDrafts((current) => current.map((draft) => draft.sourceId === sourceId ? { ...draft, fading: true } : draft));
            window.setTimeout(() => {
              setDrafts((current) => current.filter((draft) => draft.sourceId !== sourceId));
            }, 500);
          }, 2_000);
          return;
        }
        if (status.status === "failed") return;
      } catch (error) {
        setDrafts((current) => current.map((draft) => draft.sourceId === sourceId ? {
          ...draft,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        } : draft));
        return;
      }
    }
  }
}
