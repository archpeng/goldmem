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
	    getTodaySnapshot: vi.fn(),
	    getElderProfile: vi.fn(),
	    upsertElderProfile: vi.fn(),
	  };
	});

const listMvpDataMock = vi.mocked(api.listMvpData);
const sendElderTurnMock = vi.mocked(api.sendElderTurn);
const sendFeedbackMock = vi.mocked(api.sendFeedback);
const confirmReminderMock = vi.mocked(api.confirmReminder);
const getIngestStatusMock = vi.mocked(api.getIngestStatus);
const getTodaySnapshotMock = vi.mocked(api.getTodaySnapshot);
const getElderProfileMock = vi.mocked(api.getElderProfile);
const upsertElderProfileMock = vi.mocked(api.upsertElderProfile);

beforeEach(() => {
  vi.clearAllMocks();
	  listMvpDataMock.mockResolvedValue({ reminders: [] });
	  getTodaySnapshotMock.mockResolvedValue({ date: "2026-05-14", todayReminders: [], yesterdayConfirmed: [], weekTopics: [] });
	  getElderProfileMock.mockResolvedValue({
	    elderId: "elder-mvp",
	    tenantId: "tenant-mvp",
	    displayName: "王奶奶",
	    timezone: "Asia/Shanghai",
	    medications: [],
	    places: [],
	  });
	  upsertElderProfileMock.mockResolvedValue({
	    elderId: "elder-mvp",
	    tenantId: "tenant-mvp",
	    displayName: "王奶奶",
	    timezone: "Asia/Shanghai",
	    medications: [],
	    places: [],
	  });
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
  window.localStorage.clear();
  delete document.documentElement.dataset.elderMode;
});

