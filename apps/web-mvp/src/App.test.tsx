import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import * as api from "./lib/api.js";

vi.mock("./lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api.js")>();
  return {
    ...actual,
    sendElderTurn: vi.fn(),
    listMvpData: vi.fn(),
    confirmReminder: vi.fn(),
    sendFeedback: vi.fn(),
    getDebugTrace: vi.fn(),
    getIngestStatus: vi.fn(),
  };
});

const listMvpDataMock = vi.mocked(api.listMvpData);
const sendElderTurnMock = vi.mocked(api.sendElderTurn);
const sendFeedbackMock = vi.mocked(api.sendFeedback);
const confirmReminderMock = vi.mocked(api.confirmReminder);
const getIngestStatusMock = vi.mocked(api.getIngestStatus);

beforeEach(() => {
  vi.clearAllMocks();
  listMvpDataMock.mockResolvedValue({ reminders: [] });
  sendFeedbackMock.mockResolvedValue({
    id: "feedback-1",
    tenantId: "tenant-mvp",
    elderId: "elder-mvp",
    actorUserId: "elder-mvp",
    feedbackType: "answer_wrong",
    correction: {},
    createdAt: "2026-05-11T08:00:00.000Z",
  });
  sendElderTurnMock.mockResolvedValue(recordTurn());
  getIngestStatusMock.mockResolvedValue({ sourceId: "source-1", status: "ready", eventIds: [], reminderIds: ["reminder-1"] });
  confirmReminderMock.mockResolvedValue(confirmedReminderRecord());
});

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("renders a single AI native elder conversation surface", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "生活记忆助手" })).toBeInTheDocument();
    expect(screen.getByLabelText("想说的话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送给记忆助手" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "语音输入" })).toBeInTheDocument();
    expect(screen.queryByText("全部")).not.toBeInTheDocument();
    expect(screen.getByText("说一句话后，我会把需要处理的事放到这里。")).toBeInTheDocument();
    expect(screen.queryByText("说一句话，我帮你记住；想不起来时，我根据你说过的话帮你找。")).not.toBeInTheDocument();
    expect(screen.queryByText("直接说一句话就行")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记一下" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "问一问" })).not.toBeInTheDocument();
    await waitFor(() => expect(listMvpDataMock).toHaveBeenCalledWith("elder-mvp"));
  });

  it("submits one elder turn and refreshes the task list", async () => {
    const user = userEvent.setup();
    listMvpDataMock
      .mockResolvedValueOnce({ reminders: [] })
      .mockResolvedValueOnce({ reminders: [reminderRecord()] });
    render(<App />);

    await user.type(screen.getByLabelText("想说的话"), "明天上午提醒我给女儿打电话。");
    await user.click(screen.getByRole("button", { name: "发送给记忆助手" }));

    await waitFor(() => expect(sendElderTurnMock).toHaveBeenCalledWith({
      elderId: "elder-mvp",
      text: expect.stringContaining("女儿"),
    }));
    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "给女儿打电话 确认提醒" })).toBeInTheDocument();
  });

  it("turns a pending reminder into confirmed state after confirmation", async () => {
    const user = userEvent.setup();
    listMvpDataMock
      .mockResolvedValueOnce({ reminders: [reminderRecord()] })
      .mockResolvedValueOnce({ reminders: [confirmedReminderRecord()] });
    render(<App />);

    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "早上 7 点" }));
    await user.click(screen.getByRole("button", { name: "给女儿打电话 确认提醒" }));

    await waitFor(() => expect(confirmReminderMock).toHaveBeenCalledWith(expect.objectContaining({
      reminderId: "reminder-1",
      timezone: "Asia/Shanghai",
    })));
    expect(await screen.findByLabelText("给女儿打电话 确认")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认提醒/ })).not.toBeInTheDocument();
  });

  it("renders only reminder sections without top filter cards", async () => {
    const user = userEvent.setup();
    listMvpDataMock.mockResolvedValue({ reminders: [reminderRecord()] });
    render(<App />);

    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "给女儿打电话 确认提醒" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /待我确认/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /家人确认/ })).not.toBeInTheDocument();
    expect(screen.queryByText("等待家人确认")).not.toBeInTheDocument();
    expect(screen.queryByText("最近记住")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "给女儿打电话 标记紧急" }));
    expect(screen.getByRole("button", { name: "给女儿打电话 取消紧急" })).toBeInTheDocument();
    expect(screen.getAllByText("紧急").length).toBeGreaterThan(0);
  });

  it("moves an urgent reminder to the top of the list", async () => {
    const user = userEvent.setup();
    listMvpDataMock.mockResolvedValue({
      reminders: [
        { ...reminderRecord(), id: "reminder-1", title: "先买菜" },
        { ...reminderRecord(), id: "reminder-2", title: "后拿药" },
      ],
    });
    render(<App />);

    expect((await screen.findByText("先买菜")).compareDocumentPosition(await screen.findByText("后拿药")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "后拿药 标记紧急" }));

    expect(screen.getByText("后拿药").compareDocumentPosition(screen.getByText("先买菜")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders all pending reminders without truncating at twelve", async () => {
    const reminders = Array.from({ length: 13 }, (_, index) => ({
      ...reminderRecord(),
      id: `reminder-${index + 1}`,
      title: `待确认提醒 ${index + 1}`,
    }));
    listMvpDataMock.mockResolvedValue({ reminders });
    render(<App />);

    expect(await screen.findByText("待确认提醒 13")).toBeInTheDocument();
    expect(await screen.findAllByRole("button", { name: /确认提醒$/ })).toHaveLength(13);
  });

  it("does not put already confirmed reminders back into elder confirmation", async () => {
    listMvpDataMock.mockResolvedValue({
      reminders: [{
        ...confirmedReminderRecord(),
        confirmationRequired: true,
      }],
    });
    render(<App />);

    expect(await screen.findByLabelText("给女儿打电话 确认")).toBeInTheDocument();
    expect(screen.queryByText("待我确认")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认提醒/ })).not.toBeInTheDocument();
  });

  it("keeps text input available when speech recognition is unsupported", async () => {
    const user = userEvent.setup();
    const speechWindow = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const originalSpeechRecognition = speechWindow.SpeechRecognition;
    const originalWebkitSpeechRecognition = speechWindow.webkitSpeechRecognition;
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });

    try {
      render(<App />);
      await user.click(screen.getByRole("button", { name: "语音输入" }));

      expect(await screen.findByText("当前浏览器不支持语音输入，请使用文字输入。")).toBeInTheDocument();
      expect(screen.getByLabelText("想说的话")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: originalSpeechRecognition });
      Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: originalWebkitSpeechRecognition });
    }
  });

  it("renders recall answers with evidence from the unified turn result", async () => {
    const user = userEvent.setup();
    sendElderTurnMock.mockResolvedValueOnce(recallTurn());
    render(<App />);

    await user.clear(screen.getByLabelText("想说的话"));
    await user.type(screen.getByLabelText("想说的话"), "我买了什么？");
    await user.click(screen.getByRole("button", { name: "发送给记忆助手" }));

    expect((await screen.findAllByText("您今天买了青菜。")).length).toBeGreaterThan(0);
    expect(await screen.findByText("最近回答")).toBeInTheDocument();
    expect(await screen.findByText(/你之前记录过/)).toBeInTheDocument();
  });

  it("sends answer feedback through the elder feedback route", async () => {
    const user = userEvent.setup();
    sendElderTurnMock.mockResolvedValueOnce(recallTurn());
    render(<App />);

    await user.clear(screen.getByLabelText("想说的话"));
    await user.type(screen.getByLabelText("想说的话"), "我买了什么？");
    await user.click(screen.getByRole("button", { name: "发送给记忆助手" }));
    await user.click(await screen.findByRole("button", { name: "这不对，改一下" }));
    await user.type(screen.getByPlaceholderText("例如：不是青菜，是菠菜。"), "不是青菜，是菠菜。");
    await user.click(screen.getByRole("button", { name: "提交修改" }));

    await waitFor(() => expect(sendFeedbackMock).toHaveBeenCalledWith(expect.objectContaining({
      elderId: "elder-mvp",
      actorUserId: "elder-mvp",
      sourceId: "source-1",
      feedbackType: "answer_wrong",
    })));
  });
});

