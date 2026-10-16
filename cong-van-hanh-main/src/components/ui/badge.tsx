import type { HTMLAttributes } from "react";

import { cx } from "@/lib/cx";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "border-border bg-primary/5 text-primary",
  info: "border-[#bfe0d8] bg-[#e4f3ee] text-primary",
  success: "border-[#b6e2d1] bg-[#e4f7ef] text-success",
  warning: "border-[#f3d4a0] bg-accent-soft text-[#9a5712]",
  danger: "border-[#eebfbf] bg-[#fdeeee] text-danger",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-bold uppercase tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
