import type { MemoryRecallResult, SemanticMemoryStore } from "./index.js";

export type HttpAdapterOptions = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
};

export class HttpMem0RecallStore implements SemanticMemoryStore {
  constructor(private readonly options: HttpAdapterOptions) {}

  async addMemory(input: { tenantId: string; elderId: string; memory: string; metadata?: Record<string, unknown> }): Promise<void> {
    await request(this.options, "/memories", {
      method: "POST",
      body: JSON.stringify({
        user_id: buildTenantUserId(input),
        messages: [{ role: "user", content: input.memory }],
        metadata: {
          ...input.metadata,
          tenantId: input.tenantId,
          elderId: input.elderId,
        },
        infer: false,
      }),
    });
  }

  async searchMemory(input: {
    tenantId: string;
    elderId: string;
    query: string;
    limit?: number;
  }): Promise<MemoryRecallResult[]> {
    const result = await request(this.options, "/search", {
      method: "POST",
      body: JSON.stringify({
        user_id: buildTenantUserId(input),
        query: input.query,
        limit: input.limit,
      }),
    });
    return normalizeMem0SearchResult(result);
  }
}

export class HttpSemanticMemoryStore extends HttpMem0RecallStore {}

export function buildTenantUserId(input: { tenantId: string; elderId: string }): string {
  return `${input.tenantId}:${input.elderId}`;
}

async function request(options: HttpAdapterOptions, path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(options.timeoutMs ?? 5_000),
    headers: {
      "content-type": "application/json",
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}`, "x-api-key": options.apiKey } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP memory adapter failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) return undefined;
  return response.json();
}

function normalizeMem0SearchResult(
  result: unknown,
): MemoryRecallResult[] {
  const items = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.results)
      ? result.results
      : isRecord(result) && Array.isArray(result.memories)
        ? result.memories
        : [];

  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const memory = stringValue(item.memory ?? item.text ?? item.content);
    if (!memory) return [];
    const score = numberValue(item.score);
    const metadata = isRecord(item.metadata) ? item.metadata : undefined;
    const retrievalSignals = retrievalSignalsValue(item);
    const entities = stringArrayValue(item.entities ?? item.entity_names ?? item.entityNames);
    const relations = Array.isArray(item.relations) ? item.relations : undefined;
    const providerId = stringValue(item.id ?? item.memory_id ?? item.memoryId);
    return [
      {
        memory,
        score,
        metadata,
        provider: "mem0",
        providerId,
        retrievalSignals,
        entities,
        relations,
        raw: item,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length ? strings : undefined;
}

function retrievalSignalsValue(item: Record<string, unknown>): MemoryRecallResult["retrievalSignals"] | undefined {
  const signals = {
    semanticScore: numberValue(item.semantic_score ?? item.semanticScore ?? item.vector_score ?? item.vectorScore),
    keywordScore: numberValue(item.keyword_score ?? item.keywordScore ?? item.bm25_score ?? item.bm25Score),
    entityScore: numberValue(item.entity_score ?? item.entityScore),
    rerankScore: numberValue(item.rerank_score ?? item.rerankScore),
  };
  return Object.values(signals).some((value) => value !== undefined) ? signals : undefined;
}
