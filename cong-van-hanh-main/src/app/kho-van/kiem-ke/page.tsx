import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { LinkButton, Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getWarehouseInventoryWorkspace } from "@/lib/warehouse/inventory";

import { WarehouseInventoryWorkspace } from "./warehouse-inventory-workspace";
import { ShelfInventoryTabs } from "./shelf-inventory-tabs";

export const metadata: Metadata = {
  title: "Kiểm kê Kho RFID | Cổng vận hành",
};

export const dynamic = "force-dynamic";

export default async function WarehouseInventoryPage() {
  const session = await requireCurrentSession();
  const allowed =
    session.fullAccess ||
    session.modules.includes("warehouse-inventory") ||
    session.moduleGroups.includes("warehouse");

  return (
    <AppShell activePath="/" moduleKey="warehouse-inventory" session={session}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href="/" size="sm" variant="ghost">
          ← Trang dịch vụ
        </LinkButton>
      </div>

      {!allowed ? (
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp module Kiểm kê Kho.
          </p>
        </Panel>
      ) : (
        <ShelfInventoryTabs><WarehouseInventoryWorkspace
          initialData={await getWarehouseInventoryWorkspace(session)}
        /></ShelfInventoryTabs>
      )}
    </AppShell>
  );
}
