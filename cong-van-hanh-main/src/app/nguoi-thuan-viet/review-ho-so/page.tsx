import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  sessionOwnsUserId,
  sessionUserIds,
} from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { requestStatusMeta } from "@/lib/requests/services";

import { ReviewContractWorkspace } from "./review-contract-workspace";

export const metadata: Metadata = {
  title: "Review hồ sơ | Cổng vận hành",
};

function payloadObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export default async function ReviewContractPage() {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const canOpen =
    session.fullAccess ||
    session.moduleGroups.includes("legal") ||
    session.modules.includes("review-contract");
  if (!canOpen) {
    return (
      <AppShell activePath="/" moduleKey="review-contract" session={session}>
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền Review hồ sơ.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const canViewAll = canAny(session, [
    "admin_requests.read",
    "admin_requests.process",
  ]);
  const db = getDb();
  const [companies, documentTypes, requests] = await Promise.all([
    db.company.findMany({
      orderBy: [{ code: "asc" }],
      where: { status: "ACTIVE" },
    }),
    db.documentType.findMany({
      orderBy: [{ legacySheetRow: "asc" }, { name: "asc" }],
      where: { status: "ACTIVE" },
    }),
    db.request.findMany({
      include: {
        attachments: true,
        createdBy: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 150,
      where: {
        archivedAt: null,
        serviceCode: "review-contract",
        ...(canViewAll
          ? {}
          : { createdById: { in: identityUserIds } }),
      },
    }),
  ]);

  return (
    <AppShell activePath="/" moduleKey="review-contract" session={session}>
      <ReviewContractWorkspace
        canViewAll={canViewAll}
        companies={companies.map((company) => ({
          id: company.id,
          label: company.shortName || company.legalName,
          shortName: company.shortName || company.code,
        }))}
        documentTypes={documentTypes.map((document) => ({
          id: document.id,
          name: document.name,
          requiresCustom:
            Array.isArray(document.formatTokens) &&
            document.formatTokens.some(
              (token) =>
                token &&
                typeof token === "object" &&
                !Array.isArray(token) &&
                String((token as Record<string, unknown>).type) === "CUSTOM_TEXT",
            ),
        }))}
        requests={requests.map((request) => ({
          attachments: request.attachments.map((file) => ({
            fileName: file.fileName,
            fileUrl: file.fileObjectId
              ? `/api/requests/files/${encodeURIComponent(file.fileObjectId)}`
              : file.fileUrl,
            id: file.id,
          })),
          code: request.code,
          createdAt: request.createdAt.toISOString(),
          createdBy:
            sessionOwnsUserId(session, request.createdById)
              ? "Tôi"
              : request.createdBy.displayName,
          id: request.id,
          note: request.note || "",
          payload: payloadObject(request.payload),
          status: request.status,
          statusLabel: requestStatusMeta[request.status].label,
          title: request.title,
        }))}
      />
    </AppShell>
  );
}
