import type { ReactNode } from "react";
import type { DebugTrace } from "@goldmem/memory-schema";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";

export function DevPanel({
  actorUserId,
  debugTrace,
  debugTraceId,
  elderId,
  loading,
  onActorChange,
  onDebugTraceIdChange,
  onElderChange,
  onLoadTrace,
}: {
  actorUserId: string;
  debugTrace: DebugTrace | null;
  debugTraceId: string;
  elderId: string;
  loading: boolean;
  onActorChange: (value: string) => void;
  onDebugTraceIdChange: (value: string) => void;
  onElderChange: (value: string) => void;
  onLoadTrace: () => void | Promise<void>;
}) {
  return (
    <details className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
      <summary className="cursor-pointer text-base font-medium text-slate-700">开发工具</summary>
      <div className="mt-4 grid gap-3">
        <Field label="老人 ID">
          <Input value={elderId} onChange={(event) => onElderChange(event.target.value)} />
        </Field>
        <Field label="老人操作人">
          <Input value={actorUserId} onChange={(event) => onActorChange(event.target.value)} />
        </Field>
        <Field label="traceId">
          <Input value={debugTraceId} onChange={(event) => onDebugTraceIdChange(event.target.value)} />
        </Field>
        <Button disabled={loading || !debugTraceId.trim()} variant="secondary" onClick={() => void onLoadTrace()}>
          查询调试链路
        </Button>
        {debugTrace ? (
          <pre className="max-h-72 overflow-auto rounded-xl bg-white p-3 text-xs leading-5">
            {JSON.stringify(debugTrace, null, 2)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-600">
      {label}
      {children}
    </label>
  );
}
