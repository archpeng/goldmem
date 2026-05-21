import {
  DEFAULT_TENANT_ID,
  ParsedMemoryQuerySchema,
  type ParsedMemoryQuery,
} from "@mem/memory-schema";
import { appendProviderTimings } from "./model-gateway-timings.js";
import { mergeEvidence } from "./retrieval.js";
import { alignSemanticEvidence, searchSemanticMemorySafely } from "./query-semantic.js";
import { alignTemporalEvidence, searchTemporalFactsSafely } from "./query-temporal-evidence.js";
import {
  assessEvidenceCoverage,
  mergeEventsById,
  shouldUsePostgresCoverageFallback,
  type EvidenceCoverage,
} from "./query-evidence-coverage.js";
import type { ElderMemoryKernelDeps, QueryMemoryInput } from "./index.js";
import type { RetrievedEvidence } from "@mem/model-gateway";

const STRUCTURED_RECALL_LIMIT = 30;

export type QueryRetrievalDiagnostics = {
  postgresCount: number;
  postgresFallbackUsed: boolean;
  postgresFallbackCount: number;
  semanticCount: number;
  semanticCandidateLinkedCount: number;
  semanticAlignedCount: number;
  semanticUnalignedCount: number;
  semanticEvidenceCount: number;
  graphitiCount: number;
  graphitiAlignedCount: number;
  graphitiRawCount: number;
  graphitiRawAlignedCount: number;
  graphitiRawUnalignedCount: number;
  graphitiRawEvidenceCount: number;
  graphitiRawDroppedByRankCount: number;
  graphitiProvenanceCount: number;
  graphitiProvenanceAlignedCount: number;
  graphitiProvenanceUnalignedCount: number;
  graphitiProvenanceEvidenceCount: number;
  graphitiProvenanceDroppedByRankCount: number;
  contextLinkCount: number;
  evidenceCount: number;
  evidenceCoverageRequired: boolean;
  evidenceCoveragePassed: boolean;
  evidenceCoverageRequiredTerms: string[];
  evidenceCoverageMatchedTerms: string[];
};

export type QueryRecallResult = {
  parsedQuery: ParsedMemoryQuery;
  evidence: RetrievedEvidence[];
  evidenceCoverage: EvidenceCoverage;
  retrieval: QueryRetrievalDiagnostics;
  timings: Record<string, unknown>;
};

