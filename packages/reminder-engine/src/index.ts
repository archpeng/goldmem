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

export interface ReminderEngine {
  createCandidate(input: CreateReminderCandidateInput): Promise<Reminder>;
  confirmReminder(input: ConfirmReminderInput): Promise<Reminder>;
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
}
