import Link from "next/link";
import type { ComponentProps } from "react";

import {
  buttonStyles,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button";

type LinkButtonProps = ComponentProps<typeof Link> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function LinkButton({
  className,
  size = "md",
  variant = "primary",
  ...props
}: LinkButtonProps) {
  return (
    <Link
      className={buttonStyles({ className, size, variant })}
      {...props}
    />
  );
}
