create table if not exists memory_processing_jobs (
  id text primary key,
  type text not null,
  tenant_id text not null,
  elder_id text not null,
  source_id text,
  event_id text,
  trace_id text,
  status text not null,
  attempts real not null default 0,
  max_attempts real not null default 5,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memory_processing_jobs_due_idx
  on memory_processing_jobs (status, next_run_at, created_at);

create index if not exists memory_processing_jobs_source_idx
  on memory_processing_jobs (tenant_id, source_id, type, created_at desc);

create index if not exists memory_processing_jobs_event_idx
  on memory_processing_jobs (tenant_id, event_id, type, created_at desc);
