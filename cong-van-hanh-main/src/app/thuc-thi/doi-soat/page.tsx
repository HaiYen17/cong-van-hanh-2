import type { Metadata } from "next";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";
import { assertReconciliationAccess } from "@/lib/reconciliation/service";

export const metadata: Metadata = {
  title: "Đối soát | Cổng vận hành",
};

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const session = await requireCurrentSession();
  assertReconciliationAccess(session);

  return (
    <LegacyModuleFrame
      moduleKey="reconciliation"
      src="/legacy/reconciliation.html"
      title="Đối soát"
    />
  );
}
