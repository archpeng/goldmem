import * as React from "react";
import { cn } from "../../lib/utils.js";

export function Alert({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        variant === "destructive"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-900",
        className,
      )}
      {...props}
    />
  );
}
