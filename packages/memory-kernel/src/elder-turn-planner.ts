import { ModelGatewayError } from "@goldmem/model-gateway";
import type { ElderTurnPlan, PersonalContext } from "@goldmem/memory-schema";
import type { ElderMemoryKernelDeps } from "./index.js";
import { consumeProviderTimings, modelGatewayErrorPayload } from "./model-gateway-timings.js";

export async function planElderTurnSafely(deps: ElderMemoryKernelDeps, input: {
  tenantId: string;
  elderId: string;
  text: string;
  now: string;
  traceId: string;
  context: PersonalContext;
}): Promise<ElderTurnPlan> {
  try {
    return await deps.modelGateway.planElderTurn({
      tenantId: input.tenantId,
      elderId: input.elderId,
      text: input.text,
      now: input.now,
      context: input.context,
    });
  } catch (error) {
    if (!(error instanceof ModelGatewayError) || error.code !== "schema_validation_error") throw error;
    await deps.auditLog.record({
      type: "elder_turn_plan_failed",
      tenantId: input.tenantId,
      elderId: input.elderId,
      traceId: input.traceId,
      payload: {
        traceId: input.traceId,
        text: input.text,
        failureType: "turn_schema_validation_error",
        errorMessage: error.message,
        modelGateway: modelGatewayErrorPayload(error),
        providerTimings: consumeProviderTimings(deps.modelGateway),
        fallbackUsed: true,
      },
    });
    return {
      intent: "clarify",
      confidence: 0,
      clarifyingQuestion: "您想让我记住这件事，还是帮您查以前的记忆？",
      requiresIngestContextRecall: false,
    };
  }
}

export function emptyTurnContext(): PersonalContext {
  return {
    recentEvents: [],
    semanticCandidateEvents: [],
    openReminders: [],
    semanticMemories: [],
    knownEntities: [],
    familyRelations: [],
    safetyPolicy: [],
  };
}
