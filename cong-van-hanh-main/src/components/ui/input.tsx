import type { InputHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cx(
        "app-control h-12 w-full border px-4 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}
