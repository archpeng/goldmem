CREATE UNIQUE INDEX IF NOT EXISTS memory_sources_client_turn_unique
ON memory_sources (tenant_id, elder_id, ((metadata->>'clientTurnId')))
WHERE metadata->>'clientTurnId' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS memory_processing_jobs_ingest_source_unique
ON memory_processing_jobs (tenant_id, source_id, type)
WHERE source_id IS NOT NULL AND type = 'ingest_source';
