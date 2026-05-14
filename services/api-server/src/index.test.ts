import { describe, expect, it } from "vitest";
import { buildServer, buildTemporalMemoryFromEnv, type ApiServerDeps } from "./index.js";
import type { DebugTrace, ElderTurnResult, FamilyAssistTask, FamilyTask, Feedback, IngestStatus, MemoryAnswer, MemoryEvent, Reminder } from "@mem/memory-schema";

describe("api-server", () => {
  it("handles elder turn, reminder list, and family assist endpoints", async () => {
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

    const profile = await server.inject({
      method: "GET",
      url: "/elder/profile?elderId=elder-1",
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().displayName).toBe("elder-1");

    const savedProfile = await server.inject({
      method: "PUT",
      url: "/elder/profile",
      payload: {
        elderId: "elder-1",
        displayName: "王奶奶",
        medications: [{ name: "降压药" }],
      },
    });
    expect(savedProfile.statusCode).toBe(200);
    expect(savedProfile.json().medications).toEqual([{ name: "降压药" }]);

    const snapshot = await server.inject({
      method: "GET",
      url: "/elder/today-snapshot?elderId=elder-1&timezone=Asia%2FShanghai",
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().date).toBe("2026-05-14");

    const tasks = await server.inject({
      method: "GET",
      url: "/family/elders/elder-1/pending-tasks?actorUserId=family-1",
    });
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json()).toHaveLength(1);
    expect(tasks.json()[0]).not.toHaveProperty("relatedEventId");
    expect(deps.auditRecords.some((record) => record.type === "family_assist_tasks_viewed")).toBe(true);

    const missingActor = await server.inject({
      method: "GET",
      url: "/family/elders/elder-1/pending-tasks",
    });
    expect(missingActor.statusCode).toBe(400);

    const removedTasksRoute = await server.inject({
      method: "GET",
      url: "/family/elders/elder-1/tasks",
    });
    expect(removedTasksRoute.statusCode).toBe(404);

    const removedNotificationRoute = await server.inject({
      method: "GET",
      url: "/family/elders/elder-1/notification-intents",
    });
    expect(removedNotificationRoute.statusCode).toBe(404);

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
    expect(trace.statusCode).toBe(404);
  });

  it("requires explicit debug registration and token before serving traces", async () => {
    const server = buildServer(createDeps({ debugApiToken: "debug-secret-1234" }));

    const missingToken = await server.inject({
      method: "GET",
      url: "/debug/traces/trace-1",
    });
    expect(missingToken.statusCode).toBe(403);

    const wrongToken = await server.inject({
      method: "GET",
      url: "/debug/traces/trace-1",
      headers: { "x-mem-debug-token": "wrong-secret-1234" },
    });
    expect(wrongToken.statusCode).toBe(403);
  });

  it("returns a redacted debug trace DTO without raw memory content", async () => {
    const server = buildServer(createDeps({
      debugApiToken: "debug-secret-1234",
      debugTrace: sensitiveDebugTrace(),
    }));

    const response = await server.inject({
      method: "GET",
      url: "/debug/traces/trace-sensitive",
      headers: { "x-mem-debug-token": "debug-secret-1234" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      traceId: "trace-sensitive",
      source: {
        id: "source-sensitive",
        contentRedacted: true,
        audioRedacted: true,
      },
      planSummary: {
        present: true,
        eventCount: 1,
        reminderCandidateCount: 1,
        riskFlagCount: 1,
      },
      auditTrail: [{
        id: "audit-sensitive",
        payloadSummary: { kind: "object" },
      }],
      queryDiagnostics: {
        retrieval: {
          graphitiAlignedCount: 1,
        },
      },
    });
    expect(body.source).not.toHaveProperty("transcript");
    expect(body.source).not.toHaveProperty("audioUrl");
    expect(body).not.toHaveProperty("memoryPlan");
    expect(body.auditTrail[0]).not.toHaveProperty("payload");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("raw transcript");
    expect(serialized).not.toContain("audio.example.com");
    expect(serialized).not.toContain("raw evidence quote");
    expect(serialized).not.toContain("raw memory plan");
    expect(serialized).not.toContain("arbitrary audit payload");
    expect(serialized).not.toContain("\"quote\"");
    expect(serialized).not.toContain("\"transcript\"");
    expect(serialized).not.toContain("\"audioUrl\"");
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

function createDeps(options: { debugApiToken?: string; debugTrace?: DebugTrace } = {}): ApiServerDeps & { auditRecords: Array<{ type: string }> } {
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
  const debugTrace: DebugTrace = options.debugTrace ?? {
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
      getTodaySnapshot: async () => ({
        date: "2026-05-14",
        todayReminders: [reminder],
        yesterdayConfirmed: [],
        weekTopics: [{ type: "shopping", count: 1, sampleTitles: ["Bought vegetables"] }],
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
      listFamilyAssistTasks: async (input): Promise<FamilyAssistTask[]> => {
        auditRecords.push({ type: "family_assist_tasks_viewed" });
        return [{
          id: task.id,
          title: task.title,
          summary: task.summary,
          type: task.type,
          urgency: task.urgency,
          status: task.status,
          visibility: task.visibility,
          createdAt: task.createdAt,
        }];
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
      getByIds: async () => [event],
      aggregateByTypeWithin: async () => [{ type: "shopping", count: 1, sampleTitles: ["Bought vegetables"] }],
    },
    reminderStore: {
      create: async (input) => ({ ...input, id: "reminder-2", createdAt: reminder.createdAt }),
      get: async () => reminder,
      listByElder: async () => [reminder],
      findByRemindAtRange: async () => [reminder],
      findByConfirmedAtRange: async () => [],
      update: async (input) => ({ ...reminder, ...input.patch }),
    },
    elderProfileStore: {
      get: async () => null,
      upsert: async (input) => ({
        tenantId: input.tenantId,
        elderId: input.elderId,
        displayName: input.displayName ?? input.elderId,
        timezone: input.timezone ?? "Asia/Shanghai",
        medications: input.medications ?? [],
        places: input.places ?? [],
        wakeTime: input.wakeTime,
        sleepTime: input.sleepTime,
        notes: input.notes,
      }),
    },
    debugTraceStore: {
      getByTrace: async () => debugTrace,
      getBySource: async () => debugTrace,
      getByAuditId: async () => debugTrace,
    },
    debugApi: options.debugApiToken ? { token: options.debugApiToken } : undefined,
    healthCheck: async () => ({ postgres: "ok" }),
    auditRecords,
  };
}

function sensitiveDebugTrace(): DebugTrace {
  return {
    traceId: "trace-sensitive",
    source: {
      id: "source-sensitive",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      type: "voice",
      transcript: "raw transcript should never leave the debug API",
      audioUrl: "https://audio.example.com/raw.wav",
      createdAt: "2026-05-09T12:00:00.000Z",
      metadata: {
        language: "zh-CN",
        locationHint: "private home location",
        appVersion: "test",
        timezone: "Asia/Shanghai",
        clientTurnId: "turn-sensitive",
      },
    },
    memoryPlan: {
      raw: "raw memory plan secret",
      events: [{ evidence: [{ sourceId: "source-sensitive", quote: "raw evidence quote" }] }],
      reminderCandidates: [{}],
      riskFlags: [{}],
      familyTasks: [],
      contextLinks: [],
      relationEnrichmentSignals: [],
      uncertainties: ["private uncertainty"],
    },
    evidenceMerge: {
      evidence: [{ sourceId: "source-sensitive", transcriptQuote: "raw evidence quote" }],
    },
    finalAnswer: {
      answerText: "private answer text",
    },
    auditTrail: [{
      id: "audit-sensitive",
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      sourceId: "source-sensitive",
      traceId: "trace-sensitive",
      type: "memory_query",
      payload: {
        traceId: "trace-sensitive",
        transcript: "raw transcript should never leave the debug API",
        audioUrl: "https://audio.example.com/raw.wav",
        plan: { raw: "raw memory plan secret" },
        retrieval: { graphitiAlignedCount: 1, note: "not numeric" },
        timings: { totalMs: 12 },
        evidence: [{ quote: "raw evidence quote" }],
        arbitrary: "arbitrary audit payload secret",
      },
      createdAt: "2026-05-09T12:00:00.000Z",
    }],
  };
}
