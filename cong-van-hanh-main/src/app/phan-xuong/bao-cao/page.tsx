import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";
import { canAccessWorkshop } from "@/lib/workshop/runtime";

export const metadata: Metadata = { title: "Báo cáo Xưởng | Cổng vận hành" };
export const dynamic = "force-dynamic";

export default async function WorkshopReportPage() {
  const session = await requireCurrentSession();
  if (!canAccessWorkshop(session, "workshop-report")) notFound();
  return <LegacyModuleFrame moduleKey="workshop-report" src="/legacy/workshop-report.html" title="Báo cáo Xưởng" />;
}
