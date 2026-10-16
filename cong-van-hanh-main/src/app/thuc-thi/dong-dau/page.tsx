import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { LinkButton, Panel } from "@/components/ui";
import type { FormatToken } from "@/lib/document-numbering";
import { renderNumber } from "@/lib/document-registry";
import { effectiveSealDeclarationModes } from "@/lib/document-declaration";
import { requireCurrentSession } from "@/lib/auth/session";
import { sessionUserIds } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";

import { DongDauForm } from "./dong-dau-form";
import type {
  SealDeclarationMode,
  SealDocumentTypeOption,
  SealPartnerOption,
  SealSubmissionOffice,
} from "./types";

export const metadata: Metadata = {
  title: "Đóng dấu và Ký số | Cổng vận hành",
};

const PARTNER_KEY_PREFIX = "document-seal.partner.";
const SUBMISSION_OFFICES: SealSubmissionOffice[] = [
  { key: "q12", label: "Văn phòng Q12" },
  { key: "thanh-cong", label: "Văn phòng Thành Công" },
];

function objectOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function declarationModes(value: unknown): SealDeclarationMode[] {
  const allowed = new Set<SealDeclarationMode>([
    "partner",
    "period",
    "detail",
  ]);
  const items = Array.isArray(value)
    ? value
        .map((entry) => {
          if (typeof entry === "string") return entry;
          const item = objectOf(entry);
          return text(item.key ?? item.value ?? item.type);
        })
        .filter((entry): entry is SealDeclarationMode =>
          allowed.has(entry as SealDeclarationMode),
        )
    : [];
  return items.length ? [...new Set(items)] : ["partner", "period", "detail"];
}

function formatTokens(value: unknown): FormatToken[] {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const item = objectOf(entry);
          const type = text(item.type ?? item.tokenKey ?? item.key);
          if (!type) return null;
          const tokenValue = text(item.value);
          return tokenValue ? { type, value: tokenValue } : { type };
        })
        .filter((item): item is FormatToken => Boolean(item))
    : [];
}

function savedPartner(value: string | null): SealPartnerOption | null {
  if (!value) return null;
  try {
    const item = objectOf(JSON.parse(value));
    const name = text(item.name);
    const taxId = text(item.taxId);
    if (!name || !taxId) return null;
    const type = item.type === "person" ? "person" : "business";
    return {
      address: text(item.address),
      employeeCode: "",
      id: text(item.id) || `customer:${taxId}`,
      issuedDate: text(item.issuedDate),
      issuedPlace: text(item.issuedPlace),
      label: text(item.label) || name,
      name,
      searchText:
        text(item.searchText) ||
        [name, taxId, item.shortName, item.address].map(text).join(" "),
      shortName: text(item.shortName),
      sourceLabel:
        text(item.sourceLabel) ||
        (type === "person" ? "Đối tác - Cá nhân" : "Đối tác - Doanh nghiệp"),
      sourceType: "customer",
      taxId,
      type,
    };
  } catch {
    return null;
  }
}

