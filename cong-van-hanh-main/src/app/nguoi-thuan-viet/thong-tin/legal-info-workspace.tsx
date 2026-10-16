"use client";

import { useMemo, useState } from "react";
import { Check, Clipboard, FileText, Search, UserRound } from "lucide-react";

import { Badge, Button, Input } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { renderPreview, type FormatToken } from "@/lib/document-numbering";

type DocumentInfo = {
  condition: string;
  formatTokens: FormatToken[];
  id: string;
  name: string;
  startIndex: number;
  takesNumber: boolean;
};

type JdInfo = {
  activities: { id: string; name: string; sortOrder: number }[];
  activityCount: number;
  fileName: string;
  fileUrl: string;
  isLegacy: boolean;
  position: string;
  source: string;
  sourceLabel: string;
  title: string;
  workGroups: { id: string; name: string; sortOrder: number }[];
};

type EmployeeInfo = {
  bankAccount: string;
  bankName: string;
  birthDate: string;
  company: string;
  department: string;
  email: string;
  employeeCode: string;
  fullName: string;
  id: string;
  identityDate: string;
  identityNumber: string;
  identityPlace: string;
  phone: string;
  status: string;
  title: string;
};

const PROFILE_FIELDS: { key: keyof EmployeeInfo; label: string }[] = [
  { key: "employeeCode", label: "Mã nhân sự" },
  { key: "fullName", label: "Nhân sự" },
  { key: "company", label: "Công ty" },
  { key: "department", label: "Khu vực / Chuyên môn" },
  { key: "title", label: "Chức danh" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Điện thoại" },
  { key: "birthDate", label: "Ngày sinh" },
  { key: "identityNumber", label: "Số CCCD" },
  { key: "identityDate", label: "Ngày cấp" },
  { key: "identityPlace", label: "Nơi cấp" },
  { key: "bankName", label: "Ngân hàng" },
  { key: "bankAccount", label: "Số tài khoản" },
  { key: "status", label: "Trạng thái" },
];

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi");
}

