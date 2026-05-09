import type { Reminder, ReminderCandidateDraft } from "@goldmem/memory-schema";
import type { ReminderStore } from "@goldmem/memory-store";

export type CreateReminderCandidateInput = ReminderCandidateDraft & {
  elderId: string;
  sourceId: string;
  eventId?: string;
};

export type ConfirmReminderInput = {
  reminderId: string;
  actorUserId: string;
  remindAt?: string;
};

export type ReminderTransitionInput = {
  reminderId: string;
  actorUserId?: string;
};

export interface ReminderEngine {
  createCandidate(input: CreateReminderCandidateInput): Promise<Reminder>;
  confirmReminder(input: ConfirmReminderInput): Promise<Reminder>;
  scheduleReminder(input: ReminderTransitionInput): Promise<Reminder>;
  markReminderSent(input: ReminderTransitionInput): Promise<Reminder>;
  completeReminder(input: ReminderTransitionInput): Promise<Reminder>;
  cancelReminder(input: ReminderTransitionInput): Promise<Reminder>;
  expireReminder(input: ReminderTransitionInput): Promise<Reminder>;
}

export class DefaultReminderEngine implements ReminderEngine {
  constructor(private readonly reminderStore: ReminderStore) {}

  async createCandidate(input: CreateReminderCandidateInput): Promise<Reminder> {
    const status = input.confirmationRequired ? "pending_family_confirm" : "candidate";

    return this.reminderStore.create({
      elderId: input.elderId,
      sourceId: input.sourceId,
      eventId: input.eventId,
      title: input.title,
      description: input.description,
      remindAt: input.remindAt,
      status,
      confirmationRequired: input.confirmationRequired,
      confidence: input.confidence,
      reason: input.reason,
    });
  }

  async confirmReminder(input: ConfirmReminderInput): Promise<Reminder> {
    const existing = await this.reminderStore.get(input.reminderId);
    if (!existing) {
      throw new Error(`Reminder not found: ${input.reminderId}`);
    }

    const remindAt = input.remindAt ?? existing.remindAt;
    if (!remindAt) {
      throw new Error("Cannot confirm reminder without remindAt");
    }

    return this.reminderStore.update(existing.id, {
      remindAt,
      status: "confirmed",
      confirmedBy: input.actorUserId,
      confirmedAt: new Date().toISOString(),
    });
  }

  async scheduleReminder(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input.reminderId);
    if (existing.status !== "confirmed") {
      throw new Error(`Cannot schedule reminder from status: ${existing.status}`);
    }
    if (!existing.remindAt) {
      throw new Error("Cannot schedule reminder without remindAt");
    }
    return this.reminderStore.update(existing.id, { status: "scheduled" });
  }

  async markReminderSent(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input.reminderId);
    if (existing.status !== "scheduled") {
      throw new Error(`Cannot mark reminder sent from status: ${existing.status}`);
    }
    return this.reminderStore.update(existing.id, { status: "sent" });
  }

  async completeReminder(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input.reminderId);
    if (existing.status !== "sent" && existing.status !== "scheduled" && existing.status !== "confirmed") {
      throw new Error(`Cannot complete reminder from status: ${existing.status}`);
    }
    return this.reminderStore.update(existing.id, { status: "done" });
  }

  async cancelReminder(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input.reminderId);
    if (existing.status === "done" || existing.status === "expired") {
      throw new Error(`Cannot cancel reminder from status: ${existing.status}`);
    }
    return this.reminderStore.update(existing.id, { status: "cancelled" });
  }

  async expireReminder(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input.reminderId);
    if (existing.status === "done" || existing.status === "cancelled") {
      throw new Error(`Cannot expire reminder from status: ${existing.status}`);
    }
    return this.reminderStore.update(existing.id, { status: "expired" });
  }

  private async requireReminder(reminderId: string): Promise<Reminder> {
    const existing = await this.reminderStore.get(reminderId);
    if (!existing) {
      throw new Error(`Reminder not found: ${reminderId}`);
    }
    return existing;
  }
}
