import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { resolveSharedJdsForPositions } from "@/lib/evaluation/jd-resolution";
import type { FormatToken } from "@/lib/document-numbering";

import { LegalInfoWorkspace } from "./legal-info-workspace";

export const metadata: Metadata = {
  title: "Thông tin | Cổng vận hành",
};

function formatTokens(value: unknown): FormatToken[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const type = String(source.type || "").trim();
      if (!type) return null;
      return {
        type,
        ...(source.value != null ? { value: String(source.value) } : {}),
      };
    })
    .filter((item): item is FormatToken => Boolean(item));
}

function contentName(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const source = value as Record<string, unknown>;
  return String(
    source.displayName ||
      source.name ||
      source.title ||
      source.activityName ||
      "",
  ).trim();
}

function sortOrder(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const source = value as Record<string, unknown>;
  const result = Number(source.sortOrder || source.order || 0);
  return Number.isFinite(result) ? result : 0;
}

export default async function LegalInfoPage() {
  const session = await requireCurrentSession();
  const canOpen =
    session.fullAccess ||
    session.moduleGroups.includes("legal") ||
    session.modules.includes("legal-info");

  if (!canOpen) {
    return (
      <AppShell activePath="/" moduleKey="legal-info" session={session}>
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền xem Thông tin.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const db = getDb();
  const [documents, employees] = await Promise.all([
    db.documentType.findMany({
      orderBy: [{ legacySheetRow: "asc" }, { name: "asc" }],
      where: { status: "ACTIVE" },
    }),
    db.employee.findMany({
      include: { company: true },
      orderBy: [{ fullName: "asc" }],
      where: { status: "ACTIVE" },
    }),
  ]);
  const positions = Array.from(
    new Set(employees.map((employee) => employee.title || "").filter(Boolean)),
  );
  const jds = await resolveSharedJdsForPositions(positions);

  return (
    <AppShell activePath="/" moduleKey="legal-info" session={session}>
      <LegalInfoWorkspace
        documents={documents.map((document) => ({
          condition: document.condition || "",
          formatTokens: formatTokens(document.formatTokens),
          id: document.id,
          name: document.name,
          startIndex: document.startIndex,
          takesNumber: document.takesNumber,
        }))}
        employees={employees.map((employee) => ({
          bankAccount: employee.bankAccount || "",
          bankName: employee.bankName || "",
          birthDate: employee.birthDate || "",
          company:
            employee.company?.shortName || employee.company?.legalName || "",
          department: employee.department || "",
          email: employee.email || "",
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          id: employee.id,
          identityDate: employee.identityDate || "",
          identityNumber: employee.identityNumber || "",
          identityPlace: employee.identityPlace || "",
          phone: employee.phone || "",
          status: employee.status,
          title: employee.title || "",
        }))}
        jds={jds.map((jd) => ({
          activities: jd.activities.map((activity) => ({
            id: activity.id,
            name: activity.name || contentName(activity.content) || "Hoạt động",
            sortOrder:
              Number(activity.sourceRow || 0) || sortOrder(activity.content),
          })),
          activityCount: jd.activityCount,
          fileName: jd.fileName,
          fileUrl: jd.fileUrl,
          isLegacy: jd.isLegacy,
          position: jd.position,
          source: jd.source,
          sourceLabel: jd.sourceLabel,
          title: jd.title,
          workGroups: jd.workGroups.map((group) => ({
            id: group.id,
            name: group.name || contentName(group.content) || "Nhóm công việc",
            sortOrder: Number(group.sourceRow || 0) || sortOrder(group.content),
          })),
        }))}
      />
    </AppShell>
  );
}
