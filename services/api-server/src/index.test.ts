import { describe, expect, it } from "vitest";
import { buildServer, type ApiServerDeps } from "./index.js";
import type { FamilyTask, MemoryAnswer, MemoryEvent, Reminder } from "@goldmem/memory-schema";

describe("api-server", () => {
  it("handles elder text ingest, query, reminder list, and family task endpoints", async () => {
    const deps = createDeps();
    const server = buildServer(deps);

    const health = await server.inject({
      method: "GET",
      url: "/health",
    });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(true);

    const ingest = await server.inject({
      method: "POST",
      url: "/elder/text-notes",
      payload: {
        elderId: "elder-1",
        transcript: "I bought vegetables.",
      },
    });
    expect(ingest.statusCode).toBe(200);
    expect(ingest.json().sourceId).toBe("source-1");

    const query = await server.inject({
      method: "POST",
      url: "/elder/query",
      payload: {
        elderId: "elder-1",
        query: "What did I buy?",
      },
    });
    expect(query.statusCode).toBe(200);
    expect(query.json().answerText).toContain("vegetables");

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
      url: "/family/elders/elder-1/pending-tasks",
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

    const reminderConfirmed = await server.inject({
      method: "POST",
      url: "/elder/reminders/reminder-1/confirm",
      payload: { actorUserId: "elder-1", remindAt: "2026-05-10T09:00:00.000Z" },
    });
    expect(reminderConfirmed.statusCode).toBe(200);
    expect(deps.auditRecords.some((record) => record.type === "reminder_confirmed")).toBe(true);
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

  return {
    kernel: {
      ingestText: async () => ({
        sourceId: "source-1",
        summary: "Summary",
        events: [],
        reminderCandidates: [],
        elderFacingCards: [],
      }),
      ingestVoice: async () => ({
        sourceId: "source-1",
        summary: "Summary",
        events: [],
        reminderCandidates: [],
        elderFacingCards: [],
      }),
      queryMemory: async (): Promise<MemoryAnswer> => ({
        answerText: "You bought vegetables.",
        confidence: 0.9,
        matchedSources: [],
        retrievedEvidence: [],
        suggestedActions: [],
      }),
    } as ApiServerDeps["kernel"],
    sourceStore: {
      saveAudio: async () => "file://audio.wav",
      create: async (input) => ({ ...input, id: "source-2" }),
      get: async () => null,
    },
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
    reminderEngine: {
      createCandidate: async (input) => ({ ...input, id: "reminder-2", status: "pending_family_confirm", createdAt: reminder.createdAt }),
      confirmReminder: async (input) => ({
        ...reminder,
        status: "confirmed",
        confirmedBy: input.actorUserId,
        remindAt: input.remindAt ?? reminder.remindAt,
      }),
    } as ApiServerDeps["reminderEngine"],
    familyTaskStore: {
      create: async (input) => ({ ...task, ...input }),
      listPending: async () => [task],
      confirm: async (_taskId, actorUserId) => ({
        ...task,
        status: "confirmed",
        confirmedBy: actorUserId,
        confirmedAt: "2026-05-09T12:01:00.000Z",
      }),
    },
    auditLog: {
      record: async (input) => {
        auditRecords.push(input);
      },
    },
    healthCheck: async () => ({ postgres: "ok" }),
    auditRecords,
  };
}
