import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type {
  AuditLog,
  ContextLinkStore,
  EventStore,
  FamilyReminderCommandStore,
  FamilyTaskStore,
  FeedbackStore,
  DebugTraceStore,
  MemoryProcessingJobStore,
  NotificationIntentStore,
  PersonalContextStore,
  ReminderStore,
  RiskFlagStore,
  SemanticMemoryStore,
  SourceStore,
  TemporalMemoryJobStore,
} from "./index.js";
import { PostgresAuditLog } from "./postgres-audit.js";
import { PostgresContextLinkStore } from "./postgres-context-links.js";
import { PostgresEventStore } from "./postgres-events.js";
import { PostgresFamilyReminderCommandStore } from "./postgres-family-reminder-command.js";
import { PostgresFamilyTaskStore } from "./postgres-family-tasks.js";
import { PostgresFeedbackStore } from "./postgres-feedback.js";
import { PostgresDebugTraceStore } from "./postgres-debug-traces.js";
import { PostgresMemoryProcessingJobStore } from "./postgres-memory-processing-jobs.js";
import { PostgresNotificationIntentStore } from "./postgres-notification-intents.js";
import { PostgresPersonalContextStore } from "./postgres-read-models.js";
import { PostgresReminderStore } from "./postgres-reminders.js";
import { PostgresRiskFlagStore } from "./postgres-risk-flags.js";
import { PostgresSemanticMemoryStore } from "./postgres-semantic-memory.js";
import * as schema from "./postgres-schema.js";
import { PostgresSourceStore } from "./postgres-sources.js";
import { PostgresTemporalMemoryJobStore } from "./postgres-temporal-jobs.js";
import type { Db, PostgresStoreOptions } from "./postgres-types.js";

export type { PostgresStoreOptions } from "./postgres-types.js";

export type PostgresStores = {
  pool: Pool;
  db: Db;
  sourceStore: SourceStore;
  eventStore: EventStore;
  contextLinkStore: ContextLinkStore;
  reminderStore: ReminderStore;
  familyTaskStore: FamilyTaskStore;
  riskFlagStore: RiskFlagStore;
  feedbackStore: FeedbackStore;
  debugTraceStore: DebugTraceStore;
  notificationIntentStore: NotificationIntentStore;
  familyReminderCommandStore: FamilyReminderCommandStore;
  personalContextStore: PersonalContextStore;
  auditLog: AuditLog;
  temporalMemoryJobStore: TemporalMemoryJobStore;
  memoryProcessingJobStore: MemoryProcessingJobStore;
  semanticMemoryStore: SemanticMemoryStore;
  close(): Promise<void>;
};

export function createPostgresStores(options: PostgresStoreOptions): PostgresStores {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const db = drizzle(pool, { schema });

  return {
    pool,
    db,
    sourceStore: new PostgresSourceStore(db, options),
    eventStore: new PostgresEventStore(db),
    contextLinkStore: new PostgresContextLinkStore(db),
    reminderStore: new PostgresReminderStore(db),
    familyTaskStore: new PostgresFamilyTaskStore(db),
    riskFlagStore: new PostgresRiskFlagStore(db),
    feedbackStore: new PostgresFeedbackStore(db),
    debugTraceStore: new PostgresDebugTraceStore(db),
    notificationIntentStore: new PostgresNotificationIntentStore(db),
    familyReminderCommandStore: new PostgresFamilyReminderCommandStore(db),
    personalContextStore: new PostgresPersonalContextStore(db),
    auditLog: new PostgresAuditLog(db),
    temporalMemoryJobStore: new PostgresTemporalMemoryJobStore(db),
    memoryProcessingJobStore: new PostgresMemoryProcessingJobStore(db),
    semanticMemoryStore: new PostgresSemanticMemoryStore(pool),
    close: () => pool.end(),
  };
}

export { PostgresSemanticMemoryStore } from "./postgres-semantic-memory.js";
