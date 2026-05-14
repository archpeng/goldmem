import {
  DEFAULT_TENANT_ID,
  type CreateFeedbackRequest,
  type CreateFamilyReminderRequest,
  type ElderTurnResult,
  type FamilyAssistTask,
  type IngestStatus,
  type MemoryAnswer,
  type MemoryEvent,
  type MemoryPlan,
  type MemorySource,
  type Feedback,
  type Reminder,
  type TodaySnapshot,
} from "@mem/memory-schema";
import { randomUUID } from "node:crypto";
import type { ModelGateway } from "@mem/model-gateway";
import type { TemporalMemoryStore } from "@mem/temporal-memory";
import type {
  AuditLog,
  ContextLinkStore,
  ElderProfileStore,
  EventStore,
  FamilyReminderCommandStore,
  FamilyTaskStore,
  FeedbackStore,
  MemoryProcessingJobStore,
  PersonalContextStore,
  ReminderStore,
  RiskFlagStore,
  SemanticMemoryStore,
  SourceStore,
  TemporalMemoryJobStore,
} from "@mem/memory-store";
import type { ReminderEngine } from "@mem/reminder-engine";
import type { RiskEngine } from "@mem/risk-engine";
import type { PermissionEngine } from "@mem/permission-engine";
import { createFamilyReminderCommand } from "./family-reminders.js";
import { listFamilyAssistTasksCommand, type ListFamilyAssistTasksInput } from "./family-assist.js";
import {
  confirmReminderCommand,
  createFeedbackCommand,
  updateFamilyTaskStatusCommand,
  type ConfirmReminderInput,
  type UpdateFamilyTaskStatusInput,
} from "./elder-commands.js";
import { appendProviderTimings } from "./model-gateway-timings.js";
import { IngestOrchestrator } from "./ingest-orchestrator.js";
import { QueryOrchestrator } from "./query-orchestrator.js";
import { MemoryProcessingOrchestrator } from "./memory-processing.js";
import { buildTurnPlanContext, planElderTurnSafely } from "./elder-turn-planner.js";
import { getTodaySnapshot as buildTodaySnapshot, type GetTodaySnapshotInput } from "./today-snapshot.js";

export type IngestTextInput = {
  tenantId?: string;
  elderId: string;
  transcript: string;
  localCreatedAt?: string;
  metadata?: MemorySource["metadata"];
  traceId?: string;
  clientTurnId?: string;
};

export type IngestVoiceInput = {
  tenantId?: string;
  elderId: string;
  audio: Uint8Array;
  localCreatedAt?: string;
  metadata?: MemorySource["metadata"];
  traceId?: string;
};

export type IngestResult = {
  traceId: string;
  sourceId: string;
  summary: string;
  events: MemoryEvent[];
  reminderCandidates: Reminder[];
  elderFacingCards: Array<{
    title: string;
    summary: string;
    needsConfirmation: boolean;
    riskLevel: string;
  }>;
  temporalMemory: {
    status: "queued" | "not_needed" | "failed";
    enqueueReason?: "hard_risk" | "hard_context_link" | "hard_family_task" | "model_relation_signal" | "not_needed";
    relationSignalIntents?: Array<MemoryPlan["relationEnrichmentSignals"][number]["intent"]>;
    errorCode?: "graphiti_enqueue_failed";
    errorMessage?: string;
  };
};

export type QueryMemoryInput = {
  tenantId?: string;
  elderId: string;
  query: string;
  now?: string;
  traceId?: string;
};

export type ElderTurnInput = {
  tenantId?: string;
  elderId: string;
  text: string;
  now?: string;
  timezone?: string;
  traceId?: string;
  clientTurnId?: string;
};

export type CreateFamilyReminderInput = CreateFamilyReminderRequest;
export type CreateFeedbackInput = CreateFeedbackRequest;
export type { GetTodaySnapshotInput };
export type { ConfirmReminderInput, ListFamilyAssistTasksInput, UpdateFamilyTaskStatusInput };

