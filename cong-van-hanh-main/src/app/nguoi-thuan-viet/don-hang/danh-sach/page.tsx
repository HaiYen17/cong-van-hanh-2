import type { Metadata } from "next";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Danh sách đơn của tôi | Cổng vận hành",
};

export default async function MyOrderListPage() {
  await requireCurrentSession();
  return (
    <LegacyModuleFrame
      moduleKey="my-orders"
      src="/legacy/inbox-me.html?v=20260820-2"
      title="Danh sách đơn của tôi"
    />
  );
}
