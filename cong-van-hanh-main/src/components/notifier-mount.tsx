"use client";

import dynamic from "next/dynamic";

import type { MotivationItem } from "@/lib/motivation";

// Chỉ render phía client (ssr:false) → tự do đọc localStorage, không lệch hydrate.
const NotifierPopup = dynamic(
  () => import("./notifier-popup").then((m) => m.NotifierPopup),
  { ssr: false },
);

export function NotifierMount({ notifications }: { notifications: MotivationItem[] }) {
  return <NotifierPopup notifications={notifications} />;
}
