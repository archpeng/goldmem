import { EventTypeSchema, RiskLevelSchema, type MemoryAnswer, type MemoryEvent, type ParsedMemoryQuery } from "@mem/memory-schema";
import type { RetrievedEvidence } from "@mem/model-gateway";
import type { TemporalEvidence } from "@mem/temporal-memory";

export function evidenceBoundMatchedSources(
  matchedSources: MemoryAnswer["matchedSources"],
  evidence: RetrievedEvidence[],
): MemoryAnswer["matchedSources"] {
  const evidenceBySourceId = new Map(evidence.map((item) => [item.sourceId, item]));
  const matched = matchedSources.flatMap((source) => {
    const item = evidenceBySourceId.get(source.sourceId);
    if (!item) return [];
    return [{
      ...source,
      createdAt: item.createdAt,
      summary: item.summary,
      canPlayAudio: item.canPlayAudio,
      retrievalSource: item.retrievalSource,
    }];
  });
  if (matched.length > 0) return matched;
  return evidence.map((item) => ({
    sourceId: item.sourceId,
    createdAt: item.createdAt,
    summary: item.summary,
    canPlayAudio: item.canPlayAudio,
    retrievalSource: item.retrievalSource,
  }));
}

export function mergeEvidence(
  events: MemoryEvent[],
  semanticEvidence: RetrievedEvidence[],
  temporalResults: TemporalEvidence[],
  parsedQuery: ParsedMemoryQuery,
  query: string,
  now: string,
): RetrievedEvidence[] {
  const eventEvidence: RetrievedEvidence[] = events.map((event) => ({
    sourceId: event.sourceId,
    eventId: event.id,
    createdAt: event.createdAt,
    summary: buildEventEvidenceSummary(event),
    score: scoreStructuredEvent(event, parsedQuery, query),
    canPlayAudio: true,
    retrievalSource: "postgres",
    eventType: event.type,
    riskLevel: event.riskLevel,
    requiresConfirmation: event.requiresConfirmation,
  }));

  const eventsById = new Map(events.map((event) => [event.id, event]));

  const temporalEvidence: RetrievedEvidence[] = temporalResults.flatMap((result) => {
    if (!result.sourceId) return [];
    const event = result.eventId ? eventsById.get(result.eventId) : undefined;
    return [
      {
        sourceId: result.sourceId,
        eventId: result.eventId,
        createdAt: temporalEvidenceCreatedAt(result, event, now),
        summary: result.fact,
        score: result.score,
        canPlayAudio: true,
        retrievalSource: result.origin === "provenance_fallback" ? "graphiti_provenance" as const : "graphiti" as const,
        eventType: event?.type ?? parseEventType(result.metadata?.eventType),
        riskLevel: event?.riskLevel ?? parseRiskLevel(result.metadata?.riskLevel),
        requiresConfirmation: event?.requiresConfirmation ?? (typeof result.metadata?.requiresConfirmation === "boolean" ? result.metadata.requiresConfirmation : undefined),
      },
    ];
  });

  return mergeRetrievedEvidence([...eventEvidence, ...semanticEvidence, ...temporalEvidence], {
    preserveRawGraphiti: shouldSearchTemporalMemory(query, parsedQuery),
    prioritizeCurrentEvidence: shouldPrioritizeCurrentEvidence(query, parsedQuery),
    preserveConfirmationDiversity: shouldPreserveConfirmationDiversity(parsedQuery),
  });
}

export function buildEventEvidenceSummary(event: MemoryEvent): string {
  return compactEvidenceSummary([
    event.title,
    event.summary,
    informativeTimeText(event.timeText) ? `Time: ${event.timeText}` : undefined,
  ]);
}

function compactEvidenceSummary(parts: Array<string | undefined>): string {
  const seen = new Set<string>();
  const compacted: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    compacted.push(value);
  }
  return compacted.join(" ");
}

function informativeTimeText(value: string | undefined): value is string {
  if (!value) return false;
  return !/未提到时间|没有时间|no time/i.test(value);
}

