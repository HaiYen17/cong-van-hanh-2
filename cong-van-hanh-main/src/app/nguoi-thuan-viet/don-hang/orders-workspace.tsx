"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Archive,
  CheckCircle2,
  Clock3,
  Files,
  Search,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { cancelRequestAction } from "@/app/thuc-thi/actions";
import { Badge, Button, Input } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

type Ticket = {
  assignedTo: string;
  attachments: {
    fileName: string;
    fileUrl: string;
    id: string;
    mimeType: string;
    sizeBytes: number;
  }[];
  code: string;
  company: string;
  completedAt: string;
  createdAt: string;
  events: {
    actor: string;
    createdAt: string;
    id: string;
    note: string;
    type: string;
  }[];
  id: string;
  note: string;
  payload: unknown;
  priority: string;
  serviceCode: string;
  serviceLabel: string;
  status: string;
  statusLabel: string;
  title: string;
  updatedAt: string;
};

type FilterKey = "all" | "received" | "processing" | "needs-info" | "done" | "overdue";

const FILTERS: {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  key: FilterKey;
  label: string;
}[] = [
  { icon: Archive, key: "all", label: "Tất cả" },
  { icon: Clock3, key: "received", label: "Đã tiếp nhận" },
  { icon: Clock3, key: "processing", label: "Đang xử lý" },
  { icon: Files, key: "needs-info", label: "Cần bổ sung" },
  { icon: CheckCircle2, key: "done", label: "Hoàn tất" },
  { icon: Clock3, key: "overdue", label: "Quá hạn" },
];

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function objectPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function dueAt(ticket: Ticket) {
  const payload = objectPayload(ticket.payload);
  const due = String(payload.dueAt || payload.deadline || "").trim();
  if (due) {
    const parsed = Date.parse(due);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.parse(ticket.createdAt) + 7 * 24 * 60 * 60 * 1000;
}

function isClosed(status: string) {
  return ["COMPLETED", "CANCELLED", "REJECTED"].includes(status);
}

function isOverdue(ticket: Ticket) {
  return !isClosed(ticket.status) && dueAt(ticket) < Date.now();
}

function matchesFilter(ticket: Ticket, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "received") return ticket.status === "SUBMITTED";
  if (filter === "processing") {
    return ["IN_PROGRESS", "APPROVED"].includes(ticket.status);
  }
  if (filter === "needs-info") return ticket.status === "NEEDS_INFO";
  if (filter === "done") return isClosed(ticket.status);
  return isOverdue(ticket);
}

function statusTone(status: string) {
  if (status === "COMPLETED" || status === "APPROVED") return "success" as const;
  if (status === "REJECTED") return "danger" as const;
  if (status === "NEEDS_INFO" || status === "IN_PROGRESS") return "warning" as const;
  if (status === "CANCELLED") return "neutral" as const;
  return "info" as const;
}

