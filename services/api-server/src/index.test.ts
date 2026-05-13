import { describe, expect, it } from "vitest";
import { buildServer, buildTemporalMemoryFromEnv, type ApiServerDeps } from "./index.js";
import type { DebugTrace, ElderTurnResult, FamilyTask, Feedback, IngestStatus, MemoryAnswer, MemoryEvent, Reminder } from "@goldmem/memory-schema";

describe("api-server", () => {
  it("handles elder turn, reminder list, and family task endpoints", async () => {
    const deps = createDeps();
    const server = buildServer(deps);

    const health = await server.inject({
      method: "GET",
      url: "/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const recordTurn = await server.inject({
      method: "POST",
      url: "/elder/turn",
      payload: {
        elderId: "elder-1",
        text: "I bought vegetables.",
      },
    });
    expect(recordTurn.statusCode).toBe(200);
    expect(recordTurn.json().turnType).toBe("record");
    expect(recordTurn.json().draft.sourceId).toBe("source-1");

    const ingestStatus = await server.inject({
      method: "GET",
      url: "/elder/sources/source-1/ingest-status",
    });
    expect(ingestStatus.statusCode).toBe(200);
    expect(ingestStatus.json().status).toBe("ready");

    const recallTurn = await server.inject({
      method: "POST",
      url: "/elder/turn",
      payload: {
        elderId: "elder-1",
        text: "What did I buy?",
      },
    });
    expect(recallTurn.statusCode).toBe(200);
    expect(recallTurn.json().turnType).toBe("recall");
    expect(recallTurn.json().answer.answerText).toContain("vegetables");

    const feedback = await server.inject({
      method: "POST",
      url: "/elder/feedback",
      payload: {
        elderId: "elder-1",
        actorUserId: "elder-1",
        sourceId: "source-1",
        feedbackType: "answer_wrong",
        correction: { query: "What did I buy?", expected: "青菜" },
      },
    });
    expect(feedback.statusCode).toBe(200);
    expect(feedback.json().feedbackType).toBe("answer_wrong");
    expect(deps.auditRecords.some((record) => record.type === "feedback_created")).toBe(true);

    const reminders = await server.inject({
      method: "GET",
      url: "/elder/reminders?elderId=elder-1",
    });
    expect(reminders.statusCode).toBe(200);
    expect(reminders.json()).toHaveLength(1);

    const events = await server.inject({
      method: "GET",
      url: "/elder/events?elderId=elder-1",
    });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toHaveLength(1);

    const tasks = await server.inject({
      method: "GET",
      url: "/family/elders/elder-1/tasks",
    });
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json()).toHaveLength(1);

    const confirmed = await server.inject({
      method: "POST",
      url: "/family/tasks/task-1/confirm",
      payload: { actorUserId: "family-1" },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("confirmed");
    expect(deps.auditRecords.some((record) => record.type === "family_task_confirmed")).toBe(true);

    const rejected = await server.inject({
      method: "POST",
      url: "/family/tasks/task-1/reject",
      payload: { actorUserId: "family-1" },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe("rejected");

    const needsMoreInfo = await server.inject({
      method: "POST",
      url: "/family/tasks/task-1/needs-more-info",
      payload: { actorUserId: "family-1" },
    });
    expect(needsMoreInfo.statusCode).toBe(200);
    expect(needsMoreInfo.json().status).toBe("needs_more_info");

    const reminderConfirmed = await server.inject({
      method: "POST",
      url: "/elder/reminders/reminder-1/confirm",
      payload: { actorUserId: "elder-1", remindAt: "2026-05-10T09:00:00.000Z" },
    });
    expect(reminderConfirmed.statusCode).toBe(200);
    expect(deps.auditRecords.some((record) => record.type === "reminder_confirmed")).toBe(true);

    const familyReminder = await server.inject({
      method: "POST",
      url: "/family/reminders",
      payload: {
        elderId: "elder-1",
        actorUserId: "family-1",
        title: "提醒妈妈明天量血压",
        remindAt: "2026-05-11T09:00:00.000Z",
        reason: "Family-created reminder.",
        idempotencyKey: "family-api-1",
      },
    });
    expect(familyReminder.statusCode).toBe(200);
    expect(familyReminder.json().id).toBe("family-reminder-1");
    expect(deps.auditRecords.some((record) => record.type === "family_reminder_created")).toBe(true);

    const trace = await server.inject({
      method: "GET",
      url: "/debug/traces/trace-1",
    });
    expect(trace.statusCode).toBe(200);
    expect(trace.json().traceId).toBe("trace-1");
  });

  it("fails fast when production requires Graphiti config", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalRequired = process.env.GRAPHITI_REQUIRED_IN_PRODUCTION;
    const originalBaseUrl = process.env.GRAPHITI_BASE_URL;
    delete process.env.GRAPHITI_BASE_URL;
    process.env.GRAPHITI_REQUIRED_IN_PRODUCTION = "true";

    expect(() => buildTemporalMemoryFromEnv()).toThrow("GRAPHITI_BASE_URL is required");

    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalRequired === undefined) delete process.env.GRAPHITI_REQUIRED_IN_PRODUCTION;
    else process.env.GRAPHITI_REQUIRED_IN_PRODUCTION = originalRequired;
    if (originalBaseUrl === undefined) delete process.env.GRAPHITI_BASE_URL;
    else process.env.GRAPHITI_BASE_URL = originalBaseUrl;
  });
});

function createDeps(): ApiServerDeps & { auditRecords: Array<{ type: string }> } {
  const reminder: Reminder = {
    id: "reminder-1",
    elderId: "elder-1",
    sourceId: "source-1",
    title: "Take a walk",
    status: "candidate",
    confirmationRequired: false,
    confidence: 0.8,
    reason: "Test reminder",
    createdAt: "2026-05-09T12:00:00.000Z",
  };
  const task: FamilyTask = {
    id: "task-1",
    elderId: "elder-1",
    type: "general_review",
    title: "Review",
    summary: "Review task",
    status: "pending",
    visibility: "shared_summary",
    urgency: "low",
    createdAt: "2026-05-09T12:00:00.000Z",
  };
  const event: MemoryEvent = {
    id: "event-1",
    elderId: "elder-1",
    sourceId: "source-1",
    type: "shopping",
    title: "Bought vegetables",
    summary: "The elder bought vegetables.",
    timeConfidence: 0.8,
    entities: [],
    importance: 0.5,
    confidence: 0.9,
    riskLevel: "normal",
    requiresConfirmation: false,
    visibility: "private",
    evidence: [{ sourceId: "source-1", quote: "I bought vegetables." }],
    status: "active",
    createdAt: "2026-05-09T12:00:00.000Z",
  };

  const auditRecords: Array<{ type: string }> = [];
  const debugTrace: DebugTrace = {
    traceId: "trace-1",
    auditTrail: [{
      id: "audit-1",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      traceId: "trace-1",
      type: "memory_query",
      payload: { traceId: "trace-1" },
      createdAt: "2026-05-09T12:00:00.000Z",
    }],
  };

  return {
    kernel: {
      ingestText: async () => ({
        traceId: "trace-ingest",
        sourceId: "source-1",
        summary: "Summary",
        events: [],
        reminderCandidates: [],
        elderFacingCards: [],
      }),
      ingestVoice: async () => ({
        traceId: "trace-ingest",
        sourceId: "source-1",
        summary: "Summary",
        events: [],
        reminderCandidates: [],
        elderFacingCards: [],
      }),
      queryMemory: async (): Promise<MemoryAnswer> => ({
        traceId: "trace-query",
        answerText: "You bought vegetables.",
        confidence: 0.9,
        matchedSources: [],
        retrievedEvidence: [],
        suggestedActions: [],
      }),
      elderTurn: async (input): Promise<ElderTurnResult> => {
        if (input.text.includes("?")) {
          return {
            traceId: "trace-turn-query",
            turnType: "recall",
            message: "You bought vegetables.",
            answer: {
              traceId: "trace-query",
              answerText: "You bought vegetables.",
              confidence: 0.9,
              matchedSources: [],
              retrievedEvidence: [],
              suggestedActions: [],
            },
          };
        }
        return {
          traceId: "trace-turn-ingest",
          turnType: "record",
          message: "我先记下这句话，正在整理提醒。",
          draft: {
            sourceId: "source-1",
            transcript: input.text,
            status: "queued",
            createdAt: "2026-05-09T12:00:00.000Z",
          },
        };
      },
      getIngestStatus: async (): Promise<IngestStatus> => ({
        sourceId: "source-1",
        status: "ready",
        summary: "Summary",
        eventIds: ["event-1"],
        reminderIds: ["reminder-1"],
      }),
      createFamilyReminder: async (input) => {
        auditRecords.push({ type: "family_reminder_created" });
        return {
          id: "family-reminder-1",
          tenantId: input.tenantId,
          elderId: input.elderId,
          sourceId: "source-family-1",
          title: input.title,
          description: input.description,
          remindAt: input.remindAt,
          status: "pending_family_confirm",
          confirmationRequired: true,
          confidence: 1,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          createdAt: "2026-05-09T12:00:00.000Z",
        };
      },
      createFeedback: async (input): Promise<Feedback> => {
        auditRecords.push({ type: "feedback_created" });
        return {
          ...input,
          id: "feedback-1",
          createdAt: "2026-05-09T12:00:00.000Z",
        };
      },
      confirmReminder: async (input) => {
        auditRecords.push({ type: "reminder_confirmed" });
        return {
          ...reminder,
          status: "confirmed",
          confirmedBy: input.actorUserId,
          remindAt: input.remindAt ?? reminder.remindAt,
        };
      },
      updateFamilyTaskStatus: async (input) => {
        const status = input.action === "confirm"
          ? "confirmed"
          : input.action === "reject"
            ? "rejected"
            : "needs_more_info";
        auditRecords.push({ type: `family_task_${status}` });
        return {
          ...task,
          status,
          confirmedBy: input.actorUserId,
          confirmedAt: "2026-05-09T12:01:00.000Z",
        };
      },
    } as ApiServerDeps["kernel"],
    eventStore: {
      create: async (input) => ({ ...input, id: "event-2", createdAt: event.createdAt }),
      search: async () => [event],
    },
    reminderStore: {
      create: async (input) => ({ ...input, id: "reminder-2", createdAt: reminder.createdAt }),
      get: async () => reminder,
      listByElder: async () => [reminder],
      update: async (_id, patch) => ({ ...reminder, ...patch }),
    },
    familyTaskStore: {
      create: async (input) => ({ ...task, ...input }),
      listByElder: async () => [task],
      listPending: async () => [task],
      confirm: async (input) => ({
        ...task,
        status: "confirmed",
        confirmedBy: input.actorUserId,
        confirmedAt: "2026-05-09T12:01:00.000Z",
      }),
      reject: async (input) => ({
        ...task,
        status: "rejected",
        confirmedBy: input.actorUserId,
        confirmedAt: "2026-05-09T12:01:00.000Z",
      }),
      requestMoreInfo: async (input) => ({
        ...task,
        status: "needs_more_info",
        confirmedBy: input.actorUserId,
        confirmedAt: "2026-05-09T12:01:00.000Z",
      }),
    },
    debugTraceStore: {
      getByTrace: async () => debugTrace,
      getBySource: async () => debugTrace,
      getByAuditId: async () => debugTrace,
    },
    notificationIntentStore: {
      create: async (input) => ({
        ...input,
        id: "notification-1",
        status: input.status ?? "pending",
        createdAt: "2026-05-09T12:00:00.000Z",
      }),
      listByElder: async () => [],
    },
    healthCheck: async () => ({ postgres: "ok" }),
    auditRecords,
  };
}
