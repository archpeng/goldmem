import { useEffect, useState } from "react";
import type { TodaySnapshot } from "@mem/memory-schema";
import { getTodaySnapshot } from "../lib/api.js";
import { readLastSnapshotDismissed, writeLastSnapshotDismissed } from "../lib/local-prefs.js";
import type { RequestState } from "../lib/app-helpers.js";

export function useTodaySnapshot(
  elderId: string,
  setState: (next: RequestState) => void,
) {
  const [todaySnapshot, setTodaySnapshot] = useState<TodaySnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    getTodaySnapshot(elderId, timezone).then((snapshot) => {
      if (cancelled) return;
      setTodaySnapshot(readLastSnapshotDismissed() === snapshot.date ? null : snapshot);
    }).catch((error) => {
      if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [elderId, setState]);

  function dismissTodaySnapshot(date: string) {
    writeLastSnapshotDismissed(date);
    setTodaySnapshot(null);
  }

  return {
    todaySnapshot,
    dismissTodaySnapshot,
  };
}
