import * as React from "react";
import { cn } from "../../lib/utils.js";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
