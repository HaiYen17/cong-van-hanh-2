import Link from "next/link";

import { cx } from "@/lib/cx";

export type ModuleTab = {
  href: string;
  key: string;
  label: string;
};

export function ModuleTabs({
  active,
  tabs,
}: {
  active: string;
  tabs: ModuleTab[];
}) {
  return (
    <nav className="mt-5 flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          className={cx(
            "-mb-px shrink-0 rounded-t-xl border-b-2 px-4 py-2.5 text-sm font-semibold transition",
            active === tab.key
              ? "border-accent bg-white/55 text-primary"
              : "border-transparent text-muted hover:bg-white/40 hover:text-primary",
          )}
          href={tab.href}
          key={tab.key}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function ModuleStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white/75 px-4 py-4 shadow-[0_10px_24px_rgba(17,45,39,0.05)]">
      <div className="text-2xl font-extrabold text-primary">{value}</div>
      <div className="mt-1 text-xs font-semibold text-muted">{label}</div>
    </div>
  );
}
