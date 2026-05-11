CREATE TABLE IF NOT EXISTS temporal_memory_jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  elder_id text NOT NULL,
  source_id text NOT NULL,
  status text NOT NULL,
  attempts real NOT NULL DEFAULT 0,
  max_attempts real NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  episode_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_temporal_jobs_due
ON temporal_memory_jobs (status, next_run_at, created_at);

CREATE INDEX IF NOT EXISTS idx_temporal_jobs_tenant_source
ON temporal_memory_jobs (tenant_id, elder_id, source_id);

CREATE TABLE IF NOT EXISTS graphiti_episode_provenance (
  id text PRIMARY KEY,
  group_id text NOT NULL,
  tenant_id text NOT NULL,
  elder_id text NOT NULL,
  episode_name text NOT NULL,
  source_ids jsonb NOT NULL,
  event_ids jsonb NOT NULL,
  metadata_json jsonb NOT NULL,
  body_text text NOT NULL,
  body_hash text NOT NULL,
  reference_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_graphiti_provenance_episode_name
ON graphiti_episode_provenance (episode_name);

CREATE INDEX IF NOT EXISTS idx_graphiti_provenance_group
ON graphiti_episode_provenance (group_id, reference_time DESC);