export type ElderMemoryKernelDeps = {
  sourceStore: SourceStore;
  eventStore: EventStore;
  contextLinkStore: ContextLinkStore;
  reminderStore: ReminderStore;
  reminderEngine: ReminderEngine;
  familyReminderCommandStore: FamilyReminderCommandStore;
  familyTaskStore: FamilyTaskStore;
  feedbackStore: FeedbackStore;
  riskFlagStore: RiskFlagStore;
  semanticMemory: SemanticMemoryStore;
  personalContextStore: PersonalContextStore;
  elderProfileStore?: ElderProfileStore;
  modelGateway: ModelGateway;
  riskEngine: RiskEngine;
  permissionEngine: PermissionEngine;
  auditLog: AuditLog;
  temporalMemory: TemporalMemoryStore;
  temporalMemoryJobStore: TemporalMemoryJobStore;
  memoryProcessingJobStore: MemoryProcessingJobStore;
};

export class ElderMemoryKernel {
  private readonly ingestOrchestrator: IngestOrchestrator;
  private readonly queryOrchestrator: QueryOrchestrator;
  private readonly memoryProcessing: MemoryProcessingOrchestrator;

  constructor(private readonly deps: ElderMemoryKernelDeps) {
    this.ingestOrchestrator = new IngestOrchestrator(deps);
    this.queryOrchestrator = new QueryOrchestrator(deps);
    this.memoryProcessing = new MemoryProcessingOrchestrator(deps);
  }

  async ingestVoice(input: IngestVoiceInput): Promise<IngestResult> {
    const traceId = input.traceId ?? randomUUID();
    const audioUrl = await this.deps.sourceStore.saveAudio(input.audio);
    const transcription = await this.deps.modelGateway.transcribe(input.audio);

    const source = await this.deps.sourceStore.create({
      tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
      elderId: input.elderId,
      type: "voice",
      transcript: transcription.text,
      audioUrl,
      createdAt: new Date().toISOString(),
      localCreatedAt: input.localCreatedAt,
      asrConfidence: transcription.confidence,
      metadata: input.metadata,
    });

    return this.ingestOrchestrator.ingestSource(source, traceId);
  }

  async ingestText(input: IngestTextInput): Promise<IngestResult> {
    const traceId = input.traceId ?? randomUUID();
    const source = await this.deps.sourceStore.create({
      tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
      elderId: input.elderId,
      type: "text",
      transcript: input.transcript,
      createdAt: new Date().toISOString(),
      localCreatedAt: input.localCreatedAt,
      metadata: input.metadata,
    });

    return this.ingestOrchestrator.ingestSource(source, traceId);
  }

  async createFamilyReminder(input: CreateFamilyReminderInput): Promise<Reminder> {
    return createFamilyReminderCommand(this.deps, input, input.traceId ?? randomUUID());
  }

  async listFamilyAssistTasks(input: ListFamilyAssistTasksInput): Promise<FamilyAssistTask[]> {
    return listFamilyAssistTasksCommand(this.deps, input);
  }

  async confirmReminder(input: ConfirmReminderInput): Promise<Reminder> {
    return confirmReminderCommand(this.deps, input);
  }

  async updateFamilyTaskStatus(input: UpdateFamilyTaskStatusInput) {
    return updateFamilyTaskStatusCommand(this.deps, input);
  }

  async createFeedback(input: CreateFeedbackInput): Promise<Feedback> {
    return createFeedbackCommand(this.deps, input);
  }

  async queryMemory(input: QueryMemoryInput): Promise<MemoryAnswer> {
    return this.queryOrchestrator.queryMemory(input, input.traceId ?? randomUUID());
  }

  async getIngestStatus(input: { tenantId?: string; sourceId: string }): Promise<IngestStatus> {
    return this.memoryProcessing.getStatus(input);
  }

