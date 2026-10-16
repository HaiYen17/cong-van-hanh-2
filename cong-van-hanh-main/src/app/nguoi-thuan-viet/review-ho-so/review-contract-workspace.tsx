"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { FileSearch, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  submitRequestAction,
  type RequestActionState,
} from "@/app/thuc-thi/actions";
import { Badge, Button, Input, Select } from "@/components/ui";
import { FilePicker } from "@/components/ui/file-picker";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

type CompanyOption = {
  id: string;
  label: string;
  shortName: string;
};

type DocumentTypeOption = {
  id: string;
  name: string;
  requiresCustom: boolean;
};

type ReviewRequest = {
  attachments: { fileName: string; fileUrl: string; id: string }[];
  code: string;
  createdAt: string;
  createdBy: string;
  id: string;
  note: string;
  payload: Record<string, unknown>;
  status: string;
  statusLabel: string;
  title: string;
};

type ReviewFinding = {
  blocking: boolean;
  evidence: string;
  group: string;
  issue: string;
  recommendation: string;
  ruleCode: string;
  severity: string;
};

const initialState: RequestActionState = {};

function tone(status: string) {
  if (["COMPLETED", "APPROVED"].includes(status)) return "success" as const;
  if (status === "REJECTED") return "danger" as const;
  if (["IN_PROGRESS", "NEEDS_INFO"].includes(status)) return "warning" as const;
  return "info" as const;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (normalized && normalized !== "[object Object]") return normalized;
  }
  return "";
}

function businessPayload(payload: Record<string, unknown>) {
  const nested = Array.isArray(payload.payload)
    ? objectValue(payload.payload[0])
    : objectValue(payload.payload);
  return Object.keys(nested).length ? nested : payload;
}

function requestDetailFields(payload: Record<string, unknown>) {
  const item = businessPayload(payload);
  const employee = objectValue(payload.employee);
  return [
    {
      label: "Loại hồ sơ",
      value: textValue(
        item.documentTypeName,
        item.documentTypeChoice,
        item.loai,
      ),
    },
    {
      label: "Pháp nhân",
      value: textValue(
        item.companyName,
        item.companyShortName,
        item.phapNhan,
      ),
    },
    {
      label: "Đối tác",
      value: textValue(item.partnerName, item.partner),
    },
    {
      label: "Nội dung chính",
      value: textValue(
        item.documentSummary,
        item.mainContent,
        item.detail,
        payload.note,
      ),
    },
    {
      label: "Tên hồ sơ",
      value: textValue(
        item.generatedName,
        item.documentName,
        item.tenHoSo,
        item.contractName,
      ),
    },
    {
      label: "Điều kiện lưu",
      value: textValue(item.documentCondition),
    },
    {
      label: "Ngày ký",
      value: textValue(item.signedDate, item.date),
    },
    {
      label: "Người yêu cầu",
      value: textValue(
        payload.requesterName,
        payload.employeeName,
        employee.name,
      ),
    },
    {
      label: "Phòng ban",
      value: textValue(payload.requesterDepartment, employee.dept),
    },
  ].filter((field) => field.value);
}

function reviewResult(payload: Record<string, unknown>) {
  const result = objectValue(payload.reviewResult);
  const item = businessPayload(payload);
  const sourceFindings = Array.isArray(result.findings)
    ? result.findings
    : Array.isArray(item.findingsPreview)
      ? item.findingsPreview
      : [];
  const isLegacyReview =
    !Object.keys(result).length &&
    (sourceFindings.length > 0 ||
      textValue(item.reviewStatus).toUpperCase().includes("REVIEWED"));
  if (!Object.keys(result).length && !isLegacyReview) return null;
  const findings = sourceFindings.map((value) => {
        const finding = objectValue(value);
        return {
          blocking: Boolean(finding.blocking),
          evidence: textValue(finding.evidence, finding.comment),
          group: textValue(finding.group, finding.ruleName, "Khác"),
          issue: textValue(finding.issue),
          recommendation: textValue(
            finding.recommendation,
            finding.suggestion,
          ),
          ruleCode: textValue(finding.ruleCode, finding.ruleId),
          severity: textValue(finding.severity, "GREEN").toUpperCase(),
        } satisfies ReviewFinding;
      });
  const legacyRisk =
    Number(item.redCount || 0) > 0
      ? "RED"
      : Number(item.orangeCount || 0) > 0
        ? "ORANGE"
        : findings[0]?.severity || "GREEN";
  return {
    findings,
    overallRisk: textValue(result.overallRisk, legacyRisk).toUpperCase(),
    summary: textValue(
      result.summary,
      isLegacyReview
        ? `Kết quả review lịch sử đã được khôi phục đầy đủ với ${findings.length} góp ý.`
        : "",
    ),
  };
}

