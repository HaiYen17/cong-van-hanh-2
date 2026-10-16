import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { LinkButton, Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getShelfSkuConfigWorkspace } from "@/lib/warehouse/shelf-config";

import { ShelfSkuConfigWorkspace } from "./shelf-sku-config-workspace";

export const metadata: Metadata = {
  title: "Cấu hình kệ | Cổng vận hành",
};

export const dynamic = "force-dynamic";

export default async function ShelfSkuConfigPage() {
  const session = await requireCurrentSession();
  const allowed =
    session.fullAccess ||
    session.modules.includes("warehouse-shelf-config") ||
    session.moduleGroups.includes("warehouse");

  return (
    <AppShell activePath="/" moduleKey="warehouse-shelf-config" session={session}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href="/" size="sm" variant="ghost">
          ← Trang dịch vụ
        </LinkButton>
        <LinkButton href="/kho-van/thong-tin" size="sm" variant="ghost">
          Thông tin Kệ/Xe
        </LinkButton>
        <LinkButton href="/kho-van/kiem-ke" size="sm" variant="ghost">
          Kiểm kê RFID
        </LinkButton>
      </div>

      {!allowed ? (
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp module Cấu hình kệ.
          </p>
        </Panel>
      ) : (
        <ShelfSkuConfigWorkspace
          initialData={await getShelfSkuConfigWorkspace(session)}
        />
      )}
    </AppShell>
  );
}
