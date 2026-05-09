import { z } from "zod";

export const ISODateTimeSchema = z.string().datetime();

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

export const FamilyConfirmationTaskDraftSchema = z.object({
  type: z.enum(["reminder_confirm", "risk_review", "memory_correction", "general_review"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  urgency: z.enum(["low", "medium", "high"]),
  visibility: VisibilitySchema,
  relatedEventIndex: z.number().int().nonnegative().optional(),
});
export type FamilyConfirmationTaskDraft = z.infer<typeof FamilyConfirmationTaskDraftSchema>;

export const MemoryUpdateDraftSchema = z.object({
  target: z.enum(["semantic_memory", "temporal_graph", "wiki_page"]),
  path: z.string().optional(),
  operation: z.enum(["add", "append", "replace_section", "create"]),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});
export type MemoryUpdateDraft = z.infer<typeof MemoryUpdateDraftSchema>;

export const UncertaintySchema = z.object({
  field: z.string().min(1),
  description: z.string().min(1),
  suggestedAction: z.enum(["ask_elder", "ask_family", "leave_unresolved", "review_later"]),
});
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const MemoryPlanSchema = z.object({
  sourceId: z.string().min(1),
  elderId: z.string().min(1),
  summary: z.string().min(1),
  events: z.array(MemoryEventDraftSchema).default([]),
  reminderCandidates: z.array(ReminderCandidateDraftSchema).default([]),
  riskFlags: z.array(RiskFlagSchema).default([]),
  familyTasks: z.array(FamilyConfirmationTaskDraftSchema).default([]),
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
  elderId: z.string().min(1),
  sourceId: z.string().min(1),
  status: z.enum(["active", "needs_review", "archived"]),
  createdAt: ISODateTimeSchema,
});
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export const ReminderSchema = z.object({
  id: z.string().min(1),
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
  answerText: z.string().min(1),
  confidence: z.number().min(0).max(1),
  matchedSources: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        createdAt: ISODateTimeSchema,
        summary: z.string().min(1),
        canPlayAudio: z.boolean(),
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
