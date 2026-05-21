import type { DebugTrace } from "@mem/memory-schema";

export type RedactedDebugTraceDto = {
  traceId: string;
  source?: {
    id: string;
    tenantId: string;
    elderId: string;
    type: string;
    createdAt: string;
    localCreatedAt?: string;
    asrConfidence?: number;
    contentRedacted: true;
    audioRedacted: boolean;
    metadata?: {
      language?: string;
      appVersion?: string;
      timezone?: string;
      clientTurnId?: string;
    };
  };
  planSummary?: RedactedMemoryPlanSummary;
  guardrailSummary?: RedactedValueSummary;
  postgresWriteSummary?: RedactedValueSummary;
  semanticSummary?: RedactedValueSummary;
  graphitiSummary?: RedactedValueSummary;
  evidenceMergeSummary?: RedactedValueSummary;
  finalAnswerSummary?: RedactedValueSummary;
  queryDiagnostics?: {
    retrieval?: Record<string, number>;
    timings?: Record<string, unknown>;
  };
  auditTrail: RedactedAuditRecord[];
};

type RedactedMemoryPlanSummary = {
  present: true;
  eventCount?: number;
  reminderCandidateCount?: number;
  riskFlagCount?: number;
  familyTaskCount?: number;
  contextLinkCount?: number;
  relationSignalCount?: number;
  uncertaintyCount?: number;
};

type RedactedValueSummary = {
  kind: "missing" | "object" | "array" | "string" | "number" | "boolean";
  keyCount?: number;
  itemCount?: number;
};

type RedactedAuditRecord = {
  id: string;
  tenantId: string;
  elderId: string;
  sourceId?: string;
  traceId?: string;
  type: string;
  createdAt: string;
  payloadSummary: RedactedValueSummary;
};

export function redactDebugTrace(trace: DebugTrace): RedactedDebugTraceDto {
  return {
    traceId: trace.traceId,
    source: redactDebugSource(trace.source),
    planSummary: summarizeMemoryPlan(trace.memoryPlan),
    guardrailSummary: summarizeValue(trace.guardrails),
    postgresWriteSummary: summarizeValue(trace.postgresWrites),
    semanticSummary: summarizeValue(trace.semanticWritesOrCandidates),
    graphitiSummary: summarizeValue(trace.graphitiEpisodesOrFacts),
    evidenceMergeSummary: summarizeValue(trace.evidenceMerge),
    finalAnswerSummary: summarizeValue(trace.finalAnswer),
    queryDiagnostics: redactQueryDiagnostics(trace),
    auditTrail: trace.auditTrail.map((record) => ({
      id: record.id,
      tenantId: record.tenantId,
      elderId: record.elderId,
      sourceId: record.sourceId,
      traceId: record.traceId,
      type: record.type,
      createdAt: record.createdAt,
      payloadSummary: summarizeValue(record.payload) ?? { kind: "missing" },
    })),
  };
}

function redactQueryDiagnostics(trace: DebugTrace): RedactedDebugTraceDto["queryDiagnostics"] | undefined {
  const queryPayload = latestAuditPayload(trace, "memory_query");
  const retrieval = numericRecord(readRecord(queryPayload?.retrieval));
  const timings = readRecord(queryPayload?.timings);
  if (!retrieval && Object.keys(timings).length === 0) return undefined;
  return {
    retrieval,
    timings: Object.keys(timings).length > 0 ? timings : undefined,
  };
}

function redactDebugSource(source: DebugTrace["source"]): RedactedDebugTraceDto["source"] | undefined {
  if (!source) return undefined;
  return {
    id: source.id,
    tenantId: source.tenantId,
    elderId: source.elderId,
    type: source.type,
    createdAt: source.createdAt,
    localCreatedAt: source.localCreatedAt,
    asrConfidence: source.asrConfidence,
    contentRedacted: true,
    audioRedacted: Boolean(source.audioUrl),
    metadata: source.metadata ? {
      language: source.metadata.language,
      appVersion: source.metadata.appVersion,
      timezone: source.metadata.timezone,
      clientTurnId: source.metadata.clientTurnId,
    } : undefined,
  };
}

function summarizeMemoryPlan(value: unknown): RedactedMemoryPlanSummary | undefined {
  if (!value) return undefined;
  const plan = readRecord(value);
  return {
    present: true,
    eventCount: countArray(plan.events),
    reminderCandidateCount: countArray(plan.reminderCandidates),
    riskFlagCount: countArray(plan.riskFlags),
    familyTaskCount: countArray(plan.familyTasks),
    contextLinkCount: countArray(plan.contextLinks),
    relationSignalCount: countArray(plan.relationEnrichmentSignals),
    uncertaintyCount: countArray(plan.uncertainties),
  };
}

function summarizeValue(value: unknown): RedactedValueSummary | undefined {
  if (value === undefined) return undefined;
  if (value === null) return { kind: "missing" };
  if (Array.isArray(value)) return { kind: "array", itemCount: value.length };
  if (typeof value === "object") return { kind: "object", keyCount: Object.keys(value).length };
  if (typeof value === "string") return { kind: "string" };
  if (typeof value === "number") return { kind: "number" };
  if (typeof value === "boolean") return { kind: "boolean" };
  return { kind: "missing" };
}

function countArray(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function latestAuditPayload(trace: DebugTrace, type: string): Record<string, unknown> | undefined {
  const record = trace.auditTrail.filter((item) => item.type === type).at(-1);
  return readRecord(record?.payload);
}

function numericRecord(value: Record<string, unknown>): Record<string, number> | undefined {
  const entries = Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
