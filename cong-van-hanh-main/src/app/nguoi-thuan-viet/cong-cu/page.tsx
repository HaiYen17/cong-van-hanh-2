import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { canAccessSupportTools } from "@/lib/support-tools/runtime";

export const metadata: Metadata = {
  title: "Công cụ hỗ trợ | Cổng vận hành",
};

export default async function SupportToolsPage() {
  const session = await requireCurrentSession();
  if (!canAccessSupportTools(session)) {
    return (
      <AppShell activePath="/" moduleKey="support-tools" session={session}>
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở Công cụ hỗ trợ.
          </p>
        </Panel>
      </AppShell>
    );
  }

  return (
    <LegacyModuleFrame
      moduleKey="support-tools"
      src="/legacy/support-tools.html"
      title="Công cụ hỗ trợ"
    />
  );
}
