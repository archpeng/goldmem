import type { MemoryAnswer, MemoryEvent, ParsedMemoryQuery } from "@goldmem/memory-schema";
import type { MemoryRecallResult } from "@goldmem/memory-store";
import type { RetrievedEvidence } from "@goldmem/model-gateway";
import type { TemporalEvidence } from "@goldmem/temporal-memory";

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
  semanticResults: MemoryRecallResult[],
  temporalResults: TemporalEvidence[],
  parsedQuery: ParsedMemoryQuery,
  query: string,
  now: string,
): RetrievedEvidence[] {
  const eventEvidence: RetrievedEvidence[] = events.map((event) => ({
    sourceId: event.sourceId,
    eventId: event.id,
    createdAt: event.createdAt,
    summary: event.summary,
    score: scoreStructuredEvent(event, parsedQuery, query),
    canPlayAudio: true,
    retrievalSource: "postgres",
  }));

  const semanticEvidence: RetrievedEvidence[] = semanticResults.flatMap((result) => {
    if (typeof result.metadata?.sourceId !== "string") return [];
    return [
      {
        sourceId: result.metadata.sourceId,
        eventId: typeof result.metadata.eventId === "string" ? result.metadata.eventId : undefined,
        createdAt: typeof result.metadata.createdAt === "string" ? result.metadata.createdAt : new Date().toISOString(),
        summary: typeof result.metadata.summary === "string" ? result.metadata.summary : result.memory,
        score: result.score ?? 0.5,
        canPlayAudio: true,
        retrievalSource: "mem0" as const,
      },
    ];
  });

  const temporalEvidence: RetrievedEvidence[] = temporalResults.flatMap((result) => {
    if (!result.sourceId) return [];
    return [
      {
        sourceId: result.sourceId,
        eventId: result.eventId,
        createdAt: result.validFrom ?? now,
        summary: result.fact,
        score: result.score,
        canPlayAudio: true,
        retrievalSource: "graphiti" as const,
      },
    ];
  });

  return mergeRetrievedEvidence([...eventEvidence, ...semanticEvidence, ...temporalEvidence]);
}

export function mergeRetrievedEvidence(evidence: RetrievedEvidence[]): RetrievedEvidence[] {
  const byKey = new Map<string, RetrievedEvidence>();
  for (const item of evidence) {
    const key = `${item.retrievalSource}:${item.sourceId}:${item.eventId ?? item.summary}`;
    const existing = byKey.get(key);
    if (!existing || item.score > existing.score) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

export function shouldSearchTemporalMemory(query: string, parsedQuery: ParsedMemoryQuery): boolean {
  const normalized = query.toLowerCase();
  const relationTerms = [
    "后来",
    "改过",
    "现在",
    "以前",
    "上次",
    "确认过",
    "是不是还是",
    "有没有变化",
    "有没有改",
    "怎么改",
    "改期",
    "经常",
    "反复",
    "关联",
    "谁确认",
    "安全吗",
    "安全不",
    "诈骗",
    "陌生人",
    "身份证",
    "验证码",
    "补贴",
    "风险",
    "转账",
    "current",
    "changed",
    "change",
    "history",
    "confirmed",
    "rescheduled",
    "related",
    "trend",
    "safe",
    "scam",
    "fraud",
    "identity",
    "verification code",
    "risk",
  ];
  if (relationTerms.some((term) => normalized.includes(term))) return true;

  const temporalTypes = new Set(["medication", "appointment", "health", "finance", "family", "object"]);
  return parsedQuery.entities.length > 0 && parsedQuery.eventTypes.some((type) => temporalTypes.has(type));
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
