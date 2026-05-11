import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmFamilyTask,
  confirmReminder,
  createTextNote,
  listMvpData,
  queryMemory,
} from "./api.js";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("web MVP api adapter", () => {
  it("posts text notes through the API proxy", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sourceId: "source-1", summary: "已保存", events: [], reminderCandidates: [], elderFacingCards: [] }));

    await expect(createTextNote({ elderId: "elder-1", transcript: "我买了青菜。" })).resolves.toMatchObject({
      sourceId: "source-1",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/elder/text-notes", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ elderId: "elder-1", transcript: "我买了青菜。" }),
    }));
  });

  it("queries memory and lists MVP data with encoded elder ids", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ answerText: "您买了青菜。", confidence: 0.9, matchedSources: [], retrievedEvidence: [], suggestedActions: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(queryMemory({ elderId: "elder 1", query: "我买了什么？" })).resolves.toMatchObject({
      answerText: "您买了青菜。",
    });
    await expect(listMvpData("elder 1")).resolves.toEqual({ events: [], reminders: [], familyTasks: [] });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/elder/query", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/elder/events?elderId=elder%201", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/elder/reminders?elderId=elder%201", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/family/elders/elder%201/pending-tasks", expect.any(Object));
  });

  it("confirms reminders and family tasks through thin route calls", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "reminder-1", status: "confirmed" }))
      .mockResolvedValueOnce(jsonResponse({ id: "task-1", status: "confirmed" }));

    await confirmReminder({ reminderId: "reminder-1", actorUserId: "elder-1", remindAt: "2026-05-11T09:00:00.000Z" });
    await confirmFamilyTask({ taskId: "task-1", actorUserId: "family-1" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/elder/reminders/reminder-1/confirm", expect.objectContaining({
      body: JSON.stringify({ actorUserId: "elder-1", remindAt: "2026-05-11T09:00:00.000Z" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/family/tasks/task-1/confirm", expect.objectContaining({
      body: JSON.stringify({ actorUserId: "family-1" }),
    }));
  });

  it("maps backend failures to Chinese user-facing messages", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Cannot confirm reminder without remindAt" }, 400));

    await expect(confirmReminder({ reminderId: "reminder-1", actorUserId: "elder-1" })).rejects.toThrow("请先补充提醒时间。");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
