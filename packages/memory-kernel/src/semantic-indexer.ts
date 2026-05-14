import type { MemoryEvent } from "@mem/memory-schema";
import type { ElderMemoryKernelDeps } from "./index.js";
import { consumeProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";

export class SemanticIndexer {
  constructor(private readonly deps: ElderMemoryKernelDeps) {}

  async indexEvent(event: MemoryEvent, traceId?: string): Promise<void> {
    const memory = [
      `Title: ${event.title}`,
      `Summary: ${event.summary}`,
      `Type: ${event.type}`,
      `Risk: ${event.riskLevel}`,
      `Source: ${event.sourceId}`,
    ].join("\n");
    const metadata = {
      tenantId: event.tenantId,
      elderId: event.elderId,
      sourceId: event.sourceId,
      eventId: event.id,
      eventType: event.type,
      title: event.title,
      summary: event.summary,
      createdAt: event.createdAt,
      riskLevel: event.riskLevel,
      requiresConfirmation: event.requiresConfirmation,
      visibility: event.visibility,
      traceId,
    };

    try {
      const embedding = await this.deps.modelGateway.embedText({ text: memory });
      await this.deps.semanticMemory.addMemory({
        tenantId: event.tenantId,
        elderId: event.elderId,
        memory,
        embedding,
        metadata,
      });
    } catch (error) {
      await this.deps.auditLog.record({
        type: "semantic_memory_write_failed",
        tenantId: event.tenantId,
        elderId: event.elderId,
        sourceId: event.sourceId,
        traceId,
        payload: {
          traceId,
          metadata,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          modelGateway: modelGatewayErrorPayload(error),
          providerTimings: consumeProviderTimings(this.deps.modelGateway),
        },
      });
      throw error;
    }
  }
}
