import type { Metadata } from "next";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Kết quả đánh giá Ứng viên | Cổng vận hành",
};

export default async function CandidateResultsPage() {
  await requireCurrentSession();
  return (
    <LegacyModuleFrame
      moduleKey="candidate-results"
      src="/legacy/recruitment-results.html"
      title="Kết quả Ứng viên"
    />
  );
}
