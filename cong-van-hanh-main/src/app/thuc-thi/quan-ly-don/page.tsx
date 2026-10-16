import type { Metadata } from "next";
import Link from "next/link";

import { DigitalSignatureQueue } from "@/components/digital-signature-queue";
import styles from "@/components/digital-signature-queue.module.css";
import { AppShell } from "@/components/layout/app-shell";
import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { Panel } from "@/components/ui";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Quản lý đơn hàng | Cổng vận hành",
};

export default async function QuanLyDonPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireCurrentSession();
  const canRead = canAny(session, [
    "admin_requests.read",
    "admin_requests.process",
  ]);
  const canProcessSignatures = session.fullAccess || can(session, "admin_requests.process");

  if (!canRead) {
    return (
      <AppShell activePath="/thuc-thi" moduleKey="order-management" session={session}>
        <Panel title="Không có quyền">
          <p className="text-sm leading-6 text-muted">
            Trang này dành cho người xử lý đơn (Admin Hành chính).
          </p>
        </Panel>
      </AppShell>
    );
  }

  const signatureTab = (await searchParams).tab === "ky-so";
  const tabs = (
    <nav aria-label="Quản lý đơn hàng" className={`${styles.orderTabs} ${signatureTab ? "" : styles.legacyTabs}`}>
      <Link aria-current={signatureTab ? undefined : "page"} className={styles.orderTab} href="/thuc-thi/quan-ly-don">Đơn hàng</Link>
      <Link aria-current={signatureTab ? "page" : undefined} className={styles.orderTab} href="/thuc-thi/quan-ly-don?tab=ky-so">Ký số</Link>
    </nav>
  );

  if (signatureTab) {
    return (
      <AppShell activePath="/thuc-thi" moduleKey="order-management" session={session}>
        {tabs}
        {canProcessSignatures ? <DigitalSignatureQueue mode="admin" /> : (
          <Panel title="Không có quyền duyệt ký">
            <p className="text-sm leading-6 text-muted">
              Tab Ký số chỉ dành cho Admin có quyền xử lý đơn hàng.
            </p>
          </Panel>
        )}
      </AppShell>
    );
  }

  return <>
    {tabs}
    <div className={styles.legacyFrame}>
      <LegacyModuleFrame moduleKey="order-management" src="/legacy/inbox-admin.html?v=20260820-2" title="Quản lý đơn hàng" />
    </div>
  </>;
}
