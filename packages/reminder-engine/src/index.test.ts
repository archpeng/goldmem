import { describe, expect, it } from "vitest";
import type { Reminder } from "@goldmem/memory-schema";
import type { CreateReminderInput, ReminderStore } from "@goldmem/memory-store";
import { DefaultReminderEngine } from "./index.js";

describe("DefaultReminderEngine", () => {
  it("moves confirmed reminders through scheduled, sent, and done", async () => {
    const store = new InMemoryReminderStore();
    const engine = new DefaultReminderEngine(store);
    const reminder = await store.create({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      sourceId: "source-1",
      title: "Take medicine",
      remindAt: "2026-05-10T09:00:00.000Z",
      status: "candidate",
      confirmationRequired: false,
      confidence: 0.9,
      reason: "Test",
    });

    await engine.confirmReminder({ tenantId: "tenant-mvp", reminderId: reminder.id, actorUserId: "elder-1" });
    await engine.scheduleReminder({ tenantId: "tenant-mvp", reminderId: reminder.id });
    await engine.markReminderSent({ tenantId: "tenant-mvp", reminderId: reminder.id });
    const done = await engine.completeReminder({ tenantId: "tenant-mvp", reminderId: reminder.id });

    expect(done.status).toBe("done");
  });

  it("rejects scheduling before confirmation", async () => {
    const store = new InMemoryReminderStore();
    const engine = new DefaultReminderEngine(store);
    const reminder = await store.create({
      tenantId: "tenant-mvp",
      elderId: "elder-1",
      sourceId: "source-1",
      title: "Take medicine",
      remindAt: "2026-05-10T09:00:00.000Z",
      status: "candidate",
      confirmationRequired: false,
      confidence: 0.9,
      reason: "Test",
    });

    await expect(engine.scheduleReminder({ tenantId: "tenant-mvp", reminderId: reminder.id })).rejects.toThrow();
  });
});

class InMemoryReminderStore implements ReminderStore {
  reminders: Reminder[] = [];

  async create(input: CreateReminderInput): Promise<Reminder> {
    const reminder = {
      ...input,
      id: `reminder-${this.reminders.length + 1}`,
      createdAt: "2026-05-09T12:00:00.000Z",
    };
    this.reminders.push(reminder);
    return reminder;
  }

  async get(input: { tenantId: string; reminderId: string }): Promise<Reminder | null> {
    return this.reminders.find((reminder) => reminder.tenantId === input.tenantId && reminder.id === input.reminderId) ?? null;
  }

  async listByElder(input: { tenantId: string; elderId: string }): Promise<Reminder[]> {
    return this.reminders.filter((reminder) => reminder.tenantId === input.tenantId && reminder.elderId === input.elderId);
  }

  async update(input: { tenantId: string; reminderId: string; patch: Partial<Reminder> }): Promise<Reminder> {
    const reminder = await this.get(input);
    if (!reminder) throw new Error(`Reminder not found: ${input.reminderId}`);
    Object.assign(reminder, input.patch);
    return reminder;
  }
}
