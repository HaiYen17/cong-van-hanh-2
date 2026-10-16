import type { Metadata } from "next";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Đánh giá nhân sự | Cổng vận hành",
};

export default async function EmployeeEvaluationPage() {
  await requireCurrentSession();

  return (
    <LegacyModuleFrame
      moduleKey="evaluation"
      src="/legacy/evaluation.html"
      title="Đánh giá Nhân sự"
      version="20260929-section-font-order-v1"
    />
  );
}