function riskTone(value: string) {
  if (["RED", "HIGH", "CRITICAL"].includes(value)) return "danger" as const;
  if (["ORANGE", "YELLOW", "MEDIUM"].includes(value)) return "warning" as const;
  if (["GREEN", "LOW"].includes(value)) return "success" as const;
  return "info" as const;
}

export function ReviewContractWorkspace({
  canViewAll,
  companies,
  documentTypes,
  requests,
}: {
  canViewAll: boolean;
  companies: CompanyOption[];
  documentTypes: DocumentTypeOption[];
  requests: ReviewRequest[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef<RequestActionState | null>(null);
  const [state, action, pending] = useActionState(submitRequestAction, initialState);
  const [tab, setTab] = useState<"create" | "mine" | "all">("create");
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [partner, setPartner] = useState("");
  const [summary, setSummary] = useState("");
  const [customNumbering, setCustomNumbering] = useState("");
  const [selected, setSelected] = useState<ReviewRequest | null>(null);
  const selectedReview = selected ? reviewResult(selected.payload) : null;
  const selectedDetails = selected
    ? requestDetailFields(selected.payload)
    : [];

  const documentType = documentTypes.find((item) => item.id === documentTypeId);
  const company = companies.find((item) => item.id === companyId);
  const generatedName = useMemo(
    () =>
      [documentType?.name, partner, company?.shortName || company?.label]
        .filter(Boolean)
        .join(" - "),
    [company, documentType, partner],
  );

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) {
      toast({
        message: state.success,
        title: "Đã gửi review",
        tone: "success",
      });
      formRef.current?.reset();
      router.refresh();
      queueMicrotask(() => {
        setDocumentTypeId("");
        setCompanyId("");
        setPartner("");
        setSummary("");
        setCustomNumbering("");
        setTab("mine");
      });
    } else if (state.error) {
      toast({
        message: state.error,
        title: "Không thể gửi review",
        tone: "error",
      });
    }
  }, [router, state, toast]);

  const payload = JSON.stringify({
    companyId,
    companyName: company?.label || "",
    customNumbering,
    documentTypeId,
    documentTypeName: documentType?.name || "",
    generatedName,
    partner,
    summary,
  });

  return (
    <>
      <WriteLoadingOverlay
        message="Dữ liệu đang được ghi vào Hệ thống..."
        show={pending}
      />
      <nav className="ui-module-toolbar flex flex-wrap gap-2 p-3">
        {[
          ["create", "Tạo yêu cầu"],
          ["mine", "Yêu cầu của tôi"],
          ...(canViewAll ? ([["all", "Tất cả yêu cầu"]] as const) : []),
        ].map(([key, label]) => (
          <button
            className={`ui-segmented-button ${tab === key ? "is-active" : ""}`}
            key={key}
            onClick={() => setTab(key as typeof tab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "create" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <form action={action} className="ui-module-panel space-y-5 p-5" ref={formRef}>
            <input name="serviceCode" type="hidden" value="review-contract" />
            <input name="companyId" type="hidden" value={companyId} />
            <input name="payload" type="hidden" value={payload} />
            <input
              name="title"
              type="hidden"
              value={generatedName || "Yêu cầu review hồ sơ"}
            />

            <div>
              <Badge tone="info">Thông tin tạo tên hồ sơ</Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                Review hồ sơ
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="ui-module-field">
                <span className="ui-module-label">Loại hồ sơ</span>
                <Select
                  onChange={(event) => setDocumentTypeId(event.target.value)}
                  required
                  value={documentTypeId}
                >
                  <option value="">Chọn loại hồ sơ</option>
                  {documentTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="ui-module-field">
                <span className="ui-module-label">Đối tác</span>
                <Input
                  onChange={(event) => setPartner(event.target.value)}
                  required
                  value={partner}
                />
              </label>
              <label className="ui-module-field md:col-span-2">
                <span className="ui-module-label">
                  Nội dung chính của hồ sơ
                </span>
                <textarea
                  className="ui-module-textarea"
                  onChange={(event) => setSummary(event.target.value)}
                  required
                  value={summary}
                />
              </label>
              {documentType?.requiresCustom ? (
                <label className="ui-module-field md:col-span-2">
                  <span className="ui-module-label">
                    Tên viết tắt của đối tác
                  </span>
                  <Input
                    onChange={(event) => setCustomNumbering(event.target.value)}
                    value={customNumbering}
                  />
                  <small className="text-xs leading-5 text-muted">
                    Trường này chỉ hiện khi loại hồ sơ đang chọn có thành phần
                    tên viết tắt trong cấu hình.
                  </small>
                </label>
              ) : null}
            </div>

            <div>
              <div className="ui-module-label mb-2">Chọn pháp nhân</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {companies.map((item) => (
                  <button
                    className={`rounded-lg border px-3 py-3 text-left text-sm font-extrabold transition ${
                      companyId === item.id
                        ? "border-accent bg-accent-soft text-primary"
                        : "border-border bg-surface text-muted hover:border-accent/40"
                    }`}
                    key={item.id}
                    onClick={() => setCompanyId(item.id)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="ui-module-field">
              <span className="ui-module-label">Chọn file</span>
              <FilePicker
                accept=".pdf,.doc,.docx,.xls,.xlsx"
                maxFileSizeBytes={8 * 1024 * 1024}
                maxFiles={1}
                name="attachments"
                required
                triggerLabel="Chọn file"
              />
            </label>
            <label className="ui-module-field">
              <span className="ui-module-label">Ghi chú</span>
              <textarea className="ui-module-textarea" name="note" />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  formRef.current?.reset();
                  setDocumentTypeId("");
                  setCompanyId("");
                  setPartner("");
                  setSummary("");
                  setCustomNumbering("");
                }}
                type="button"
                variant="secondary"
              >
                Làm mới
              </Button>
              <Button
                disabled={
                  pending ||
                  !documentTypeId ||
                  !companyId ||
                  !partner.trim() ||
                  !summary.trim()
                }
                type="submit"
              >
                {pending ? "Đang gửi..." : "Gửi review"}
              </Button>
            </div>
          </form>

          <aside className="ui-module-panel h-fit p-5 xl:sticky xl:top-20">
            <Badge tone="warning">Tên hồ sơ xem trước</Badge>
            <div className="mt-3 min-h-24 rounded-lg border border-dashed border-accent/35 bg-accent-soft/50 p-4 text-base font-extrabold leading-7 text-primary">
              {generatedName || "Chọn loại hồ sơ, đối tác và pháp nhân"}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">
              File được lưu trong kho tệp của Cổng vận hành; PostgreSQL lưu
              metadata, trạng thái và lịch sử yêu cầu.
            </p>
          </aside>
        </div>
      ) : null}

      {tab === "mine" || tab === "all" ? (
        <section className="ui-module-panel mt-5 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <Badge tone="info">
                {tab === "all" ? "Tất cả yêu cầu Review hồ sơ" : "Yêu cầu mới nhất"}
              </Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                {tab === "all" ? "Tất cả yêu cầu" : "Yêu cầu của tôi"}
              </h2>
            </div>
            <Button onClick={() => router.refresh()} size="sm" variant="secondary">
              <RefreshCw size={16} />
              Tải lại
            </Button>
          </div>
          <div className="space-y-2">
            {(tab === "all"
              ? requests
              : requests.filter((request) => request.createdBy === "Tôi")
            ).map((request) => (
              <button
                className="grid w-full gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition hover:border-accent md:grid-cols-[150px_minmax(0,1fr)_160px]"
                key={request.id}
                onClick={() => setSelected(request)}
                type="button"
              >
                <div>
                  <div className="font-mono text-xs font-extrabold text-accent">
                    {request.code}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {formatDate(request.createdAt)}
                  </div>
                </div>
                <div>
                  <div className="font-extrabold text-primary">
                    {request.title}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {request.createdBy}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Badge tone={tone(request.status)}>
                    {request.statusLabel}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-[rgba(7,24,21,0.48)] p-4 backdrop-blur-[3px]">
          <section className="max-h-[90dvh] w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-surface shadow-[0_32px_90px_rgba(17,45,39,0.28)]">
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <Badge tone={tone(selected.status)}>
                  {selected.statusLabel}
                </Badge>
                <h2 className="mt-2 text-xl font-extrabold text-primary">
                  {selected.title}
                </h2>
                <div className="mt-1 text-xs font-semibold text-muted">
                  {selected.code} · {formatDate(selected.createdAt)} ·{" "}
                  {selected.createdBy}
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
            <div className="max-h-[calc(90dvh-100px)] overflow-auto p-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                {selectedDetails.map((field) => (
                  <div key={field.label}>
                    <dt className="text-xs font-extrabold uppercase tracking-wide text-muted">
                      {field.label}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold">
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {selectedReview ? (
                <section className="mt-5 rounded-lg border border-border bg-surface-muted/55 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-extrabold uppercase tracking-wide text-muted">
                        Kết quả Bộ nguyên tắc AI
                      </div>
                      <h3 className="mt-1 text-lg font-extrabold text-primary">
                        {selectedReview.findings.length} góp ý cần xem lại
                      </h3>
                    </div>
                    <Badge tone={riskTone(selectedReview.overallRisk)}>
                      {selectedReview.overallRisk}
                    </Badge>
                  </div>
                  {selectedReview.summary ? (
                    <p className="mt-3 text-sm leading-6 text-muted">
                      {selectedReview.summary}
                    </p>
                  ) : null}
                  <div className="mt-4 space-y-3">
                    {selectedReview.findings.map((finding, index) => (
                      <article
                        className="rounded-lg border border-border bg-surface p-4"
                        key={`${finding.ruleCode}-${index}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={riskTone(finding.severity)}>
                            {finding.severity}
                          </Badge>
                          {finding.blocking ? (
                            <Badge tone="danger">Chặn trình ký</Badge>
                          ) : null}
                          <span className="text-xs font-extrabold text-muted">
                            {finding.group}
                            {finding.ruleCode ? ` · ${finding.ruleCode}` : ""}
                          </span>
                        </div>
                        <div className="mt-3 text-sm font-extrabold text-primary">
                          {finding.issue || "Nội dung cần kiểm tra"}
                        </div>
                        {finding.evidence ? (
                          <p className="mt-2 text-sm leading-6 text-muted">
                            <strong>Bằng chứng:</strong> {finding.evidence}
                          </p>
                        ) : null}
                        {finding.recommendation ? (
                          <p className="mt-2 text-sm leading-6 text-muted">
                            <strong>Khuyến nghị:</strong>{" "}
                            {finding.recommendation}
                          </p>
                        ) : null}
                      </article>
                    ))}
                    {!selectedReview.findings.length ? (
                      <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted">
                        AI chưa phát hiện góp ý nào theo bộ nguyên tắc hiện hành.
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {selected.attachments.length ? (
                <div className="mt-5">
                  <div className="mb-2 text-sm font-extrabold text-primary">
                    Hồ sơ đính kèm
                  </div>
                  {selected.attachments.map((file) => (
                    <a
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm font-bold text-primary hover:border-accent"
                      href={file.fileUrl}
                      key={file.id}
                    >
                      <FileSearch size={17} />
                      {file.fileName}
                    </a>
                  ))}
                </div>
              ) : null}
              {!selectedReview ? (
                <div className="mt-5 rounded-lg border border-dashed border-border bg-surface-muted/60 p-5 text-sm leading-6 text-muted">
                  Hồ sơ đã được lưu và đang chờ Bộ nguyên tắc AI xử lý. Kết quả
                  sẽ xuất hiện tại đây; trạng thái đồng thời được cập nhật trong
                  Đơn hàng của tôi và Quản lý đơn hàng.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
