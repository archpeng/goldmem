import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { MemoryRecallResult, SemanticMemoryStore } from "./index.js";

const EMBEDDING_DIMENSIONS = 1536;

export class PostgresSemanticMemoryStore implements SemanticMemoryStore {
  constructor(private readonly pool: Pool) {}

  async addMemory(input: {
    tenantId: string;
    elderId: string;
    memory: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    assertEmbedding(input.embedding);
    const metadata: Record<string, unknown> = {
      ...input.metadata,
      tenantId: input.tenantId,
      elderId: input.elderId,
    };
    await this.pool.query(
      `
        insert into semantic_memories (
          id,
          tenant_id,
          elder_id,
          source_id,
          event_id,
          memory,
          metadata_json,
          embedding
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::vector)
      `,
      [
        randomUUID(),
        input.tenantId,
        input.elderId,
        stringValue(metadata.sourceId),
        stringValue(metadata.eventId),
        input.memory,
        JSON.stringify(metadata),
        vectorLiteral(input.embedding),
      ],
    );
  }

  async searchMemory(input: {
    tenantId: string;
    elderId: string;
    query: string;
    embedding: number[];
    limit?: number;
  }): Promise<MemoryRecallResult[]> {
    assertEmbedding(input.embedding);
    const result = await this.pool.query<{
      memory: string;
      metadata_json: Record<string, unknown> | null;
      score: number;
    }>(
      `
        select
          memory,
          metadata_json,
          1 - (embedding <=> $3::vector) as score
        from semantic_memories
        where tenant_id = $1 and elder_id = $2
        order by embedding <=> $3::vector
        limit $4
      `,
      [input.tenantId, input.elderId, vectorLiteral(input.embedding), input.limit ?? 10],
    );

    return result.rows.map((row) => ({
      memory: row.memory,
      score: row.score,
      metadata: row.metadata_json ?? undefined,
    }));
  }
}

function assertEmbedding(value: number[]): void {
  if (value.length !== EMBEDDING_DIMENSIONS || value.some((item) => !Number.isFinite(item))) {
    throw new Error(`Semantic embedding must be ${EMBEDDING_DIMENSIONS} finite numbers`);
  }
}

function vectorLiteral(value: number[]): string {
  return `[${value.join(",")}]`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
