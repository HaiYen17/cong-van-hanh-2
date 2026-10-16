import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";
import { canAccessWorkshop } from "@/lib/workshop/runtime";

export const metadata: Metadata = { title: "Phân bổ thủ công | Cổng vận hành" };
export const dynamic = "force-dynamic";

export default async function WorkshopPlanPage() {
  const session = await requireCurrentSession();
  if (!canAccessWorkshop(session, "workshop-plan")) notFound();
  return <LegacyModuleFrame moduleKey="workshop-plan" src="/legacy/workshop-plan.html" title="Phân bổ thủ công" />;
}
