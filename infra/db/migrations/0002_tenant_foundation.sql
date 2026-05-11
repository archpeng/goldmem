ALTER TABLE elder_profiles ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE family_links ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE memory_sources ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE memory_events ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE memory_entities ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE memory_event_entities ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE risk_flags ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE family_tasks ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE memory_context_links ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenant-mvp';

CREATE INDEX IF NOT EXISTS idx_sources_tenant_elder_time
ON memory_sources (tenant_id, elder_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_tenant_elder_time
ON memory_events (tenant_id, elder_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant_elder_status
ON reminders (tenant_id, elder_id, status, remind_at);

CREATE INDEX IF NOT EXISTS idx_context_links_tenant_elder_time
ON memory_context_links (tenant_id, elder_id, created_at DESC);
