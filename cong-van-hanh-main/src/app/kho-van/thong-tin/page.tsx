import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { LinkButton, Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getWarehouseInfoWorkspace } from "@/lib/warehouse/definition";
import { getWarehouseShelfDefinitions } from "@/lib/warehouse/shelves";

import { WarehouseInfoWorkspace } from "./warehouse-info-workspace";

export const metadata: Metadata = {
  title: "Thông tin kho RFID | Cổng vận hành",
};

export const dynamic = "force-dynamic";

export default async function WarehouseInfoPage() {
  const session = await requireCurrentSession();
  const allowed =
    session.fullAccess ||
    session.modules.includes("warehouse-info") ||
    session.moduleGroups.includes("warehouse");
  const [initialData, initialShelves] = allowed
    ? await Promise.all([
        getWarehouseInfoWorkspace(session),
        getWarehouseShelfDefinitions(session),
      ])
    : [null, []];

  return (
    <AppShell activePath="/" moduleKey="warehouse-info" session={session}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href="/" size="sm" variant="ghost">
          ← Trang dịch vụ
        </LinkButton>
        <LinkButton href="/kho-van/cau-hinh" size="sm" variant="ghost">
          Cấu hình Kho
        </LinkButton>
        <LinkButton href="/kho-van/kiem-ke" size="sm" variant="ghost">
          Kiểm kê RFID
        </LinkButton>
      </div>

      {!allowed ? (
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp module Thông tin kho.
          </p>
        </Panel>
      ) : (
        <WarehouseInfoWorkspace
          initialData={initialData!}
          initialShelves={initialShelves}
        />
      )}
    </AppShell>
  );
}
