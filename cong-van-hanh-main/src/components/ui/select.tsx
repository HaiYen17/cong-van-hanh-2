import type { SelectHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cx(
        "app-control h-12 w-full border px-4 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}
