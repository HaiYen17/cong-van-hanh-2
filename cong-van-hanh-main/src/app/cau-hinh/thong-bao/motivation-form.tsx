"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileImage,
  ImagePlus,
  Italic,
  Link2,
  ListPlus,
  Megaphone,
  Palette,
  Plus,
  Target,
  Trash2,
  Underline,
} from "lucide-react";

import { Button, Input, Select } from "@/components/ui";
import { MultiSelect, type MultiOption } from "@/components/ui/multi-select";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import { saveMotivationAction, type MotivationActionState } from "./actions";

const initialState: MotivationActionState = {};

type ReactionSetOpt = { id: string; name: string };
type CompanyOpt = { id: string; legalName: string };

export type EditingEvent = {
  autoDismissMs: number | null;
  body: string | null;
  bypassSnooze: boolean;
  closePolicy: string;
  displayChannel: string;
  displayMode: string;
  endAtLocal: string;
  id: string;
  image: string;
  images: string;
  kind: string;
  level: string;
  linkedTask: {
    context?: string | null;
    output?: string | null;
    title?: string | null;
  } | null;
  location: string | null;
  popupContentMode: string;
  priority: number;
  reactionSetId: string | null;
  reminderTimes: string;
  requireAck: boolean;
  saveResponse: boolean;
  startAtLocal: string;
  targetCompanies: string[];
  targetDepartments: string[];
  targetEmployees: string[];
  targetScope: string;
  targetUrl: string | null;
  thumbnail: string;
  title: string;
};

