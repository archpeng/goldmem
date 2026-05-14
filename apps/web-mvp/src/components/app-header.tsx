import { Settings } from "lucide-react";
import { copy } from "../lib/copy.js";
import type { ElderTextScale } from "../lib/local-prefs.js";

export function AppHeader({
  today,
  textScale,
  status,
  onToggleSettings,
  onToggleTextScale,
}: {
  today: string;
  textScale: ElderTextScale;
  status: { message?: string; error?: string };
  onToggleSettings: () => void;
  onToggleTextScale: () => void;
}) {
  return (
    <header className="px-6 pb-2 pt-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-400">{today}</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight text-slate-900">{copy.appTitle}</h1>
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-2">
          <button
            aria-label={textScale === "xl" ? `${copy.settings.textScaleLabel} ${copy.settings.textScaleNormal}` : `${copy.settings.textScaleLabel} ${copy.settings.textScaleXl}`}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            type="button"
            onClick={onToggleTextScale}
          >
            {copy.settings.textScaleLabel} {textScale === "xl" ? copy.settings.textScaleXl : copy.settings.textScaleNormal}
          </button>
          <button
            aria-label={copy.settings.open}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
            type="button"
            onClick={onToggleSettings}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
      {status.error ? (
        <p className="mt-2 text-xs text-red-400">{status.error}</p>
      ) : status.message ? (
        <p className="mt-2 text-xs text-slate-400">{status.message}</p>
      ) : null}
    </header>
  );
}
