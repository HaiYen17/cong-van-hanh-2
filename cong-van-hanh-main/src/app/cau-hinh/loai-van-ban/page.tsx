import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { buildCycleKey } from "@/lib/document-registry";
import { type FormatToken } from "@/lib/document-numbering";
import { getDb } from "@/lib/db";

import { ConfigTabs } from "../config-tabs";
import { DocumentTypeConsole } from "./document-type-console";
import "./document-type-console.css";

export const metadata: Metadata = {
  title: "Loại hồ sơ | Cổng vận hành",
};

function tokens(value: unknown): FormatToken[] {
  return Array.isArray(value)
    ? value
        .map((token) => {
          const source = token as { type?: unknown; value?: unknown };
          const type = String(source.type ?? "");
          if (!type) return null;
          return {
            type,
            ...(source.value != null
              ? { value: String(source.value) }
              : {}),
          };
        })
        .filter((token): token is FormatToken => token !== null)
    : [];
}

function declarationTypes(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "")).filter(Boolean)
    : [];
}

export default async function LoaiVanBanPage() {
  const session = await requireCurrentSession();
  const canRead = canAny(session, [
    "system.settings.read",
    "system.settings.manage",
  ]);
  const canManage = can(session, "system.settings.manage");

  if (!canRead) {
    return (
      <AppShell activePath="/cau-hinh" session={session}>
        <Panel title="Không có quyền">
          <p className="text-sm leading-6 text-muted">
            Tài khoản chưa được cấp quyền cấu hình.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const db = getDb();
  const [companies, documentTypes, issuedRegistries] = await Promise.all([
    db.company.findMany({
      orderBy: [{ shortName: "asc" }, { legalName: "asc" }],
      select: { code: true, id: true, legalName: true, shortName: true },
      where: { status: "ACTIVE" },
    }),
    db.documentType.findMany({
      include: {
        _count: { select: { registries: true } },
        companyNumbering: {
          include: { company: true },
          orderBy: { company: { shortName: "asc" } },
        },
      },
      orderBy: [{ legacySheetRow: "asc" }, { name: "asc" }],
      where: { status: { not: "ARCHIVED" } },
    }),
    db.documentRegistry.findMany({
      select: {
        companyId: true,
        cycleKey: true,
        documentTypeId: true,
        serial: true,
      },
      where: { status: "ISSUED" },
    }),
  ]);

  const documentTypeById = new Map(
    documentTypes.map((item) => [item.id, item]),
  );
  const currentCycleSerials = new Map<string, number>();
  const today = new Date();
  issuedRegistries.forEach((registry) => {
    if (!registry.documentTypeId || !registry.companyId) return;
    const documentType = documentTypeById.get(registry.documentTypeId);
    if (!documentType) return;
    if (registry.cycleKey !== buildCycleKey(documentType.cycle, today)) return;
    const key = `${registry.documentTypeId}::${registry.companyId}`;
    currentCycleSerials.set(
      key,
      Math.max(currentCycleSerials.get(key) || 0, registry.serial),
    );
  });

  return (
    <AppShell activePath="/cau-hinh" session={session}>
      <ConfigTabs active="document" />
      <DocumentTypeConsole
        canManage={canManage}
        companies={companies.map((company) => ({
          id: company.id,
          label: company.shortName || company.legalName,
          shortName: company.shortName || company.code || company.legalName,
        }))}
        documentTypes={documentTypes.map((item) => ({
          companyStartIndexes: item.companyNumbering.map((rule) => ({
            companyId: rule.companyId,
            companyLabel:
              rule.company.shortName || rule.company.legalName,
            lastIssuedSerial:
              currentCycleSerials.get(`${item.id}::${rule.companyId}`) || 0,
            startIndex: rule.startIndex,
          })),
          condition: item.condition ?? "",
          cycle: item.cycle ?? "",
          cycleLimit: item.cycleLimit,
          declarationTypes: declarationTypes(item.declarationTypes),
          formatTokens: tokens(item.formatTokens),
          id: item.id,
          issuedSerials: Object.fromEntries(
            companies
              .map((company) => [
                company.id,
                currentCycleSerials.get(`${item.id}::${company.id}`) || 0,
              ])
              .filter(([, serial]) => Number(serial) > 0),
          ),
          name: item.name,
          registryCount: item._count.registries,
          startIndex: item.startIndex,
          status: item.status,
          takesNumber: item.takesNumber,
        }))}
      />
    </AppShell>
  );
}
