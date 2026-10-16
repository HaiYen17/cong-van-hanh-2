import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getWorkbenchAdminSnapshot } from "@/lib/workbench/admin";

import { ConfigTabs } from "../config-tabs";
import { WorkbenchConfigWorkspace } from "./workbench-config-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cấu hình Bàn làm việc | Cổng vận hành",
};

export default async function WorkbenchConfigPage() {
  const session = await requireCurrentSession();
  const canRead =
    session.fullAccess ||
    session.modules.includes("workbench-config") ||
    canAny(session, ["workbench_config.read", "workbench_config.manage"]);
  const canManage = session.fullAccess || can(session, "workbench_config.manage");

  if (!canRead) {
    return (
      <AppShell activePath="/cau-hinh/ban-lam-viec" moduleKey="workbench-config" session={session}>
        <Panel title="Không có quyền Cấu hình Bàn làm việc">
          <p className="text-sm leading-6 text-muted">
            Tài khoản hiện tại chưa được cấp quyền xem registry widget và nguồn công việc.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const snapshot = await getWorkbenchAdminSnapshot();
  return (
    <AppShell activePath="/cau-hinh/ban-lam-viec" moduleKey="workbench-config" session={session}>
      <ConfigTabs active="workbench" />
      <WorkbenchConfigWorkspace canManage={canManage} initialSnapshot={snapshot} />
    </AppShell>
  );
}
