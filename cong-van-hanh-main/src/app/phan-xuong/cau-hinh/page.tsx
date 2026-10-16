import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";
import { canAccessWorkshop } from "@/lib/workshop/runtime";

export const metadata: Metadata = { title: "Cấu hình Xưởng | Cổng vận hành" };
export const dynamic = "force-dynamic";

export default async function WorkshopConfigPage() {
  const session = await requireCurrentSession();
  if (!canAccessWorkshop(session, "workshop-config")) notFound();
  return <LegacyModuleFrame moduleKey="workshop-config" src="/legacy/workshop-config.html" title="Cấu hình Xưởng" />;
}
