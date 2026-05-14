import { copy } from "../lib/copy.js";

export type DraftCard = {
  id: string;
  sourceId?: string;
  transcript: string;
  status: "draft" | "queued" | "processing" | "ready" | "failed";
  summary?: string;
  errorMessage?: string;
  fading?: boolean;
};

export function DraftCards({
  drafts,
  onRetry,
  onDismiss,
}: {
  drafts: DraftCard[];
  onRetry: (draft: DraftCard) => void | Promise<void>;
  onDismiss: (draftId: string) => void;
}) {
  if (!drafts.length) return null;
  return (
    <div className="mt-2 space-y-3">
      {drafts.map((draft) => {
        const cls = [
          "rounded-2xl px-5 py-4 transition-colors",
          draftCardBg(draft.status),
          draft.status === "ready" ? "draft-card-ready" : "",
          draft.fading ? "draft-card-fade" : "",
        ].filter(Boolean).join(" ");
        return (
          <div className={cls} key={draft.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold leading-snug text-slate-900">{draft.summary ?? draft.transcript}</p>
                {draft.summary ? <p className="mt-1 text-xs leading-5 text-slate-500">{draft.transcript}</p> : null}
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${draftStatusChip(draft.status)}`}>
                {draftStatusLabel(draft)}
              </span>
            </div>
            {draft.errorMessage ? <p className="mt-2 text-xs text-red-500">{draft.errorMessage}</p> : null}
            {draft.status === "failed" ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  aria-label={`${draft.transcript} ${copy.tasks.retry}`}
                  className="flex-1 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                  type="button"
                  onClick={() => void onRetry(draft)}
                >
                  {copy.tasks.retry}
                </button>
                <button
                  aria-label={`${draft.transcript} ${copy.tasks.dismissDraft}`}
                  className="rounded-full px-3 py-2 text-xs text-slate-500 hover:bg-white/60"
                  type="button"
                  onClick={() => onDismiss(draft.id)}
                >
                  {copy.tasks.dismissDraft}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function draftCardBg(status: DraftCard["status"]): string {
  if (status === "ready") return "bg-emerald-50";
  if (status === "failed") return "bg-rose-50";
  return "bg-slate-100";
}

function draftStatusChip(status: DraftCard["status"]): string {
  if (status === "ready") return "bg-emerald-100 text-emerald-700";
  if (status === "failed") return "bg-rose-100 text-rose-700";
  return "bg-white text-slate-500";
}

function draftStatusLabel(draft: DraftCard): string {
  if (draft.status === "draft") return copy.tasks.draft;
  if (draft.status === "ready") return copy.draft.rememberedTag;
  if (draft.status === "failed") return copy.tasks.organizeFailed;
  return copy.tasks.organizing;
}