export default async function DongDauPage() {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const allowed =
    session.fullAccess || session.modules.includes("document-seal");
  const db = getDb();

  const [companies, documentTypes, employees, savedPartners, followUps] =
    allowed
      ? await Promise.all([
          db.company.findMany({
            orderBy: [{ code: "asc" }],
            select: {
              address: true,
              code: true,
              id: true,
              legalName: true,
              shortName: true,
              taxCode: true,
            },
            where: { status: "ACTIVE" },
          }),
          db.documentType.findMany({
            orderBy: [{ name: "asc" }],
            select: {
              condition: true,
              declarationTypes: true,
              formatTokens: true,
              id: true,
              name: true,
              startIndex: true,
              takesNumber: true,
            },
            where: { status: "ACTIVE" },
          }),
          db.employee.findMany({
            include: { company: true },
            orderBy: [{ fullName: "asc" }],
            where: { archivedAt: null, status: "ACTIVE" },
          }),
          db.systemSetting.findMany({
            orderBy: [{ createdAt: "asc" }],
            select: { value: true },
            where: { key: { startsWith: PARTNER_KEY_PREFIX } },
          }),
          db.followUpRequirement.findMany({
            select: { blocksModules: true, reason: true },
            where: {
              status: "PENDING",
              targetUserId: { in: identityUserIds },
            },
          }),
        ])
      : [[], [], [], [], []];

  const blockedFollowUp = followUps.find((followUp) => {
    const modules = Array.isArray(followUp.blocksModules)
      ? followUp.blocksModules.map(text)
      : [];
    return modules.includes("*") || modules.includes("document-seal");
  });

  const docTypes: SealDocumentTypeOption[] = documentTypes.map((item) => {
    const tokens = formatTokens(item.formatTokens);
    const hasCustomNumberingText = tokens.some(
      (token) => token.type === "CUSTOM_TEXT",
    );
    return {
      condition: item.condition || "",
      declarationTypes: effectiveSealDeclarationModes(
        item.name,
        declarationModes(item.declarationTypes),
      ) as SealDeclarationMode[],
      hasCustomNumberingText,
      id: item.id,
      name: item.name,
      numberingPreview:
        item.takesNumber && tokens.length
          ? renderNumber(
              tokens,
              Math.max(item.startIndex, 1),
              "CTY",
              new Date(),
              hasCustomNumberingText ? "ĐỐI TÁC" : "",
            )
          : "",
      takesNumber: item.takesNumber,
    };
  });

  const partners: SealPartnerOption[] = [
    ...savedPartners
      .map((setting) => savedPartner(setting.value))
      .filter((item): item is SealPartnerOption => Boolean(item)),
    ...companies.map((company) => ({
      address: company.address || "",
      employeeCode: "",
      id: `company:${company.id}`,
      issuedDate: "",
      issuedPlace: "",
      label: company.legalName,
      name: company.legalName,
      searchText: [
        company.legalName,
        company.shortName,
        company.code,
        company.taxCode,
        company.address,
      ]
        .filter(Boolean)
        .join(" "),
      shortName: company.shortName || company.code,
      sourceLabel: "Pháp nhân",
      sourceType: "company" as const,
      taxId: company.taxCode || "",
      type: "business" as const,
    })),
    ...employees.map((employee) => {
      const companyName = employee.company?.legalName || "";
      const meta = [
        employee.employeeCode,
        employee.title || employee.department,
        companyName,
        employee.identityNumber ? `CCCD: ${employee.identityNumber}` : "",
      ]
        .filter(Boolean)
        .join(" • ");
      return {
        address: companyName,
        employeeCode: employee.employeeCode,
        id: `employee:${employee.id}`,
        issuedDate: employee.identityDate || "",
        issuedPlace: employee.identityPlace || "",
        label: employee.employeeCode
          ? `${employee.fullName} - ${employee.employeeCode}`
          : employee.fullName,
        name: employee.fullName,
        searchText: [
          employee.fullName,
          employee.employeeCode,
          employee.identityNumber,
          employee.identityDate,
          employee.identityPlace,
          employee.department,
          employee.title,
          companyName,
        ]
          .filter(Boolean)
          .join(" "),
        shortName: employee.employeeCode,
        sourceLabel: "Nhân sự",
        sourceType: "employee" as const,
        taxId: employee.identityNumber || "",
        type: "person" as const,
        meta,
      };
    }),
  ].sort((left, right) =>
    left.name.localeCompare(right.name, "vi", { sensitivity: "base" }),
  );

  return (
    <AppShell activePath="/" moduleKey="document-seal" session={session}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href="/" size="sm" variant="ghost">
          ← Trang dịch vụ
        </LinkButton>
      </div>

      {!allowed ? (
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở module Đóng dấu và Ký số.
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
      ) : docTypes.length === 0 ? (
        <Panel title="Chưa có loại văn bản">
          <p className="text-sm text-muted">
            Chưa có loại văn bản hoạt động. Nhờ admin cấu hình trước khi tạo
            đơn.
          </p>
        </Panel>
      ) : (
        <DongDauForm
          companies={companies.map((company) => ({
            address: company.address || "",
            code: company.code,
            id: company.id,
            legalName: company.legalName,
            shortName: company.shortName || "",
            taxCode: company.taxCode || "",
          }))}
          currentUserName={session.displayName}
          docTypes={docTypes}
          initialPartners={partners}
          submissionOffices={SUBMISSION_OFFICES}
        />
      )}
    </AppShell>
  );
}