function Field({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <label className="space-y-2 text-sm font-semibold text-foreground">
      <span>{label}</span>
      {children}
      {hint ? (
        <span className="block text-xs font-normal leading-5 text-muted">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function Switch({
  defaultChecked,
  label,
  name,
  note,
}: {
  defaultChecked?: boolean;
  label: string;
  name: string;
  note?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
      <span>
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        {note ? <span className="block text-xs leading-5 text-muted">{note}</span> : null}
      </span>
      <input
        className="mt-1 size-5 accent-[#b51d4b]"
        defaultChecked={defaultChecked}
        name={name}
        type="checkbox"
      />
    </label>
  );
}

function SectionTitle({
  children,
  number,
}: {
  children: React.ReactNode;
  number: number;
}) {
  return (
    <h3 className="flex items-center gap-2.5 text-xs font-black uppercase tracking-[0.08em] text-accent">
      <span className="grid size-7 place-items-center rounded-lg bg-accent/10 text-[11px]">
        {number}
      </span>
      {children}
    </h3>
  );
}

const textareaCls =
  "min-h-24 w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20";

function splitValues(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function moveItem(values: string[], from: number, to: number) {
  if (to < 0 || to >= values.length) return values;
  const next = [...values];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const FORM_SECTIONS = [
  {
    description: "Tiêu đề, nội dung, hình ảnh và bộ tương tác",
    icon: FileImage,
    id: "content",
    label: "Nội dung",
  },
  {
    description: "Khoảng hiệu lực, ưu tiên và lưu phản hồi",
    icon: CalendarClock,
    id: "schedule",
    label: "Lịch phát",
  },
  {
    description: "WebApp, Notifier, popup và mức độ",
    icon: Megaphone,
    id: "channel",
    label: "Kênh & popup",
  },
  {
    description: "Công ty, phòng ban hoặc từng nhân sự",
    icon: Target,
    id: "audience",
    label: "Đối tượng",
  },
  {
    description: "Tạo đầu việc gắn với thông báo",
    icon: ClipboardCheck,
    id: "task",
    label: "Giao việc",
  },
] as const;

type FormSectionId = (typeof FORM_SECTIONS)[number]["id"];

export function MotivationForm({
  companies,
  departments,
  editing,
  employees,
  reactionSets,
}: {
  companies: CompanyOpt[];
  departments: MultiOption[];
  editing: EditingEvent | null;
  employees: MultiOption[];
  reactionSets: ReactionSetOpt[];
}) {
  const [state, action, pending] = useActionState(
    saveMotivationAction,
    initialState,
  );
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const seen = useRef<MotivationActionState | null>(null);
  const [scope, setScope] = useState(editing?.targetScope ?? "all");
  const [kind, setKind] = useState(editing?.kind ?? "message");
  const [body, setBody] = useState(editing?.body ?? "");
  const [imageLinks, setImageLinks] = useState(
    splitValues(editing?.images ?? ""),
  );
  const [imageDraft, setImageDraft] = useState("");
  const [reminderTimes, setReminderTimes] = useState(
    splitValues(editing?.reminderTimes ?? ""),
  );
  const [reminderDraft, setReminderDraft] = useState("");
  const [linkedTaskEnabled, setLinkedTaskEnabled] = useState(
    Boolean(editing?.linkedTask),
  );
  const [activeSection, setActiveSection] =
    useState<FormSectionId>("content");

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) {
      toast({
        message: state.success,
        title: "Thông báo / Bản tin",
        tone: "success",
      });
      if (!editing) {
        const resetTimer = window.setTimeout(() => {
          formRef.current?.reset();
          setBody("");
          setImageLinks([]);
          setImageDraft("");
          setKind("message");
          setReminderTimes([]);
          setReminderDraft("");
          setScope("all");
          setLinkedTaskEnabled(false);
          setActiveSection("content");
        }, 0);
        return () => window.clearTimeout(resetTimer);
      }
    } else if (state.error) {
      toast({ message: state.error, title: "Không lưu được", tone: "error" });
      const errorTimer = window.setTimeout(
        () => setActiveSection("content"),
        0,
      );
      return () => window.clearTimeout(errorTimer);
    }
  }, [editing, state, toast]);

  const insertBodyFormat = (before: string, after = before) => {
    const input = bodyRef.current;
    if (!input) return;
    const start = input.selectionStart ?? body.length;
    const end = input.selectionEnd ?? start;
    const selected = body.slice(start, end) || "nội dung";
    setBody(
      `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`,
    );
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  };

  const addImageLink = () => {
    const value = imageDraft.trim();
    if (!value || imageLinks.includes(value)) return;
    setImageLinks((current) => [...current, value]);
    setImageDraft("");
  };

  const addReminder = () => {
    const value = reminderDraft.trim();
    if (!/^\d{2}:\d{2}$/.test(value) || reminderTimes.includes(value)) return;
    setReminderTimes((current) => [...current, value].sort());
    setReminderDraft("");
  };

  const companyOptions: MultiOption[] = companies.map((company) => ({
    label: company.legalName,
    value: company.id,
  }));
  const activeSectionIndex = FORM_SECTIONS.findIndex(
    (section) => section.id === activeSection,
  );

  return (
    <>
      <WriteLoadingOverlay
        message="Đang tải hình và lưu cấu hình…"
        show={pending}
      />
      <form
        action={action}
        className="space-y-7"
        encType="multipart/form-data"
        key={editing?.id ?? "new"}
        ref={formRef}
      >
        <input name="editId" type="hidden" value={editing?.id ?? ""} />

        <nav
          aria-label="Các phần cấu hình nội dung"
          className="grid gap-2 rounded-xl border border-border bg-surface-muted p-2 sm:grid-cols-2 xl:grid-cols-5"
        >
          {FORM_SECTIONS.map((section, index) => {
            const Icon = section.icon;
            const selected = activeSection === section.id;
            return (
              <button
                aria-current={selected ? "step" : undefined}
                className={`group flex min-h-[76px] items-start gap-3 rounded-lg border px-3 py-3 text-left transition ${
                  selected
                    ? "border-accent bg-gradient-to-br from-accent to-accent-strong text-white shadow-[0_10px_24px_rgba(181,29,75,.2)]"
                    : "border-transparent bg-surface text-primary hover:border-border hover:bg-white"
                }`}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                    selected
                      ? "bg-white/18 text-white"
                      : "bg-accent/10 text-accent"
                  }`}
                >
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <strong className="block text-sm font-black">
                    {index + 1}. {section.label}
                  </strong>
                  <small
                    className={`mt-1 block text-[11px] leading-4 ${
                      selected ? "text-white/78" : "text-muted"
                    }`}
                  >
                    {section.description}
                  </small>
                </span>
              </button>
            );
          })}
        </nav>

        <section
          className="space-y-4"
          hidden={activeSection !== "content"}
        >
          <SectionTitle number={1}>Nội dung và hình ảnh</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Loại nội dung">
              <Select
                name="kind"
                onChange={(event) => setKind(event.target.value)}
                value={kind}
              >
                <option value="message">Thông điệp</option>
                <option value="event">Sự kiện</option>
                <option value="notice">Thông báo</option>
              </Select>
            </Field>
            <Field label="Bộ tương tác">
              <Select
                defaultValue={editing?.reactionSetId ?? ""}
                name="reactionSetId"
              >
                <option value="">Không gắn bộ tương tác</option>
                {reactionSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tiêu đề / tên">
              <textarea
                className={`${textareaCls} min-h-[78px] font-semibold`}
                defaultValue={editing?.title ?? ""}
                name="title"
                placeholder="Tiêu đề hiển thị"
                required
              />
            </Field>
            {kind === "event" ? (
              <Field label="Địa điểm" hint="Chỉ dùng cho nội dung loại Sự kiện">
                <Input defaultValue={editing?.location ?? ""} name="location" />
              </Field>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Hình hiển thị chính"
              hint="Dán link Drive/URL hoặc tải hình mới bên dưới"
            >
              <Input
                defaultValue={editing?.image ?? ""}
                name="image"
                placeholder="https://drive.google.com/file/d/…"
              />
            </Field>
            {kind === "event" ? (
              <Field
                label="Thumbnail sự kiện"
                hint="Dùng cho thẻ Sự kiện trong danh sách"
              >
                <div className="grid gap-2">
                  <Input
                    defaultValue={editing?.thumbnail ?? ""}
                    name="thumbnail"
                    placeholder="Link Drive hoặc File ID"
                  />
                  <label className="ui-file-picker-trigger is-dashed min-h-11 cursor-pointer rounded-lg">
                    <ImagePlus size={17} />
                    <span>Chọn thumbnail mới</span>
                    <input
                      accept="image/*"
                      className="sr-only"
                      name="thumbnailFile"
                      type="file"
                    />
                  </label>
                </div>
              </Field>
            ) : null}
          </div>

          <input name="images" type="hidden" value={imageLinks.join("\n")} />
          <Field
            label="Bộ hình hiển thị"
            hint="Tải nhiều hình và điều chỉnh đúng thứ tự sẽ phát trên cổng"
          >
            <div className="grid gap-3 rounded-lg border border-border bg-surface-muted p-3">
              <label className="ui-file-picker-trigger is-dashed min-h-12 cursor-pointer rounded-lg">
                <ImagePlus size={18} />
                <span>Chọn một hoặc nhiều hình để tải lên Drive</span>
                <input
                  accept="image/*"
                  className="sr-only"
                  multiple
                  name="imageFiles"
                  type="file"
                />
              </label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Link2
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    size={17}
                  />
                  <Input
                    className="pl-10"
                    onChange={(event) => setImageDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addImageLink();
                      }
                    }}
                    placeholder="Dán thêm link Drive hoặc URL hình"
                    value={imageDraft}
                  />
                </div>
                <Button onClick={addImageLink} type="button" variant="secondary">
                  <Plus size={17} />
                  Thêm
                </Button>
              </div>
              {imageLinks.length ? (
                <div className="grid gap-2">
                  {imageLinks.map((link, index) => (
                    <div
                      className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
                      key={`${link}-${index}`}
                    >
                      <span className="grid size-7 place-items-center rounded-md bg-accent/10 text-xs font-black text-accent">
                        {index + 1}
                      </span>
                      <span className="truncate text-xs text-muted" title={link}>
                        {link}
                      </span>
                      <span className="flex gap-1">
                        <button
                          aria-label="Đưa hình lên"
                          className="ui-icon-button size-8 rounded-md shadow-none"
                          disabled={index === 0}
                          onClick={() =>
                            setImageLinks((current) =>
                              moveItem(current, index, index - 1),
                            )
                          }
                          type="button"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          aria-label="Đưa hình xuống"
                          className="ui-icon-button size-8 rounded-md shadow-none"
                          disabled={index === imageLinks.length - 1}
                          onClick={() =>
                            setImageLinks((current) =>
                              moveItem(current, index, index + 1),
                            )
                          }
                          type="button"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          aria-label="Bỏ hình"
                          className="ui-icon-button size-8 rounded-md text-danger shadow-none"
                          onClick={() =>
                            setImageLinks((current) =>
                              current.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            )
                          }
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-center text-xs text-muted">
                  Chưa có link hình cũ. Hình tải mới sẽ được nối vào đúng thứ tự.
                </div>
              )}
            </div>
          </Field>

          <Field label="Nội dung">
            <div className="overflow-hidden rounded-lg border border-border bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <div className="flex flex-wrap gap-1 border-b border-border bg-surface-muted p-2">
                {[
                  {
                    after: "**",
                    before: "**",
                    icon: Bold,
                    label: "In đậm",
                  },
                  {
                    after: "*",
                    before: "*",
                    icon: Italic,
                    label: "In nghiêng",
                  },
                  {
                    after: "__",
                    before: "__",
                    icon: Underline,
                    label: "Gạch chân",
                  },
                  {
                    after: "[/hong]",
                    before: "[hong]",
                    icon: Palette,
                    label: "Màu hồng",
                  },
                  {
                    after: "[/do]",
                    before: "[do]",
                    icon: Palette,
                    label: "Màu đỏ",
                  },
                  {
                    after: "[/xanhduong]",
                    before: "[xanhduong]",
                    icon: Palette,
                    label: "Màu xanh",
                  },
                  {
                    after: "",
                    before: "\n",
                    icon: ListPlus,
                    label: "Xuống dòng",
                  },
                ].map(({ after, before, icon: Icon, label }) => (
                  <button
                    aria-label={label}
                    className="ui-icon-button size-9 rounded-md shadow-none"
                    key={label}
                    onClick={() => insertBodyFormat(before, after)}
                    title={label}
                    type="button"
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
              <textarea
                className="min-h-36 w-full resize-y border-0 bg-transparent px-3.5 py-3 text-sm text-foreground outline-none placeholder:text-muted"
                name="body"
                onChange={(event) => setBody(event.target.value)}
                placeholder="Nhập nội dung rồi bôi đen đoạn cần định dạng…"
                ref={bodyRef}
                value={body}
              />
            </div>
          </Field>
        </section>

        <section
          className="space-y-4"
          hidden={activeSection !== "schedule"}
        >
          <SectionTitle number={2}>Lịch và thứ tự ưu tiên</SectionTitle>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Bắt đầu">
              <Input
                defaultValue={editing?.startAtLocal ?? ""}
                name="startAt"
                type="datetime-local"
              />
            </Field>
            <Field label="Kết thúc">
              <Input
                defaultValue={editing?.endAtLocal ?? ""}
                name="endAt"
                type="datetime-local"
              />
            </Field>
            <Field label="Ưu tiên" hint="Số lớn sẽ hiện trước">
              <Input
                defaultValue={editing ? String(editing.priority) : "0"}
                name="priority"
                type="number"
              />
            </Field>
          </div>
          <Switch
            defaultChecked={editing?.saveResponse ?? false}
            label="Lưu phản hồi của người xem"
            name="saveResponse"
            note="Bật khi nội dung có bộ tương tác và cần thống kê phản hồi."
          />
        </section>

        <section
          className="space-y-4"
          hidden={activeSection !== "channel"}
        >
          <SectionTitle number={3}>Kênh phát và Notifier</SectionTitle>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Kênh hiển thị">
              <Select
                defaultValue={editing?.displayChannel ?? "webapp"}
                name="displayChannel"
              >
                <option value="webapp">WebApp</option>
                <option value="notifier">Notifier</option>
                <option value="both">WebApp + Notifier</option>
              </Select>
            </Field>
            <Field label="Mức độ">
              <Select defaultValue={editing?.level ?? "normal"} name="level">
                <option value="normal">Bình thường</option>
                <option value="success">Thành công</option>
                <option value="warning">Cảnh báo</option>
                <option value="urgent">Khẩn</option>
              </Select>
            </Field>
            <Field label="Kiểu popup">
              <Select
                defaultValue={editing?.displayMode ?? "toast"}
                name="displayMode"
              >
                <option value="toast">Toast góc phải</option>
                <option value="center_popup">Popup chính diện</option>
                <option value="sticky_warning">Cảnh báo dính</option>
                <option value="image_portrait">Ảnh đứng toàn màn</option>
                <option value="image_landscape">Thiệp ngang toàn màn</option>
                <option value="image_only">Chỉ hiển thị ảnh</option>
              </Select>
            </Field>
            <Field label="Nội dung popup">
              <Select
                defaultValue={editing?.popupContentMode ?? "full"}
                name="popupContentMode"
              >
                <option value="full">Đủ tiêu đề và nội dung</option>
                <option value="hide_message">Ẩn nội dung</option>
                <option value="hide_title">Ẩn tiêu đề</option>
                <option value="image_only">Chỉ hiển thị ảnh</option>
              </Select>
            </Field>
            <Field label="Chính sách đóng">
              <Select
                defaultValue={editing?.closePolicy ?? "auto"}
                name="closePolicy"
              >
                <option value="auto">Tự tắt</option>
                <option value="manual_close">Người dùng bấm X</option>
                <option value="require_ack">Phải bấm Đã xem</option>
              </Select>
            </Field>
            <Field label="Tự tắt sau (ms)">
              <Input
                defaultValue={editing?.autoDismissMs ?? "10000"}
                min={0}
                name="autoDismissMs"
                type="number"
              />
            </Field>
            <Field label="URL đích">
              <Input
                defaultValue={editing?.targetUrl ?? ""}
                name="targetUrl"
                placeholder="https://…"
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Giờ nhắc trong ngày"
                hint="Có thể thêm nhiều mốc; bấm × trên tag để bỏ"
              >
                <input
                  name="reminderTimes"
                  type="hidden"
                  value={reminderTimes.join(",")}
                />
                <div className="grid gap-2 rounded-lg border border-border bg-surface-muted p-3">
                  <div className="flex gap-2">
                    <Input
                      onChange={(event) => setReminderDraft(event.target.value)}
                      type="time"
                      value={reminderDraft}
                    />
                    <Button
                      onClick={addReminder}
                      type="button"
                      variant="secondary"
                    >
                      <Plus size={16} />
                      Thêm giờ
                    </Button>
                  </div>
                  <div className="flex min-h-8 flex-wrap gap-2">
                    {reminderTimes.length ? (
                      reminderTimes.map((time) => (
                        <button
                          className="ui-chip min-h-8 gap-2 px-3 text-xs"
                          key={time}
                          onClick={() =>
                            setReminderTimes((current) =>
                              current.filter((item) => item !== time),
                            )
                          }
                          title="Bỏ giờ nhắc"
                          type="button"
                        >
                          {time} <span aria-hidden="true">×</span>
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-muted">
                        Chưa đặt giờ nhắc.
                      </span>
                    )}
                  </div>
                </div>
              </Field>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Switch
              defaultChecked={editing?.requireAck}
              label="Bắt buộc xác nhận Đã xem"
              name="requireAck"
            />
            <Switch
              defaultChecked={editing?.bypassSnooze}
              label="Bỏ qua chế độ tạm ẩn"
              name="bypassSnooze"
              note="Nội dung vẫn xuất hiện dù người dùng đang tạm ẩn thông báo thường."
            />
          </div>
        </section>

        <section
          className="space-y-4"
          hidden={activeSection !== "audience"}
        >
          <SectionTitle number={4}>Đối tượng nhận</SectionTitle>
          <Field label="Phạm vi">
            <Select
              name="targetScope"
              onChange={(event) => setScope(event.target.value)}
              value={scope}
            >
              <option value="all">Tất cả nhân sự</option>
              <option value="company">Theo công ty</option>
              <option value="department">Theo phòng ban</option>
              <option value="employee">Theo nhân viên</option>
            </Select>
          </Field>
          {scope === "company" ? (
            <Field label="Công ty nhận">
              <MultiSelect
                defaultValues={editing?.targetCompanies ?? []}
                name="targetCompanies"
                options={companyOptions}
                placeholder="Gõ tên công ty…"
              />
            </Field>
          ) : null}
          {scope === "department" ? (
            <Field label="Phòng ban nhận">
              <MultiSelect
                defaultValues={editing?.targetDepartments ?? []}
                name="targetDepartments"
                options={departments}
                placeholder="Gõ tên phòng ban…"
              />
            </Field>
          ) : null}
          {scope === "employee" ? (
            <Field label="Nhân viên nhận">
              <MultiSelect
                defaultValues={editing?.targetEmployees ?? []}
                name="targetEmployees"
                options={employees}
                placeholder="Gõ tên hoặc mã nhân viên…"
              />
            </Field>
          ) : null}
        </section>

        <section
          className="space-y-4"
          hidden={activeSection !== "task"}
        >
          <SectionTitle number={5}>Giao việc kèm thông báo</SectionTitle>
          <label className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
            <span>
              <span className="block text-sm font-semibold text-foreground">
                Tạo việc kèm nội dung này
              </span>
              <span className="block text-xs leading-5 text-muted">
                Deadline lấy từ thời gian kết thúc; lịch nhắc và người nhận dùng
                cấu hình phía trên.
              </span>
            </span>
            <input
              checked={linkedTaskEnabled}
              className="mt-1 size-5 accent-[#b51d4b]"
              name="linkedTaskEnabled"
              onChange={(event) => setLinkedTaskEnabled(event.target.checked)}
              type="checkbox"
            />
          </label>
          {linkedTaskEnabled ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Tên việc">
                <Input
                  defaultValue={editing?.linkedTask?.title ?? ""}
                  name="linkedTaskTitle"
                />
              </Field>
              <Field label="Đầu ra cần đạt">
                <Input
                  defaultValue={editing?.linkedTask?.output ?? ""}
                  name="linkedTaskOutput"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Bối cảnh giao việc">
                  <textarea
                    className={textareaCls}
                    defaultValue={editing?.linkedTask?.context ?? ""}
                    name="linkedTaskContext"
                  />
                </Field>
              </div>
            </div>
          ) : null}
        </section>

        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white/90 p-3 shadow-xl backdrop-blur-xl">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={activeSectionIndex === 0}
              onClick={() =>
                setActiveSection(FORM_SECTIONS[activeSectionIndex - 1].id)
              }
              type="button"
              variant="secondary"
            >
              <ChevronLeft size={16} />
              Trước
            </Button>
            <Button
              disabled={activeSectionIndex === FORM_SECTIONS.length - 1}
              onClick={() =>
                setActiveSection(FORM_SECTIONS[activeSectionIndex + 1].id)
              }
              type="button"
              variant="secondary"
            >
              Tiếp
              <ChevronRight size={16} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              formRef.current?.reset();
              setBody("");
              setImageLinks([]);
              setReminderTimes([]);
              setActiveSection("content");
            }}
            type="button"
            variant="ghost"
          >
            Làm mới
          </Button>
          <Button disabled={pending} type="submit">
            <CheckCircle2 size={17} />
            {pending
              ? "Đang lưu…"
              : editing
                ? "Cập nhật nội dung"
                : "Lưu nội dung"}
          </Button>
          </div>
        </div>
      </form>
    </>
  );
}
