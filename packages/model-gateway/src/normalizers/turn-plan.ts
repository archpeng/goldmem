import type { PlanElderTurnInput } from "../index.js";
import { asRecord, enumValue, numberValue, optionalString } from "./common.js";

const ELDER_TURN_INTENTS = ["record", "recall", "record_and_recall", "clarify"] as const;

export function normalizeElderTurnPlanResult(raw: unknown, input: PlanElderTurnInput): unknown {
  const record = asRecord(raw);
  const intent = enumValue(record.intent ?? record.turnType ?? record.action, ELDER_TURN_INTENTS, "clarify");
  const recordText = optionalString(record.recordText ?? record.memoryText ?? record.noteText);
  const queryText = optionalString(record.queryText ?? record.question);

  return {
    ...record,
    intent,
    confidence: numberValue(record.confidence, 0.5),
    recordText: intent === "record" || intent === "record_and_recall" ? recordText ?? input.text : recordText,
    queryText: intent === "recall" || intent === "record_and_recall" ? queryText ?? input.text : queryText,
    clarifyingQuestion: intent === "clarify"
      ? optionalString(record.clarifyingQuestion ?? record.question) ?? "您想让我记住这件事，还是帮您查以前的记忆？"
      : optionalString(record.clarifyingQuestion),
  };
}
