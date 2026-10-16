import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";
import { canAccessWorkshop } from "@/lib/workshop/runtime";

export const metadata: Metadata = { title: "Đặt hàng Xưởng | Cổng vận hành" };
export const dynamic = "force-dynamic";

export default async function WorkshopOrderPage() {
  const session = await requireCurrentSession();
  if (!canAccessWorkshop(session, "workshop-order")) notFound();
  return <LegacyModuleFrame moduleKey="workshop-order" src="/legacy/workshop-order.html" title="Đặt hàng Xưởng" />;
}
