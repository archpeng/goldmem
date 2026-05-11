import { z } from "zod";

export const ISODateTimeSchema = z.string().datetime();
export const DEFAULT_TENANT_ID = "tenant-mvp";
export const TenantIdSchema = z.string().min(1).default(DEFAULT_TENANT_ID);

export const SourceTypeSchema = z.enum(["voice", "text", "family_input"]);
export const EventTypeSchema = z.enum([
  "health",
  "medication",
  "appointment",
  "family",
  "shopping",
  "finance",
  "place",
  "object",
  "general",
]);
export const EntityTypeSchema = z.enum(["person", "place", "medicine", "object", "organization", "unknown"]);
export const RiskLevelSchema = z.enum(["normal", "sensitive", "medical", "financial", "fraud_risk"]);
export const ReminderStatusSchema = z.enum([
  "candidate",
  "pending_elder_confirm",
  "pending_family_confirm",
  "confirmed",
  "scheduled",
  "sent",
  "done",
  "cancelled",
  "expired",
]);
export const VisibilitySchema = z.enum(["private", "shared_summary", "shared_full", "family_required"]);
export const ContextLinkTypeSchema = z.enum(["possibly_related", "fills_missing_time"]);
export const ContextLinkStatusSchema = z.enum(["active", "needs_confirmation", "rejected"]);

export const EvidenceRefSchema = z.object({
  sourceId: z.string().min(1),
  quote: z.string().optional(),
  startChar: z.number().int().nonnegative().optional(),
  endChar: z.number().int().nonnegative().optional(),
  audioStartMs: z.number().int().nonnegative().optional(),
  audioEndMs: z.number().int().nonnegative().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const MemorySourceSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  type: SourceTypeSchema,
  transcript: z.string().min(1),
  audioUrl: z.string().url().optional(),
  createdAt: ISODateTimeSchema,
  localCreatedAt: ISODateTimeSchema.optional(),
  asrConfidence: z.number().min(0).max(1).optional(),
  deviceId: z.string().optional(),
  metadata: z
    .object({
      language: z.string().optional(),
      locationHint: z.string().optional(),
      appVersion: z.string().optional(),
    })
    .optional(),
});
export type MemorySource = z.infer<typeof MemorySourceSchema>;

export const EntityDraftSchema = z.object({
  type: EntityTypeSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});
export type EntityDraft = z.infer<typeof EntityDraftSchema>;

export const MemoryEventDraftSchema = z.object({
  type: EventTypeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  timeText: z.string().optional(),
  eventTimeStart: ISODateTimeSchema.optional(),
  eventTimeEnd: ISODateTimeSchema.optional(),
  timeConfidence: z.number().min(0).max(1),
  entities: z.array(EntityDraftSchema).default([]),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  riskLevel: RiskLevelSchema,
  requiresConfirmation: z.boolean(),
  visibility: VisibilitySchema.default("private"),
  evidence: z.array(EvidenceRefSchema).min(1),
});
export type MemoryEventDraft = z.infer<typeof MemoryEventDraftSchema>;

