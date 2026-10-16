import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { LinkButton, Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import { TrichLucForm } from "./trich-luc-form";

export const metadata: Metadata = { title: "Trích lục / lưu trữ hồ sơ | Cổng vận hành" };

export default async function TrichLucPage() {
  const session = await requireCurrentSession();
  const db = getDb();
  const [companies, docTypes, archivedDossiers] = await Promise.all([
    db.company.findMany({ orderBy: { code: "asc" }, select: { id: true, legalName: true, shortName: true }, where: { status: "ACTIVE" } }),
    db.documentType.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, where: { status: "ACTIVE" } }),
    db.legalDossier.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        companyId: true,
        companyShortSnapshot: true,
        documentRegistry: { select: { documentNumber: true } },
        documentTypeId: true,
        documentTypeSnapshot: true,
        generatedStorageName: true,
        id: true,
        storageCounterparty: true,
      },
      take: 5000,
      where: {
        cancelledAt: null,
        generatedStorageName: { not: null },
      },
    }),
  ]);

  const seenNames = new Set<string>();
  const archivedRecords = archivedDossiers.flatMap((dossier) => {
    const recordName = dossier.generatedStorageName?.trim();
    if (!recordName) return [];
    const key = recordName
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("vi-VN")
      .replace(/\s+/g, " ")
      .trim();
    if (seenNames.has(key)) return [];
    seenNames.add(key);
    return [{
      companyId: dossier.companyId || "",
      documentTypeId: dossier.documentTypeId || "",
      id: dossier.id,
      meta: [
        dossier.documentRegistry?.documentNumber,
        dossier.companyShortSnapshot,
        dossier.documentTypeSnapshot,
        dossier.storageCounterparty,
      ].filter(Boolean).join(" • "),
      recordName,
    }];
  });

  return (
    <AppShell activePath="/thuc-thi" moduleKey="document-archive" session={session}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <LinkButton href="/thuc-thi" size="sm" variant="ghost">← Khu Thực thi</LinkButton>
      </div>

      <Panel title="Tạo yêu cầu">
        <TrichLucForm
          archivedRecords={archivedRecords}
          companies={companies}
          docTypes={docTypes}
        />
      </Panel>
    </AppShell>
  );
}
