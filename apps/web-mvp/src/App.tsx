import { useEffect, useMemo, useState } from "react";
import { Bell, Brain, Check, Database, GitBranch, HelpCircle, RefreshCw, Save, Search, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import type { DebugTrace, FamilyTask, MemoryAnswer, MemoryEvent, Reminder } from "@goldmem/memory-schema";
import {
  confirmFamilyTask,
  confirmReminder,
  createTextNote,
  getDebugTrace,
  listMvpData,
  queryMemory,
  rejectFamilyTask,
  requestFamilyTaskInfo,
  type IngestResult,
  type MvpLists,
} from "./lib/api.js";
import {
  copy,
  translateEventType,
  translateRiskLevel,
  translateStatus,
  translateUrgency,
  translateVisibility,
} from "./lib/copy.js";
import { Alert } from "./components/ui/alert.js";
import { Badge, type BadgeProps } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";

type RequestState = {
  loading: boolean;
  message?: string;
  error?: string;
};

export function App() {
  const [elderId, setElderId] = useState("elder-mvp");
  const [actorUserId, setActorUserId] = useState("elder-mvp");
  const [familyActorUserId, setFamilyActorUserId] = useState("family-mvp");
  const [transcript, setTranscript] = useState<string>(copy.capture.defaultTranscript);
  const [query, setQuery] = useState<string>(copy.recall.defaultQuestion);
  const [confirmTimes, setConfirmTimes] = useState<Record<string, string>>({});
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [answer, setAnswer] = useState<MemoryAnswer | null>(null);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [familyTasks, setFamilyTasks] = useState<FamilyTask[]>([]);
  const [debugTraceId, setDebugTraceId] = useState("");
  const [debugTrace, setDebugTrace] = useState<DebugTrace | null>(null);
  const [state, setState] = useState<RequestState>({ loading: false });

  const canRefresh = elderId.trim().length > 0;
  const mergedEvents = useMemo(() => mergeEvents(events, ingestResult?.events ?? []), [events, ingestResult]);

  useEffect(() => {
    if (!canRefresh) return;
    void refreshLists(elderId, setLists, setState);
  }, [canRefresh, elderId]);

  async function handleIngest() {
    await runRequest(setState, copy.status.memorySaved, async () => {
      const result = await createTextNote({ elderId, transcript });
      setIngestResult(result);
      await refreshLists(elderId, setLists, setState, false);
    });
  }

  async function handleQuery() {
    await runRequest(setState, copy.status.queryAnswered, async () => {
      const result = await queryMemory({ elderId, query });
      setAnswer(result);
    });
  }

  async function handleConfirmReminder(reminder: Reminder) {
    await runRequest(setState, copy.status.reminderConfirmed, async () => {
      const localValue = confirmTimes[reminder.id];
      await confirmReminder({
        reminderId: reminder.id,
        actorUserId,
        remindAt: reminder.remindAt ?? toIso(localValue),
      });
      await refreshLists(elderId, setLists, setState, false);
    });
  }

  async function handleConfirmFamilyTask(task: FamilyTask) {
    await runRequest(setState, copy.status.familyTaskConfirmed, async () => {
      await confirmFamilyTask({ taskId: task.id, actorUserId: familyActorUserId });
      await refreshLists(elderId, setLists, setState, false);
    });
  }

  async function handleRejectFamilyTask(task: FamilyTask) {
    await runRequest(setState, "家属任务已拒绝。", async () => {
      await rejectFamilyTask({ taskId: task.id, actorUserId: familyActorUserId });
      await refreshLists(elderId, setLists, setState, false);
    });
  }

  async function handleRequestFamilyTaskInfo(task: FamilyTask) {
    await runRequest(setState, "已标记需要补充信息。", async () => {
      await requestFamilyTaskInfo({ taskId: task.id, actorUserId: familyActorUserId });
      await refreshLists(elderId, setLists, setState, false);
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
    <main className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
      <header className="grid gap-5 pb-5 lg:grid-cols-[minmax(280px,1fr)_minmax(420px,680px)] lg:items-end">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-600">
            <ShieldCheck className="h-4 w-4" />
            Kernel MVP
          </div>
          <h1 className="text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">{copy.appTitle}</h1>
          <p className="mt-2 max-w-2xl text-base leading-7 text-slate-600">{copy.appDescription}</p>
        </div>
        <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
          <Field label={copy.identity.elderId}>
            <Input value={elderId} onChange={(event) => setElderId(event.target.value)} />
          </Field>
          <Field label={copy.identity.elderActor}>
            <Input value={actorUserId} onChange={(event) => setActorUserId(event.target.value)} />
          </Field>
          <Field label={copy.identity.familyActor}>
            <Input value={familyActorUserId} onChange={(event) => setFamilyActorUserId(event.target.value)} />
          </Field>
        </section>
      </header>

      {state.message || state.error ? (
        <Alert className="mb-4" variant={state.error ? "destructive" : "default"}>
          {state.error ?? state.message}
        </Alert>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <Card>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleIngest();
            }}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-slate-500" />
                <CardTitle>{copy.capture.title}</CardTitle>
              </div>
              <Button disabled={state.loading || !transcript.trim() || !elderId.trim()} type="submit">
                <Save className="h-4 w-4" />
                {copy.capture.action}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={7} />
              {ingestResult ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-950">{copy.capture.latestSummary}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{ingestResult.summary}</p>
                </div>
              ) : null}
            </CardContent>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-slate-500" />
              <CardTitle>{copy.recall.title}</CardTitle>
            </div>
            <Button disabled={state.loading || !query.trim() || !elderId.trim()} onClick={() => void handleQuery()}>
              <Search className="h-4 w-4" />
              {copy.recall.action}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} />
            {answer ? <AnswerCard answer={answer} /> : null}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{copy.events.title}</CardTitle>
              <CardDescription>从 PostgreSQL 事实源读取的最近记忆。</CardDescription>
            </div>
            <Button
              disabled={state.loading || !elderId.trim()}
              variant="secondary"
              onClick={() => void refreshLists(elderId, setLists, setState)}
            >
              <RefreshCw className="h-4 w-4" />
              {copy.events.refresh}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            {mergedEvents.length ? mergedEvents.map((event) => <EventCard event={event} key={event.id} />) : <Empty label={copy.events.empty} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-slate-500" />
              <CardTitle>{copy.reminders.title}</CardTitle>
            </div>
            <Badge variant="default">{reminders.length}</Badge>
          </CardHeader>
          <CardContent className="grid gap-3">
            {reminders.length ? (
              reminders.map((reminder) => (
                <ReminderCard
                  confirmTime={confirmTimes[reminder.id] ?? ""}
                  key={reminder.id}
                  loading={state.loading}
                  reminder={reminder}
                  onConfirm={() => void handleConfirmReminder(reminder)}
                  onTimeChange={(value) => setConfirmTimes((current) => ({ ...current, [reminder.id]: value }))}
                />
              ))
            ) : (
              <Empty label={copy.reminders.empty} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-slate-500" />
              <CardTitle>{copy.familyTasks.title}</CardTitle>
            </div>
            <Badge variant="default">{familyTasks.length}</Badge>
          </CardHeader>
          <CardContent className="grid gap-3">
            {familyTasks.length ? (
              familyTasks.map((task) => (
                <FamilyTaskCard
                  key={task.id}
                  loading={state.loading}
                  task={task}
                  onConfirm={() => void handleConfirmFamilyTask(task)}
                  onReject={() => void handleRejectFamilyTask(task)}
                  onNeedsMoreInfo={() => void handleRequestFamilyTaskInfo(task)}
                />
              ))
            ) : (
              <Empty label={copy.familyTasks.empty} />
            )}
          </CardContent>
        </Card>
      </section>

      {import.meta.env.DEV ? (
        <section className="mt-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>调试链路</CardTitle>
                <CardDescription>按 traceId 读取只读 audit 链路。</CardDescription>
              </div>
              <Button disabled={state.loading || !debugTraceId.trim()} onClick={() => void handleLoadDebugTrace()}>
                <Search className="h-4 w-4" />
                查询
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Input value={debugTraceId} onChange={(event) => setDebugTraceId(event.target.value)} placeholder="traceId" />
              {debugTrace ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p className="font-medium text-slate-950">{debugTrace.traceId}</p>
                  <p className="mt-1">audit {debugTrace.auditTrail.length} 条</p>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-white p-3 text-xs leading-5">
                    {JSON.stringify(debugTrace, null, 2)}
                  </pre>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </main>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-600">
      {label}
      {children}
    </label>
  );
}

function AnswerCard({ answer }: { answer: MemoryAnswer }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-base leading-7 text-slate-950">{answer.answerText}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="warning">
          {copy.recall.confidence} {formatPercent(answer.confidence)}
        </Badge>
        {answer.matchedSources.length ? <Badge>{copy.recall.matchedSources}</Badge> : null}
      </div>
      {answer.retrievedEvidence.length ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-xs font-medium uppercase text-slate-500">{copy.recall.evidenceSources}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Array.from(new Set(answer.retrievedEvidence.map((item) => item.retrievalSource))).map((source) => (
              <EvidenceSourceBadge key={source} source={source} />
            ))}
          </div>
        </div>
      ) : null}
      {answer.matchedSources.length ? (
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
          {answer.matchedSources.map((source) => (
            <li className="rounded-md border border-slate-200 bg-white px-3 py-2" key={`${source.sourceId}:${source.summary}`}>
              <div className="mb-1">
                <EvidenceSourceBadge source={source.retrievalSource ?? "postgres"} />
              </div>
              {source.summary}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function EvidenceSourceBadge({ source }: { source: "postgres" | "mem0" | "context_link" | "graphiti" }) {
  if (source === "context_link") {
    return (
      <Badge className="gap-1" variant="warning">
        <GitBranch className="h-3.5 w-3.5" />
        {copy.recall.contextLinkEvidence}
      </Badge>
    );
  }

  if (source === "graphiti") {
    return (
      <Badge className="gap-1" variant="warning">
        <Brain className="h-3.5 w-3.5" />
        {copy.recall.graphitiEvidence}
      </Badge>
    );
  }

  const isMem0 = source === "mem0";
  const Icon = isMem0 ? Sparkles : Database;
  return (
    <Badge className="gap-1" variant={isMem0 ? "default" : "secondary"}>
      <Icon className="h-3.5 w-3.5" />
      {isMem0 ? copy.recall.mem0Evidence : copy.recall.postgresEvidence}
    </Badge>
  );
}

function EventCard({ event }: { event: MemoryEvent }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-base font-semibold leading-6 text-slate-950">{event.title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">{event.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge>{translateEventType(event.type)}</Badge>
        <Badge variant={riskVariant(event.riskLevel)}>{translateRiskLevel(event.riskLevel)}</Badge>
        <Badge>{translateStatus(event.status)}</Badge>
      </div>
    </article>
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
    <article className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div>
        <h3 className="text-base font-semibold leading-6 text-slate-950">{reminder.title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{reminder.reason}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{translateStatus(reminder.status)}</Badge>
          <Badge variant={reminder.remindAt ? "secondary" : "warning"}>
            {reminder.remindAt ? formatDate(reminder.remindAt) : copy.reminders.timeNeeded}
          </Badge>
        </div>
      </div>
      {!reminder.remindAt ? (
        <Input
          aria-label={`${reminder.title} 的提醒时间`}
          type="datetime-local"
          value={confirmTime}
          onChange={(event) => onTimeChange(event.target.value)}
        />
      ) : null}
      <Button disabled={loading || reminder.status === "confirmed" || (!reminder.remindAt && !confirmTime)} onClick={onConfirm}>
        <Check className="h-4 w-4" />
        {copy.reminders.confirm}
      </Button>
    </article>
  );
}

function FamilyTaskCard({
  loading,
  task,
  onConfirm,
  onReject,
  onNeedsMoreInfo,
}: {
  loading: boolean;
  task: FamilyTask;
  onConfirm: () => void;
  onReject: () => void;
  onNeedsMoreInfo: () => void;
}) {
  return (
    <article className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div>
        <h3 className="text-base font-semibold leading-6 text-slate-950">{task.title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{task.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={task.urgency === "high" ? "danger" : task.urgency === "medium" ? "warning" : "secondary"}>
            {translateUrgency(task.urgency)}
          </Badge>
          <Badge>{translateVisibility(task.visibility)}</Badge>
          <Badge>{translateStatus(task.status)}</Badge>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Button disabled={loading || task.status !== "pending"} onClick={onConfirm}>
          <Check className="h-4 w-4" />
          {copy.familyTasks.confirm}
        </Button>
        <Button disabled={loading || task.status !== "pending"} variant="secondary" onClick={onNeedsMoreInfo}>
          <HelpCircle className="h-4 w-4" />
          补充
        </Button>
        <Button disabled={loading || task.status !== "pending"} variant="secondary" onClick={onReject}>
          <X className="h-4 w-4" />
          拒绝
        </Button>
      </div>
    </article>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}

async function refreshLists(
  elderId: string,
  setLists: (lists: MvpLists) => void,
  setState: (state: RequestState) => void,
  showStatus = true,
) {
  if (!elderId.trim()) return;
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

function mergeEvents(...groups: MemoryEvent[][]): MemoryEvent[] {
  const byId = new Map<string, MemoryEvent>();
  for (const event of groups.flat()) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function riskVariant(riskLevel: string): BadgeProps["variant"] {
  if (riskLevel === "fraud_risk" || riskLevel === "financial") return "danger";
  if (riskLevel === "medical" || riskLevel === "sensitive") return "warning";
  return "secondary";
}
