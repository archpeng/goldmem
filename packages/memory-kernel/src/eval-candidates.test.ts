import { describe, expect, it } from "vitest";
import { buildEvalCandidates } from "./eval-candidates.js";

describe("buildEvalCandidates", () => {
  it("exports no-evidence query audits without raw transcript content", () => {
    const candidates = buildEvalCandidates({
      audits: [{
        id: "audit-1",
        tenantId: "tenant-1",
        elderId: "elder-1",
        type: "memory_query",
        payload: {
          traceId: "trace-query-1",
          query: "我昨天买了什么？",
          failureType: "no_evidence",
          transcript: "raw transcript must not be copied",
          retrieval: { evidenceCount: 0 },
        },
        createdAt: "2026-05-11T00:00:00.000Z",
      }],
      feedback: [],
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        id: "audit-audit-1",
        traceId: "trace-query-1",
        failureType: "no_evidence",
        query: "我昨天买了什么？",
        expected: expect.objectContaining({ answerMustNotInvent: true }),
      }),
    ]);
    expect(JSON.stringify(candidates)).not.toContain("raw transcript");
  });

  it("exports negative feedback as regression candidates", () => {
    const candidates = buildEvalCandidates({
      audits: [],
      feedback: [{
        id: "feedback-1",
        tenantId: "tenant-1",
        elderId: "elder-1",
        sourceId: "source-1",
        eventId: "event-1",
        actorUserId: "family-1",
        feedbackType: "answer_wrong",
        correction: { traceId: "trace-feedback-1", query: "复查改期了吗？", expectedEvidence: ["下周一"] },
        createdAt: "2026-05-11T00:00:00.000Z",
      }],
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        id: "feedback-feedback-1",
        failureType: "user_feedback_negative",
        sourceId: "source-1",
        eventId: "event-1",
        expected: { answerMustNotInvent: true, expectedEvidence: ["下周一"] },
      }),
    ]);
  });
});
