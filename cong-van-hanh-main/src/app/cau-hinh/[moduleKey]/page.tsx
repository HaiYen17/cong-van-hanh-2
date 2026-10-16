import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { LegacyModuleFrame } from "@/components/legacy-module-frame";
import { ModuleStat, ModuleTabs } from "@/components/module-tabs";
import {
  Badge,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { canAccessAppSetup } from "@/lib/support-tools/runtime";

type ModuleDefinition = {
  badge: string;
  description: string;
  moduleKey: string;
  tabs: { key: string; label: string; recordTypes: string[] }[];
  title: string;
};

const MODULES: Record<string, ModuleDefinition> = {
  "setup-tai-san": {
    badge: "Admin Hành chính",
    description:
      "Cấu hình dùng chung, CCDC/tài sản, văn phòng phẩm, đồng phục và lịch sử tác vụ xử lý ảnh.",
    moduleKey: "asset-setup",
    tabs: [
      { key: "config", label: "Cấu hình", recordTypes: ["asset-setup"] },
      { key: "assets", label: "CCDC/tài sản", recordTypes: ["asset-catalog"] },
      { key: "stationery", label: "Văn phòng phẩm", recordTypes: ["stationery"] },
      { key: "uniform", label: "Đồng phục", recordTypes: ["uniform"] },
    ],
    title: "Setup tài sản",
  },
  "setup-ung-dung": {
    badge: "Admin Hành chính",
    description:
      "Kho ứng dụng nội bộ, tag, logo, file tải, phiên bản và hướng dẫn sử dụng.",
    moduleKey: "app-setup",
    tabs: [
      { key: "apps", label: "Ứng dụng", recordTypes: ["app-definition"] },
      { key: "tags", label: "Bộ tag", recordTypes: ["shared-tag"] },
    ],
    title: "Setup ứng dụng",
  },
  "bieu-mau": {
    badge: "Admin Hành chính",
    description:
      "Danh mục biểu mẫu, file nguồn, trường dữ liệu đã quét và lịch sử tạo file.",
    moduleKey: "template-management",
    tabs: [
      { key: "templates", label: "Biểu mẫu", recordTypes: ["template"] },
      {
        key: "history",
        label: "Lịch sử tạo file",
        recordTypes: ["template-history"],
      },
    ],
    title: "Cấu hình Biểu mẫu",
  },
  "nguyen-tac-ai": {
    badge: "Admin Hành chính",
    description:
      "Nguồn, guideline, rule, phạm vi áp dụng, mức độ và lịch sử review hồ sơ bằng AI.",
    moduleKey: "review-config",
    tabs: [
      { key: "rules", label: "Bộ nguyên tắc", recordTypes: ["ai-review-rule"] },
      {
        key: "history",
        label: "Lịch sử review",
        recordTypes: ["ai-review-record"],
      },
    ],
    title: "Bộ nguyên tắc AI",
  },
};

export const metadata: Metadata = {
  title: "Cấu hình | Cổng vận hành",
};

function summarize(content: unknown) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return "";
  return Object.entries(content)
    .filter(([, value]) => value != null && String(value).trim())
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 80)}`)
    .join(" · ");
}

export default async function RestoredConfigModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ moduleKey: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireCurrentSession();
  const { moduleKey } = await params;
  const definition = MODULES[moduleKey];
  if (!definition) notFound();
  if (moduleKey === "setup-ung-dung") {
    if (!canAccessAppSetup(session)) {
      return (
        <AppShell activePath="/cau-hinh" moduleKey="app-setup" session={session}>
          <Panel title="Không có quyền truy cập">
            <p className="text-sm text-muted">
              Tài khoản hiện tại chưa được cấp quyền mở Setup ứng dụng.
            </p>
          </Panel>
        </AppShell>
      );
    }
    return (
      <LegacyModuleFrame
        moduleKey="app-setup"
        src="/legacy/app-setup.html"
        title="Setup ứng dụng"
      />
    );
  }
  const query = await searchParams;
  const selectedTab =
    definition.tabs.find((tab) => tab.key === query.tab) ?? definition.tabs[0];
  const db = getDb();

  const [rows, grouped] = await Promise.all([
    db.configurationRecord.findMany({
      orderBy: [{ updatedAt: "desc" }, { sourceRow: "asc" }],
      take: 150,
      where: { recordType: { in: selectedTab.recordTypes } },
    }),
    db.configurationRecord.groupBy({
      _count: { _all: true },
      by: ["recordType"],
      where: {
        recordType: {
          in: definition.tabs.flatMap((tab) => tab.recordTypes),
        },
      },
    }),
  ]);
  const counts = new Map(
    grouped.map((item) => [item.recordType, item._count._all]),
  );

  return (
    <AppShell moduleKey={definition.moduleKey} session={session}>
      <ModuleTabs
        active={selectedTab.key}
        tabs={definition.tabs.map((tab) => ({
          href: `/cau-hinh/${moduleKey}?tab=${tab.key}`,
          key: tab.key,
          label: tab.label,
        }))}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {definition.tabs.map((tab) => (
          <ModuleStat
            key={tab.key}
            label={tab.label}
            value={tab.recordTypes.reduce(
              (total, recordType) => total + (counts.get(recordType) ?? 0),
              0,
            )}
          />
        ))}
      </div>

      <Panel className="mt-5" title={selectedTab.label}>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface-muted/60 p-8 text-center text-sm text-muted">
            Chưa có dữ liệu trong nhóm này.
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Mã</TableHeaderCell>
                <TableHeaderCell>Tên</TableHeaderCell>
                <TableHeaderCell>Trạng thái</TableHeaderCell>
                <TableHeaderCell>Thông tin</TableHeaderCell>
                <TableHeaderCell>Nguồn</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-semibold text-primary">
                    {row.code || "—"}
                  </TableCell>
                  <TableCell>{row.name || "—"}</TableCell>
                  <TableCell>
                    <Badge tone={row.status ? "success" : "neutral"}>
                      {row.status || "Đã nạp"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[520px] text-xs leading-5 text-muted">
                    {summarize(row.content) || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted">
                    {row.sourceSheet} · dòng {row.sourceRow}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </AppShell>
  );
}
