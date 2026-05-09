CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS elder_profiles (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  display_name text NOT NULL,
  timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_links (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  family_user_id text NOT NULL,
  relationship text NOT NULL,
  permission_level text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_sources (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  type text NOT NULL,
  audio_url text,
  transcript text NOT NULL,
  asr_confidence real,
  created_at timestamptz NOT NULL,
  local_created_at timestamptz,
  device_id text,
  metadata jsonb
);

CREATE TABLE IF NOT EXISTS memory_events (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  source_id text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  time_text text,
  event_time_start timestamptz,
  event_time_end timestamptz,
  time_confidence real NOT NULL,
  entities jsonb NOT NULL,
  importance real NOT NULL,
  confidence real NOT NULL,
  risk_level text NOT NULL,
  requires_confirmation boolean NOT NULL,
  visibility text NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_entities (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  type text NOT NULL,
  name text NOT NULL,
  aliases jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_event_entities (
  event_id text NOT NULL,
  entity_id text NOT NULL,
  relation text NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  source_id text NOT NULL,
  event_id text,
  title text NOT NULL,
  description text,
  remind_at timestamptz,
  status text NOT NULL,
  confirmation_required boolean NOT NULL,
  confidence real NOT NULL,
  reason text NOT NULL,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_flags (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  source_id text NOT NULL,
  event_id text,
  type text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  reason text NOT NULL,
  requires_family_review boolean NOT NULL,
  requires_human_confirmation boolean NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_tasks (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  family_user_id text,
  type text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL,
  visibility text NOT NULL,
  urgency text NOT NULL,
  related_event_id text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  source_id text,
  event_id text,
  actor_user_id text NOT NULL,
  feedback_type text NOT NULL,
  correction_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  source_id text,
  type text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
