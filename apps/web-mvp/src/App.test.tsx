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
});

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("renders a single AI native elder conversation surface", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "我帮你记" })).toBeInTheDocument();
    expect(screen.getByText("直接说一句话就行")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记一下" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "问一问" })).not.toBeInTheDocument();
    await waitFor(() => expect(listMvpDataMock).toHaveBeenCalledWith("elder-mvp"));
  });

  it("submits one elder turn and renders the record result", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "发送给记忆助手" }));

    await waitFor(() => expect(sendElderTurnMock).toHaveBeenCalledWith({
      elderId: "elder-mvp",
      text: expect.stringContaining("青菜"),
    }));
    expect(await screen.findByText("我理解的是")).toBeInTheDocument();
    expect(await screen.findByText("老人说今天买了青菜。")).toBeInTheDocument();
  });

  it("renders recall answers with evidence from the unified turn result", async () => {
    const user = userEvent.setup();
    sendElderTurnMock.mockResolvedValueOnce(recallTurn());
    render(<App />);

    await user.clear(screen.getByLabelText("想说的话"));
    await user.type(screen.getByLabelText("想说的话"), "我买了什么？");
    await user.click(screen.getByRole("button", { name: "发送给记忆助手" }));

    expect((await screen.findAllByText("您今天买了青菜。")).length).toBeGreaterThan(0);
    expect(await screen.findByText("依据")).toBeInTheDocument();
    expect(await screen.findByText("你之前记录过")).toBeInTheDocument();
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
