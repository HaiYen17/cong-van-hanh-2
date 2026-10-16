import type { Metadata } from "next";

import { DigitalSignatureQueue } from "@/components/digital-signature-queue";
import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Duyệt hồ sơ ký số | Cổng vận hành",
};

export default async function DigitalSignatureApprovalPage() {
  const session = await requireCurrentSession();
  const canRead = session.fullAccess || canAny(session, ["approvals.read", "approvals.approve"]);

  return (
    <AppShell activePath="/thuc-thi/ky-so-phe-duyet" moduleKey="approvals" session={session}>
      {canRead ? <DigitalSignatureQueue mode="bod" /> : (
        <Panel title="Không có quyền">
          <p className="text-sm leading-6 text-muted">Trang này dành cho BOD được phân quyền duyệt hồ sơ.</p>
        </Panel>
      )}
    </AppShell>
  );
}