describe("App", () => {
  it("renders a single AI native elder conversation surface", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "生活记忆助手" })).toBeInTheDocument();
    expect(screen.getByLabelText("想说的话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送给记忆助手" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "语音输入" })).toBeInTheDocument();
    expect(screen.queryByText("全部")).not.toBeInTheDocument();
	    expect(screen.getByText("试试这样跟我说：")).toBeInTheDocument();
	    expect(screen.getByRole("button", { name: "示例 明天下午 3 点要去复查" })).toBeInTheDocument();
	    expect(screen.queryByText("说一句话，我帮你记住；想不起来时，我根据你说过的话帮你找。")).not.toBeInTheDocument();
    expect(screen.queryByText("直接说一句话就行")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记一下" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "问一问" })).not.toBeInTheDocument();
    await waitFor(() => expect(listMvpDataMock).toHaveBeenCalledWith("elder-mvp"));
	  });

	  it("fills input from empty state examples", async () => {
	    const user = userEvent.setup();
	    render(<App />);

	    await user.click(await screen.findByRole("button", { name: "示例 医保卡放在抽屉左边" }));

	    expect(screen.getByLabelText("想说的话")).toHaveValue("医保卡放在抽屉左边");
	  });

	  it("retries failed drafts with a new client turn id in place", async () => {
	    const user = userEvent.setup();
	    sendElderTurnMock
	      .mockRejectedValueOnce(new Error("model failed"))
	      .mockResolvedValueOnce(recordTurn());
	    render(<App />);

	    await user.type(screen.getByLabelText("想说的话"), "明天上午提醒我给女儿打电话。");
	    await user.click(screen.getByRole("button", { name: "发送给记忆助手" }));
	    await user.click(await screen.findByRole("button", { name: /再试一次/ }));

	    await waitFor(() => expect(sendElderTurnMock).toHaveBeenCalledTimes(2));
	    const first = sendElderTurnMock.mock.calls[0]?.[0].clientTurnId;
	    const second = sendElderTurnMock.mock.calls[1]?.[0].clientTurnId;
	    expect(first).toEqual(expect.any(String));
	    expect(second).toEqual(expect.any(String));
	    expect(second).not.toBe(first);
	  });

  it("submits one elder turn and refreshes the task list", async () => {
    const user = userEvent.setup();
    listMvpDataMock
      .mockResolvedValueOnce({ reminders: [] })
      .mockResolvedValueOnce({ reminders: [reminderRecord()] });
    render(<App />);

    await user.type(screen.getByLabelText("想说的话"), "明天上午提醒我给女儿打电话。");
    await user.click(screen.getByRole("button", { name: "发送给记忆助手" }));

    await waitFor(() => expect(sendElderTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      clientTurnId: expect.any(String),
      elderId: "elder-mvp",
      text: expect.stringContaining("女儿"),
    })));
    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "给女儿打电话 确认提醒" })).toBeInTheDocument();
  });

  it("submits a speech transcript once when recognition ends more than once", async () => {
    const user = userEvent.setup();
    const speechWindow = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const originalSpeechRecognition = speechWindow.SpeechRecognition;
    const originalWebkitSpeechRecognition = speechWindow.webkitSpeechRecognition;
    const instances: FakeSpeechRecognition[] = [];
    class FakeSpeechRecognition {
      lang = "";
      interimResults = false;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();

      constructor() {
        instances.push(this);
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeSpeechRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });

    try {
      render(<App />);
      await user.click(screen.getByRole("button", { name: "语音输入" }));
      const recognition = instances[0];
      expect(recognition).toBeDefined();

      recognition!.onresult?.({ results: [{ 0: { transcript: "今天五点下班" } }] });
      recognition!.onend?.();
      recognition!.onend?.();

      await waitFor(() => expect(sendElderTurnMock).toHaveBeenCalledTimes(1));
      expect(sendElderTurnMock).toHaveBeenCalledWith(expect.objectContaining({
        clientTurnId: expect.any(String),
        elderId: "elder-mvp",
        text: "今天五点下班",
      }));
    } finally {
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: originalSpeechRecognition });
      Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: originalWebkitSpeechRecognition });
    }
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
	    expect(await screen.findByText("不是青菜，是菠菜。")).toBeInTheDocument();
	    expect(screen.getByText("已更新")).toBeInTheDocument();
	    expect(screen.getByText(/你之前记录过/)).toBeInTheDocument();
	  });

	  it("toggles elder text scale", async () => {
	    const user = userEvent.setup();
	    render(<App />);

	    await user.click(screen.getByRole("button", { name: "字号 大" }));

	    expect(document.documentElement.dataset.elderMode).toBe("xl");
	    expect(window.localStorage.getItem("elderTextScale")).toBe("xl");
	  });

	  it("dismisses today snapshot for the current date", async () => {
	    const user = userEvent.setup();
	    getTodaySnapshotMock.mockResolvedValueOnce({
	      date: "2026-05-14",
	      todayReminders: [confirmedReminderRecord()],
	      yesterdayConfirmed: [],
	      weekTopics: [{ type: "appointment", count: 2, sampleTitles: ["复查"] }],
	    });
	    render(<App />);

	    await user.click(await screen.findByRole("button", { name: "今天就先这样" }));

	    expect(window.localStorage.getItem("lastSnapshotDismissed")).toBe("2026-05-14");
	    expect(screen.queryByText("今天先帮你看一眼")).not.toBeInTheDocument();
	  });

	  it("saves elder profile from settings", async () => {
	    const user = userEvent.setup();
	    render(<App />);

	    await user.click(screen.getByRole("button", { name: "设置" }));
	    await user.clear(await screen.findByLabelText("称呼"));
	    await user.type(screen.getByLabelText("称呼"), "李奶奶");
	    await user.type(screen.getByLabelText("正在吃的药（每行一种，名称在前）"), "降压药 早餐后一片");
	    await user.click(screen.getByRole("button", { name: "保存" }));

	    await waitFor(() => expect(upsertElderProfileMock).toHaveBeenCalledWith(expect.objectContaining({
	      elderId: "elder-mvp",
	      displayName: "李奶奶",
	      medications: [{ name: "降压药", dosage: "早餐后一片" }],
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
      transcript: "今天买了青菜。",
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
        summary: "你今天买了青菜。",
        canPlayAudio: false,
        retrievalSource: "postgres" as const,
      }],
      retrievedEvidence: [{
        sourceId: "source-1",
        eventId: "event-1",
        createdAt: "2026-05-11T08:00:00.000Z",
        summary: "你今天买了青菜。",
        score: 0.9,
        canPlayAudio: false,
        retrievalSource: "postgres" as const,
      }],
      suggestedActions: [],
    },
  };
}