function valueText(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function PayloadSummary({ payload }: { payload: unknown }) {
  const source = objectPayload(payload);
  const items = Array.isArray(source.items)
    ? (source.items as Record<string, unknown>[])
    : [];
  if (items.length) {
    return (
      <div className="space-y-2">
        {items.map((item, index) => (
          <article
            className="rounded-lg border border-border bg-surface-muted/70 p-3"
            key={index}
          >
            <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-accent">
              Mục {index + 1}
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              {Object.entries(item).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    {key}
                  </dt>
                  <dd className="whitespace-pre-wrap text-sm text-foreground">
                    {valueText(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    );
  }
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {Object.entries(source).map(([key, value]) => (
        <div key={key}>
          <dt className="text-[11px] font-bold uppercase tracking-wide text-muted">
            {key}
          </dt>
          <dd className="whitespace-pre-wrap text-sm text-foreground">
            {valueText(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function OrdersWorkspace({ tickets }: { tickets: Ticket[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [view, setView] = useState<"detail" | "json" | "files">("detail");
  const [pending, startTransition] = useTransition();

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((item) => [
          item.key,
          tickets.filter((ticket) => matchesFilter(ticket, item.key)).length,
        ]),
      ) as Record<FilterKey, number>,
    [tickets],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    return tickets
      .filter((ticket) => matchesFilter(ticket, filter))
      .filter((ticket) => {
        if (!needle) return true;
        return [
          ticket.code,
          ticket.title,
          ticket.serviceLabel,
          ticket.company,
          ticket.statusLabel,
        ].some((value) => value.toLocaleLowerCase("vi").includes(needle));
      })
      .sort((left, right) => {
        if (isClosed(left.status) && isClosed(right.status)) {
          return Date.parse(right.completedAt || right.updatedAt) - Date.parse(left.completedAt || left.updatedAt);
        }
        return Date.parse(right.createdAt) - Date.parse(left.createdAt);
      });
  }, [filter, query, tickets]);

  const cancel = (ticket: Ticket) => {
    if (!window.confirm(`Hủy đơn ${ticket.code}?`)) return;
    startTransition(async () => {
      await cancelRequestAction(ticket.id);
      toast({
        message: `Đơn ${ticket.code} đã chuyển sang trạng thái hủy.`,
        title: "Đã cập nhật",
        tone: "success",
      });
      setSelected(null);
      router.refresh();
    });
  };

  return (
    <>
      <WriteLoadingOverlay message="Đang cập nhật đơn hàng..." show={pending} />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {FILTERS.map((item) => {
          const Icon = item.icon;
          const active = filter === item.key;
          return (
            <button
              className={`rounded-lg border px-4 py-3 text-left transition ${
                active
                  ? "border-accent bg-accent-soft text-primary shadow-[0_10px_26px_var(--brand-shadow-soft)]"
                  : "border-border bg-surface text-muted hover:border-accent/40"
              }`}
              key={item.key}
              onClick={() => setFilter(item.key)}
              type="button"
            >
              <div className="flex items-center justify-between">
                <Icon size={18} />
                <span className="text-2xl font-extrabold text-primary">
                  {counts[item.key]}
                </span>
              </div>
              <div className="mt-1 text-xs font-extrabold uppercase tracking-wide">
                {item.label}
              </div>
            </button>
          );
        })}
      </section>

      <section className="ui-module-toolbar mt-4 flex items-center gap-3 p-3">
        <Search aria-hidden className="shrink-0 text-accent" size={20} />
        <Input
          className="border-0 bg-transparent shadow-none focus:ring-0"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm mã đơn, dịch vụ, nội dung, công ty..."
          value={query}
        />
      </section>

      <section className="mt-4 space-y-3">
        {visible.length ? (
          visible.map((ticket) => (
            <button
              className="ui-module-panel grid w-full gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:border-accent/35 md:grid-cols-[160px_minmax(0,1fr)_180px]"
              key={ticket.id}
              onClick={() => {
                setSelected(ticket);
                setView("detail");
              }}
              type="button"
            >
              <div>
                <div className="font-mono text-xs font-extrabold text-accent">
                  {ticket.code}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {formatDate(ticket.createdAt)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="truncate font-extrabold text-primary">
                  {ticket.title}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                  <span>{ticket.serviceLabel}</span>
                  {ticket.company ? <span>· {ticket.company}</span> : null}
                  {ticket.priority ? <span>· {ticket.priority}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {isOverdue(ticket) ? <Badge tone="danger">Quá hạn</Badge> : null}
                <Badge tone={statusTone(ticket.status)}>
                  {ticket.statusLabel}
                </Badge>
              </div>
            </button>
          ))
        ) : (
          <div className="ui-module-panel grid min-h-56 place-items-center border-dashed p-8 text-center text-sm text-muted">
            Không có đơn phù hợp với bộ lọc hiện tại.
          </div>
        )}
      </section>

      {selected ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-[rgba(7,24,21,0.48)] p-4 backdrop-blur-[3px]">
          <section className="max-h-[92dvh] w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-surface shadow-[0_32px_90px_rgba(17,45,39,0.28)]">
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <div className="font-mono text-xs font-extrabold text-accent">
                  {selected.code}
                </div>
                <h2 className="mt-1 text-xl font-extrabold text-primary">
                  {selected.title}
                </h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone={statusTone(selected.status)}>
                    {selected.statusLabel}
                  </Badge>
                  <Badge tone="neutral">{selected.serviceLabel}</Badge>
                </div>
              </div>
              <button
                aria-label="Đóng"
                className="ui-close-button"
                onClick={() => setSelected(null)}
                type="button"
              >
                <X size={20} />
              </button>
            </header>

            <nav className="flex gap-1 border-b border-border px-5 pt-3">
              {[
                ["detail", "Chi tiết"],
                ["files", `Tệp (${selected.attachments.length})`],
                ["json", "Xem JSON"],
              ].map(([key, label]) => (
                <button
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-extrabold ${
                    view === key
                      ? "border-accent text-primary"
                      : "border-transparent text-muted"
                  }`}
                  key={key}
                  onClick={() => setView(key as typeof view)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="max-h-[calc(92dvh-190px)] overflow-auto p-5">
              {view === "detail" ? (
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div>
                    <PayloadSummary payload={selected.payload} />
                    {selected.note ? (
                      <div className="mt-4 rounded-lg border border-border bg-surface-muted p-4">
                        <div className="text-xs font-extrabold uppercase tracking-wide text-muted">
                          Ghi chú
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                          {selected.note}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <aside className="space-y-4">
                    <dl className="rounded-lg border border-border p-4 text-sm">
                      {[
                        ["Ngày tạo", formatDate(selected.createdAt)],
                        ["Công ty", selected.company || "—"],
                        ["Người xử lý", selected.assignedTo || "Chưa phân công"],
                        ["Mức ưu tiên", selected.priority || "Bình thường"],
                      ].map(([label, value]) => (
                        <div className="border-b border-border py-2 last:border-0" key={label}>
                          <dt className="text-xs font-bold text-muted">{label}</dt>
                          <dd className="mt-0.5 font-semibold text-foreground">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="rounded-lg border border-border p-4">
                      <div className="mb-3 text-sm font-extrabold text-primary">
                        Lịch sử xử lý
                      </div>
                      <div className="space-y-3">
                        {selected.events.map((event) => (
                          <div className="border-l-2 border-accent/40 pl-3" key={event.id}>
                            <div className="text-xs font-extrabold text-primary">
                              {event.type}
                            </div>
                            <div className="text-xs text-muted">
                              {formatDate(event.createdAt)}
                              {event.actor ? ` · ${event.actor}` : ""}
                            </div>
                            {event.note ? (
                              <p className="mt-1 text-xs leading-5">{event.note}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </aside>
                </div>
              ) : null}

              {view === "files" ? (
                selected.attachments.length ? (
                  <div className="space-y-2">
                    {selected.attachments.map((file) => (
                      <a
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm font-bold text-primary hover:border-accent"
                        href={file.fileUrl}
                        key={file.id}
                      >
                        <span className="truncate">{file.fileName}</span>
                        <span className="shrink-0 text-xs text-muted">
                          {(file.sizeBytes / 1024).toFixed(1)} KB
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
                    Đơn này không có tệp đính kèm.
                  </div>
                )
              ) : null}

              {view === "json" ? (
                <pre className="overflow-auto rounded-lg bg-[#102f2a] p-4 text-xs leading-6 text-[#e9f6f1]">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              ) : null}
            </div>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
              {!isClosed(selected.status) ? (
                <Button
                  disabled={pending}
                  onClick={() => cancel(selected)}
                  variant="danger"
                >
                  Hủy đơn
                </Button>
              ) : null}
              <Button onClick={() => setSelected(null)} variant="secondary">
                Đóng
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