export const ReminderCandidateDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  timeText: z.string().optional(),
  remindAt: ISODateTimeSchema.optional(),
  timeConfidence: z.number().min(0).max(1),
  relatedEventIndex: z.number().int().nonnegative().optional(),
  confirmationRequired: z.boolean(),
  suggestedConfirmers: z
    .array(
      z.object({
        role: z.enum(["elder", "family"]),
        personName: z.string().optional(),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});
export type ReminderCandidateDraft = z.infer<typeof ReminderCandidateDraftSchema>;

export const RiskFlagSchema = z.object({
  type: z.enum([
    "medical_advice",
    "medication_change",
    "financial_transfer",
    "fraud_suspected",
    "identity_document",
    "password_or_code",
    "location_sensitive",
  ]),
  severity: z.enum(["low", "medium", "high"]),
  summary: z.string().min(1),
  reason: z.string().min(1),
  requiresFamilyReview: z.boolean(),
  requiresHumanConfirmation: z.boolean(),
  evidence: z.array(EvidenceRefSchema).min(1),
});
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const RiskFlagRecordSchema = RiskFlagSchema.extend({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  sourceId: z.string().min(1),
  eventId: z.string().optional(),
  createdAt: ISODateTimeSchema,
});
export type RiskFlagRecord = z.infer<typeof RiskFlagRecordSchema>;

export const FamilyConfirmationTaskDraftSchema = z.object({
  type: z.enum(["reminder_confirm", "risk_review", "memory_correction", "general_review", "conflict_review"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  urgency: z.enum(["low", "medium", "high"]),
  visibility: VisibilitySchema,
  relatedEventIndex: z.number().int().nonnegative().optional(),
});
export type FamilyConfirmationTaskDraft = z.infer<typeof FamilyConfirmationTaskDraftSchema>;

export const FamilyTaskSchema = FamilyConfirmationTaskDraftSchema.omit({ relatedEventIndex: true }).extend({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  familyUserId: z.string().optional(),
  relatedEventId: z.string().optional(),
  status: z.enum(["pending", "confirmed", "rejected", "needs_more_info", "cancelled"]),
  confirmedBy: z.string().optional(),
  confirmedAt: ISODateTimeSchema.optional(),
  createdAt: ISODateTimeSchema,
});
export type FamilyTask = z.infer<typeof FamilyTaskSchema>;

export const NotificationIntentSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  familyUserId: z.string().optional(),
  type: z.enum(["family_task", "reminder", "risk_review", "conflict_review"]),
  status: z.enum(["pending", "sent", "failed", "cancelled"]),
  title: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  createdAt: ISODateTimeSchema,
});
export type NotificationIntent = z.infer<typeof NotificationIntentSchema>;

export const FeedbackSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  sourceId: z.string().optional(),
  eventId: z.string().optional(),
  actorUserId: z.string().min(1),
  feedbackType: z.string().min(1),
  correction: z.record(z.unknown()).default({}),
  createdAt: ISODateTimeSchema,
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const AuditRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  sourceId: z.string().optional(),
  traceId: z.string().optional(),
  type: z.string().min(1),
  payload: z.record(z.unknown()),
  createdAt: ISODateTimeSchema,
});
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

export const DebugTraceSchema = z.object({
  traceId: z.string().min(1),
  source: MemorySourceSchema.optional(),
  memoryPlan: z.unknown().optional(),
  guardrails: z.unknown().optional(),
  postgresWrites: z.unknown().optional(),
  semanticWritesOrCandidates: z.unknown().optional(),
  graphitiEpisodesOrFacts: z.unknown().optional(),
  evidenceMerge: z.unknown().optional(),
  finalAnswer: z.unknown().optional(),
  auditTrail: z.array(AuditRecordSchema),
});
export type DebugTrace = z.infer<typeof DebugTraceSchema>;

export const MemoryUpdateDraftSchema = z.object({
  target: z.enum(["semantic_memory", "wiki_page"]),
  path: z.string().optional(),
  operation: z.enum(["add", "append", "replace_section", "create"]),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type MemoryUpdateDraft = z.infer<typeof MemoryUpdateDraftSchema>;

export const ContextLinkDraftSchema = z.object({
  fromEventIndex: z.number().int().nonnegative(),
  toEventId: z.string().min(1).optional(),
  toEventIndex: z.number().int().nonnegative().optional(),
  reminderId: z.string().min(1).optional(),
  type: ContextLinkTypeSchema,
  confidence: z.number().min(0).max(1),
  status: ContextLinkStatusSchema.default("needs_confirmation"),
  reason: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).min(1),
});
export type ContextLinkDraft = z.infer<typeof ContextLinkDraftSchema>;

export const UncertaintySchema = z.object({
  field: z.string().min(1),
  description: z.string().min(1),
  suggestedAction: z.enum(["ask_elder", "ask_family", "leave_unresolved", "review_later"]),
});
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const MemoryPlanSchema = z.object({
  tenantId: TenantIdSchema,
  sourceId: z.string().min(1),
  elderId: z.string().min(1),
  summary: z.string().min(1),
  events: z.array(MemoryEventDraftSchema).default([]),
  reminderCandidates: z.array(ReminderCandidateDraftSchema).default([]),
  riskFlags: z.array(RiskFlagSchema).default([]),
  familyTasks: z.array(FamilyConfirmationTaskDraftSchema).default([]),
  contextLinks: z.array(ContextLinkDraftSchema).default([]),
  memoryUpdates: z.array(MemoryUpdateDraftSchema).default([]),
  uncertainties: z.array(UncertaintySchema).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  modelInfo: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
  }),
  confidence: z.number().min(0).max(1),
});
export type MemoryPlan = z.infer<typeof MemoryPlanSchema>;

