"use client";

import { Building2, Link2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

type HunonicSection = "account" | "layout";

const SECTIONS = [
  {
    icon: Link2,
    id: "account" as const,
    label: "Liên kết tài khoản",
  },
  {
    icon: Building2,
    id: "layout" as const,
    label: "Sơ đồ vận hành",
  },
];

export function HunonicSectionTabs({
  account,
  layout,
}: {
  account: ReactNode;
  layout: ReactNode;
}) {
  const [active, setActive] = useState<HunonicSection>("account");

  return (
    <section className="mt-5 space-y-5">
      <div
        aria-label="Khu vực cấu hình Hunonic"
        className="ui-module-toolbar grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-muted/70 p-1.5"
        role="tablist"
      >
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const selected = active === section.id;
          return (
            <button
              aria-controls={`hunonic-panel-${section.id}`}
              aria-selected={selected}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 ${
                selected
                  ? "border-brand bg-brand text-white shadow-[0_8px_20px_rgba(17,76,65,0.18)]"
                  : "border-transparent bg-transparent text-primary hover:border-border hover:bg-white"
              }`}
              id={`hunonic-tab-${section.id}`}
              key={section.id}
              onClick={() => setActive(section.id)}
              role="tab"
              type="button"
            >
              <Icon size={18} />
              {section.label}
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby="hunonic-tab-account"
        hidden={active !== "account"}
        id="hunonic-panel-account"
        role="tabpanel"
      >
        {account}
      </div>
      <div
        aria-labelledby="hunonic-tab-layout"
        hidden={active !== "layout"}
        id="hunonic-panel-layout"
        role="tabpanel"
      >
        {layout}
      </div>
    </section>
  );
}
