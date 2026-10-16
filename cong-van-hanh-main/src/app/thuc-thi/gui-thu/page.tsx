import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { LinkButton, Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { sessionUserIds } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { listAccessibleVtpAccounts } from "@/lib/send-mail/account-access";
import { buildSendMailLocationOptions } from "@/lib/send-mail/office-locations";

import { GuiThuForm } from "./gui-thu-form";
import { MailStatusRefreshButton } from "./mail-order-controls";
import { MailOrderList } from "./mail-order-list";

export const metadata: Metadata = { title: "Gửi thư ViettelPost | Cổng vận hành" };

export default async function GuiThuPage() {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const db = getDb();
  const { accounts, actor } = await listAccessibleVtpAccounts(session);

  const [employees, orders, companyLocations] = await Promise.all([
    db.employee.findMany({
      orderBy: { fullName: "asc" },
      select: {
        company: { select: { legalName: true, shortName: true } },
        department: true,
        employeeCode: true,
        fullName: true,
        phone: true,
        title: true,
      },
      where: { phone: { not: null }, status: "ACTIVE" },
    }),
    db.mailOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      where: { createdById: { in: identityUserIds } },
    }),
    db.company.findMany({
      select: {
        address: true,
        branchName: true,
        legalName: true,
        oldAddress: true,
        oldDistrictId: true,
        oldDistrictName: true,
        oldProvinceId: true,
        oldProvinceName: true,
        oldWardId: true,
        oldWardName: true,
        sendMailAddressPriority: true,
        sendMailLocationKey: true,
        shortName: true,
      },
      where: {
        sendMailLocationKey: { not: null },
        status: "ACTIVE",
      },
    }),
  ]);

  const accountOptions = accounts.map((a) => ({
    company: a.company?.shortName ?? a.company?.legalName ?? "",
    defaultLocationKey: a.company?.sendMailLocationKey ?? "",
    env: a.env,
    hasToken: Boolean(a.token),
    id: a.id,
    name: a.name,
  }));
  const employeeOptions = employees
    .filter((e) => e.phone)
    .map((e) => ({
      company: e.company?.shortName ?? e.company?.legalName ?? "",
      department: e.department ?? "",
      employeeId: e.employeeCode,
      name: e.fullName,
      phone: e.phone as string,
      title: e.title ?? "",
    }));
  const locationOptions = buildSendMailLocationOptions(companyLocations);

  return (
    <AppShell activePath="/thuc-thi" moduleKey="send-mail" session={session}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href="/thuc-thi" size="sm" variant="ghost">← Khu Thực thi</LinkButton>
      </div>

      <Panel className="mt-5" title="Tạo vận đơn">
        {accountOptions.length === 0 ? (
          <p className="text-sm text-muted">
            Chưa có tài khoản ViettelPost. Nhờ admin thêm ở{" "}
            <LinkButton href="/cau-hinh/tong" size="sm" variant="ghost">Cấu hình Tổng</LinkButton>.
          </p>
        ) : (
          <GuiThuForm
            accounts={accountOptions}
            defaultSenderName={actor.fullName}
            defaultSenderPhone={actor.phone}
            employees={employeeOptions}
            locations={locationOptions}
          />
        )}
      </Panel>

      <Panel
        actions={<MailStatusRefreshButton />}
        className="mt-5"
        title={`Đơn của tôi gần đây (${orders.length})`}
      >
        <MailOrderList orders={orders} />
      </Panel>
    </AppShell>
  );
}
