import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { canAccessAssetSetup } from "@/lib/assets/setup-runtime";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Setup tài sản | Cổng vận hành",
};

export const dynamic = "force-dynamic";

export default async function AssetSetupPage() {
  const session = await requireCurrentSession();
  if (!canAccessAssetSetup(session)) notFound();

  return (
    <LegacyModuleFrame
      moduleKey="asset-setup"
      src="/legacy/asset-setup.html"
      title="Setup tài sản"
    />
  );
}
