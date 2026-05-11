import {
  DEFAULT_TENANT_ID,
  type CreateFamilyReminderRequest,
  type ElderTurnPlan,
  type ElderTurnResult,
  type MemoryAnswer,
  type MemoryEvent,
  type MemorySource,
  type PersonalContext,
  type Reminder,
} from "@goldmem/memory-schema";
import { randomUUID } from "node:crypto";
import { ModelGatewayError, type ModelGateway } from "@goldmem/model-gateway";
import type { TemporalMemoryStore } from "@goldmem/temporal-memory";
import type {
  AuditLog,
  ContextLinkStore,
  EventStore,
  FamilyReminderCommandStore,
  FamilyTaskStore,
  PersonalContextStore,
  RiskFlagStore,
  SemanticMemoryStore,
  SourceStore,
  TemporalMemoryJobStore,
} from "@goldmem/memory-store";
import type { ReminderEngine } from "@goldmem/reminder-engine";
import type { RiskEngine } from "@goldmem/risk-engine";
import type { PermissionEngine } from "@goldmem/permission-engine";
import { createFamilyReminderCommand } from "./family-reminders.js";
import { appendProviderTimings, consumeProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";
import { IngestOrchestrator } from "./ingest-orchestrator.js";
import { QueryOrchestrator } from "./query-orchestrator.js";

export type IngestTextInput = {
  tenantId?: string;
  elderId: string;
  transcript: string;
  localCreatedAt?: string;
  metadata?: MemorySource["metadata"];
  traceId?: string;
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
    status: "written" | "failed";
    errorCode?: "graphiti_not_configured" | "graphiti_write_failed" | "graphiti_retry_enqueue_failed";
    errorMessage?: string;
    retryQueued?: boolean;
    retryJobId?: string;
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
  traceId?: string;
};

export type CreateFamilyReminderInput = CreateFamilyReminderRequest;

export type ElderMemoryKernelDeps = {
  sourceStore: SourceStore;
  eventStore: EventStore;
  contextLinkStore: ContextLinkStore;
  reminderEngine: ReminderEngine;
  familyReminderCommandStore: FamilyReminderCommandStore;
  familyTaskStore: FamilyTaskStore;
  riskFlagStore: RiskFlagStore;
  semanticMemory: SemanticMemoryStore;
  personalContextStore: PersonalContextStore;
  modelGateway: ModelGateway;
  riskEngine: RiskEngine;
  permissionEngine: PermissionEngine;
  auditLog: AuditLog;
  temporalMemory: TemporalMemoryStore;
  temporalMemoryJobStore: TemporalMemoryJobStore;
};

export class ElderMemoryKernel {
  private readonly ingestOrchestrator: IngestOrchestrator;
  private readonly queryOrchestrator: QueryOrchestrator;

  constructor(private readonly deps: ElderMemoryKernelDeps) {
    this.ingestOrchestrator = new IngestOrchestrator(deps);
    this.queryOrchestrator = new QueryOrchestrator(deps);
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

  async queryMemory(input: QueryMemoryInput): Promise<MemoryAnswer> {
    return this.queryOrchestrator.queryMemory(input, input.traceId ?? randomUUID());
  }

  async elderTurn(input: ElderTurnInput): Promise<ElderTurnResult> {
    const startedAt = Date.now();
    const timings: Record<string, unknown> = {};
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const traceId = input.traceId ?? randomUUID();
    const now = input.now ?? new Date().toISOString();
    const contextStartedAt = Date.now();
    const context = await this.deps.personalContextStore.buildContext({
      tenantId,
      elderId: input.elderId,
      queryText: input.text,
    });
    timings.buildContextMs = Date.now() - contextStartedAt;

    const turnPlanStartedAt = Date.now();
    const plan = await this.planElderTurnSafely({
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
      const ingestStartedAt = Date.now();
      const ingestResult = await this.ingestText({
        tenantId,
        elderId: input.elderId,
        transcript: plan.recordText ?? input.text,
        traceId,
      });
      timings.ingestTextMs = Date.now() - ingestStartedAt;
      result = {
        traceId,
        turnType: "record",
        message: "我帮你记住了。",
        ingestResult,
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
      const ingestStartedAt = Date.now();
      const ingestResult = await this.ingestText({
        tenantId,
        elderId: input.elderId,
        transcript: plan.recordText ?? input.text,
        traceId,
      });
      timings.ingestTextMs = Date.now() - ingestStartedAt;

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
        message: "我先帮你记住了，也找到了相关记忆。",
        ingestResult,
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
        text: input.text,
        plan,
        turnType: result.turnType,
        wroteMemory: Boolean(result.ingestResult),
        queriedMemory: Boolean(result.answer),
        timings,
      },
    });

    return result;
  }

  private async planElderTurnSafely(input: {
    tenantId: string;
    elderId: string;
    text: string;
    now: string;
    traceId: string;
    context: PersonalContext;
  }): Promise<ElderTurnPlan> {
    try {
      return await this.deps.modelGateway.planElderTurn({
        tenantId: input.tenantId,
        elderId: input.elderId,
        text: input.text,
        now: input.now,
        context: input.context,
      });
    } catch (error) {
      if (!(error instanceof ModelGatewayError) || error.code !== "schema_validation_error") throw error;
      await this.deps.auditLog.record({
        type: "elder_turn_plan_failed",
        tenantId: input.tenantId,
        elderId: input.elderId,
        traceId: input.traceId,
        payload: {
          traceId: input.traceId,
          text: input.text,
          failureType: "turn_schema_validation_error",
          errorMessage: error.message,
          modelGateway: modelGatewayErrorPayload(error),
          providerTimings: consumeProviderTimings(this.deps.modelGateway),
          fallbackUsed: true,
        },
      });
      return {
        intent: "clarify",
        confidence: 0,
        clarifyingQuestion: "您想让我记住这件事，还是帮您查以前的记忆？",
      };
    }
  }
}
