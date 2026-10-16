import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getTemplateManagementSnapshot } from "@/lib/templates/runtime";

import { TemplateManagementWorkspace } from "./template-management-workspace";

export const metadata: Metadata = {
  title: "Cấu hình Biểu mẫu | Cổng vận hành",
};

export default async function TemplateManagementPage() {
  const session = await requireCurrentSession();
  let snapshot: Awaited<
    ReturnType<typeof getTemplateManagementSnapshot>
  > | null = null;
  try {
    snapshot = await getTemplateManagementSnapshot(session);
  } catch {}

  return (
    <AppShell activePath="/cau-hinh" moduleKey="template-management" session={session}>
      {snapshot ? (
        <TemplateManagementWorkspace initial={snapshot} />
      ) : (
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền Cấu hình Biểu mẫu.
          </p>
        </Panel>
      )}
    </AppShell>
  );
}
