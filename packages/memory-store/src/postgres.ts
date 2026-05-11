import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type {
  AuditLog,
  ContextLinkStore,
  EventStore,
  FamilyReminderCommandStore,
  FamilyTaskStore,
  FeedbackStore,
  PersonalContextStore,
  ReminderStore,
  RiskFlagStore,
  SourceStore,
  TemporalMemoryJobStore,
} from "./index.js";
import { PostgresAuditLog } from "./postgres-audit.js";
import { PostgresContextLinkStore } from "./postgres-context-links.js";
import { PostgresEventStore } from "./postgres-events.js";
import { PostgresFamilyReminderCommandStore } from "./postgres-family-reminder-command.js";
import { PostgresFamilyTaskStore } from "./postgres-family-tasks.js";
import { PostgresFeedbackStore } from "./postgres-feedback.js";
import { PostgresPersonalContextStore } from "./postgres-read-models.js";
import { PostgresReminderStore } from "./postgres-reminders.js";
import { PostgresRiskFlagStore } from "./postgres-risk-flags.js";
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
  familyReminderCommandStore: FamilyReminderCommandStore;
  personalContextStore: PersonalContextStore;
  auditLog: AuditLog;
  temporalMemoryJobStore: TemporalMemoryJobStore;
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
    familyReminderCommandStore: new PostgresFamilyReminderCommandStore(db),
    personalContextStore: new PostgresPersonalContextStore(db),
    auditLog: new PostgresAuditLog(db),
    temporalMemoryJobStore: new PostgresTemporalMemoryJobStore(db),
    close: () => pool.end(),
  };
}
