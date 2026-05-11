create table if not exists notification_intents (
  id text primary key,
  tenant_id text not null,
  elder_id text not null,
  family_user_id text,
  type text not null,
  status text not null,
  title text not null,
  payload_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists notification_intents_tenant_elder_created_idx
  on notification_intents (tenant_id, elder_id, created_at desc);
