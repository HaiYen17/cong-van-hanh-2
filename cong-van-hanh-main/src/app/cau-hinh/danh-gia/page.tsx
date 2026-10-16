import type { Metadata } from "next";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Cấu hình đánh giá | Cổng vận hành",
};

export default async function EvaluationConfigPage() {
  await requireCurrentSession();

  return (
    <LegacyModuleFrame
      moduleKey="evaluation-config"
      src="/legacy/evaluation-config.html"
      title="Cấu hình Đánh giá"
      version="20260930-monitor-sections-v2"
    />
  );
}
