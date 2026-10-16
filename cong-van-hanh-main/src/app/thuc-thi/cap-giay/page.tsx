import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { LinkButton, Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { sessionUserIds } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";

import { CapGiayForm } from "./cap-giay-form";
import type {
  AuthorizationCompany,
  AuthorizationDocumentType,
  AuthorizationEmployee,
} from "./types";

export const metadata: Metadata = {
  title: "Cấp giấy Ủy quyền / Giới thiệu | Cổng vận hành",
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi-VN");
}

function isLetterType(value: string) {
  const key = normalize(value);
  return key.includes("uy quyen") || key.includes("gioi thieu");
}

export default async function CapGiayPage() {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const allowed =
    session.fullAccess || session.modules.includes("authorization-letter");
  const db = getDb();

  const [companyRows, documentTypeRows, employeeRows, currentUser, followUps] =
    allowed
      ? await Promise.all([
          db.company.findMany({
            orderBy: { code: "asc" },
            where: { status: "ACTIVE" },
          }),
          db.documentType.findMany({
            orderBy: { name: "asc" },
            where: { status: "ACTIVE", takesNumber: true },
          }),
          db.employee.findMany({
            include: { company: true },
            orderBy: { fullName: "asc" },
            where: { archivedAt: null, status: "ACTIVE" },
          }),
          db.user.findUnique({
            include: { employee: { include: { company: true } } },
            where: { id: session.userId },
          }),
          db.followUpRequirement.findMany({
            select: { blocksModules: true, reason: true },
            where: {
              status: "PENDING",
              targetUserId: { in: identityUserIds },
            },
          }),
        ])
      : [[], [], [], null, []];

  const blockedFollowUp = followUps.find((followUp) => {
    const modules = Array.isArray(followUp.blocksModules)
      ? followUp.blocksModules.map(text)
      : [];
    return modules.includes("*") || modules.includes("authorization-letter");
  });

  const employees: AuthorizationEmployee[] = employeeRows.map((employee) => ({
    birthDate: employee.birthDate || "",
    companyId: employee.companyId || "",
    companyName: employee.company?.legalName || "",
    department: employee.department || "",
    email: employee.email || "",
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    id: employee.id,
    identityDate: employee.identityDate || "",
    identityNumber: employee.identityNumber || "",
    identityPlace: employee.identityPlace || "",
    title: employee.title || "",
  }));
  const companies: AuthorizationCompany[] = companyRows.map((company) => {
    const representative = employeeRows.find(
      (employee) =>
        normalize(employee.fullName) === normalize(company.representative),
    );
    return {
      address: company.address || "",
      code: company.code,
      id: company.id,
      legalName: company.legalName,
      representativeIdentityDate: representative?.identityDate || "",
      representativeIdentityNumber: representative?.identityNumber || "",
      representativeIdentityPlace: representative?.identityPlace || "",
      representativeName:
        representative?.fullName || company.representative || "",
      representativeTitle: representative?.title || "Giám đốc",
      shortName: company.shortName || company.code,
      taxCode: company.taxCode || "",
    };
  });
  const docTypes: AuthorizationDocumentType[] = documentTypeRows
    .filter((item) => isLetterType(item.name))
    .map((item) => ({ id: item.id, name: item.name }));
  const selfEmployee = currentUser?.employee
    ? employees.find((employee) => employee.id === currentUser.employee?.id) ||
      null
    : null;

  return (
    <AppShell activePath="/" moduleKey="authorization-letter" session={session}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href="/" size="sm" variant="ghost">
          ← Trang dịch vụ
        </LinkButton>
      </div>

      {!allowed ? (
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở module Cấp giấy Ủy
            quyền/Giới thiệu.
          </p>
        </Panel>
      ) : blockedFollowUp ? (
        <Panel title="Tạm khóa module">
          <p className="text-sm leading-6 text-muted">
            Ông cần hoàn tất yêu cầu bổ sung hồ sơ trước khi tạo đơn mới:{" "}
            <strong className="text-foreground">{blockedFollowUp.reason}</strong>
          </p>
          <div className="mt-4">
            <LinkButton href="/nguoi-thuan-viet/don-hang" variant="secondary">
              Mở Đơn hàng của tôi
            </LinkButton>
          </div>
        </Panel>
      ) : !companies.length || !docTypes.length ? (
        <Panel title="Thiếu cấu hình nền">
          <p className="text-sm text-muted">
            Module chưa có đủ pháp nhân hoặc loại Giấy Ủy quyền/Giới thiệu đang
            hoạt động. Tui đã giữ màn hình an toàn để không tạo đơn sai.
          </p>
        </Panel>
      ) : (
        <CapGiayForm
          companies={companies}
          currentUserName={session.displayName}
          docTypes={docTypes}
          employees={employees}
          selfEmployee={selfEmployee}
        />
      )}
    </AppShell>
  );
}
