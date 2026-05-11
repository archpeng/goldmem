CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS semantic_memories (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  elder_id text NOT NULL,
  source_id text,
  event_id text,
  memory text NOT NULL,
  metadata_json jsonb NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS semantic_memories_tenant_elder_created_idx
  ON semantic_memories (tenant_id, elder_id, created_at DESC);

CREATE INDEX IF NOT EXISTS semantic_memories_embedding_hnsw_idx
  ON semantic_memories USING hnsw (embedding vector_cosine_ops);
