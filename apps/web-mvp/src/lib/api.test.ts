import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmReminder,
  getIngestStatus,
  getDebugTrace,
  listMvpData,
  sendElderTurn,
  sendFeedback,
} from "./api.js";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("web MVP api adapter", () => {
  it("posts elder turns through the API proxy", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ traceId: "trace-1", turnType: "record", message: "已保存", draft: { sourceId: "source-1", transcript: "我买了青菜。", status: "queued", createdAt: "2026-05-09T12:00:00.000Z" } }));

    await expect(sendElderTurn({ elderId: "elder-1", text: "我买了青菜。", clientTurnId: "turn-1" })).resolves.toMatchObject({
      turnType: "record",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/elder/turn", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ elderId: "elder-1", text: "我买了青菜。", clientTurnId: "turn-1", timezone: "Asia/Shanghai" }),
    }));
  });

  it("loads ingest status for draft cards", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sourceId: "source-1", status: "ready", eventIds: ["event-1"], reminderIds: [] }));

    await expect(getIngestStatus("source-1")).resolves.toMatchObject({ status: "ready" });

    expect(fetchMock).toHaveBeenCalledWith("/api/elder/sources/source-1/ingest-status", expect.any(Object));
  });

  it("loads debug traces through the debug API", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ traceId: "trace-1", auditTrail: [] }));

    await expect(getDebugTrace("trace-1")).resolves.toMatchObject({ traceId: "trace-1" });

    expect(fetchMock).toHaveBeenCalledWith("/api/debug/traces/trace-1", expect.any(Object));
  });

  it("sends recall turns and lists MVP data with encoded elder ids", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ traceId: "trace-1", turnType: "recall", message: "您买了青菜。", answer: { answerText: "您买了青菜。", confidence: 0.9, matchedSources: [], retrievedEvidence: [], suggestedActions: [] } }))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(sendElderTurn({ elderId: "elder 1", text: "我买了什么？" })).resolves.toMatchObject({
      answer: expect.objectContaining({ answerText: "您买了青菜。" }),
    });
    await expect(listMvpData("elder 1")).resolves.toEqual({ reminders: [] });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/elder/turn", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/elder/reminders?elderId=elder%201", expect.any(Object));
  });

  it("confirms reminders through the elder route", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "reminder-1", status: "confirmed" }));

    await confirmReminder({
      reminderId: "reminder-1",
      actorUserId: "elder-1",
      remindAt: "2026-05-11T09:00:00.000Z",
      timezone: "Asia/Shanghai",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/elder/reminders/reminder-1/confirm", expect.objectContaining({
      body: JSON.stringify({ actorUserId: "elder-1", remindAt: "2026-05-11T09:00:00.000Z", timezone: "Asia/Shanghai" }),
    }));
  });

  it("sends elder feedback through the feedback route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "feedback-1", feedbackType: "answer_wrong" }));

    await expect(sendFeedback({
      elderId: "elder-1",
      actorUserId: "elder-1",
      sourceId: "source-1",
      feedbackType: "answer_wrong",
      correction: { correctionText: "不是青菜" },
    })).resolves.toMatchObject({ feedbackType: "answer_wrong" });

    expect(fetchMock).toHaveBeenCalledWith("/api/elder/feedback", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        tenantId: "tenant-mvp",
        elderId: "elder-1",
        actorUserId: "elder-1",
        sourceId: "source-1",
        feedbackType: "answer_wrong",
        correction: { correctionText: "不是青菜" },
      }),
    }));
  });

  it("maps backend failures to Chinese user-facing messages", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Cannot confirm reminder without remindAt" }, 400));

    await expect(confirmReminder({ reminderId: "reminder-1", actorUserId: "elder-1" })).rejects.toThrow("请先补充提醒时间。");
  });

  it("hides raw route failures from elder-facing copy", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 500 }));

    await expect(listMvpData("elder-1")).rejects.toThrow("暂时连不上记忆服务，请稍后再试。");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