  async getTodaySnapshot(input: Omit<GetTodaySnapshotInput, "tenantId" | "now"> & {
    tenantId?: string;
    now?: string;
  }): Promise<TodaySnapshot> {
    return buildTodaySnapshot(this.deps, {
      tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
      elderId: input.elderId,
      now: input.now ?? new Date().toISOString(),
      timezone: input.timezone,
    });
  }

  async processMemoryProcessingJobs(input: Parameters<MemoryProcessingOrchestrator["processJobs"]>[0] = {}) {
    return this.memoryProcessing.processJobs(input);
  }

  async elderTurn(input: ElderTurnInput): Promise<ElderTurnResult> {
    const startedAt = Date.now();
    const timings: Record<string, unknown> = {};
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const traceId = input.traceId ?? randomUUID();
    const now = input.now ?? new Date().toISOString();
    const context = await buildTurnPlanContext(this.deps, { tenantId, elderId: input.elderId });

    const turnPlanStartedAt = Date.now();
    const plan = await planElderTurnSafely(this.deps, {
      tenantId,
      elderId: input.elderId,
      text: input.text,
      now,
      traceId,
      context,
    });
    timings.planElderTurnMs = Date.now() - turnPlanStartedAt;
    appendProviderTimings(timings, this.deps.modelGateway);

    let result: ElderTurnResult;
    if (plan.intent === "record") {
      const enqueueStartedAt = Date.now();
      const draft = await this.memoryProcessing.enqueueTextIngest({
        tenantId,
        elderId: input.elderId,
        transcript: plan.recordText ?? input.text,
        localCreatedAt: now,
        metadata: { timezone: input.timezone ?? "Asia/Shanghai" },
        traceId,
        clientTurnId: input.clientTurnId,
        requiresIngestContextRecall: plan.requiresIngestContextRecall,
      });
      timings.enqueueIngestMs = Date.now() - enqueueStartedAt;
      result = {
        traceId,
        turnType: "record",
        message: "我先记下这句话，正在整理提醒。",
        draft,
      };
    } else if (plan.intent === "recall") {
      const queryStartedAt = Date.now();
      const answer = await this.queryMemory({
        tenantId,
        elderId: input.elderId,
        query: plan.queryText ?? input.text,
        now,
        traceId,
      });
      timings.queryMemoryMs = Date.now() - queryStartedAt;
      result = {
        traceId,
        turnType: "recall",
        message: answer.answerText,
        answer,
      };
    } else if (plan.intent === "record_and_recall") {
      const enqueueStartedAt = Date.now();
      const draft = await this.memoryProcessing.enqueueTextIngest({
        tenantId,
        elderId: input.elderId,
        transcript: plan.recordText ?? input.text,
        localCreatedAt: now,
        metadata: { timezone: input.timezone ?? "Asia/Shanghai" },
        traceId,
        clientTurnId: input.clientTurnId,
        requiresIngestContextRecall: plan.requiresIngestContextRecall,
      });
      timings.enqueueIngestMs = Date.now() - enqueueStartedAt;

      const queryStartedAt = Date.now();
      const answer = await this.queryMemory({
        tenantId,
        elderId: input.elderId,
        query: plan.queryText ?? input.text,
        now,
        traceId,
      });
      timings.queryMemoryMs = Date.now() - queryStartedAt;
      result = {
        traceId,
        turnType: "record_and_recall",
        message: "我先记下这句话，也先帮你找到了相关记忆。",
        draft,
        answer,
      };
    } else {
      result = {
        traceId,
        turnType: "clarify",
        message: plan.clarifyingQuestion ?? "您想让我记住这件事，还是帮您查以前的记忆？",
      };
    }
    timings.totalMs = Date.now() - startedAt;

    await this.deps.auditLog.record({
      type: "elder_turn",
      tenantId,
      elderId: input.elderId,
      traceId,
      payload: {
        traceId,
        clientTurnId: input.clientTurnId,
        text: input.text,
        plan,
        turnType: result.turnType,
        wroteMemory: Boolean(result.ingestResult || result.draft),
        queriedMemory: Boolean(result.answer),
        timings,
      },
    });

    return result;
  }

}