export const MemoryEventSchema = MemoryEventDraftSchema.extend({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  sourceId: z.string().min(1),
  status: z.enum(["active", "needs_review", "archived"]),
  createdAt: ISODateTimeSchema,
});
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export const MemoryContextLinkSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  fromEventId: z.string().min(1),
  toEventId: z.string().min(1),
  reminderId: z.string().min(1).optional(),
  type: ContextLinkTypeSchema,
  status: ContextLinkStatusSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).min(1),
  createdAt: ISODateTimeSchema,
});
export type MemoryContextLink = z.infer<typeof MemoryContextLinkSchema>;

export const ReminderSchema = z.object({
  id: z.string().min(1),
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  sourceId: z.string().min(1),
  eventId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  remindAt: ISODateTimeSchema.optional(),
  status: ReminderStatusSchema,
  confirmationRequired: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  confirmedBy: z.string().optional(),
  confirmedAt: ISODateTimeSchema.optional(),
  createdAt: ISODateTimeSchema,
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const ParsedMemoryQuerySchema = z.object({
  intent: z.enum([
    "recall_event",
    "check_reminder",
    "ask_today",
    "ask_recent_important",
    "ask_person_related",
    "unknown",
  ]),
  timeRange: z
    .object({
      start: ISODateTimeSchema,
      end: ISODateTimeSchema,
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  entities: z
    .array(
      z.object({
        type: EntityTypeSchema,
        name: z.string().min(1),
        confidence: z.number().min(0).max(1),
      }),
    )
    .default([]),
  eventTypes: z.array(EventTypeSchema).default([]),
  requiresSourceEvidence: z.boolean(),
});
export type ParsedMemoryQuery = z.infer<typeof ParsedMemoryQuerySchema>;

export const MemoryAnswerSchema = z.object({
  traceId: z.string().min(1).optional(),
  answerText: z.string().min(1),
  confidence: z.number().min(0).max(1),
  matchedSources: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        createdAt: ISODateTimeSchema,
        summary: z.string().min(1),
        canPlayAudio: z.boolean(),
        retrievalSource: z.enum(["postgres", "semantic", "context_link", "graphiti"]).optional(),
      }),
    )
    .default([]),
  retrievedEvidence: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        eventId: z.string().min(1).optional(),
        createdAt: ISODateTimeSchema,
        summary: z.string().min(1),
        transcriptQuote: z.string().optional(),
        score: z.number().min(0).max(1),
        canPlayAudio: z.boolean(),
        retrievalSource: z.enum(["postgres", "semantic", "context_link", "graphiti"]),
      }),
    )
    .default([]),
  suggestedActions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("play_audio"), sourceId: z.string().min(1) }),
        z.object({ type: z.literal("create_reminder"), title: z.string().min(1) }),
        z.object({ type: z.literal("ask_family_confirm"), title: z.string().min(1) }),
      ]),
    )
    .default([]),
  safetyNote: z.string().optional(),
});
export type MemoryAnswer = z.infer<typeof MemoryAnswerSchema>;

export const ElderTurnIntentSchema = z.enum(["record", "recall", "record_and_recall", "clarify"]);
export type ElderTurnIntent = z.infer<typeof ElderTurnIntentSchema>;

export const ElderTurnPlanSchema = z.object({
  intent: ElderTurnIntentSchema,
  confidence: z.number().min(0).max(1),
  recordText: z.string().min(1).optional(),
  queryText: z.string().min(1).optional(),
  clarifyingQuestion: z.string().min(1).optional(),
});
export type ElderTurnPlan = z.infer<typeof ElderTurnPlanSchema>;

