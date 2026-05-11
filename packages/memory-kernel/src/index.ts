import {
  DEFAULT_TENANT_ID,
  type CreateFamilyReminderRequest,
  type MemoryAnswer,
  type MemoryEvent,
  type MemorySource,
  type Reminder,
} from "@goldmem/memory-schema";
import { randomUUID } from "node:crypto";
import type { ModelGateway } from "@goldmem/model-gateway";
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
}
