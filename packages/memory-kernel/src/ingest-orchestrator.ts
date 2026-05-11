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
    const startedAt = Date.now();
    const timings: Record<string, unknown> = {};
    try {
      const baseContextStartedAt = Date.now();
      const baseContext = await this.deps.personalContextStore.buildContext({
        elderId: source.elderId,
        tenantId: source.tenantId,
        queryText: source.transcript,
      });
      timings.baseContextMs = Date.now() - baseContextStartedAt;

      const semanticCandidatesStartedAt = Date.now();
      const context = await this.buildIngestContextWithSemanticCandidates(source, baseContext, traceId);
      timings.semanticCandidatesMs = Date.now() - semanticCandidatesStartedAt;

      const generateMemoryPlanStartedAt = Date.now();
      const rawPlan = await this.deps.modelGateway.generateMemoryPlan({
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        transcript: source.transcript,
        createdAt: source.createdAt,
        context,
      });
      timings.generateMemoryPlanMs = Date.now() - generateMemoryPlanStartedAt;

      const schemaValidationStartedAt = Date.now();
      const validatedPlan = MemoryPlanSchema.parse({
        ...rawPlan,
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
      });
      timings.schemaValidationMs = Date.now() - schemaValidationStartedAt;

      const riskGuardStartedAt = Date.now();
      const riskGuardedPlan = await this.deps.riskEngine.enforce(validatedPlan);
      timings.riskGuardMs = Date.now() - riskGuardStartedAt;

      const permissionStartedAt = Date.now();
      const permissionedPlan = await this.deps.permissionEngine.applyDefaultVisibility(
        riskGuardedPlan,
        source.elderId,
      );
      timings.permissionMs = Date.now() - permissionStartedAt;

      const applyPlanStartedAt = Date.now();
      const applied = await this.planApplier.apply(permissionedPlan, context, traceId);
      timings.applyPlanMs = Date.now() - applyPlanStartedAt;
      timings.applyPlan = applied.timings;

      const temporalWriteStartedAt = Date.now();
      const temporalMemory = await this.temporalWriter.write(source, applied, traceId);
      timings.temporalWriteMs = Date.now() - temporalWriteStartedAt;
      timings.totalMs = Date.now() - startedAt;

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
          timings,
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
      timings.totalMs = Date.now() - startedAt;
      await this.deps.auditLog.record({
        type: "memory_ingest_failed",
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        traceId,
        payload: {
          traceId,
          timings,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async buildIngestContextWithSemanticCandidates(source: MemorySource, context: PersonalContext, traceId: string): Promise<PersonalContext> {
    const semanticResults = await this.searchSemanticCandidates(source, traceId);
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

  private async searchSemanticCandidates(source: MemorySource, traceId: string) {
    try {
      return await this.deps.semanticMemory.searchMemory({
        tenantId: source.tenantId,
        elderId: source.elderId,
        query: source.transcript,
        limit: 8,
      });
    } catch (error) {
      await this.deps.auditLog.record({
        type: "semantic_candidate_search_failed",
        tenantId: source.tenantId,
        elderId: source.elderId,
        sourceId: source.id,
        traceId,
        payload: {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }
}
