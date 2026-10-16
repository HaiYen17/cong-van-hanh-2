import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";

type PanelProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  title: string;
};

export function Panel({
  actions,
  children,
  className,
  title,
  ...props
}: PanelProps) {
  return (
    <section
      className={cx(
        "app-panel border p-6",
        className,
      )}
      {...props}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold text-primary">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