export const ElderTurnRequestSchema = z.object({
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  text: z.string().min(1),
  now: ISODateTimeSchema.optional(),
  traceId: z.string().min(1).optional(),
});
export type ElderTurnRequest = z.infer<typeof ElderTurnRequestSchema>;

export const ElderTurnResultSchema = z.object({
  traceId: z.string().min(1),
  turnType: ElderTurnIntentSchema,
  message: z.string().min(1),
  ingestResult: z
    .object({
      traceId: z.string().min(1),
      sourceId: z.string().min(1),
      summary: z.string().min(1),
      events: z.array(MemoryEventSchema),
      reminderCandidates: z.array(ReminderSchema),
      elderFacingCards: z.array(z.object({
        title: z.string().min(1),
        summary: z.string().min(1),
        needsConfirmation: z.boolean(),
        riskLevel: z.string().min(1),
      })),
      temporalMemory: z
        .object({
          status: z.enum(["written", "failed"]),
          errorCode: z.enum(["graphiti_not_configured", "graphiti_write_failed", "graphiti_retry_enqueue_failed"]).optional(),
          errorMessage: z.string().optional(),
          retryQueued: z.boolean().optional(),
          retryJobId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  answer: MemoryAnswerSchema.optional(),
});
export type ElderTurnResult = z.infer<typeof ElderTurnResultSchema>;

export const PersonalContextSchema = z.object({
  elderProfile: z.record(z.unknown()).optional(),
  recentEvents: z.array(z.object({
    eventId: z.string().optional(),
    sourceId: z.string().optional(),
    title: z.string().min(1),
    summary: z.string().min(1),
    createdAt: ISODateTimeSchema,
  })),
  semanticCandidateEvents: z.array(z.object({
    eventId: z.string().min(1),
    sourceId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    createdAt: ISODateTimeSchema,
    score: z.number().min(0).max(1).optional(),
  })).optional(),
  openReminders: z.array(z.object({
    reminderId: z.string().min(1),
    eventId: z.string().optional(),
    title: z.string().min(1),
    reason: z.string().min(1),
    timeText: z.string().optional(),
    remindAt: ISODateTimeSchema.optional(),
    timeConfidence: z.number().min(0).max(1).optional(),
    status: z.string().min(1),
  })).optional(),
  semanticMemories: z.array(z.object({
    memory: z.string().min(1),
    score: z.number().min(0).max(1).optional(),
  })),
  knownEntities: z.array(z.object({
    type: z.string().min(1),
    name: z.string().min(1),
    aliases: z.array(z.string()).optional(),
  })),
  familyRelations: z.array(z.object({
    name: z.string().min(1),
    relationship: z.string().min(1),
    userId: z.string().optional(),
  })),
  safetyPolicy: z.array(z.string()),
});
export type PersonalContext = z.infer<typeof PersonalContextSchema>;

export const CreateFeedbackRequestSchema = z.object({
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  actorUserId: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  feedbackType: z.string().min(1),
  correction: z.record(z.unknown()).default({}),
  traceId: z.string().min(1).optional(),
});
export type CreateFeedbackRequest = z.infer<typeof CreateFeedbackRequestSchema>;

export const ConfirmReminderRequestSchema = z.object({
  tenantId: TenantIdSchema,
  actorUserId: z.string().min(1),
  remindAt: ISODateTimeSchema.optional(),
  traceId: z.string().min(1).optional(),
});
export type ConfirmReminderRequest = z.infer<typeof ConfirmReminderRequestSchema>;

export const CreateFamilyReminderRequestSchema = z.object({
  tenantId: TenantIdSchema,
  elderId: z.string().min(1),
  actorUserId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  remindAt: ISODateTimeSchema.optional(),
  reason: z.string().default("Family-created reminder."),
  idempotencyKey: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
});
export type CreateFamilyReminderRequest = z.infer<typeof CreateFamilyReminderRequestSchema>;
