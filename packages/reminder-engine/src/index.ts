import type { Reminder, ReminderCandidateDraft } from "@mem/memory-schema";
import type { CreateReminderInput, ReminderStore } from "@mem/memory-store";

export type CreateReminderCandidateInput = ReminderCandidateDraft & {
  tenantId: string;
  elderId: string;
  sourceId: string;
  eventId?: string;
};

export type ConfirmReminderInput = {
  tenantId: string;
  reminderId: string;
  actorUserId: string;
  remindAt?: string;
  timezone?: string;
};

export type ReminderTransitionInput = {
  tenantId: string;
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
    return this.reminderStore.create(buildReminderCreateInput(input));
  }

  async confirmReminder(input: ConfirmReminderInput): Promise<Reminder> {
    const existing = await this.reminderStore.get({ tenantId: input.tenantId, reminderId: input.reminderId });
    if (!existing) {
      throw new Error(`Reminder not found: ${input.reminderId}`);
    }

    const remindAt = input.remindAt ?? existing.remindAt;
    if (!remindAt) {
      throw new Error("Cannot confirm reminder without remindAt");
    }
    const confirmedTimeText = formatConfirmedReminderTime(remindAt, input.timezone);

    return this.reminderStore.update({
      tenantId: input.tenantId,
      reminderId: existing.id,
      patch: {
        remindAt,
        timeText: confirmedTimeText,
        status: "confirmed",
        confirmationRequired: false,
        reason: `已按确认时间设置提醒：${confirmedTimeText}。`,
        confirmedBy: input.actorUserId,
        confirmedAt: new Date().toISOString(),
      },
    });
  }

  async scheduleReminder(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input);
    if (existing.status !== "confirmed") {
      throw new Error(`Cannot schedule reminder from status: ${existing.status}`);
    }
    if (!existing.remindAt) {
      throw new Error("Cannot schedule reminder without remindAt");
    }
    return this.reminderStore.update({ tenantId: input.tenantId, reminderId: existing.id, patch: { status: "scheduled" } });
  }

  async markReminderSent(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input);
    if (existing.status !== "scheduled") {
      throw new Error(`Cannot mark reminder sent from status: ${existing.status}`);
    }
    return this.reminderStore.update({ tenantId: input.tenantId, reminderId: existing.id, patch: { status: "sent" } });
  }

  async completeReminder(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input);
    if (existing.status !== "sent" && existing.status !== "scheduled" && existing.status !== "confirmed") {
      throw new Error(`Cannot complete reminder from status: ${existing.status}`);
    }
    return this.reminderStore.update({ tenantId: input.tenantId, reminderId: existing.id, patch: { status: "done" } });
  }

  async cancelReminder(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input);
    if (existing.status === "done" || existing.status === "expired") {
      throw new Error(`Cannot cancel reminder from status: ${existing.status}`);
    }
    return this.reminderStore.update({ tenantId: input.tenantId, reminderId: existing.id, patch: { status: "cancelled" } });
  }

  async expireReminder(input: ReminderTransitionInput): Promise<Reminder> {
    const existing = await this.requireReminder(input);
    if (existing.status === "done" || existing.status === "cancelled") {
      throw new Error(`Cannot expire reminder from status: ${existing.status}`);
    }
    return this.reminderStore.update({ tenantId: input.tenantId, reminderId: existing.id, patch: { status: "expired" } });
  }

  private async requireReminder(input: { tenantId: string; reminderId: string }): Promise<Reminder> {
    const existing = await this.reminderStore.get(input);
    if (!existing) {
      throw new Error(`Reminder not found: ${input.reminderId}`);
    }
    return existing;
  }
}

export function formatConfirmedReminderTime(remindAt: string, timezone = "Asia/Shanghai"): string {
  const formatter = buildConfirmedReminderFormatter(timezone);
  const parts = formatter.formatToParts(new Date(remindAt));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}年${Number(value("month"))}月${Number(value("day"))}日 ${value("hour")}:${value("minute")}`;
}

function buildConfirmedReminderFormatter(timezone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("zh-CN", options);
  } catch {
    return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone: "Asia/Shanghai" });
  }
}

export function buildReminderCreateInput(input: CreateReminderCandidateInput): CreateReminderInput {
  return {
    elderId: input.elderId,
    tenantId: input.tenantId,
    sourceId: input.sourceId,
    eventId: input.eventId,
    title: input.title,
    description: input.description,
    timeText: input.timeText,
    remindAt: input.remindAt,
    timeConfidence: input.timeConfidence,
    status: input.confirmationRequired ? "pending_family_confirm" : "candidate",
    confirmationRequired: input.confirmationRequired,
    confidence: input.confidence,
    reason: input.reason,
  };
}
