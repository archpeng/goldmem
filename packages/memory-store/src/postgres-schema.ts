import { boolean, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const elderProfiles = pgTable("elder_profiles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const familyLinks = pgTable("family_links", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  familyUserId: text("family_user_id").notNull(),
  relationship: text("relationship").notNull(),
  permissionLevel: text("permission_level").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memorySources = pgTable("memory_sources", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  type: text("type").notNull(),
  audioUrl: text("audio_url"),
  transcript: text("transcript").notNull(),
  asrConfidence: real("asr_confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  localCreatedAt: timestamp("local_created_at", { withTimezone: true }),
  deviceId: text("device_id"),
  metadata: jsonb("metadata"),
});

export const memoryEvents = pgTable("memory_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  sourceId: text("source_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  timeText: text("time_text"),
  eventTimeStart: timestamp("event_time_start", { withTimezone: true }),
  eventTimeEnd: timestamp("event_time_end", { withTimezone: true }),
  timeConfidence: real("time_confidence").notNull(),
  entities: jsonb("entities").notNull(),
  importance: real("importance").notNull(),
  confidence: real("confidence").notNull(),
  riskLevel: text("risk_level").notNull(),
  requiresConfirmation: boolean("requires_confirmation").notNull(),
  visibility: text("visibility").notNull(),
  evidence: jsonb("evidence").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoryEntities = pgTable("memory_entities", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  aliases: jsonb("aliases").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoryEventEntities = pgTable("memory_event_entities", {
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  eventId: text("event_id").notNull(),
  entityId: text("entity_id").notNull(),
  relation: text("relation").notNull(),
});

export const reminders = pgTable("reminders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  sourceId: text("source_id").notNull(),
  eventId: text("event_id"),
  title: text("title").notNull(),
  description: text("description"),
  remindAt: timestamp("remind_at", { withTimezone: true }),
  status: text("status").notNull(),
  confirmationRequired: boolean("confirmation_required").notNull(),
  confidence: real("confidence").notNull(),
  reason: text("reason").notNull(),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskFlags = pgTable("risk_flags", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  sourceId: text("source_id").notNull(),
  eventId: text("event_id"),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
  reason: text("reason").notNull(),
  requiresFamilyReview: boolean("requires_family_review").notNull(),
  requiresHumanConfirmation: boolean("requires_human_confirmation").notNull(),
  evidence: jsonb("evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const familyTasks = pgTable("family_tasks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  familyUserId: text("family_user_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  visibility: text("visibility").notNull(),
  urgency: text("urgency").notNull(),
  relatedEventId: text("related_event_id"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoryContextLinks = pgTable("memory_context_links", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  fromEventId: text("from_event_id").notNull(),
  toEventId: text("to_event_id").notNull(),
  reminderId: text("reminder_id"),
  type: text("type").notNull(),
  status: text("status").notNull(),
  confidence: real("confidence").notNull(),
  reason: text("reason").notNull(),
  evidence: jsonb("evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  sourceId: text("source_id"),
  eventId: text("event_id"),
  actorUserId: text("actor_user_id").notNull(),
  feedbackType: text("feedback_type").notNull(),
  correction: jsonb("correction_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default("tenant-mvp"),
  elderId: text("elder_id").notNull(),
  sourceId: text("source_id"),
  type: text("type").notNull(),
  payload: jsonb("payload_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const temporalMemoryJobs = pgTable("temporal_memory_jobs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  elderId: text("elder_id").notNull(),
  sourceId: text("source_id").notNull(),
  status: text("status").notNull(),
  attempts: real("attempts").notNull().default(0),
  maxAttempts: real("max_attempts").notNull().default(5),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lastError: text("last_error"),
  episode: jsonb("episode_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const familyReminderCommands = pgTable("family_reminder_commands", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  elderId: text("elder_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  sourceId: text("source_id").notNull(),
  reminderId: text("reminder_id").notNull(),
  request: jsonb("request_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
