import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import {
  getLegalDossierQueue,
  hasAdminToolsAccess,
} from "@/lib/admin-tools/legal-dossier";
import { requireCurrentSession } from "@/lib/auth/session";

import { CorrectionWorkspace } from "./correction-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hiệu đính hồ sơ | Cổng vận hành",
};

export default async function HieuDinhPage() {
  const session = await requireCurrentSession();
  const allowed = hasAdminToolsAccess(session, "view");

  if (!allowed) {
    return (
      <AppShell activePath="/thuc-thi/hieu-dinh" moduleKey="admin-tools" session={session}>
        <Panel title="Không có quyền truy cập">
          <p className="text-sm leading-6 text-muted">
            Tài khoản hiện tại chưa được cấp module Công cụ Admin / Hiệu đính
            hồ sơ.
          </p>
        </Panel>
      </AppShell>
    );
  }

  let loadError = "";
  let data = null;
  try {
    data = await getLegalDossierQueue();
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Không kết nối được dữ liệu hồ sơ.";
  }

  if (!data) {
    return (
      <AppShell activePath="/thuc-thi/hieu-dinh" moduleKey="admin-tools" session={session}>
        <Panel title="Chưa tải được dữ liệu Hiệu đính">
          <p className="text-sm leading-6 text-muted">
            {loadError}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            Nếu đây là lần chạy đầu của schema hồ sơ mới, cần áp dụng migration
            PostgreSQL trước khi mở lại trang.
          </p>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell activePath="/thuc-thi/hieu-dinh" moduleKey="admin-tools" session={session}>
      <CorrectionWorkspace initialData={data} />
    </AppShell>
  );
}
