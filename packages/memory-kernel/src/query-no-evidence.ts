import type { MemoryAnswer } from "@mem/memory-schema";

export function buildNoEvidenceAnswer(traceId: string): MemoryAnswer {
  return {
    answerText: "我没有找到可以回答这件事的记忆。",
    traceId,
    confidence: 0,
    matchedSources: [],
    retrievedEvidence: [],
    suggestedActions: [],
    safetyNote: "没有找到可引用的来源依据。",
  };
}

export function isNoEvidenceAnswer(answer: MemoryAnswer): boolean {
  if (answer.confidence > 0.4) return false;
  if (/但是|但我找到了|但有|不过我找到了|however|but/i.test(answer.answerText)) return false;
  return /没有找到|没找到|未找到|没有记录|没有相关|not find|not found/i.test(answer.answerText);
}
