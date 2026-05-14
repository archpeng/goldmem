const KEY_TEXT_SCALE = "elderTextScale";
const KEY_LAST_SNAPSHOT_DISMISSED = "lastSnapshotDismissed";
const KEY_ANSWER_CORRECTIONS = "answerCorrections";

export type ElderTextScale = "normal" | "xl";

type SafeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeStorage(): SafeStorage | null {
  try {
    const storage = typeof window !== "undefined" ? window.localStorage : null;
    if (
      !storage ||
      typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function" ||
      typeof storage.removeItem !== "function"
    ) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

export function readTextScale(): ElderTextScale {
  const value = safeStorage()?.getItem(KEY_TEXT_SCALE);
  return value === "xl" ? "xl" : "normal";
}

export function writeTextScale(scale: ElderTextScale): void {
  const storage = safeStorage();
  if (!storage) return;
  if (scale === "normal") storage.removeItem(KEY_TEXT_SCALE);
  else storage.setItem(KEY_TEXT_SCALE, scale);
}

export function applyTextScaleToDocument(scale: ElderTextScale): void {
  if (typeof document === "undefined") return;
  if (scale === "xl") document.documentElement.dataset.elderMode = "xl";
  else delete document.documentElement.dataset.elderMode;
}

export function readLastSnapshotDismissed(): string | null {
  return safeStorage()?.getItem(KEY_LAST_SNAPSHOT_DISMISSED) ?? null;
}

export function writeLastSnapshotDismissed(yyyymmdd: string): void {
  safeStorage()?.setItem(KEY_LAST_SNAPSHOT_DISMISSED, yyyymmdd);
}

export type AnswerCorrection = {
  correctionText: string;
  correctedAt: number;
};

const CORRECTION_TTL_MS = 24 * 60 * 60 * 1000;

type CorrectionsMap = Record<string, AnswerCorrection>;

function readCorrections(): CorrectionsMap {
  const raw = safeStorage()?.getItem(KEY_ANSWER_CORRECTIONS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const now = Date.now();
    const fresh: CorrectionsMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as { correctionText?: unknown; correctedAt?: unknown };
      if (typeof v.correctionText !== "string" || typeof v.correctedAt !== "number") continue;
      if (now - v.correctedAt > CORRECTION_TTL_MS) continue;
      fresh[key] = { correctionText: v.correctionText, correctedAt: v.correctedAt };
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeCorrections(map: CorrectionsMap): void {
  safeStorage()?.setItem(KEY_ANSWER_CORRECTIONS, JSON.stringify(map));
}

export function getAnswerCorrection(traceId: string): AnswerCorrection | null {
  if (!traceId) return null;
  const map = readCorrections();
  return map[traceId] ?? null;
}

export function setAnswerCorrection(traceId: string, correctionText: string): void {
  if (!traceId) return;
  const trimmed = correctionText.trim();
  if (!trimmed) return;
  const map = readCorrections();
  map[traceId] = { correctionText: trimmed, correctedAt: Date.now() };
  writeCorrections(map);
}

export function todayLocalDateString(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
