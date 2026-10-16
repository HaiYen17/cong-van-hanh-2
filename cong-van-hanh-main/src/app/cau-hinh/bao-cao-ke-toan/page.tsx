import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";

import { AccountingConfigFrame } from "./accounting-config-frame";

export const metadata: Metadata = {
  title: "Cấu hình Báo cáo Kế toán | Cổng vận hành",
};

export default async function AccountingConfigPage() {
  const session = await requireCurrentSession();

  if (!can(session, "accounting.config.read")) {
    return (
      <AppShell
        activePath="/cau-hinh"
        moduleKey="accounting-config"
        session={session}
      >
        <Panel title="Không có quyền">
          <p className="text-sm leading-6 text-muted">
            Tài khoản chưa được cấp quyền xem cấu hình Báo cáo Kế toán.
          </p>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell
      activePath="/cau-hinh"
      moduleKey="accounting-config"
      session={session}
    >
      <AccountingConfigFrame />
    </AppShell>
  );
}
