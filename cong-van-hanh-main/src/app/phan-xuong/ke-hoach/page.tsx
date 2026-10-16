import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";
import { canAccessWorkshop } from "@/lib/workshop/runtime";

export const metadata: Metadata = { title: "Kế hoạch Xưởng | Cổng vận hành" };
export const dynamic = "force-dynamic";

export default async function WorkshopAllocationPage() {
  const session = await requireCurrentSession();
  if (!canAccessWorkshop(session, "workshop-allocation")) notFound();
  return <LegacyModuleFrame moduleKey="workshop-allocation" src="/legacy/workshop-allocation.html" title="Kế hoạch Xưởng" />;
}
