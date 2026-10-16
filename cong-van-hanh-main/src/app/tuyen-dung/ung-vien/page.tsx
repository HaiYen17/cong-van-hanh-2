import type { Metadata } from "next";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quản lý Ứng viên | Cổng vận hành",
};

export default async function CandidateManagementPage() {
  await requireCurrentSession();

  return (
    <LegacyModuleFrame
      moduleKey="candidate-management"
      src="/legacy/recruitment-management.html"
      title="Quản lý Ứng viên"
    />
  );
}
