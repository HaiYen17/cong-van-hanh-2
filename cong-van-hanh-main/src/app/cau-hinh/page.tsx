import type { Metadata } from "next";
import { Building2, Pencil, Power, PowerOff } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, LinkButton, Panel } from "@/components/ui";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import { setCompanyStatusAction } from "./actions";
import { ConfigTabs } from "./config-tabs";
import { CompanyForm } from "./settings-forms";

export const metadata: Metadata = {
  title: "Cấu hình | Cổng vận hành",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ editCompany?: string }>;
}) {
  const session = await requireCurrentSession();
  const canRead = canAny(session, ["companies.read", "companies.manage"]);
  const canManage = can(session, "companies.manage");

  if (!canRead) {
    return (
      <AppShell activePath="/cau-hinh" moduleKey="config" session={session}>
        <Panel title="Không có quyền Cấu hình">
          <p className="text-sm leading-6 text-muted">
            Tài khoản hiện tại chưa được cấp quyền xem cấu hình công ty.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const { editCompany } = await searchParams;
  const companies = await getDb().company.findMany({
    include: { _count: { select: { employees: true } } },
    orderBy: [{ status: "asc" }, { code: "asc" }],
  });
  const editingSource = editCompany
    ? companies.find((company) => company.id === editCompany)
    : null;
  const editing = editingSource
    ? {
        address: editingSource.address,
        branchName: editingSource.branchName,
        businessRegistration: editingSource.businessRegistration,
        code: editingSource.code,
        id: editingSource.id,
        legalName: editingSource.legalName,
        oldAddress: editingSource.oldAddress,
        oldDistrictId: editingSource.oldDistrictId,
        oldDistrictName: editingSource.oldDistrictName,
        oldProvinceId: editingSource.oldProvinceId,
        oldProvinceName: editingSource.oldProvinceName,
        oldWardId: editingSource.oldWardId,
        oldWardName: editingSource.oldWardName,
        representative: editingSource.representative,
        sendMailAddressPriority: editingSource.sendMailAddressPriority,
        sendMailLocationKey: editingSource.sendMailLocationKey,
        shortName: editingSource.shortName,
        status: editingSource.status,
        taxCode: editingSource.taxCode,
      }
    : null;

  return (
    <AppShell activePath="/cau-hinh" moduleKey="config" session={session}>
      <ConfigTabs active="company" />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="ui-module-panel p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge tone="info">Cấu hình công ty</Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                {editing ? `Sửa ${editing.legalName}` : "Thêm công ty"}
              </h2>
            </div>
            {editing ? (
              <LinkButton href="/cau-hinh" size="sm" variant="secondary">
                Làm mới
              </LinkButton>
            ) : null}
          </div>
          {canManage ? (
            <CompanyForm editing={editing} />
          ) : (
            <p className="text-sm text-muted">
              Tài khoản hiện tại chỉ được xem danh sách công ty.
            </p>
          )}
        </section>

        <aside className="ui-module-panel h-fit p-5 xl:sticky xl:top-20">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <Badge tone="warning">Danh sách công ty</Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                {companies.length} công ty
              </h2>
            </div>
            <Building2 className="text-accent" size={28} />
          </div>
          <div className="max-h-[calc(100dvh-230px)] space-y-3 overflow-auto pr-1">
            {companies.map((company) => (
              <article
                className="rounded-lg border border-border bg-surface p-4"
                key={company.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-extrabold text-primary">
                      {company.legalName}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                      <span>{company.code}</span>
                      {company.shortName ? <span>· {company.shortName}</span> : null}
                      <span>· {company._count.employees} nhân sự</span>
                    </div>
                  </div>
                  <span
                    className={`ui-status-dot ${
                      company.status === "ACTIVE" ? "" : "ui-status-dot--orange"
                    }`}
                    title={
                      company.status === "ACTIVE" ? "Hoạt động" : "Tạm dừng"
                    }
                  />
                </div>
                {company.address ? (
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">
                    {company.address}
                  </p>
                ) : null}
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <LinkButton
                      href={`/cau-hinh?editCompany=${company.id}`}
                      size="sm"
                      variant="secondary"
                    >
                      <Pencil size={15} />
                      Sửa
                    </LinkButton>
                    <form
                      action={setCompanyStatusAction.bind(
                        null,
                        company.id,
                        company.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                      )}
                    >
                      <Button size="sm" type="submit" variant="ghost">
                        {company.status === "ACTIVE" ? (
                          <PowerOff size={15} />
                        ) : (
                          <Power size={15} />
                        )}
                        {company.status === "ACTIVE" ? "Tắt" : "Bật"}
                      </Button>
                    </form>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
