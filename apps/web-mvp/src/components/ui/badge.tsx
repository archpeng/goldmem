import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:   "rounded-md border-transparent bg-slate-950 text-white",
        secondary: "rounded-md border-slate-200 bg-slate-50 text-slate-700",
        warning:   "rounded-md border-amber-200 bg-amber-50 text-amber-800",
        danger:    "rounded-md border-red-200 bg-red-50 text-red-700",
        pill:      "rounded-full border-transparent bg-slate-950 text-white font-semibold",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
