import { listMvpData, type MvpLists } from "./api.js";
import { copy } from "./copy.js";

export type RequestState = { loading: boolean; message?: string; error?: string };

export function formatConfirmedReminderText(remindAt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone, year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(remindAt));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}年${Number(value("month"))}月${Number(value("day"))}日 ${value("hour")}:${value("minute")}`;
}

export async function refreshLists(
  elderId: string,
  setLists: (lists: MvpLists) => void,
  setState: (state: RequestState) => void,
  showStatus = true,
): Promise<void> {
  if (!elderId.trim()) return;
  if (!showStatus) {
    try {
      setLists(await listMvpData(elderId));
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  await runRequest(setState, copy.status.refreshed, async () => { setLists(await listMvpData(elderId)); }, showStatus);
}

export async function runRequest(
  setState: (state: RequestState) => void,
  successMessage: string,
  action: () => Promise<void>,
  showStatus = true,
): Promise<boolean> {
  setState({ loading: true });
  try {
    await action();
    setState({ loading: false, message: showStatus ? successMessage : undefined });
    return true;
  } catch (error) {
    setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function createClientTurnId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `turn:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
