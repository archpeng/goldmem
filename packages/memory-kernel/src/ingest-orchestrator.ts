import { MemoryPlanSchema, type MemorySource, type PersonalContext } from "@goldmem/memory-schema";
import { isString } from "./guards.js";
import { MemoryPlanApplier } from "./ingest-plan-applier.js";
import { IngestTemporalWriter } from "./ingest-temporal-writer.js";
import type { ElderMemoryKernelDeps, IngestResult } from "./index.js";

export class IngestOrchestrator {
  private readonly planApplier: MemoryPlanApplier;
  private readonly temporalWriter: IngestTemporalWriter;

  constructor(private readonly deps: ElderMemoryKernelDeps) {
    this.planApplier = new MemoryPlanApplier(deps);
    this.temporalWriter = new IngestTemporalWriter(deps);
  }

  async ingestSource(source: MemorySource, traceId: string): Promise<IngestResult> {
    try {
      const baseContext = await this.deps.personalContextStore.buildContext({
        elderId: source.elderId,
        tenantId: source.tenantId,
        queryText: source.transcript,
      });
      const context = await this.buildIngestContextWithSemanticCandidates(source, baseContext);

      const rawPlan = await this.deps.modelGateway.generateMemoryPlan({
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        transcript: source.transcript,
        createdAt: source.createdAt,
        context,
      });

      const validatedPlan = MemoryPlanSchema.parse({
        ...rawPlan,
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
      });
      const riskGuardedPlan = await this.deps.riskEngine.enforce(validatedPlan);
      const permissionedPlan = await this.deps.permissionEngine.applyDefaultVisibility(
        riskGuardedPlan,
        source.elderId,
      );

      const applied = await this.planApplier.apply(permissionedPlan, context, traceId);
      const temporalMemory = await this.temporalWriter.write(source, applied, traceId);

      await this.deps.auditLog.record({
        type: "memory_ingest",
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        traceId,
        payload: {
          traceId,
          plan: permissionedPlan,
          result: {
            eventIds: applied.events.map((event) => event.id),
            reminderIds: applied.reminderCandidates.map((reminder) => reminder.id),
            contextLinkIds: applied.contextLinks.map((link) => link.id),
            riskFlagIds: applied.riskFlags.map((riskFlag) => riskFlag.id),
            temporalMemory,
          },
        },
      });

      return {
        traceId,
        sourceId: source.id,
        summary: permissionedPlan.summary,
        events: applied.events,
        reminderCandidates: applied.reminderCandidates,
        elderFacingCards: applied.events.map((event) => ({
          title: event.title,
          summary: event.summary,
          needsConfirmation: event.requiresConfirmation,
          riskLevel: event.riskLevel,
        })),
        temporalMemory,
      };
    } catch (error) {
      await this.deps.auditLog.record({
        type: "memory_ingest_failed",
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        traceId,
        payload: {
          traceId,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async buildIngestContextWithSemanticCandidates(source: MemorySource, context: PersonalContext): Promise<PersonalContext> {
    const semanticResults = await this.deps.semanticMemory.searchMemory({
      tenantId: source.tenantId,
      elderId: source.elderId,
      query: source.transcript,
      limit: 8,
    });
    const candidateIds = [
      ...new Set(
        semanticResults
          .map((result) => result.metadata?.eventId)
          .filter(isString),
      ),
    ].slice(0, 8);
    if (candidateIds.length === 0) return { ...context, semanticCandidateEvents: [] };

    const eventsById = new Map(
      (await this.deps.eventStore.getByIds({ tenantId: source.tenantId, eventIds: candidateIds }))
        .map((event) => [event.id, event]),
    );
    const candidates = semanticResults.flatMap((result) => {
      const eventId = result.metadata?.eventId;
      if (!isString(eventId)) return [];
      const event = eventsById.get(eventId);
      if (!event || event.elderId !== source.elderId || event.tenantId !== source.tenantId) return [];
      return [
        {
          eventId: event.id,
          sourceId: event.sourceId,
          title: event.title,
          summary: event.summary,
          createdAt: event.createdAt,
          score: result.score,
        },
      ];
    });

    const uniqueCandidates = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      if (!uniqueCandidates.has(candidate.eventId)) uniqueCandidates.set(candidate.eventId, candidate);
    }

    return {
      ...context,
      semanticCandidateEvents: [...uniqueCandidates.values()].slice(0, 5),
    };
  }
}
