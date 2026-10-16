import type { Metadata } from "next";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Đánh giá Ứng viên | Cổng vận hành",
};

export default async function CandidateAssessmentPage() {
  await requireCurrentSession();
  return (
    <LegacyModuleFrame
      moduleKey="candidate-assessment"
      src="/legacy/recruitment-assessment.html"
      title="Đánh giá Ứng viên"
    />
  );
}
