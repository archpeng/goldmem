import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import type { MemorySource } from "@goldmem/memory-schema";
import type { CreateSourceInput, SourceStore } from "./index.js";
import { mapSource } from "./postgres-mappers.js";
import * as schema from "./postgres-schema.js";
import type { Db, PostgresStoreOptions } from "./postgres-types.js";

export class PostgresSourceStore implements SourceStore {
  constructor(
    private readonly db: Db,
    private readonly options: PostgresStoreOptions,
  ) {}

  async saveAudio(audio: Uint8Array): Promise<string> {
    const audioDir = this.options.audioDir ?? ".goldmem/audio";
    await mkdir(audioDir, { recursive: true });
    const filename = `${randomUUID()}.wav`;
    await writeFile(join(audioDir, filename), audio);
    const baseUrl = this.options.publicAudioBaseUrl ?? "file://.goldmem/audio";
    return `${baseUrl.replace(/\/$/, "")}/${filename}`;
  }

  async create(input: CreateSourceInput): Promise<MemorySource> {
    const source: MemorySource = {
      ...input,
      id: randomUUID(),
    };

    await this.db.insert(schema.memorySources).values({
      id: source.id,
      tenantId: source.tenantId,
      elderId: source.elderId,
      type: source.type,
      audioUrl: source.audioUrl,
      transcript: source.transcript,
      asrConfidence: source.asrConfidence,
      createdAt: new Date(source.createdAt),
      localCreatedAt: source.localCreatedAt ? new Date(source.localCreatedAt) : null,
      deviceId: source.deviceId,
      metadata: source.metadata,
    });

    return source;
  }

  async get(input: { tenantId: string; sourceId: string }): Promise<MemorySource | null> {
    const [row] = await this.db.select().from(schema.memorySources).where(
      and(eq(schema.memorySources.tenantId, input.tenantId), eq(schema.memorySources.id, input.sourceId)),
    ).limit(1);
    return row ? mapSource(row) : null;
  }
}
