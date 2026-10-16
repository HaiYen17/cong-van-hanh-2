import Link from "next/link";

import { cx } from "@/lib/cx";

// Thanh tab khu Thực thi — gom các màn vận hành về một dải tab nhất quán.
export type ExecTabKey = "yeu-cau" | "quan-ly" | "so-van-ban";

export function ExecTabs({ active, showManage }: { active: ExecTabKey; showManage: boolean }) {
  const tabs = [
    { href: "/thuc-thi", key: "yeu-cau", label: "Yêu cầu của tôi" },
    ...(showManage ? [{ href: "/thuc-thi/quan-ly-don", key: "quan-ly", label: "Quản lý đơn" }] : []),
    { href: "/thuc-thi/so-van-ban", key: "so-van-ban", label: "Sổ văn bản" },
  ] as const;

  return (
    <nav className="mt-5 flex flex-wrap gap-0.5 border-b border-border">
      {tabs.map((t) => (
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
