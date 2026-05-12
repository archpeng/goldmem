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
  };
});

const listMvpDataMock = vi.mocked(api.listMvpData);
const sendElderTurnMock = vi.mocked(api.sendElderTurn);
const sendFeedbackMock = vi.mocked(api.sendFeedback);
const confirmReminderMock = vi.mocked(api.confirmReminder);

beforeEach(() => {
  vi.clearAllMocks();
  listMvpDataMock.mockResolvedValue({ events: [], reminders: [], familyTasks: [] });
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
  confirmReminderMock.mockResolvedValue(confirmedReminderRecord());
});

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("renders a single AI native elder conversation surface", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "生活记忆助手" })).toBeInTheDocument();
    expect(screen.getAllByText("今天").length).toBeGreaterThan(0);
    expect(screen.getByText("事项")).toBeInTheDocument();
    expect(screen.queryByText("全部")).not.toBeInTheDocument();
    expect(screen.getByText("还没有待处理事项")).toBeInTheDocument();
    expect(screen.queryByText("说一句话，我帮你记住；想不起来时，我根据你说过的话帮你找。")).not.toBeInTheDocument();
    expect(screen.queryByText("直接说一句话就行")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记一下" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "问一问" })).not.toBeInTheDocument();
    await waitFor(() => expect(listMvpDataMock).toHaveBeenCalledWith("elder-mvp"));
  });

  it("submits one elder turn and refreshes the task list", async () => {
    const user = userEvent.setup();
    listMvpDataMock
      .mockResolvedValueOnce({ events: [], reminders: [], familyTasks: [] })
      .mockResolvedValueOnce({ events: [eventRecord()], reminders: [reminderRecord()], familyTasks: [] });
    render(<App />);

    await user.type(screen.getByLabelText("想说的话"), "明天上午提醒我给女儿打电话。");
    await user.click(screen.getByRole("button", { name: "发送给记忆助手" }));

    await waitFor(() => expect(sendElderTurnMock).toHaveBeenCalledWith({
      elderId: "elder-mvp",
      text: expect.stringContaining("女儿"),
    }));
    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("待我确认")).length).toBeGreaterThan(0);
  });

  it("turns a pending reminder into confirmed state after confirmation", async () => {
    const user = userEvent.setup();
    listMvpDataMock
      .mockResolvedValueOnce({ events: [eventRecord()], reminders: [reminderRecord()], familyTasks: [] })
      .mockResolvedValueOnce({ events: [eventRecord()], reminders: [confirmedReminderRecord()], familyTasks: [] });
    render(<App />);

    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "早上 7 点" }));
    await user.click(screen.getByRole("button", { name: "确认提醒" }));

    await waitFor(() => expect(confirmReminderMock).toHaveBeenCalledWith(expect.objectContaining({
      reminderId: "reminder-1",
      timezone: "Asia/Shanghai",
    })));
    expect((await screen.findAllByText("确认")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "确认提醒" })).not.toBeInTheDocument();
  });

  it("filters task list from the top summary controls", async () => {
    const user = userEvent.setup();
    listMvpDataMock.mockResolvedValue({ events: [eventRecord()], reminders: [reminderRecord()], familyTasks: [] });
    render(<App />);

    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /最近记住/ }));

    expect(screen.queryByText("确认提醒")).not.toBeInTheDocument();
    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /最近记住/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("separates elder confirmation from family confirmation", async () => {
    const user = userEvent.setup();
    listMvpDataMock.mockResolvedValue({
      events: [eventRecord()],
      reminders: [reminderRecord()],
      familyTasks: [familyTaskRecord()],
    });
    render(<App />);

    expect((await screen.findAllByText("给女儿打电话")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /待我确认/ })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: /待我确认/ }));
    expect(screen.getByRole("button", { name: "确认提醒" })).toBeInTheDocument();
    expect(screen.queryByText("等待家人确认")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /家人确认/ }));
    expect(await screen.findByText("等待家人确认")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认提醒" })).not.toBeInTheDocument();
  });

  it("renders all pending reminders without truncating at twelve", async () => {
    const reminders = Array.from({ length: 13 }, (_, index) => ({
      ...reminderRecord(),
      id: `reminder-${index + 1}`,
      title: `待确认提醒 ${index + 1}`,
    }));
    listMvpDataMock.mockResolvedValue({ events: [], reminders, familyTasks: [] });
    render(<App />);

    expect(await screen.findByText("待确认提醒 13")).toBeInTheDocument();
    expect(await screen.findAllByRole("button", { name: "确认提醒" })).toHaveLength(13);
  });

  it("does not put already confirmed reminders back into elder confirmation", async () => {
    listMvpDataMock.mockResolvedValue({
      events: [],
      reminders: [{
        ...confirmedReminderRecord(),
        confirmationRequired: true,
      }],
      familyTasks: [],
    });
    render(<App />);

    expect((await screen.findAllByText("确认")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /待我确认/ })).toHaveTextContent("0");
    expect(screen.queryByRole("button", { name: "确认提醒" })).not.toBeInTheDocument();
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
    message: "我帮你记住了。",
    ingestResult: {
      traceId: "trace-record",
      sourceId: "source-1",
      summary: "老人说今天买了青菜。",
      events: [],
      reminderCandidates: [],
      elderFacingCards: [{
        title: "买青菜",
        summary: "老人说今天买了青菜。",
        needsConfirmation: false,
        riskLevel: "normal",
      }],
    },
  };
}

function eventRecord() {
  return {
    id: "event-1",
    tenantId: "tenant-mvp",
    elderId: "elder-mvp",
    sourceId: "source-1",
    type: "family" as const,
    title: "给女儿打电话",
    summary: "老人想明天上午给女儿打电话。",
    timeText: "明天上午",
    timeConfidence: 0.8,
    entities: [],
    importance: 0.7,
    confidence: 0.8,
    riskLevel: "normal" as const,
    requiresConfirmation: false,
    visibility: "private" as const,
    evidence: [{ sourceId: "source-1", quote: "明天上午提醒我给女儿打电话" }],
    status: "active" as const,
    createdAt: "2026-05-11T08:00:00.000Z",
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

function familyTaskRecord() {
  return {
    id: "family-task-1",
    tenantId: "tenant-mvp",
    elderId: "elder-mvp",
    type: "reminder_confirm" as const,
    title: "请家人确认复查安排",
    summary: "这个复查安排需要家人确认。",
    urgency: "medium" as const,
    visibility: "family_required" as const,
    relatedEventId: "event-1",
    status: "pending" as const,
    createdAt: "2026-05-11T08:00:00.000Z",
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
