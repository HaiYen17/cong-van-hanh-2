import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";
import { canAccessWorkshop } from "@/lib/workshop/runtime";

export const metadata: Metadata = { title: "Đề xuất Xưởng | Cổng vận hành" };
export const dynamic = "force-dynamic";

export default async function WorkshopProposalPage() {
  const session = await requireCurrentSession();
  if (!canAccessWorkshop(session, "workshop-proposal")) notFound();
  return <LegacyModuleFrame moduleKey="workshop-proposal" src="/legacy/workshop-proposal.html" title="Đề xuất Xưởng" />;
}
