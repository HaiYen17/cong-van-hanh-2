import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Badge, Panel } from "@/components/ui";
import { getHunonicConfigSnapshot } from "@/lib/air-control/config";
import { getElectricalLayoutConfig } from "@/lib/air-control/electrical-layout";
import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";

import { ConfigTabs } from "../config-tabs";
import { HunonicConfigForm } from "./hunonic-config-form";
import { ElectricalLayoutConfig } from "./electrical-layout-config";
import { HunonicSectionTabs } from "./hunonic-section-tabs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cấu hình Hunonic | Cổng vận hành",
};

export default async function HunonicConfigPage() {
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) {
    return (
      <AppShell activePath="/cau-hinh" session={session}>
        <Panel title="Không có quyền Cấu hình Hunonic">
          <p className="text-sm leading-6 text-muted">
            Tài khoản hiện tại chưa được cấp quyền quản lý cấu hình hệ thống.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const [snapshot, layout] = await Promise.all([
    getHunonicConfigSnapshot(),
    getElectricalLayoutConfig(),
  ]);
  return (
    <AppShell activePath="/cau-hinh" session={session}>
      <section className="space-y-2">
        <Badge tone="info">Admin Hành chính</Badge>
        <h1 className="text-3xl font-extrabold tracking-tight text-primary">
          Cấu hình
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Lưu tài khoản Hunonic dùng riêng cho Cổng; phần kết nối kỹ thuật được
          hệ thống quản lý ở chế độ nâng cao.
        </p>
      </section>

      <ConfigTabs active="hunonic" />
      <HunonicSectionTabs
        account={<HunonicConfigForm initial={snapshot} />}
        layout={<ElectricalLayoutConfig initial={layout} />}
      />
    </AppShell>
  );
}