export function LegalInfoWorkspace({
  documents,
  employees,
  jds,
}: {
  documents: DocumentInfo[];
  employees: EmployeeInfo[];
  jds: JdInfo[];
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"documents" | "personnel">("documents");
  const [documentSearch, setDocumentSearch] = useState("");
  const [personSearch, setPersonSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [extractOpen, setExtractOpen] = useState(false);
  const [selectedFields, setSelectedFields] = useState<(keyof EmployeeInfo)[]>([
    "employeeCode",
    "fullName",
    "company",
    "department",
    "title",
    "email",
    "phone",
  ]);

  const visibleDocuments = useMemo(() => {
    const needle = normalized(documentSearch);
    if (!needle) return documents;
    return documents.filter((document) =>
      normalized(
        [document.name, document.condition, renderPreview(document.formatTokens, document.startIndex)]
          .join(" "),
      ).includes(needle),
    );
  }, [documentSearch, documents]);
  const visibleEmployees = useMemo(() => {
    const needle = normalized(personSearch);
    if (!needle) return employees.slice(0, 80);
    return employees
      .filter((employee) =>
        normalized(
          [
            employee.fullName,
            employee.employeeCode,
            employee.department,
            employee.title,
            employee.company,
            employee.email,
            employee.phone,
          ].join(" "),
        ).includes(needle),
      )
      .slice(0, 80);
  }, [employees, personSearch]);
  const selectedEmployee = employees.find(
    (employee) => employee.id === selectedEmployeeId,
  );
  const currentJd = selectedEmployee
    ? jds.find((jd) => normalized(jd.position) === normalized(selectedEmployee.title))
    : null;

  const copyProfile = async () => {
    if (!selectedEmployee) return;
    const text = PROFILE_FIELDS.filter(
      (field) =>
        selectedFields.includes(field.key) && selectedEmployee[field.key],
    )
      .map(
        (field) => `${field.label}: ${String(selectedEmployee[field.key] || "")}`,
      )
      .join("\n");
    await navigator.clipboard.writeText(text);
    toast({
      message: "Thông tin đã chọn đã được chép vào bộ nhớ tạm.",
      title: "Đã sao chép",
      tone: "success",
    });
  };

  return (
    <div className="ui-module-panel overflow-hidden">
      <nav className="grid grid-cols-2 border-b border-border bg-surface-muted/60">
        {[
          ["documents", "Văn bản", FileText],
          ["personnel", "Nhân sự", UserRound],
        ].map(([key, label, Icon]) => (
          <button
            className={`flex min-h-14 items-center justify-center gap-2 border-b-2 text-sm font-extrabold transition ${
              tab === key
                ? "border-accent bg-surface text-primary"
                : "border-transparent text-muted hover:bg-surface/70"
            }`}
            key={key as string}
            onClick={() => setTab(key as typeof tab)}
            type="button"
          >
            <Icon size={18} />
            {label as string}
          </button>
        ))}
      </nav>

      {tab === "documents" ? (
        <section className="p-5">
          <label className="ui-module-field">
            <span className="ui-module-label">Tìm kiếm</span>
            <div className="relative">
              <Search
                aria-hidden
                className="absolute left-4 top-1/2 -translate-y-1/2 text-accent"
                size={18}
              />
              <Input
                className="pl-11"
                onChange={(event) => setDocumentSearch(event.target.value)}
                placeholder="Tìm tên hồ sơ, điều kiện hoặc quy cách đánh số..."
                value={documentSearch}
              />
            </div>
          </label>

          {[
            {
              rows: visibleDocuments.filter((document) => document.takesNumber),
              title: "Hồ sơ có lấy số",
            },
            {
              rows: visibleDocuments.filter((document) => !document.takesNumber),
              title: "Hồ sơ không lấy số",
            },
          ].map((section) => (
            <div className="mt-5" key={section.title}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-extrabold text-primary">
                  {section.title}
                </h2>
                <span className="ui-pill">{section.rows.length}</span>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[minmax(220px,1.5fr)_minmax(180px,1fr)_minmax(180px,1fr)] gap-3 bg-primary px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-white">
                  <span>Tên hồ sơ</span>
                  <span>Phương thức đánh số</span>
                  <span>Ví dụ</span>
                </div>
                {section.rows.length ? (
                  section.rows.map((document) => (
                    <article
                      className="grid grid-cols-[minmax(220px,1.5fr)_minmax(180px,1fr)_minmax(180px,1fr)] gap-3 border-t border-border px-4 py-3 text-sm"
                      key={document.id}
                    >
                      <div>
                        <div className="font-extrabold text-primary">
                          {document.name}
                        </div>
                        {document.condition ? (
                          <div className="mt-1 text-xs text-muted">
                            {document.condition}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-muted">
                        {document.takesNumber
                          ? document.formatTokens.length
                            ? `${document.formatTokens.length} thành phần`
                            : "Theo cấu hình"
                          : "Không lấy số"}
                      </div>
                      <code className="font-bold text-accent">
                        {document.takesNumber
                          ? renderPreview(
                              document.formatTokens,
                              document.startIndex,
                              "NTV",
                              "DT",
                            ) || "—"
                          : "—"}
                      </code>
                    </article>
                  ))
                ) : (
                  <div className="border-t border-border p-6 text-center text-sm text-muted">
                    Không có hồ sơ phù hợp.
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {tab === "personnel" ? (
        <section className="grid min-h-[620px] lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="border-b border-border p-4 lg:border-b-0 lg:border-r">
            <label className="ui-module-field">
              <span className="ui-module-label">
                Tìm nhân sự trong toàn công ty
              </span>
              <div className="relative">
                <Search
                  aria-hidden
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-accent"
                  size={18}
                />
                <Input
                  className="pl-11"
                  onChange={(event) => setPersonSearch(event.target.value)}
                  placeholder="Tên, MNV, phòng ban..."
                  value={personSearch}
                />
              </div>
            </label>
            <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
              {visibleEmployees.map((employee) => (
                <button
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                    employee.id === selectedEmployeeId
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-surface hover:border-accent/40"
                  }`}
                  key={employee.id}
                  onClick={() => {
                    setSelectedEmployeeId(employee.id);
                    setExtractOpen(false);
                  }}
                  type="button"
                >
                  <div className="font-extrabold text-primary">
                    {employee.fullName}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted">
                    {[employee.employeeCode, employee.title, employee.company]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <div className="p-5">
            {selectedEmployee ? (
              <>
                <header className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-14 place-items-center rounded-lg bg-primary text-lg font-extrabold text-white">
                      {selectedEmployee.fullName
                        .split(/\s+/)
                        .slice(-2)
                        .map((part) => part[0])
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-xl font-extrabold text-primary">
                        {selectedEmployee.fullName}
                      </h2>
                      <div className="mt-1 text-sm text-muted">
                        {[selectedEmployee.title, selectedEmployee.department]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="ui-chip">
                          {selectedEmployee.employeeCode}
                        </span>
                        {selectedEmployee.company ? (
                          <span className="ui-chip">
                            {selectedEmployee.company}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <Button
                    onClick={() => setExtractOpen((current) => !current)}
                    variant="secondary"
                  >
                    <Clipboard size={17} />
                    Trích lục
                  </Button>
                </header>

                <div className="mt-5 rounded-lg border border-border bg-surface-muted/50 p-4">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {PROFILE_FIELDS.map((field) => (
                      <div key={field.key}>
                        <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
                          {field.label}
                        </div>
                        <div className="mt-1 break-words text-sm font-semibold text-foreground">
                          {selectedEmployee[field.key] || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted">
                    Thông tin nhân sự là dữ liệu nội bộ. Chỉ sao chép và sử dụng
                    cho đúng mục đích công việc.
                  </p>
                </div>

                {extractOpen ? (
                  <section className="mt-4 rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-extrabold text-primary">
                        Chọn thông tin chính
                      </h3>
                      <div className="flex gap-2">
                        <Button
                          onClick={() =>
                            setSelectedFields(
                              PROFILE_FIELDS.map((field) => field.key),
                            )
                          }
                          size="sm"
                          variant="secondary"
                        >
                          Chọn tất cả
                        </Button>
                        <Button onClick={copyProfile} size="sm">
                          Sao chép
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {PROFILE_FIELDS.map((field) => {
                        const active = selectedFields.includes(field.key);
                        return (
                          <button
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-bold ${
                              active
                                ? "border-accent bg-surface text-primary"
                                : "border-border bg-surface/60 text-muted"
                            }`}
                            key={field.key}
                            onClick={() =>
                              setSelectedFields((current) =>
                                active
                                  ? current.filter((key) => key !== field.key)
                                  : [...current, field.key],
                              )
                            }
                            type="button"
                          >
                            <span
                              className={`grid size-5 place-items-center rounded border ${
                                active
                                  ? "border-accent bg-accent text-white"
                                  : "border-border"
                              }`}
                            >
                              {active ? <Check size={13} /> : null}
                            </span>
                            {field.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <section className="mt-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-extrabold text-primary">
                      JD theo chức danh
                    </h3>
                    <span className="ui-pill">
                      {currentJd?.activityCount || 0} hoạt động
                    </span>
                  </div>
                  {currentJd ? (
                    <div className="rounded-lg border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-extrabold text-primary">
                            {currentJd.title || selectedEmployee.title}
                          </div>
                          <div className="mt-1 text-xs text-muted">
                            {currentJd.sourceLabel}
                          </div>
                        </div>
                        <Badge tone={currentJd.isLegacy ? "warning" : "success"}>
                          {currentJd.isLegacy ? "Bản dự phòng" : "JD mới"}
                        </Badge>
                      </div>
                      {currentJd.fileUrl ? (
                        <a
                          className="mt-3 inline-flex text-sm font-extrabold text-accent hover:underline"
                          href={currentJd.fileUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Mở {currentJd.fileName || "file JD"}
                        </a>
                      ) : null}
                      {currentJd.workGroups.length ? (
                        <div className="mt-4 space-y-3">
                          {currentJd.workGroups.map((group) => (
                            <article
                              className="rounded-lg border border-border bg-surface-muted/60 p-3"
                              key={group.id}
                            >
                              <div className="font-bold text-primary">
                                {group.name}
                              </div>
                              <ul className="mt-2 space-y-1 text-sm leading-5 text-muted">
                                {currentJd.activities
                                  .filter(
                                    (activity) =>
                                      !activity.sortOrder ||
                                      activity.sortOrder >= group.sortOrder,
                                  )
                                  .slice(0, 8)
                                  .map((activity) => (
                                    <li key={activity.id}>• {activity.name}</li>
                                  ))}
                              </ul>
                            </article>
                          ))}
                        </div>
                      ) : currentJd.activities.length ? (
                        <ul className="mt-4 space-y-1 text-sm leading-5 text-muted">
                          {currentJd.activities.slice(0, 20).map((activity) => (
                            <li key={activity.id}>• {activity.name}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-surface-muted/50 p-6 text-center text-sm text-muted">
                      Chưa tìm thấy JD phù hợp với chức danh hiện tại.
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="grid min-h-[520px] place-items-center text-center text-sm text-muted">
                <div>
                  <UserRound className="mx-auto mb-3 text-accent" size={36} />
                  Chọn một nhân sự bên trái để xem hồ sơ và JD.
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
