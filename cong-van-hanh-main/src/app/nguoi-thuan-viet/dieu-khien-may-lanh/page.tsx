import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import {
  canAccessAirControl,
  canViewAirControlHistory,
  getAirControlSnapshot,
} from "@/lib/air-control/runtime";
import { preferredElectricalOfficeForCompany } from "@/lib/air-control/office-preference";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import { ElectricalSystemWorkspace } from "./air-conditioner-control-workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Quản lý hệ thống điện | Cổng vận hành",
};

export default async function AirConditionerControlPage() {
  const session = await requireCurrentSession();
  if (!canAccessAirControl(session)) {
    return (
      <AppShell activePath="/" moduleKey="air-conditioner-control" session={session}>
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở Quản lý hệ thống điện.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const [snapshot, user] = await Promise.all([
    getAirControlSnapshot(session),
    getDb().user.findUnique({
      select: {
        employee: {
          select: {
            company: {
              select: { code: true, legalName: true, shortName: true },
            },
          },
        },
      },
      where: { id: session.userId },
    }),
  ]);
  const preferredOffice = preferredElectricalOfficeForCompany(
    user?.employee?.company,
  );
  return (
    <AppShell activePath="/" moduleKey="air-conditioner-control" session={session}>
      <ElectricalSystemWorkspace
        canViewHistory={canViewAirControlHistory(session)}
        initialSnapshot={snapshot}
        preferredOffice={preferredOffice}
      />
    </AppShell>
  );
}
