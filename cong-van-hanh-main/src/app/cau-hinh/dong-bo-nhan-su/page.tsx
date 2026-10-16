import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, LinkButton, Panel } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import type { PersonnelMappings } from "@/lib/personnel";
import { PERSONNEL_SHEETS_READER_ACCOUNT } from "@/lib/personnel-sheet";

import { ConfigTabs } from "../config-tabs";
import {
  PersonnelIdentityDeleteButton,
  PersonnelIdentityForm,
} from "../settings-forms";
import {
  deletePersonnelSourceAction,
  setPersonnelSourceStatusAction,
} from "./actions";
import { PersonnelSourceForm, type EditingSource } from "./source-form";
import { SyncSourceButton } from "./sync-source-button";

export const metadata: Metadata = {
  title: "Nhân sự | Cổng vận hành",
};

function fmt(value: Date | null) {
  if (!value) return "Chưa đồng bộ";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

export default async function PersonnelConfigPage({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    editIdentity?: string;
    view?: string;
  }>;
}) {
  const session = await requireCurrentSession();
  const canRead = canAny(session, [
    "system.settings.read",
    "system.settings.manage",
    "employees.read",
    "employees.manage",
  ]);
  const canManage = canAny(session, [
    "system.settings.manage",
    "employees.manage",
  ]);
  const canManageSettings = can(session, "system.settings.manage");
  if (!canRead) {
    return (
      <AppShell activePath="/cau-hinh" session={session}>
        <Panel title="Không có quyền">
          <p className="text-sm text-muted">
            Tài khoản chưa được cấp quyền cấu hình nhân sự.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const { edit, editIdentity, view } = await searchParams;
  const activeView =
    view === "identity" || editIdentity ? "identity" : "source";
  const db = getDb();
  const [companies, sources, employees, identityLinks] = await Promise.all([
    db.company.findMany({
      orderBy: { code: "asc" },
      select: { id: true, legalName: true },
      where: { status: "ACTIVE" },
    }),
    db.personnelSource.findMany({
      include: { company: { select: { legalName: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    db.employee.findMany({
      include: { company: true },
      orderBy: [{ fullName: "asc" }],
      where: { status: "ACTIVE" },
    }),
    db.personnelIdentityLink.findMany({
      include: {
        members: {
          include: { employee: { include: { company: true } } },
          orderBy: { employee: { employeeCode: "asc" } },
        },
        primaryEmployee: { include: { company: true } },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    }),
  ]);

  const source = edit ? sources.find((item) => item.companyId === edit) : null;
  const editingSource: EditingSource | null = source
    ? {
        apiLink: source.apiLink,
        companyId: source.companyId,
        headerRow: source.headerRow,
        mappings: (source.mappings ?? {}) as PersonnelMappings,
        sheetName: source.sheetName,
        syncMode: source.syncMode,
      }
    : null;
  const identity = editIdentity
    ? identityLinks.find((item) => item.id === editIdentity)
    : null;
  const editingIdentity = identity
    ? {
        employeeIds: identity.members.map((item) => item.employeeId),
        id: identity.id,
        name: identity.name,
        note: identity.note,
        primaryEmployeeId: identity.primaryEmployeeId,
      }
    : null;

  return (
    <AppShell activePath="/cau-hinh" session={session}>
      <section className="space-y-2">
        <Badge tone="info">Cấu hình</Badge>
        <h1 className="text-3xl font-extrabold tracking-tight text-primary">
          Nhân sự
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          {activeView === "source"
            ? "Cấu hình nguồn nhân sự, ánh xạ cột và theo dõi các lượt đồng bộ."
            : "Liên kết nhiều MNV thuộc cùng một người và chọn tài khoản lấy chính để xác định quyền, hồ sơ và pháp nhân."}
        </p>
      </section>
      <ConfigTabs
        active={
          activeView === "identity"
            ? "personnel-identity"
            : "personnel-source"
        }
      />

      {activeView === "source" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div>
            {canManageSettings ? (
              <section className="ui-module-panel p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <Badge tone="info">Cấu hình nguồn nhân sự</Badge>
                    <h2 className="mt-2 text-xl font-extrabold text-primary">
                      {editingSource
                        ? `Sửa nguồn ${source?.company.legalName}`
                        : "Nguồn đồng bộ"}
                    </h2>
                  </div>
                  {editingSource ? (
                    <LinkButton
                      href="/cau-hinh/dong-bo-nhan-su?view=source"
                      size="sm"
                      variant="secondary"
                    >
                      Làm mới
                    </LinkButton>
                  ) : null}
                </div>
                <PersonnelSourceForm
                  companies={companies}
                  editing={editingSource}
                  key={editingSource?.companyId || "new"}
                  readerAccount={PERSONNEL_SHEETS_READER_ACCOUNT}
                />
              </section>
            ) : (
              <Panel title="Chỉ xem nguồn nhân sự">
                <p className="text-sm leading-6 text-muted">
                  Tài khoản hiện tại chưa có quyền thay đổi nguồn đồng bộ.
                </p>
              </Panel>
            )}
          </div>

          <aside>
            <section className="ui-module-panel p-5">
              <Badge tone="info">Danh sách nguồn nhân sự</Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                {sources.length} nguồn đồng bộ
              </h2>
              <div className="mt-4 max-h-[520px] space-y-3 overflow-auto pr-1">
                {sources.length ? (
                  sources.map((item) => (
                    <article
                      className="rounded-lg border border-border bg-surface p-4"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-extrabold text-primary">
                            {item.company.legalName}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted">
                            Sheet “{item.sheetName}” · header {item.headerRow}
                            <br />
                            {item.syncMode === "snapshot"
                              ? "Snapshot/ngày"
                              : "Định kỳ 30 phút"}{" "}
                            · {fmt(item.lastSyncedAt)}
                          </div>
                        </div>
                        <Badge
                          tone={item.status === "ACTIVE" ? "success" : "warning"}
                        >
                          {item.status === "ACTIVE" ? "Đang dùng" : "Tạm tắt"}
                        </Badge>
                      </div>
                      {canManageSettings ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <SyncSourceButton sourceId={item.id} />
                          <LinkButton
                            href={`/cau-hinh/dong-bo-nhan-su?view=source&edit=${item.companyId}`}
                            size="sm"
                            variant="secondary"
                          >
                            Sửa
                          </LinkButton>
                          <form
                            action={setPersonnelSourceStatusAction.bind(
                              null,
                              item.id,
                              item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                            )}
                          >
                            <Button size="sm" type="submit" variant="ghost">
                              {item.status === "ACTIVE" ? "Tắt" : "Bật"}
                            </Button>
                          </form>
                          <form
                            action={deletePersonnelSourceAction.bind(null, item.id)}
                          >
                            <ConfirmButton
                              confirmLabel="Xóa"
                              message="Xóa cấu hình nguồn này? Dữ liệu nhân sự đã đồng bộ vẫn được giữ."
                              size="sm"
                              title="Xóa nguồn"
                              variant="danger"
                            >
                              Xóa
                            </ConfirmButton>
                          </form>
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted">
                    Chưa cấu hình nguồn nào.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div>
            {canManage ? (
              <section className="ui-module-panel p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <Badge tone="warning">Liên kết tài khoản nhân sự</Badge>
                    <h2 className="mt-2 text-xl font-extrabold text-primary">
                      {editingIdentity
                        ? `Sửa ${editingIdentity.name}`
                        : "Thêm liên kết"}
                    </h2>
                  </div>
                  {editingIdentity ? (
                    <LinkButton
                      href="/cau-hinh/dong-bo-nhan-su?view=identity"
                      size="sm"
                      variant="secondary"
                    >
                      Làm mới
                    </LinkButton>
                  ) : null}
                </div>
                <PersonnelIdentityForm
                  editing={editingIdentity}
                  employees={employees.map((employee) => ({
                    companyLabel:
                      employee.company?.shortName ||
                      employee.company?.legalName ||
                      "",
                    department: employee.department,
                    employeeCode: employee.employeeCode,
                    fullName: employee.fullName,
                    id: employee.id,
                  }))}
                  key={editingIdentity?.id ?? "new"}
                />
              </section>
            ) : (
              <Panel title="Chỉ xem liên kết nhân sự">
                <p className="text-sm leading-6 text-muted">
                  Tài khoản hiện tại chưa có quyền thay đổi liên kết nhân sự.
                </p>
              </Panel>
            )}
          </div>

          <aside>
            <section className="ui-module-panel p-5">
              <Badge tone="warning">Tài khoản đã liên kết</Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                {identityLinks.length} liên kết
              </h2>
              <div className="mt-4 max-h-[520px] space-y-3 overflow-auto pr-1">
                {identityLinks.length ? (
                  identityLinks.map((item) => (
                    <article
                      className="rounded-lg border border-border bg-surface p-4"
                      key={item.id}
                    >
                      <div className="font-extrabold text-primary">{item.name}</div>
                      <div className="mt-1 text-xs leading-5 text-muted">
                        Quyền chính: {item.primaryEmployee.fullName} ·{" "}
                        {item.primaryEmployee.employeeCode}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.members.map((member) => (
                          <span
                            className="ui-chip min-h-7 px-2.5 text-xs"
                            key={member.employeeId}
                          >
                            {member.employee.fullName} ·{" "}
                            {member.employee.employeeCode}
                          </span>
                        ))}
                      </div>
                      {canManage ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <LinkButton
                            href={`/cau-hinh/dong-bo-nhan-su?view=identity&editIdentity=${item.id}`}
                            size="sm"
                            variant="secondary"
                          >
                            Sửa
                          </LinkButton>
                          <PersonnelIdentityDeleteButton
                            linkId={item.id}
                            linkName={item.name}
                          />
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted">
                    Chưa có tài khoản liên kết.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
