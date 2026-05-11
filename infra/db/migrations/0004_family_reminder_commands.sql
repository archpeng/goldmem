CREATE TABLE IF NOT EXISTS family_reminder_commands (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  elder_id text NOT NULL,
  idempotency_key text NOT NULL,
  source_id text NOT NULL,
  reminder_id text NOT NULL,
  request_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_family_reminder_commands_idempotency
ON family_reminder_commands (tenant_id, elder_id, idempotency_key);