function recordTurn() {
  return {
    traceId: "trace-record",
    turnType: "record" as const,
    message: "我先记下这句话，正在整理提醒。",
    draft: {
      sourceId: "source-1",
      transcript: "老人说今天买了青菜。",
      status: "queued" as const,
      createdAt: "2026-05-11T08:00:00.000Z",
    },
  };
}

function reminderRecord() {
  return {
    id: "reminder-1",
    tenantId: "tenant-mvp",
    elderId: "elder-mvp",
    sourceId: "source-1",
    eventId: "event-1",
    title: "给女儿打电话",
    timeText: "明天上午",
    timeConfidence: 0.6,
    status: "pending_family_confirm" as const,
    confirmationRequired: true,
    confidence: 0.8,
    reason: "需要确认提醒时间。",
    createdAt: "2026-05-11T08:00:00.000Z",
  };
}

function confirmedReminderRecord() {
  return {
    ...reminderRecord(),
    remindAt: "2026-05-12T07:00:00.000Z",
    status: "confirmed" as const,
    confirmationRequired: false,
    confirmedBy: "elder-mvp",
    confirmedAt: "2026-05-11T08:01:00.000Z",
  };
}

function recallTurn() {
  return {
    traceId: "trace-recall",
    turnType: "recall" as const,
    message: "您今天买了青菜。",
    answer: {
      answerText: "您今天买了青菜。",
      confidence: 0.9,
      matchedSources: [{
        sourceId: "source-1",
        createdAt: "2026-05-11T08:00:00.000Z",
        summary: "老人说今天买了青菜。",
        canPlayAudio: false,
        retrievalSource: "postgres" as const,
      }],
      retrievedEvidence: [{
        sourceId: "source-1",
        eventId: "event-1",
        createdAt: "2026-05-11T08:00:00.000Z",
        summary: "老人说今天买了青菜。",
        score: 0.9,
        canPlayAudio: false,
        retrievalSource: "postgres" as const,
      }],
      suggestedActions: [],
    },
  };
}
