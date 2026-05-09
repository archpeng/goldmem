CREATE TABLE IF NOT EXISTS memory_context_links (
  id text PRIMARY KEY,
  elder_id text NOT NULL,
  from_event_id text NOT NULL,
  to_event_id text NOT NULL,
  reminder_id text,
  type text NOT NULL,
  status text NOT NULL,
  confidence real NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_context_links_elder_id_idx
  ON memory_context_links (elder_id);

CREATE INDEX IF NOT EXISTS memory_context_links_from_event_id_idx
  ON memory_context_links (from_event_id);

CREATE INDEX IF NOT EXISTS memory_context_links_to_event_id_idx
  ON memory_context_links (to_event_id);
