import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import * as api from "./lib/api.js";

vi.mock("./lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api.js")>();
  return {
    ...actual,
    createTextNote: vi.fn(),
    queryMemory: vi.fn(),
    listMvpData: vi.fn(),
    confirmReminder: vi.fn(),
    confirmFamilyTask: vi.fn(),
    rejectFamilyTask: vi.fn(),
    requestFamilyTaskInfo: vi.fn(),
    getDebugTrace: vi.fn(),
  };
});

const listMvpDataMock = vi.mocked(api.listMvpData);
const createTextNoteMock = vi.mocked(api.createTextNote);
const queryMemoryMock = vi.mocked(api.queryMemory);

beforeEach(() => {
  vi.clearAllMocks();
  listMvpDataMock.mockResolvedValue({ events: [], reminders: [], familyTasks: [] });
  createTextNoteMock.mockResolvedValue({
    traceId: "trace-web-test",
    sourceId: "source-1",
    summary: "老人说今天买了青菜。",
    events: [],
    reminderCandidates: [],
    elderFacingCards: [],
  });
  queryMemoryMock.mockResolvedValue({
    answerText: "您今天买了青菜。",
    confidence: 0.9,
    matchedSources: [],
    retrievedEvidence: [],
    suggestedActions: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("renders the Chinese MVP surface and refreshes lists for the default elder", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "GoldMem 记忆 MVP" })).toBeInTheDocument();
    expect(screen.getByText("Kernel MVP")).toBeInTheDocument();
    await waitFor(() => expect(listMvpDataMock).toHaveBeenCalledWith("elder-mvp"));
  });

  it("ingests a text note and displays the returned summary", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "保存记忆" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "保存记忆" }));

    await waitFor(() => expect(createTextNoteMock).toHaveBeenCalledWith({
      elderId: "elder-mvp",
      transcript: expect.any(String),
    }));
    expect(await screen.findByText("老人说今天买了青菜。")).toBeInTheDocument();
  });

  it("queries memory and displays the evidence-bound answer", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "询问" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "询问" }));

    await waitFor(() => expect(queryMemoryMock).toHaveBeenCalledWith({
      elderId: "elder-mvp",
      query: expect.any(String),
    }));
    expect(await screen.findByText("您今天买了青菜。")).toBeInTheDocument();
  });
});
