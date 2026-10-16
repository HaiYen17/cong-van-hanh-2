import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";
import { canAccessWorkshop } from "@/lib/workshop/runtime";

export const metadata: Metadata = { title: "Duyệt KH Xưởng | Cổng vận hành" };
export const dynamic = "force-dynamic";

export default async function WorkshopPlanApprovalPage() {
  const session = await requireCurrentSession();
  if (!canAccessWorkshop(session, "workshop-plan-approval")) notFound();
  return <LegacyModuleFrame moduleKey="workshop-plan-approval" src="/legacy/workshop-plan-approval.html" title="Duyệt KH Xưởng" />;
}
