import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  LinkButton,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { type FormatToken } from "@/lib/document-numbering";
import { getDb } from "@/lib/db";

import { cancelDocumentAction } from "./actions";
import { ExecTabs } from "../exec-tabs";
import { IssueForm, type DocTypeOpt } from "./issue-form";

export const metadata: Metadata = { title: "Sổ văn bản | Cổng vận hành" };

const PAGE_SIZE = 20;

function tokensOf(value: unknown): FormatToken[] {
  return Array.isArray(value)
    ? value.map((t) => {
        const o = t as { type?: unknown; value?: unknown };
        return { type: String(o.type ?? ""), ...(o.value != null ? { value: String(o.value) } : {}) };
      })
    : [];
}
function fmtDate(d: Date) {
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export default async function SoVanBanPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; page?: string; q?: string; status?: string; type?: string }>;
}) {
  const session = await requireCurrentSession();
  const canRead = canAny(session, ["documents.read", "documents.manage"]);
  const canManage = can(session, "documents.manage");
  const canReadRequests = canAny(session, ["admin_requests.read", "admin_requests.process"]);

  if (!canRead) {
    return (
      <AppShell activePath="/thuc-thi" session={session}>
        <Panel title="Không có quyền">
          <p className="text-sm leading-6 text-muted">Tài khoản chưa được cấp quyền xem sổ văn bản.</p>
        </Panel>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const companyFilter = sp.company || "";
  const typeFilter = sp.type || "";
  const statusFilter = sp.status === "CANCELLED" || sp.status === "ISSUED" ? sp.status : "";
  const q = (sp.q || "").trim();
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);

  const where = {
    ...(companyFilter ? { companyId: companyFilter } : {}),
    ...(typeFilter ? { documentTypeId: typeFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(q
      ? {
          OR: [
            { documentNumber: { contains: q, mode: "insensitive" as const } },
            { partnerName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const db = getDb();
  const [companies, docTypesRaw, total, rows] = await Promise.all([
    db.company.findMany({
      orderBy: { code: "asc" },
      select: { code: true, id: true, legalName: true, shortName: true },
      where: { status: "ACTIVE" },
    }),
    db.documentType.findMany({
      orderBy: { name: "asc" },
      where: { status: "ACTIVE", takesNumber: true },
    }),
    db.documentRegistry.count({ where }),
    db.documentRegistry.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      where,
    }),
  ]);

  const docTypes: DocTypeOpt[] = docTypesRaw.map((d) => ({
    cycle: d.cycle,
    formatTokens: tokensOf(d.formatTokens),
    id: d.id,
    name: d.name,
    startIndex: d.startIndex,
  }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (over: Record<string, string>) => {
    const u = new URLSearchParams({
      ...(companyFilter ? { company: companyFilter } : {}),
      ...(typeFilter ? { type: typeFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(q ? { q } : {}),
      ...over,
    });
    return `/thuc-thi/so-van-ban?${u.toString()}`;
  };

  return (
    <AppShell activePath="/thuc-thi" session={session}>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">Thực thi</Badge>
          <LinkButton href="/cau-hinh/loai-van-ban" size="sm" variant="ghost">Cấu hình loại văn bản →</LinkButton>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-primary">Sổ văn bản</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Cấp số văn bản theo quy cách đã cấu hình và tra cứu toàn bộ số đã cấp. STT tự tăng theo
          công ty + loại + chu kỳ, chống trùng.
        </p>
      </section>

      <ExecTabs active="so-van-ban" showManage={canReadRequests} />

      {canManage ? (
        <Panel className="mt-5" title="Cấp số văn bản">
          {docTypes.length === 0 ? (
            <p className="text-sm text-muted">
              Chưa có loại văn bản nào “Có lấy số”. Tạo ở{" "}
              <LinkButton href="/cau-hinh/loai-van-ban" size="sm" variant="ghost">Cấu hình loại văn bản</LinkButton>.
            </p>
          ) : (
            <IssueForm companies={companies} docTypes={docTypes} />
          )}
        </Panel>
      ) : null}

      <Panel className="mt-6" title={`Sổ văn bản (${total})`}>
        {/* Bộ lọc */}
        <form className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4" method="get">
          <select className="h-11 rounded-lg border border-border bg-surface px-3 text-sm" defaultValue={companyFilter} name="company">
            <option value="">Tất cả công ty</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.shortName || c.legalName}</option>
            ))}
          </select>
          <select className="h-11 rounded-lg border border-border bg-surface px-3 text-sm" defaultValue={typeFilter} name="type">
            <option value="">Tất cả loại</option>
            {docTypesRaw.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select className="h-11 rounded-lg border border-border bg-surface px-3 text-sm" defaultValue={statusFilter} name="status">
            <option value="">Mọi trạng thái</option>
            <option value="ISSUED">Đã cấp số</option>
            <option value="CANCELLED">Đã hủy</option>
          </select>
          <div className="flex gap-2">
            <input className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm" defaultValue={q} name="q" placeholder="Tìm số / đối tác" />
            <Button size="sm" type="submit" variant="secondary">Lọc</Button>
          </div>
        </form>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Số văn bản</TableHeaderCell>
              <TableHeaderCell>Loại</TableHeaderCell>
              <TableHeaderCell>Công ty</TableHeaderCell>
              <TableHeaderCell>Đối tác</TableHeaderCell>
              <TableHeaderCell>Ngày ký</TableHeaderCell>
              <TableHeaderCell>Người cấp</TableHeaderCell>
              <TableHeaderCell>Trạng thái</TableHeaderCell>
              {canManage ? <TableHeaderCell>Thao tác</TableHeaderCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell className="py-6 text-center text-muted" colSpan={canManage ? 8 : 7}>Chưa có số văn bản nào.</TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-semibold text-primary">{r.documentNumber}</TableCell>
                  <TableCell>{r.documentTypeName}</TableCell>
                  <TableCell>{r.companyShort}</TableCell>
                  <TableCell>{r.partnerName || "—"}</TableCell>
                  <TableCell>{fmtDate(r.signDate)}</TableCell>
                  <TableCell>{r.createdByName || "—"}</TableCell>
                  <TableCell>
                    {r.status === "ISSUED" ? <Badge tone="success">Đã cấp số</Badge> : <Badge tone="danger">Đã hủy</Badge>}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      {r.status === "ISSUED" ? (
                        <form action={cancelDocumentAction.bind(null, r.id)}>
                          <ConfirmButton confirmLabel="Hủy số" message={`Hủy số ${r.documentNumber}? Số vẫn được giữ chỗ, không cấp lại cho người khác.`} title="Hủy số văn bản" variant="danger">
                            Hủy
                          </ConfirmButton>
                        </form>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted">Trang {page}/{totalPages}</span>
            <div className="flex gap-2">
              {page > 1 ? <LinkButton href={qs({ page: String(page - 1) })} size="sm" variant="secondary">← Trước</LinkButton> : null}
              {page < totalPages ? <LinkButton href={qs({ page: String(page + 1) })} size="sm" variant="secondary">Sau →</LinkButton> : null}
            </div>
          </div>
        ) : null}
      </Panel>
    </AppShell>
  );
}
