import type { AuditLog, MemoryRecallResult, SemanticMemoryStore } from "@mem/memory-store";
import type { ModelGateway } from "@mem/model-gateway";
import { consumeProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";

export async function searchSemanticMemorySafely(input: {
  semanticMemory: SemanticMemoryStore;
  modelGateway: ModelGateway;
  auditLog: AuditLog;
  tenantId: string;
  elderId: string;
  query: string;
  traceId: string;
}): Promise<MemoryRecallResult[]> {
  try {
    const embedding = await input.modelGateway.embedText({ text: input.query });
    return await input.semanticMemory.searchMemory({
      tenantId: input.tenantId,
      elderId: input.elderId,
      query: input.query,
      embedding,
      limit: 10,
    });
  } catch (error) {
    await input.auditLog.record({
      type: "semantic_memory_search_failed",
      tenantId: input.tenantId,
      elderId: input.elderId,
      traceId: input.traceId,
      payload: {
        traceId: input.traceId,
        query: input.query,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        modelGateway: modelGatewayErrorPayload(error),
        providerTimings: consumeProviderTimings(input.modelGateway),
      },
    });
    return [];
  }
}
