export function buildRecallTerms(query?: string, entityNames?: string[]): string[] {
  const terms = new Set<string>();
  for (const value of [query, ...(entityNames ?? [])]) {
    if (!value) continue;
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