function parseEventType(value: unknown): MemoryEvent["type"] | undefined {
  const parsed = EventTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseRiskLevel(value: unknown): MemoryEvent["riskLevel"] | undefined {
  const parsed = RiskLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function mergeRetrievedEvidence(
  evidence: RetrievedEvidence[],
  options: {
    preserveRawGraphiti?: boolean;
    prioritizeCurrentEvidence?: boolean;
    preserveConfirmationDiversity?: boolean;
  } = {},
): RetrievedEvidence[] {
  const byKey = new Map<string, RetrievedEvidence>();
  for (const item of evidence) {
    const key = `${item.retrievalSource}:${item.sourceId}:${item.eventId ?? item.summary}`;
    const existing = byKey.get(key);
    if (!existing || item.score > existing.score) {
      byKey.set(key, item);
    }
  }

  const ranked = [...byKey.values()].sort((a, b) => compareRetrievedEvidence(a, b, options));
  const selected = ensureConfirmationDiversity(
    ranked,
    ranked.slice(0, 12),
    options,
  );
  if (!options.preserveRawGraphiti || selected.some((item) => item.retrievalSource === "graphiti")) {
    return selected;
  }

  const rawGraphiti = ranked.find((item) => item.retrievalSource === "graphiti");
  if (!rawGraphiti) return selected;
  if (selected.length < 12) return [...selected, rawGraphiti];

  const replacementIndex = lowestPriorityReplacementIndex(selected);
  return selected.map((item, index) => index === replacementIndex ? rawGraphiti : item)
    .sort((a, b) => compareRetrievedEvidence(a, b, options));
}

function compareRetrievedEvidence(
  a: RetrievedEvidence,
  b: RetrievedEvidence,
  options: { prioritizeCurrentEvidence?: boolean },
): number {
  const scoreDelta = b.score - a.score;
  if (!options.prioritizeCurrentEvidence || Math.abs(scoreDelta) > 0.15) {
    return scoreDelta;
  }

  const recencyDelta = evidenceTimeMs(b) - evidenceTimeMs(a);
  if (recencyDelta !== 0) return recencyDelta;
  return scoreDelta;
}

function ensureConfirmationDiversity(
  ranked: RetrievedEvidence[],
  selected: RetrievedEvidence[],
  options: { preserveConfirmationDiversity?: boolean },
): RetrievedEvidence[] {
  if (!options.preserveConfirmationDiversity || selected.length === 0) return selected;
  return ensureBooleanFacetDiversity(
    ranked,
    selected,
    (item) => item.requiresConfirmation,
  );
}

function ensureBooleanFacetDiversity(
  ranked: RetrievedEvidence[],
  selected: RetrievedEvidence[],
  valueFor: (item: RetrievedEvidence) => boolean | undefined,
): RetrievedEvidence[] {
  const selectedValues = new Set(selected.map(valueFor).filter((value): value is boolean => typeof value === "boolean"));
  if (selectedValues.size !== 1) return selected;

  const presentValue = [...selectedValues][0];
  if (typeof presentValue !== "boolean") return selected;
  const missingCandidate = ranked.find((item) => valueFor(item) === !presentValue);
  if (!missingCandidate || selected.includes(missingCandidate)) return selected;
  if (selected.length < 12) return [...selected, missingCandidate];

  const replacementIndex = lowestPriorityReplacementIndex(selected);
  if (replacementIndex < 0) return selected;
  return selected.map((item, index) => index === replacementIndex ? missingCandidate : item);
}

function lowestPriorityReplacementIndex(evidence: RetrievedEvidence[]): number {
  const nonPostgresIndex = lastLowestScoreIndex(evidence, (item) => item.retrievalSource !== "postgres");
  return nonPostgresIndex >= 0 ? nonPostgresIndex : lastLowestScoreIndex(evidence, () => true);
}

function lastLowestScoreIndex(
  evidence: RetrievedEvidence[],
  canReplace: (item: RetrievedEvidence) => boolean,
): number {
  let index = -1;
  let score = Number.POSITIVE_INFINITY;
  for (let current = 0; current < evidence.length; current += 1) {
    const item = evidence[current];
    if (!item || !canReplace(item)) continue;
    if (item.score <= score) {
      score = item.score;
      index = current;
    }
  }
  return index;
}

export function shouldSearchTemporalMemory(_query: string, parsedQuery: ParsedMemoryQuery): boolean {
  if (parsedQuery.requiresTemporalEvidence || parsedQuery.relationQueryIntent !== "none") return true;
  return parsedQuery.safetyTags.some((tag) => (
    tag === "medical" ||
    tag === "medication" ||
    tag === "financial" ||
    tag === "fraud" ||
    tag === "identity" ||
    tag === "privacy"
  ));
}

function shouldPrioritizeCurrentEvidence(_query: string, parsedQuery: ParsedMemoryQuery): boolean {
  return parsedQuery.requiresTemporalEvidence || parsedQuery.relationQueryIntent !== "none";
}

function shouldPreserveConfirmationDiversity(parsedQuery: ParsedMemoryQuery): boolean {
  return parsedQuery.intent === "check_reminder" || parsedQuery.safetyTags.includes("privacy");
}

function evidenceTimeMs(item: RetrievedEvidence): number {
  const ms = Date.parse(item.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function temporalEvidenceCreatedAt(
  result: TemporalEvidence,
  event: MemoryEvent | undefined,
  now: string,
): string {
  return event?.createdAt
    ?? stringMetadata(result.metadata?.eventCreatedAt)
    ?? result.validFrom
    ?? now;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function scoreStructuredEvent(event: MemoryEvent, parsedQuery: ParsedMemoryQuery, query: string): number {
  const eventText = `${event.title}\n${event.summary}`.toLowerCase();
  const queryTerms = buildRecallTerms(query, parsedQuery.entities.map((entity) => entity.name));
  const entityNames = event.entities.map((entity) => entity.name.toLowerCase());

  let score = 0.45 + event.importance * 0.2 + event.confidence * 0.15;
  if (parsedQuery.eventTypes.includes(event.type)) score += 0.12;
  if (eventMatchesTimeRange(event, parsedQuery.timeRange)) score += 0.14;
  if (queryTerms.some((term) => eventText.includes(term))) score += 0.16;
  if (parsedQuery.entities.some((entity) => entityNames.includes(entity.name.toLowerCase()))) score += 0.1;
  if (event.status === "active") score += 0.03;

  return clampScore(score);
}

function eventMatchesTimeRange(event: MemoryEvent, timeRange: ParsedMemoryQuery["timeRange"]): boolean {
  if (!timeRange) return false;
  const eventTime = event.eventTimeStart ?? event.createdAt;
  const eventMs = Date.parse(eventTime);
  const startMs = Date.parse(timeRange.start);
  const endMs = Date.parse(timeRange.end);
  if (!Number.isFinite(eventMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return eventMs >= startMs && eventMs <= endMs;
}

function buildRecallTerms(query: string, entityNames: string[]): string[] {
  const terms = new Set<string>();
  for (const value of [query, ...entityNames]) {
    for (const term of tokenizeRecallText(value)) terms.add(term);
  }
  return [...terms].slice(0, 16);
}

function tokenizeRecallText(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return [];

  const terms = new Set<string>();
  for (const token of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= 2) terms.add(token);
    if (/[\p{Script=Han}]/u.test(token)) {
      for (const item of cjkNgrams(token)) terms.add(item);
    }
  }

  return [...terms];
}

function cjkNgrams(value: string): string[] {
  const chars = [...value].filter((char) => /[\p{Script=Han}]/u.test(char));
  const grams: string[] = [];
  for (const size of [2, 3]) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      grams.push(chars.slice(index, index + size).join(""));
    }
  }
  return grams;
}

export function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}
