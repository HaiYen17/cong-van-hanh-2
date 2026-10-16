import type { ButtonHTMLAttributes } from "react";

import { cx } from "@/lib/cx";

export type ButtonVariant =
  | "primary"
  | "brand"
  | "secondary"
  | "ghost"
  | "danger";
export type ButtonSize = "md" | "sm" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary: "app-primary-button focus-visible:outline-brand",
  brand: "app-primary-button focus-visible:outline-brand",
  secondary: "app-secondary-button border focus-visible:outline-accent",
  ghost:
    "bg-primary/10 text-primary hover:bg-primary/15 focus-visible:outline-accent",
  danger:
    "border-0 bg-danger text-white shadow-[0_12px_26px_rgba(186,47,47,0.22)] hover:brightness-[1.05] focus-visible:outline-danger",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-[var(--ui-button-height)] px-5 py-2 text-sm",
  sm: "min-h-[calc(var(--ui-button-height)-10px)] px-4 py-1.5 text-sm",
  icon: "size-11 p-0",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function buttonStyles({
  className,
  size = "md",
  variant = "primary",
}: {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
} = {}) {
  return cx(
    "app-button inline-flex items-center justify-center gap-2 font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-55",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  className,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonStyles({ className, size, variant })}
      type={type}
      {...props}
    />
  );
}
