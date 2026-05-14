import { describe, expect, it } from "vitest";
import type { Reminder } from "@mem/memory-schema";
import { buildPlan, createHarness, memoryEvent } from "../test/harness.js";

describe("today snapshot", () => {
  it("builds local-day windows from the requested timezone", async () => {
    const harness = createHarness(buildPlan({ summary: "noop" }));
    harness.reminderStore.reminders.push(
      reminder({
        id: "today-start",
        title: "今天复查",
        remindAt: "2026-05-13T16:00:00.000Z",
        status: "confirmed",
      }),
      reminder({
        id: "tomorrow-start",
        title: "明天边界",
        remindAt: "2026-05-14T16:00:00.000Z",
        status: "confirmed",
      }),
      reminder({
        id: "yesterday-confirmed",
        title: "昨天确认吃药",
        status: "confirmed",
        confirmedAt: "2026-05-13T15:59:59.000Z",
      }),
    );
    harness.eventStore.events.push(
      memoryEvent({ id: "event-1", type: "appointment", title: "社区医院复查", createdAt: "2026-05-13T10:00:00.000Z" }),
      memoryEvent({ id: "event-2", type: "appointment", title: "社区医院改期", createdAt: "2026-05-12T10:00:00.000Z" }),
      memoryEvent({ id: "event-3", type: "shopping", title: "买青菜", createdAt: "2026-05-11T10:00:00.000Z" }),
    );

    const snapshot = await harness.kernel.getTodaySnapshot({
      elderId: "elder-1",
      now: "2026-05-13T23:30:00.000Z",
      timezone: "Asia/Shanghai",
    });

    expect(snapshot.date).toBe("2026-05-14");
    expect(snapshot.todayReminders.map((item) => item.id)).toEqual(["today-start"]);
    expect(snapshot.yesterdayConfirmed.map((item) => item.id)).toEqual(["yesterday-confirmed"]);
    expect(snapshot.weekTopics[0]).toMatchObject({
      type: "appointment",
      count: 2,
      sampleTitles: ["社区医院复查", "社区医院改期"],
    });
  });
});

function reminder(input: Partial<Reminder>): Reminder {
  return {
    id: input.id ?? "reminder-1",
    tenantId: input.tenantId ?? "tenant-mvp",
    elderId: input.elderId ?? "elder-1",
    sourceId: input.sourceId ?? "source-1",
    eventId: input.eventId,
    title: input.title ?? "提醒",
    description: input.description,
    timeText: input.timeText,
    remindAt: input.remindAt,
    timeConfidence: input.timeConfidence,
    status: input.status ?? "confirmed",
    confirmationRequired: input.confirmationRequired ?? false,
    confidence: input.confidence ?? 0.9,
    reason: input.reason ?? "测试提醒",
    confirmedBy: input.confirmedBy,
    confirmedAt: input.confirmedAt,
    createdAt: input.createdAt ?? "2026-05-13T12:00:00.000Z",
  };
}
