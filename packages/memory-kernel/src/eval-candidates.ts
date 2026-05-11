export type EvalCandidateAuditInput = {
  id: string;
  tenantId: string;
  elderId: string;
  sourceId?: string | null;
  type: string;
  payload: unknown;
  createdAt: string;
};

export type EvalCandidateFeedbackInput = {
  id: string;
  tenantId: string;
  elderId: string;
  sourceId?: string | null;
  eventId?: string | null;
  actorUserId: string;
  feedbackType: string;
  correction: unknown;
  createdAt: string;
};

export type EvalCandidate = {
  id: string;
  tenantId: string;
  elderId: string;
  traceId?: string;
  sourceId?: string;
  eventId?: string;
  source: "audit" | "feedback";
  failureType: string;
  query?: string;
  createdAt: string;
  expected: {
    answerMustNotInvent?: boolean;
    expectedEvidence?: string[];
  };
  metadata: Record<string, unknown>;
};

const AUDIT_FAILURE_TYPES = new Set([
  "no_evidence",
  "low_confidence",
  "graphiti_disagreement",
  "mem0_unaligned",
  "answer_validation_failed",
  "user_feedback_negative",
]);

export function buildEvalCandidates(input: {
  audits: EvalCandidateAuditInput[];
  feedback: EvalCandidateFeedbackInput[];
}): EvalCandidate[] {
  return [
    ...input.audits.flatMap(candidateFromAudit),
    ...input.feedback.flatMap(candidateFromFeedback),
  ];
}

function candidateFromAudit(audit: EvalCandidateAuditInput): EvalCandidate[] {
  const payload = asRecord(audit.payload);
  const failureType = stringValue(payload.failureType) ?? (payload.noEvidence === true ? "no_evidence" : undefined);
  if (!failureType || !AUDIT_FAILURE_TYPES.has(failureType)) return [];
  const query = stringValue(payload.query);
  return [{
    id: `audit-${audit.id}`,
    tenantId: audit.tenantId,
    elderId: audit.elderId,
    traceId: stringValue(payload.traceId),
    sourceId: audit.sourceId ?? undefined,
    source: "audit",
    failureType,
    query,
    createdAt: audit.createdAt,
    expected: {
      answerMustNotInvent: failureType === "no_evidence" || failureType === "answer_validation_failed",
      expectedEvidence: evidenceHints(payload),
    },
    metadata: {
      auditId: audit.id,
      auditType: audit.type,
      retrieval: payload.retrieval,
    },
  }];
}

function candidateFromFeedback(feedback: EvalCandidateFeedbackInput): EvalCandidate[] {
  if (feedback.feedbackType === "positive" || feedback.feedbackType === "thumbs_up") return [];
  const correction = asRecord(feedback.correction);
  return [{
    id: `feedback-${feedback.id}`,
    tenantId: feedback.tenantId,
    elderId: feedback.elderId,
    traceId: stringValue(correction.traceId),
    sourceId: feedback.sourceId ?? undefined,
    eventId: feedback.eventId ?? undefined,
    source: "feedback",
    failureType: "user_feedback_negative",
    query: stringValue(correction.query),
    createdAt: feedback.createdAt,
    expected: {
      answerMustNotInvent: true,
      expectedEvidence: evidenceHints(correction),
    },
    metadata: {
      feedbackId: feedback.id,
      feedbackType: feedback.feedbackType,
      actorUserId: feedback.actorUserId,
    },
  }];
}

function evidenceHints(record: Record<string, unknown>): string[] {
  const value = record.expectedEvidence ?? record.evidenceHints;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
