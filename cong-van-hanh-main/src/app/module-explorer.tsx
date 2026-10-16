"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { ModuleIcon } from "@/lib/module-icons";

export type ModuleCard = {
  description: string | null;
  href: string | null;
  icon: string | null;
  key: string;
  label: string;
};

export type GroupBlock = { key: string; modules: ModuleCard[]; title: string };
export type CollectionBlock = { groups: GroupBlock[]; title: string };

// Tông màu nhóm — bám --group-accent / --group-accent-soft bản cũ (AppStyles).
type Tone = { accent: string; soft: string };
const TONES: Tone[] = [
  { accent: "#114c41", soft: "rgba(17,76,65,0.12)" }, // emerald
  { accent: "#c97716", soft: "rgba(233,133,29,0.12)" }, // amber
  { accent: "#0d6b6a", soft: "rgba(13,107,106,0.12)" }, // teal
  { accent: "#cf5c35", soft: "rgba(207,92,53,0.12)" }, // coral
];

function norm(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// .feature-card bản cũ: căn giữa, icon 58px trên, tên dưới (màu tông), bo 26px, hover nhấc -4px.
function FeatureCard({ appModule, tone }: { appModule: ModuleCard; tone: Tone }) {
  const inner = (
    <>
      <span
        className="grid size-[58px] place-items-center rounded-[18px]"
        style={{ backgroundColor: tone.soft, color: tone.accent }}
      >
        <ModuleIcon className="size-[30px]" name={appModule.icon} />
      </span>
      <span className="text-[0.92rem] font-bold leading-[1.38]" style={{ color: tone.accent }}>
        {appModule.label}
      </span>
    </>
  );
  const base =
    "group relative flex min-h-[142px] flex-col items-center justify-center gap-3 rounded-[26px] border border-white/85 bg-gradient-to-b from-white to-white/[0.88] px-3.5 py-[18px] text-center shadow-[0_14px_28px_rgba(17,45,39,0.08)] transition-all duration-200";

  if (appModule.href) {
    return (
      <Link className={`${base} hover:-translate-y-1 hover:border-accent/20 hover:shadow-[0_20px_36px_rgba(17,45,39,0.13)]`} href={appModule.href}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={base}>
      {inner}
      <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[26px] bg-primary/[0.86] opacity-0 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-100">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm font-bold text-white">🔒 Sắp ra mắt</span>
      </div>
    </div>
  );
}

export function ModuleExplorer({ collections }: { collections: CollectionBlock[] }) {
  const [query, setQuery] = useState("");
  const nq = norm(query.trim());

  const filtered = useMemo(() => {
    if (!nq) return collections;
    return collections
      .map((collection) => ({
        ...collection,
        groups: collection.groups
          .map((group) => ({
            ...group,
            modules: group.modules.filter(
              (m) => norm(m.label).includes(nq) || (m.description ? norm(m.description).includes(nq) : false),
            ),
          }))
          .filter((group) => group.modules.length > 0),
      }))
      .filter((collection) => collection.groups.length > 0);
  }, [collections, nq]);

  return (
    <div className="space-y-[22px]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" strokeWidth={1.7} />
        <input
          className="h-12 w-full rounded-full border border-border bg-surface pl-12 pr-4 text-sm text-foreground shadow-[0_8px_22px_rgba(17,45,39,0.05)] outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm nhanh module bạn cần..."
          type="search"
          value={query}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-sm leading-6 text-muted">
          Không tìm thấy module nào khớp “{query}”.
        </div>
      ) : (
        filtered.map((collection, ci) => {
          const tone = TONES[ci % TONES.length];
          return (
            // .feature-group: card trắng bo 30px
            <section
              className="rounded-[30px] border border-white/70 bg-white/[0.78] p-6 shadow-[0_10px_24px_rgba(17,45,39,0.06),0_2px_6px_rgba(17,45,39,0.03)]"
              key={collection.title}
            >
              <h2 className="mb-[18px] font-heading text-[1.28rem] font-extrabold tracking-[-0.02em]" style={{ color: tone.accent }}>
                {collection.title}
              </h2>
              <div className="grid gap-[18px]">
                {collection.groups.map((group) => (
                  <div className="grid gap-3.5" key={group.key}>
                    {collection.groups.length > 1 || group.title !== collection.title ? (
                      <h3 className="font-heading text-[1rem] font-bold tracking-[-0.02em]" style={{ color: tone.accent }}>
                        {group.title}
                      </h3>
                    ) : null}
                    {/* .feature-grid: auto-fit minmax(180px,1fr) */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4">
                      {group.modules.map((appModule) => (
                        <FeatureCard appModule={appModule} key={appModule.key} tone={tone} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