export async function collectQueryRecall(
  deps: ElderMemoryKernelDeps,
  input: QueryMemoryInput,
  traceId: string,
  now: string,
): Promise<QueryRecallResult> {
  const timings: Record<string, unknown> = {};
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;

  const contextStartedAt = Date.now();
  const context = await deps.personalContextStore.buildContext({
    tenantId,
    elderId: input.elderId,
    queryText: input.query,
  });
  timings.buildContextMs = Date.now() - contextStartedAt;

  const parseQueryStartedAt = Date.now();
  const parsedQuery = ParsedMemoryQuerySchema.parse(await deps.modelGateway.parseMemoryQuery({
    tenantId,
    elderId: input.elderId,
    query: input.query,
    now,
    context,
  }));
  timings.parseQueryMs = Date.now() - parseQueryStartedAt;
  appendProviderTimings(timings, deps.modelGateway);

  const postgresSearchStartedAt = Date.now();
  let structuredEvents = await deps.eventStore.search({
    tenantId,
    elderId: input.elderId,
    query: input.query,
    types: parsedQuery.eventTypes,
    timeRange: parsedQuery.timeRange,
    entityNames: parsedQuery.entities.map((entity) => entity.name),
    limit: STRUCTURED_RECALL_LIMIT,
  });
  timings.postgresSearchMs = Date.now() - postgresSearchStartedAt;

  const semanticSearchStartedAt = Date.now();
  const semanticResults = await searchSemanticMemorySafely({
    semanticMemory: deps.semanticMemory,
    modelGateway: deps.modelGateway,
    auditLog: deps.auditLog,
    tenantId,
    elderId: input.elderId,
    query: input.query,
    traceId,
  });
  timings.semanticSearchMs = Date.now() - semanticSearchStartedAt;
  appendProviderTimings(timings, deps.modelGateway);

  const semanticAlignStartedAt = Date.now();
  const alignedSemantic = await alignSemanticEvidence({
    sourceStore: deps.sourceStore,
    eventStore: deps.eventStore,
    tenantId,
    elderId: input.elderId,
    semanticResults,
  });
  timings.semanticAlignMs = Date.now() - semanticAlignStartedAt;

  const temporalSearchStartedAt = Date.now();
  const temporalResults = await searchTemporalFactsSafely({
    temporalMemory: deps.temporalMemory,
    auditLog: deps.auditLog,
    tenantId,
    elderId: input.elderId,
    query: input.query,
    parsedQuery,
    traceId,
  });
  timings.temporalSearchMs = Date.now() - temporalSearchStartedAt;

  const temporalAlignStartedAt = Date.now();
  const alignedTemporalResults = await alignTemporalEvidence({
    sourceStore: deps.sourceStore,
    eventStore: deps.eventStore,
    tenantId,
    elderId: input.elderId,
    temporalResults,
  });
  timings.temporalAlignMs = Date.now() - temporalAlignStartedAt;

  let postgresFallbackUsed = false;
  let postgresFallbackCount = 0;
  const mergeEvidenceStartedAt = Date.now();
  let evidence = mergeEvidence(structuredEvents, alignedSemantic.evidence, alignedTemporalResults, parsedQuery, input.query, now);
  timings.mergeEvidenceMs = Date.now() - mergeEvidenceStartedAt;
  let evidenceCoverage = assessEvidenceCoverage(evidence, parsedQuery, input.query);

  if (shouldUsePostgresCoverageFallback(evidenceCoverage)) {
    const postgresFallbackSearchStartedAt = Date.now();
    const fallbackEvents = await deps.eventStore.search({
      tenantId,
      elderId: input.elderId,
      query: input.query,
      limit: STRUCTURED_RECALL_LIMIT,
    });
    timings.postgresFallbackSearchMs = Date.now() - postgresFallbackSearchStartedAt;
    postgresFallbackUsed = true;
    postgresFallbackCount = fallbackEvents.length;
    structuredEvents = mergeEventsById([...structuredEvents, ...fallbackEvents]);

    const fallbackMergeStartedAt = Date.now();
    evidence = mergeEvidence(structuredEvents, alignedSemantic.evidence, alignedTemporalResults, parsedQuery, input.query, now);
    timings.mergeEvidenceAfterFallbackMs = Date.now() - fallbackMergeStartedAt;
    evidenceCoverage = assessEvidenceCoverage(evidence, parsedQuery, input.query);
  }

  const graphitiRawCount = temporalResults.filter((result) => result.origin === "graphiti_raw").length;
  const graphitiRawAlignedCount = alignedTemporalResults.filter((result) => result.origin === "graphiti_raw").length;
  const graphitiRawEvidenceCount = evidence.filter((item) => item.retrievalSource === "graphiti").length;
  const graphitiProvenanceCount = temporalResults.filter((result) => result.origin === "provenance_fallback").length;
  const graphitiProvenanceAlignedCount = alignedTemporalResults.filter((result) => result.origin === "provenance_fallback").length;
  const graphitiProvenanceEvidenceCount = evidence.filter((item) => item.retrievalSource === "graphiti_provenance").length;

  return {
    parsedQuery,
    evidence,
    evidenceCoverage,
    retrieval: {
      postgresCount: structuredEvents.length,
      postgresFallbackUsed,
      postgresFallbackCount,
      semanticCount: semanticResults.length,
      semanticCandidateLinkedCount: alignedSemantic.candidateLinkedCount,
      semanticAlignedCount: alignedSemantic.alignedCount,
      semanticUnalignedCount: alignedSemantic.unalignedCount,
      semanticEvidenceCount: evidence.filter((item) => item.retrievalSource === "semantic").length,
      graphitiCount: temporalResults.length,
      graphitiAlignedCount: alignedTemporalResults.length,
      graphitiRawCount,
      graphitiRawAlignedCount,
      graphitiRawUnalignedCount: Math.max(0, graphitiRawCount - graphitiRawAlignedCount),
      graphitiRawEvidenceCount,
      graphitiRawDroppedByRankCount: Math.max(0, graphitiRawAlignedCount - graphitiRawEvidenceCount),
      graphitiProvenanceCount,
      graphitiProvenanceAlignedCount,
      graphitiProvenanceUnalignedCount: Math.max(0, graphitiProvenanceCount - graphitiProvenanceAlignedCount),
      graphitiProvenanceEvidenceCount,
      graphitiProvenanceDroppedByRankCount: Math.max(0, graphitiProvenanceAlignedCount - graphitiProvenanceEvidenceCount),
      contextLinkCount: 0,
      evidenceCount: evidence.length,
      evidenceCoverageRequired: evidenceCoverage.required,
      evidenceCoveragePassed: evidenceCoverage.passed,
      evidenceCoverageRequiredTerms: evidenceCoverage.requiredTerms,
      evidenceCoverageMatchedTerms: evidenceCoverage.matchedTerms,
    },
    timings,
  };
}
