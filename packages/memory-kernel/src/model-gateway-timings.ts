import { ModelGatewayError, type ModelGateway, type ModelGatewayProviderTiming } from "@mem/model-gateway";

export function consumeProviderTimings(modelGateway: ModelGateway): ModelGatewayProviderTiming[] {
  return modelGateway.consumeProviderTimings?.() ?? [];
}

export function appendProviderTimings(payload: Record<string, unknown>, modelGateway: ModelGateway): void {
  const timings = consumeProviderTimings(modelGateway);
  if (timings.length === 0) return;
  const current = Array.isArray(payload.providerTimings) ? payload.providerTimings : [];
  payload.providerTimings = [...current, ...timings];
}

export function modelGatewayErrorPayload(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof ModelGatewayError)) return undefined;
  return {
    code: error.code,
    ...(error.details ?? {}),
  };
}
