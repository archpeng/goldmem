import type { SemanticMemoryStore } from "./index.js";

export type HttpAdapterOptions = {
  baseUrl: string;
  apiKey?: string;
};

export class HttpSemanticMemoryStore implements SemanticMemoryStore {
  constructor(private readonly options: HttpAdapterOptions) {}

  async addMemory(input: { userId: string; memory: string; metadata?: Record<string, unknown> }): Promise<void> {
    await request(this.options, "/memories", {
      method: "POST",
      body: JSON.stringify({
        user_id: input.userId,
        messages: [{ role: "user", content: input.memory }],
        metadata: input.metadata,
        infer: false,
      }),
    });
  }

  async searchMemory(input: {
    userId: string;
    query: string;
    limit?: number;
  }): Promise<Array<{ memory: string; score?: number; metadata?: Record<string, unknown> }>> {
    const result = await request(this.options, "/search", {
      method: "POST",
      body: JSON.stringify({
        user_id: input.userId,
        query: input.query,
        limit: input.limit,
      }),
    });
    return normalizeMem0SearchResult(result);
  }
}

async function request(options: HttpAdapterOptions, path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
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
): Array<{ memory: string; score?: number; metadata?: Record<string, unknown> }> {
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
    return [{ memory, score, metadata }];
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
