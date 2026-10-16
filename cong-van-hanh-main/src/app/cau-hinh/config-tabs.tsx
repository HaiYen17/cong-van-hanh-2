import Link from "next/link";

import { cx } from "@/lib/cx";

// Các tab Cấu hình hành chính, bổ sung kết nối Hunonic của Cổng Vận hành.
const TABS = [
  { href: "/cau-hinh", key: "company", label: "Công ty" },
  {
    href: "/cau-hinh/dong-bo-nhan-su?view=source",
    key: "personnel-source",
    label: "Nguồn nhân sự",
  },
  {
    href: "/cau-hinh/dong-bo-nhan-su?view=identity",
    key: "personnel-identity",
    label: "Liên kết nhân sự",
  },
  { href: "/cau-hinh/loai-van-ban", key: "document", label: "Loại văn bản" },
  { href: "/cau-hinh/thong-bao", key: "event", label: "Sự kiện" },
  { href: "/cau-hinh/hunonic", key: "hunonic", label: "Hunonic" },
  { href: "/cau-hinh/lich-hop", key: "meetings", label: "Lịch họp" },
  {
    href: "/cau-hinh/ban-lam-viec",
    key: "workbench",
    label: "Bàn làm việc",
  },
] as const;

export type ConfigTabKey = (typeof TABS)[number]["key"];

export function ConfigTabs({ active }: { active: ConfigTabKey }) {
  return (
    <nav className="mt-5 flex flex-wrap gap-0.5 border-b border-border">
      {TABS.map((t) => (
        <Link
          className={cx(
            "-mb-px rounded-t-xl border-b-2 px-4 py-2.5 text-sm font-semibold transition",
            t.key === active
              ? "border-accent text-primary"
              : "border-transparent text-muted hover:bg-surface/60 hover:text-primary",
          )}
          href={t.href}
          key={t.key}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
