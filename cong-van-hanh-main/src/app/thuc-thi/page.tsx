import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, LinkButton, Panel } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Prisma } from "@/generated/prisma/client";
import type { RequestStatus } from "@/generated/prisma/enums";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  sessionOwnsUserId,
  sessionUserIds,
} from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import {
  getServiceFields,
  isNumberingService,
  isValidServiceCode,
  isValidStatus,
  requestEventLabels,
  requestServices,
  requestStatusMeta,
  requestStatusOrder,
  serviceLabel,
} from "@/lib/requests/services";
import {
  isElectronicSignatureItem,
  payloadItems,
} from "@/lib/requests/electronic-signature-payload";

import {
  approveRequestAction,
  cancelRequestAction,
  completeRequestAction,
  issueAndCompleteRequestAction,
  needsInfoRequestAction,
  processRequestAction,
  rejectRequestAction,
} from "./actions";
import { ExecTabs } from "./exec-tabs";
import { RequestForm } from "./request-form";

export const metadata: Metadata = {
  title: "Thực thi | Cổng vận hành",
};

const PAGE_SIZE = 20;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function StatusBadge({ status }: { status: RequestStatus }) {
  const meta = requestStatusMeta[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export default async function ExecutionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const db = getDb();

  const canProcess = canAny(session, [
    "admin_requests.process",
    "admin_requests.read",
  ]);
  const canApprove = can(session, "admin_requests.approve");
  const canArchive = can(session, "admin_requests.archive");
  const canIssueDocs = can(session, "documents.manage");
  const canCreate = canAny(session, [
    "my_requests.create",
    "admin_requests.create",
    "support_requests.create",
  ]);

  const sp = await searchParams;
  const requestedView = readParam(sp.view);
  const view: "mine" | "queue" = canProcess
    ? requestedView === "mine"
      ? "mine"
      : "queue"
    : "mine";

  const statusParam = readParam(sp.status);
  const statusFilter: RequestStatus | null = isValidStatus(statusParam)
    ? statusParam
    : null;
  const serviceParam = readParam(sp.service);
  const serviceFilter = isValidServiceCode(serviceParam) ? serviceParam : null;
  const q = readParam(sp.q).trim();
  const pageParam = Number.parseInt(readParam(sp.page), 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const where: Prisma.RequestWhereInput = { archivedAt: null };
  if (view === "mine") {
    where.createdById = { in: identityUserIds };
  }
  if (statusFilter) {
    where.status = statusFilter;
  }
  if (serviceFilter) {
    where.serviceCode = serviceFilter;
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
    ];
  }

  const scopeWhere: Prisma.RequestWhereInput =
    view === "mine"
      ? { archivedAt: null, createdById: { in: identityUserIds } }
      : { archivedAt: null };

  const [total, requests, statusGroups] = await Promise.all([
    db.request.count({ where }),
    db.request.findMany({
      include: {
        company: { select: { legalName: true, shortName: true } },
        createdBy: { select: { displayName: true } },
        events: {
          include: { actor: { select: { displayName: true } } },
          orderBy: { createdAt: "desc" },
          take: 6,
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      where,
    }),
    db.request.groupBy({
      _count: true,
      by: ["status"],
      where: scopeWhere,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusCount = new Map(
    statusGroups.map((group) => [group.status, group._count]),
  );

  const [activeCompanies, activeDocTypes] = canCreate
    ? await Promise.all([
        db.company.findMany({
          orderBy: { code: "asc" },
          select: { id: true, legalName: true, shortName: true },
          where: { status: "ACTIVE" },
        }),
        db.documentType.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
          where: { status: "ACTIVE", takesNumber: true },
        }),
      ])
    : [[], []];

  function buildHref(overrides: Record<string, string | number | null>) {
    const params = new URLSearchParams();
    const merged: Record<string, string> = {
      page: String(page),
      q,
      service: serviceFilter ?? "",
      status: statusFilter ?? "",
      view,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = String(value);
      }
    }
    for (const [key, value] of Object.entries(merged)) {
      if (value) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return query ? `/thuc-thi?${query}` : "/thuc-thi";
  }

  return (
    <AppShell activePath="/thuc-thi" session={session}>
      <section className="space-y-3">
        <Badge tone="warning">Thực thi</Badge>
        <h1 className="text-3xl font-extrabold tracking-tight text-primary">
          Yêu cầu hành chính
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Gửi yêu cầu, theo dõi xử lý, phê duyệt và lịch sử. Danh sách lọc và
          phân trang chạy trực tiếp trên Postgres có index nên mở nhanh kể cả khi
          dữ liệu lớn.
        </p>
      </section>

      <ExecTabs active="yeu-cau" showManage={canProcess} />

      {canCreate ? (
        <Panel className="mt-6" title="Tạo yêu cầu mới">
          <RequestForm companies={activeCompanies} docTypes={activeDocTypes} services={requestServices} />
        </Panel>
      ) : null}

      {canProcess ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <LinkButton
            href={buildHref({ page: 1, view: "queue" })}
            size="sm"
            variant={view === "queue" ? "secondary" : "ghost"}
          >
            Hàng đợi xử lý
          </LinkButton>
          <LinkButton
            href={buildHref({ page: 1, view: "mine" })}
            size="sm"
            variant={view === "mine" ? "secondary" : "ghost"}
          >
            Yêu cầu của tôi
          </LinkButton>
        </div>
      ) : null}

      <section className="mt-4 flex flex-wrap gap-2">
        <LinkButton
          href={buildHref({ page: 1, status: null })}
          size="sm"
          variant={statusFilter === null ? "secondary" : "ghost"}
        >
          Tất cả ({total})
        </LinkButton>
        {requestStatusOrder.map((status) => (
          <LinkButton
            href={buildHref({ page: 1, status })}
            key={status}
            size="sm"
            variant={statusFilter === status ? "secondary" : "ghost"}
          >
            {requestStatusMeta[status].label} ({statusCount.get(status) ?? 0})
          </LinkButton>
        ))}
      </section>

      <form action="/thuc-thi" className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <input name="view" type="hidden" value={view} />
        {statusFilter ? (
          <input name="status" type="hidden" value={statusFilter} />
        ) : null}
        <label className="space-y-1.5 text-sm font-semibold text-foreground">
          <span>Loại yêu cầu</span>
          <select
            className="h-12 w-56 rounded-lg border border-border bg-surface px-3.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            defaultValue={serviceFilter ?? ""}
            name="service"
          >
            <option value="">Tất cả loại</option>
            {requestServices.map((service) => (
              <option key={service.code} value={service.code}>
                {service.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-foreground">
          <span>Tìm kiếm</span>
          <input
            className="h-12 w-64 rounded-lg border border-border bg-surface px-3.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
            defaultValue={q}
            name="q"
            placeholder="Mã yêu cầu hoặc tiêu đề"
          />
        </label>
        <Button type="submit" variant="secondary">
          Lọc
        </Button>
        {serviceFilter || q ? (
          <LinkButton href={buildHref({ page: 1, q: null, service: null })} size="sm" variant="ghost">
            Xóa lọc
          </LinkButton>
        ) : null}
      </form>

      <p className="mt-3 text-xs text-muted">
        {total} yêu cầu &middot; trang {page}/{totalPages}
      </p>

      <div className="mt-4 space-y-4">
        {requests.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 text-sm leading-6 text-muted">
            Chưa có yêu cầu nào khớp bộ lọc hiện tại.
          </div>
        ) : (
          requests.map((request) => {
            const status = request.status;
            const isSeal = isNumberingService(request.serviceCode);
            const sealInfo = (request.payload ?? {}) as {
              documentTypeId?: string;
              issuedNumber?: string;
              partnerName?: string;
              signDate?: string;
            };
            const customFields = isSeal ? [] : getServiceFields(request.serviceCode);
            const customPayload = (request.payload ?? {}) as Record<string, unknown>;
            const isDigitalSignature = payloadItems(customPayload).some(
              isElectronicSignatureItem,
            );
            const showProcess =
              canProcess &&
              !isDigitalSignature &&
              (status === "SUBMITTED" || status === "NEEDS_INFO");
            const showNeedsInfo =
              canProcess && !isDigitalSignature && status === "IN_PROGRESS";
            const showComplete =
              canProcess && !isSeal && (status === "IN_PROGRESS" || status === "APPROVED");
            const showIssueSeal =
              canProcess && canIssueDocs && isSeal && !isDigitalSignature && !sealInfo.issuedNumber &&
              (status === "IN_PROGRESS" || status === "APPROVED");
            const showDecision =
              canApprove &&
              !isDigitalSignature &&
              (status === "SUBMITTED" || status === "IN_PROGRESS");
            const showCancel =
              (canArchive || sessionOwnsUserId(session, request.createdById)) &&
              (status === "SUBMITTED" ||
                status === "IN_PROGRESS" ||
                status === "NEEDS_INFO");
            const hasActions =
              showProcess ||
              showNeedsInfo ||
              showComplete ||
              showIssueSeal ||
              showDecision ||
              showCancel;

            return (
              <article
                className="rounded-xl border border-border bg-surface p-5 shadow-[0_16px_40px_rgba(17,45,39,0.06)]"
                key={request.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-accent">
                        {request.code}
                      </span>
                      <Badge tone="neutral">{serviceLabel(request.serviceCode)}</Badge>
                      <StatusBadge status={status} />
                      {request.priority ? (
                        <span className="text-xs text-muted">Ưu tiên: {request.priority}</span>
                      ) : null}
                    </div>
                    <h2 className="mt-2 text-base font-bold text-foreground">
                      {request.title}
                    </h2>
                    <div className="mt-1 text-xs text-muted">
                      {request.createdBy.displayName}
                      {request.company
                        ? ` · ${request.company.shortName || request.company.legalName}`
                        : ""}
                      {` · ${formatDateTime(request.createdAt)}`}
                    </div>
                  </div>
                </div>

                {request.note ? (
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-foreground">
                    {request.note}
                  </p>
                ) : null}

                {isSeal ? (
                  <div className="mt-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
                    <span className="text-xs text-muted">
                      {[sealInfo.partnerName, sealInfo.signDate].filter(Boolean).join(" · ") || "Đóng dấu & Ký số"}
                    </span>
                    {sealInfo.issuedNumber ? (
                      <div className="mt-0.5 font-mono text-base font-bold text-primary">Số: {sealInfo.issuedNumber}</div>
                    ) : (
                      <div className="mt-0.5 text-xs font-semibold text-accent">Chờ cấp số</div>
                    )}
                  </div>
                ) : null}

                {customFields.length > 0 && customFields.some((f) => customPayload[f.name] !== undefined && customPayload[f.name] !== "" && customPayload[f.name] !== false) ? (
                  <dl className="mt-3 grid gap-x-6 gap-y-1 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm sm:grid-cols-2">
                    {customFields.map((f) => {
                      const v = customPayload[f.name];
                      if (v === undefined || v === "" || v === false) return null;
                      return (
                        <div className="flex justify-between gap-3" key={f.name}>
                          <dt className="text-muted">{f.label}</dt>
                          <dd className="text-right font-semibold text-foreground">{f.type === "checkbox" ? "Có" : String(v)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : null}

                {hasActions ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {showProcess ? (
                      <form action={processRequestAction.bind(null, request.id)}>
                        <Button size="sm" type="submit">
                          Tiếp nhận
                        </Button>
                      </form>
                    ) : null}
                    {showDecision ? (
                      <form action={approveRequestAction.bind(null, request.id)}>
                        <Button size="sm" type="submit">
                          Duyệt
                        </Button>
                      </form>
                    ) : null}
                    {showNeedsInfo ? (
                      <form action={needsInfoRequestAction.bind(null, request.id)}>
                        <Button size="sm" type="submit" variant="secondary">
                          Yêu cầu bổ sung
                        </Button>
                      </form>
                    ) : null}
                    {showComplete ? (
                      <form action={completeRequestAction.bind(null, request.id)}>
                        <Button size="sm" type="submit" variant="secondary">
                          Hoàn tất
                        </Button>
                      </form>
                    ) : null}
                    {showIssueSeal ? (
                      <form action={issueAndCompleteRequestAction.bind(null, request.id)}>
                        <Button size="sm" type="submit">
                          Cấp số & hoàn tất
                        </Button>
                      </form>
                    ) : null}
                    {showDecision ? (
                      <form action={rejectRequestAction.bind(null, request.id)}>
                        <ConfirmButton
                          confirmLabel="Từ chối"
                          message="Yêu cầu này sẽ bị từ chối. Bạn chắc chứ?"
                          title="Từ chối yêu cầu"
                          variant="danger"
                        >
                          Từ chối
                        </ConfirmButton>
                      </form>
                    ) : null}
                    {showCancel ? (
                      <form action={cancelRequestAction.bind(null, request.id)}>
                        <ConfirmButton
                          confirmLabel="Hủy yêu cầu"
                          message="Yêu cầu này sẽ bị hủy. Bạn chắc chứ?"
                          title="Hủy yêu cầu"
                        >
                          Hủy
                        </ConfirmButton>
                      </form>
                    ) : null}
                  </div>
                ) : null}

                {request.events.length > 0 ? (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-semibold text-muted">
                      Lịch sử ({request.events.length})
                    </summary>
                    <ul className="mt-3 space-y-2 border-l border-border pl-4">
                      {request.events.map((event) => (
                        <li key={event.id} className="text-sm">
                          <span className="font-semibold text-foreground">
                            {requestEventLabels[event.type] ?? event.type}
                          </span>
                          <span className="text-muted">
                            {" "}
                            · {event.actor?.displayName ?? "Hệ thống"} ·{" "}
                            {formatDateTime(event.createdAt)}
                          </span>
                          {event.note ? (
                            <div className="text-xs text-muted">{event.note}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      {totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-between">
          <LinkButton
            href={buildHref({ page: Math.max(1, page - 1) })}
            size="sm"
            variant="secondary"
          >
            Trang trước
          </LinkButton>
          <span className="text-sm text-muted">
            Trang {page} / {totalPages}
          </span>
          <LinkButton
            href={buildHref({ page: Math.min(totalPages, page + 1) })}
            size="sm"
            variant="secondary"
          >
            Trang sau
          </LinkButton>
        </div>
      ) : null}
    </AppShell>
  );
}
