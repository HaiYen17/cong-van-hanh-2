import type { Metadata } from "next";
import {
  ArrowDown,
  ArrowUp,
  BellRing,
  CheckCircle2,
  Clock3,
  Image as ImageIcon,
  Search,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge, Button, LinkButton, Panel } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { MultiOption } from "@/components/ui/multi-select";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { formatMotivationSchedule } from "@/lib/motivation-policy";

import { ConfigTabs } from "../config-tabs";
import {
  deleteReactionSetAction,
  moveMotivationPriorityAction,
  setMotivationStatusAction,
  setReactionSetStatusAction,
} from "./actions";
import { MotivationForm, type EditingEvent } from "./motivation-form";
import {
  ReactionSetForm,
  type EditingReactionSet,
} from "./reaction-set-form";

export const metadata: Metadata = {
  title: "Thông báo & Bản tin | Cổng vận hành",
};

type ReactionOption = {
  label: string;
  symbol: string;
  tone: string;
  value: string;
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function options(value: unknown): ReactionOption[] {
  return (Array.isArray(value) ? value : []).map((raw) => {
    const item = raw as Partial<ReactionOption>;
    return {
      label: String(item.label || ""),
      symbol: String(item.symbol || ""),
      tone: String(item.tone || ""),
      value: String(item.value || item.label || ""),
    };
  });
}

function modeOf(items: ReactionOption[]): "emotion" | "tag" {
  return items.filter((item) => item.symbol).length >=
    Math.ceil(Math.max(items.length, 1) / 2)
    ? "emotion"
    : "tag";
}

function localDate(value: Date | null) {
  if (!value) return "";
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function linkedTask(value: unknown): EditingEvent["linkedTask"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return {
    context: item.context == null ? null : String(item.context),
    output: item.output == null ? null : String(item.output),
    title: item.title == null ? null : String(item.title),
  };
}

function kindLabel(kind: string) {
  if (kind === "event") return "Sự kiện";
  if (kind === "notice") return "Thông báo";
  return "Thông điệp";
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function eventImage(event: {
  imageId: string | null;
  imageUrl: string | null;
  imageUrls: unknown;
}) {
  if (event.imageUrl) return event.imageUrl;
  if (event.imageId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(event.imageId)}&sz=w400`;
  }
  const first = stringArray(event.imageUrls)[0];
  return first || "";
}

function channelLabel(channel: string) {
  if (channel === "notifier") return "Notifier";
  if (channel === "both") return "WebApp + Notifier";
  return "WebApp";
}

function targetLabel(scope: string) {
  if (scope === "company") return "Theo công ty";
  if (scope === "department") return "Theo phòng ban";
  if (scope === "employee") return "Theo nhân sự";
  return "Tất cả nhân sự";
}

export default async function EventConfigPage({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    kind?: string;
    q?: string;
    reaction?: string;
  }>;
}) {
  const session = await requireCurrentSession();
  const canRead = canAny(session, ["motivation.read", "motivation.manage"]);
  const canManage = can(session, "motivation.manage");
  if (!canRead) {
    return (
      <AppShell activePath="/cau-hinh" session={session}>
        <Panel title="Không có quyền">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền xem cấu hình Sự kiện.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const { edit, kind: kindFilter = "", q = "", reaction } = await searchParams;
  const db = getDb();
  const [events, reactionSets, companies, employees] = await Promise.all([
    db.motivationEvent.findMany({
      include: {
        _count: { select: { reactions: true } },
        reactionSet: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
      where: { archivedAt: null },
    }),
    db.reactionSet.findMany({
      orderBy: { name: "asc" },
      select: {
        _count: { select: { events: true } },
        id: true,
        name: true,
        options: true,
        status: true,
      },
    }),
    db.company.findMany({
      orderBy: { code: "asc" },
      select: { id: true, legalName: true },
      where: { status: "ACTIVE" },
    }),
    db.employee.findMany({
      orderBy: { fullName: "asc" },
      select: {
        department: true,
        employeeCode: true,
        fullName: true,
      },
      where: { status: "ACTIVE" },
    }),
  ]);

  const source = edit ? events.find((event) => event.id === edit) : null;
  const editing: EditingEvent | null = source
    ? {
        autoDismissMs: source.autoDismissMs,
        body: source.body,
        bypassSnooze: source.bypassSnooze,
        closePolicy: source.closePolicy,
        displayChannel: source.displayChannel,
        displayMode: source.displayMode,
        endAtLocal: localDate(source.endAt),
        id: source.id,
        image: source.imageId || source.imageUrl || "",
        images: stringArray(source.imageUrls).join("\n"),
        kind: source.kind,
        level: source.level,
        linkedTask: linkedTask(source.linkedTask),
        location: source.location,
        popupContentMode: source.popupContentMode,
        priority: source.priority,
        reactionSetId: source.reactionSetId,
        reminderTimes: stringArray(source.reminderTimes).join(", "),
        requireAck: source.requireAck,
        saveResponse: source.saveResponse,
        startAtLocal: localDate(source.startAt),
        targetCompanies: stringArray(source.targetCompanies),
        targetDepartments: stringArray(source.targetDepartments),
        targetEmployees: stringArray(source.targetEmployees),
        targetScope: source.targetScope,
        targetUrl: source.targetUrl,
        thumbnail: source.thumbnailId || source.thumbnailUrl || "",
        title: source.title,
      }
    : null;
  const reactionSource = reaction
    ? reactionSets.find((item) => item.id === reaction)
    : null;
  const editingReaction: EditingReactionSet | null = reactionSource
    ? (() => {
        const reactionOptions = options(reactionSource.options);
        return {
          id: reactionSource.id,
          mode: modeOf(reactionOptions),
          name: reactionSource.name,
          options: reactionOptions,
        };
      })()
    : null;
  const employeeOptions: MultiOption[] = employees.map((employee) => ({
    label: employee.fullName,
    sub: [employee.employeeCode, employee.department].filter(Boolean).join(" · "),
    value: employee.employeeCode,
  }));
  const departmentOptions: MultiOption[] = [
    ...new Set(
      employees
        .map((employee) => employee.department)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
    .sort((left, right) => left.localeCompare(right, "vi"))
    .map((department) => ({ label: department, value: department }));
  const normalizedQuery = normalize(q.trim());
  const visibleEvents = events.filter((event) => {
    if (kindFilter && event.kind !== kindFilter) return false;
    if (!normalizedQuery) return true;
    return normalize(
      [
        event.title,
        event.body,
        event.location,
        event.reactionSet?.name,
      ]
        .filter(Boolean)
        .join(" "),
    ).includes(normalizedQuery);
  });
  const activeCount = events.filter((event) => event.status === "ACTIVE").length;
  const scheduledCount = events.filter(
    // Server Component chụp một mốc hiện tại cho thẻ thống kê lúc render.
    // eslint-disable-next-line react-hooks/purity
    (event) => event.startAt && event.startAt.getTime() > Date.now(),
  ).length;
  const imageCount = events.filter((event) => Boolean(eventImage(event))).length;

  return (
    <AppShell activePath="/cau-hinh" session={session}>
      <section className="overflow-hidden rounded-xl border border-[#ead5dd] bg-[radial-gradient(circle_at_90%_0%,rgba(255,255,255,.22),transparent_32%),linear-gradient(115deg,#bd2153,#991a42_58%,#71152f)] p-6 text-white shadow-[0_18px_44px_rgba(113,21,47,.2)]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <Badge tone="warning">Cấu hình V2</Badge>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white">
              Thông báo & Bản tin
            </h1>
            <p className="mt-2 text-sm leading-6 text-white/75">
              Soạn nội dung có định dạng, tải và sắp thứ tự hình, chọn bộ tương
              tác, lịch phát, kênh Notifier, đối tượng nhận và công việc liên kết.
            </p>
          </div>
          <span className="grid size-16 place-items-center rounded-2xl border border-white/20 bg-white/10 shadow-inner">
            <BellRing size={30} />
          </span>
        </div>
      </section>
      <ConfigTabs active="event" />

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: BellRing, label: "Tổng nội dung", value: events.length },
          { icon: CheckCircle2, label: "Đang hiển thị", value: activeCount },
          { icon: Clock3, label: "Đã lên lịch", value: scheduledCount },
          { icon: ImageIcon, label: "Có hình ảnh", value: imageCount },
        ].map(({ icon: Icon, label, value }) => (
          <article
            className="ui-module-panel flex items-center gap-3 p-4"
            key={label}
          >
            <span className="grid size-11 place-items-center rounded-xl bg-[#fff0f5] text-[#b51d4b]">
              <Icon size={21} />
            </span>
            <span>
              <strong className="block text-xl font-black text-primary">
                {value}
              </strong>
              <small className="text-xs text-muted">{label}</small>
            </span>
          </article>
        ))}
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="space-y-5">
          {canManage ? (
            <section className="ui-module-panel p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <Badge tone="info">Biên tập nội dung</Badge>
                  <h2 className="mt-2 text-xl font-extrabold text-primary">
                    {editing ? `Sửa ${editing.title}` : "Tạo nội dung mới"}
                  </h2>
                </div>
                {editing ? (
                  <LinkButton
                    href="/cau-hinh/thong-bao"
                    size="sm"
                    variant="secondary"
                  >
                    Làm mới
                  </LinkButton>
                ) : null}
              </div>
              <MotivationForm
                companies={companies}
                departments={departmentOptions}
                editing={editing}
                employees={employeeOptions}
                reactionSets={reactionSets.map((item) => ({
                  id: item.id,
                  name: item.name,
                }))}
              />
            </section>
          ) : null}

          {canManage ? (
            <section className="ui-module-panel p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <Badge tone="warning">Cấu hình bộ tương tác</Badge>
                  <h2 className="mt-2 text-xl font-extrabold text-primary">
                    {editingReaction
                      ? `Sửa ${editingReaction.name}`
                      : "Icon cảm xúc / thẻ tag"}
                  </h2>
                </div>
                {editingReaction ? (
                  <LinkButton
                    href="/cau-hinh/thong-bao"
                    size="sm"
                    variant="secondary"
                  >
                    Làm mới
                  </LinkButton>
                ) : null}
              </div>
              <ReactionSetForm editing={editingReaction} />
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <section className="ui-module-panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Badge tone="info">Danh sách nội dung</Badge>
                <h2 className="mt-2 text-xl font-extrabold text-primary">
                  {visibleEvents.length}/{events.length} nội dung
                </h2>
              </div>
              <LinkButton
                href="/cau-hinh/thong-bao"
                size="sm"
                variant="ghost"
              >
                Làm mới
              </LinkButton>
            </div>
            <form className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
              <label className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  size={17}
                />
                <input
                  className="ui-module-input min-h-11 pl-10"
                  defaultValue={q}
                  name="q"
                  placeholder="Tìm tiêu đề, nội dung…"
                  type="search"
                />
              </label>
              <select
                className="ui-module-select min-h-11"
                defaultValue={kindFilter}
                name="kind"
              >
                <option value="">Tất cả loại</option>
                <option value="message">Thông điệp</option>
                <option value="event">Sự kiện</option>
                <option value="notice">Thông báo</option>
              </select>
              <Button size="sm" type="submit" variant="secondary">
                Lọc
              </Button>
            </form>
            <div className="mt-4 max-h-[640px] space-y-3 overflow-auto pr-1">
              {visibleEvents.map((event, index) => {
                const image = eventImage(event);
                return (
                <article
                  className="overflow-hidden rounded-lg border border-border bg-surface"
                  key={event.id}
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="h-28 w-full bg-surface-muted object-cover"
                      src={image}
                    />
                  ) : null}
                  <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <Badge tone={event.kind === "message" ? "info" : "warning"}>
                          {kindLabel(event.kind)}
                        </Badge>
                        <Badge tone={event.status === "ACTIVE" ? "success" : "neutral"}>
                          {event.status === "ACTIVE" ? "Đang hiển thị" : "Tạm tắt"}
                        </Badge>
                        <Badge tone="neutral">
                          {channelLabel(event.displayChannel)}
                        </Badge>
                        <Badge tone="neutral">
                          {targetLabel(event.targetScope)}
                        </Badge>
                        {event.requireAck ? (
                          <Badge tone="warning">Cần xác nhận</Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 font-extrabold text-primary">
                        {event.title}
                      </div>
                      {formatMotivationSchedule(event.startAt, event.endAt) ? (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[#8a3f17]">
                          <Clock3 size={14} />
                          {formatMotivationSchedule(event.startAt, event.endAt)}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs font-semibold text-muted">
                          Hiển thị không giới hạn thời gian
                        </div>
                      )}
                      {event.location ? (
                        <div className="mt-1 text-xs font-semibold text-primary">
                          Địa điểm: {event.location}
                        </div>
                      ) : null}
                      {event.body ? (
                        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted">
                          {event.body}
                        </p>
                      ) : null}
                      <div className="mt-2 text-xs text-muted">
                        Ưu tiên {event.priority} ·{" "}
                        {event.reactionSet?.name || "Không tương tác"} ·{" "}
                        {event._count.reactions} phản hồi
                      </div>
                    </div>
                  </div>
                  {canManage ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <form
                        action={moveMotivationPriorityAction.bind(
                          null,
                          event.id,
                          "up",
                        )}
                      >
                        <Button
                          aria-label="Đưa lên trước"
                          disabled={index === 0}
                          size="sm"
                          title="Đưa lên trước"
                          type="submit"
                          variant="ghost"
                        >
                          <ArrowUp size={15} />
                        </Button>
                      </form>
                      <form
                        action={moveMotivationPriorityAction.bind(
                          null,
                          event.id,
                          "down",
                        )}
                      >
                        <Button
                          aria-label="Đưa xuống sau"
                          disabled={index === visibleEvents.length - 1}
                          size="sm"
                          title="Đưa xuống sau"
                          type="submit"
                          variant="ghost"
                        >
                          <ArrowDown size={15} />
                        </Button>
                      </form>
                      <LinkButton
                        href={`/cau-hinh/thong-bao?edit=${event.id}`}
                        size="sm"
                        variant="secondary"
                      >
                        Sửa
                      </LinkButton>
                      <form
                        action={setMotivationStatusAction.bind(
                          null,
                          event.id,
                          event.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        )}
                      >
                        <Button size="sm" type="submit" variant="ghost">
                          {event.status === "ACTIVE" ? "Tắt" : "Bật"}
                        </Button>
                      </form>
                      <form
                        action={setMotivationStatusAction.bind(
                          null,
                          event.id,
                          "ARCHIVED",
                        )}
                      >
                        <Button size="sm" type="submit" variant="danger">
                          Lưu trữ
                        </Button>
                      </form>
                    </div>
                  ) : null}
                  </div>
                </article>
                );
              })}
              {visibleEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-8 text-center text-sm text-muted">
                  Không có nội dung khớp bộ lọc hiện tại.
                </div>
              ) : null}
            </div>
          </section>

          <section className="ui-module-panel p-5">
            <Badge tone="warning">Danh sách bộ tương tác</Badge>
            <h2 className="mt-2 text-xl font-extrabold text-primary">
              {reactionSets.length} bộ
            </h2>
            <div className="mt-4 space-y-3">
              {reactionSets.map((set) => (
                <article
                  className="rounded-lg border border-border bg-surface p-4"
                  key={set.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-extrabold text-primary">{set.name}</div>
                    <Badge tone={set.status === "ACTIVE" ? "success" : "warning"}>
                      {set.status === "ACTIVE" ? "Bật" : "Tắt"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {options(set.options).map((item, index) => (
                      <span className="ui-chip min-h-7 px-2.5 text-xs" key={index}>
                        {item.symbol ? `${item.symbol} ` : ""}
                        {item.label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-muted">
                    Đang dùng ở {set._count.events} nội dung.
                  </div>
                  {canManage ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <LinkButton
                        href={`/cau-hinh/thong-bao?reaction=${set.id}`}
                        size="sm"
                        variant="secondary"
                      >
                        Sửa
                      </LinkButton>
                      <form
                        action={setReactionSetStatusAction.bind(
                          null,
                          set.id,
                          set.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        )}
                      >
                        <Button size="sm" type="submit" variant="ghost">
                          {set.status === "ACTIVE" ? "Tắt" : "Bật"}
                        </Button>
                      </form>
                      <form action={deleteReactionSetAction.bind(null, set.id)}>
                        <ConfirmButton
                          confirmLabel="Xóa"
                          message="Xóa bộ tương tác này?"
                          size="sm"
                          title="Xóa bộ tương tác"
                          variant="danger"
                        >
                          Xóa
                        </ConfirmButton>
                      </form>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
