import { DEFAULT_TENANT_ID, type MemorySource, type Reminder } from "@goldmem/memory-schema";
import { buildReminderCreateInput } from "@goldmem/reminder-engine";
import type { CreateFamilyReminderInput, ElderMemoryKernelDeps } from "./index.js";

export async function createFamilyReminderCommand(
  deps: ElderMemoryKernelDeps,
  input: CreateFamilyReminderInput,
): Promise<Reminder> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const source = {
    tenantId,
    elderId: input.elderId,
    type: "family_input",
    transcript: input.title,
    createdAt: new Date().toISOString(),
  } satisfies Omit<MemorySource, "id">;
  const reminder = buildReminderCreateInput({
    tenantId,
    elderId: input.elderId,
    sourceId: "__pending_family_source__",
    title: input.title,
    description: input.description,
    remindAt: input.remindAt,
    timeConfidence: input.remindAt ? 1 : 0,
    confirmationRequired: true,
    suggestedConfirmers: [{ role: "elder" }],
    confidence: 1,
    reason: input.reason,
  });
  const audit = {
    type: "family_reminder_created",
    tenantId,
    elderId: input.elderId,
    payload: {
      actorUserId: input.actorUserId,
      hasRemindAt: Boolean(input.remindAt),
      idempotencyKey: input.idempotencyKey,
    },
  };

  try {
    const result = await deps.familyReminderCommandStore.create({
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      source,
      reminder,
      audit,
      request: {
        tenantId,
        elderId: input.elderId,
        actorUserId: input.actorUserId,
        title: input.title,
        description: input.description,
        remindAt: input.remindAt,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return result.reminder;
  } catch (error) {
    await recordFamilyReminderFailure(deps, {
      tenantId,
      elderId: input.elderId,
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      error,
    });
    throw error;
  }
}

async function recordFamilyReminderFailure(
  deps: ElderMemoryKernelDeps,
  input: {
    tenantId: string;
    elderId: string;
    actorUserId: string;
    idempotencyKey?: string;
    error: unknown;
  },
): Promise<void> {
  try {
    await deps.auditLog.record({
      type: "family_reminder_create_failed",
      tenantId: input.tenantId,
      elderId: input.elderId,
      payload: {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
        errorName: input.error instanceof Error ? input.error.name : "UnknownError",
        errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
      },
    });
  } catch {
    // Preserve the original failure; callers need visibility into the write failure.
  }
}
