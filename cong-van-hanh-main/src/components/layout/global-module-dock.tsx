"use client";

import { Home, PanelsTopLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const WORKBENCH_PATH = "/nguoi-thuan-viet/don-hang";

export function GlobalModuleDock() {
  const pathname = usePathname();
  if (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/ket-qua-ung-vien")
  ) {
    return null;
  }

  return (
    <nav
      aria-label="Điều hướng nhanh toàn hệ thống"
      className="fixed right-2 top-1/2 z-[180] flex -translate-y-1/2 flex-col gap-1.5 rounded-xl border border-[#114c41]/15 bg-white/95 p-1.5 shadow-[0_18px_42px_rgba(14,30,26,0.22)] backdrop-blur sm:right-4"
    >
      <Link
        aria-label="Về Trang dịch vụ"
        className="group relative grid size-11 place-items-center rounded-lg border border-transparent text-[#114c41] transition hover:border-[#114c41]/15 hover:bg-[#e7f4f0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4196a]"
        href="/"
        title="Về Trang dịch vụ"
      >
        <Home aria-hidden="true" size={20} strokeWidth={2.2} />
        <span className="pointer-events-none absolute right-[calc(100%+8px)] hidden whitespace-nowrap rounded-md bg-[#114c41] px-2.5 py-1.5 text-xs font-extrabold text-white shadow-lg group-hover:block group-focus-visible:block">
          Trang dịch vụ
        </span>
      </Link>
      <span aria-hidden="true" className="mx-1 h-px bg-[#114c41]/10" />
      <Link
        aria-current={pathname === WORKBENCH_PATH ? "page" : undefined}
        aria-label="Về Bàn làm việc của tôi"
        className={`group relative grid size-11 place-items-center rounded-lg border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4196a] ${
          pathname === WORKBENCH_PATH
            ? "border-[#d4196a]/20 bg-[#fff0f6] text-[#d4196a]"
            : "border-transparent text-[#114c41] hover:border-[#114c41]/15 hover:bg-[#e7f4f0]"
        }`}
        href={WORKBENCH_PATH}
        title="Về Bàn làm việc của tôi"
      >
        <PanelsTopLeft aria-hidden="true" size={21} strokeWidth={2.2} />
        <span className="pointer-events-none absolute right-[calc(100%+8px)] hidden whitespace-nowrap rounded-md bg-[#114c41] px-2.5 py-1.5 text-xs font-extrabold text-white shadow-lg group-hover:block group-focus-visible:block">
          Bàn làm việc của tôi
        </span>
      </Link>
    </nav>
  );
}
