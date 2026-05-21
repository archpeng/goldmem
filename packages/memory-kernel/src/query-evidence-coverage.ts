import type { MemoryEvent, ParsedMemoryQuery } from "@mem/memory-schema";
import type { RetrievedEvidence } from "@mem/model-gateway";

export type EvidenceCoverage = {
  required: boolean;
  passed: boolean;
  requiredTerms: string[];
  matchedTerms: string[];
};

export function assessEvidenceCoverage(
  evidence: RetrievedEvidence[],
  parsedQuery: ParsedMemoryQuery,
  query: string,
): EvidenceCoverage {
  const required = requiresEvidenceCoverage(parsedQuery);
  if (!required) return { required, passed: true, requiredTerms: [], matchedTerms: [] };

  const requiredTerms = coverageTerms(parsedQuery, query);
  const evidenceText = evidence.map((item) => item.summary).join("\n").toLowerCase();
  const matchedTerms = requiredTerms.filter((term) => evidenceText.includes(term));
  const requiredMatchCount = requiredTerms.length === 0 ? 0 : Math.min(2, requiredTerms.length);
  const passed = requiredTerms.length === 0
    ? evidence.length > 0
    : matchedTerms.length >= requiredMatchCount;
  return { required, passed, requiredTerms, matchedTerms };
}

export function shouldUsePostgresCoverageFallback(coverage: EvidenceCoverage): boolean {
  return coverage.required && !coverage.passed;
}

export function mergeEventsById(events: MemoryEvent[]): MemoryEvent[] {
  const byId = new Map<string, MemoryEvent>();
  for (const event of events) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()];
}

function requiresEvidenceCoverage(parsedQuery: ParsedMemoryQuery): boolean {
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

function coverageTerms(parsedQuery: ParsedMemoryQuery, query: string): string[] {
  const entityTerms = parsedQuery.entities.flatMap((entity) => tokenizeCoverageText(entity.name));
  const terms = entityTerms.length > 0 ? entityTerms : tokenizeCoverageText(query);
  return [...new Set(terms)].slice(0, 16);
}

function tokenizeCoverageText(value: string): string[] {
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
