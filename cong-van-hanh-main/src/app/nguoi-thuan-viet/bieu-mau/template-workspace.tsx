"use client";

import {
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  List,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Badge, Button, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  TemplateFieldDefinition,
  TemplateFieldFormat,
  TemplateFormDefinition,
  TemplateLookupRecord,
  TemplateOutputPayload,
  TemplateOutputResult,
  TemplateRecord,
  TemplateTableGroupDefinition,
  TemplateWorkspaceSnapshot,
} from "@/lib/templates/types";

type RpcResponse<T> = {
  message?: string;
  ok: boolean;
  result?: T;
};

async function templateRpc<T>(
  method: string,
  payload: Record<string, unknown> = {},
) {
  const response = await fetch("/api/templates/rpc", {
    body: JSON.stringify({ method, payload }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = (await response.json()) as RpcResponse<T>;
  if (!response.ok || !body.ok || body.result == null) {
    throw new Error(body.message || "Không xử lý được yêu cầu Biểu mẫu.");
  }
  return body.result;
}

function previewUrl(record: TemplateRecord) {
  if (record.fileType === "spreadsheet") {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(record.workingFileId)}/preview`;
  }
  return `https://docs.google.com/document/d/${encodeURIComponent(record.workingFileId)}/preview`;
}

function fieldStyle(format: TemplateFieldFormat): CSSProperties {
  return {
    background: format.backgroundColor || undefined,
    border: format.border ? "1px solid #174c42" : undefined,
    color: format.textColor || undefined,
    fontFamily: format.fontFamily || "Times New Roman",
    fontSize: format.fontSize ? `${format.fontSize}px` : undefined,
    fontStyle: format.italic ? "italic" : undefined,
    fontWeight: format.bold ? 800 : undefined,
    textAlign: format.alignment || "left",
    textDecoration: format.underline ? "underline" : undefined,
  };
}

function findLookup(records: TemplateLookupRecord[] | undefined, key: string) {
  return records?.find((record) => record.key === key);
}

function linkedSelector(
  field: TemplateFieldDefinition,
  fields: TemplateFieldDefinition[],
) {
  if (field.linkGroupKey) {
    const exact = fields.find(
      (candidate) => candidate.fieldId === field.linkGroupKey,
    );
    if (exact) return exact;
  }
  return fields.find(
    (candidate) =>
      candidate.datasetKey === field.datasetKey &&
      candidate.tableKey === field.tableKey &&
      ["scalar-selector", "table-selector"].includes(candidate.bindingMode),
  );
}

function LookupInput({
  disabled,
  onChange,
  records,
  value,
}: {
  disabled?: boolean;
  onChange: (key: string) => void;
  records: TemplateLookupRecord[];
  value: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = records.find((record) => record.key === value);
  const [query, setQuery] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const options = useMemo(() => {
    const needle = query
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    return records
      .filter(
        (record) =>
          !needle ||
          record.label
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .toLowerCase()
            .includes(needle) ||
          record.searchText.includes(needle),
      )
      .slice(0, 16);
  }, [query, records]);

  return (
    <div className="relative" ref={rootRef}>
      <Input
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!event.target.value) onChange("");
        }}
        onFocus={() => setOpen(true)}
        placeholder="Gõ để tìm và chọn"
        value={query}
      />
      <button
        aria-label="Mở danh sách"
        className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-primary hover:bg-primary/8"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronDown size={17} />
      </button>
      {open && !disabled ? (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-auto rounded-2xl border border-border bg-white p-1.5 shadow-[0_18px_44px_rgba(17,45,39,0.16)]">
          {options.map((record) => (
            <button
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-primary hover:bg-accent-soft"
              key={record.key}
              onClick={() => {
                onChange(record.key);
                setQuery(record.label);
                setOpen(false);
              }}
              type="button"
            >
              <span className="min-w-0 truncate font-bold">{record.label}</span>
              {record.key === value ? (
                <Check className="shrink-0 text-accent" size={16} />
              ) : null}
            </button>
          ))}
          {!options.length ? (
            <div className="px-3 py-5 text-center text-sm text-muted">
              Không tìm thấy dữ liệu phù hợp.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ManualControl({
  field,
  onChange,
  value,
}: {
  field: TemplateFieldDefinition;
  onChange: (value: string) => void;
  value: string;
}) {
  if (field.manualInputType === "textarea") {
    return (
      <textarea
        className="ui-module-textarea"
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        rows={4}
        value={value}
      />
    );
  }
  if (field.manualInputType === "select" || field.options.length) {
    return (
      <Select
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        value={value}
      >
        <option value="">Chọn</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      onChange={(event) => onChange(event.target.value)}
      readOnly={field.readOnly}
      required={field.required}
      type={
        field.manualInputType === "date"
          ? "date"
          : field.manualInputType === "email"
            ? "email"
            : ["money", "number"].includes(field.manualInputType)
              ? "number"
              : "text"
      }
      value={value}
    />
  );
}

function PreviewPaper({
  companyLabel,
  definition,
  scalarValues,
  tableRows,
  template,
}: {
  companyLabel: string;
  definition: TemplateFormDefinition;
  scalarValues: Record<string, string>;
  tableRows: Record<string, Array<Record<string, string>>>;
  template: TemplateRecord;
}) {
  const displayValue = (field: TemplateFieldDefinition, rawValue: string) => {
    if (["scalar-selector", "table-selector"].includes(field.bindingMode)) {
      return (
        findLookup(definition.lookupRecords[field.datasetKey], rawValue)
          ?.values[field.sourceFieldKey] ||
        findLookup(definition.lookupRecords[field.datasetKey], rawValue)
          ?.label ||
        ""
      );
    }
    return rawValue;
  };
  return (
    <div className="min-h-[720px] bg-white px-8 py-10 text-[#192925] shadow-[0_18px_54px_rgba(17,45,39,0.12)]">
      <div className="border-b border-[#dfe6e2] pb-5 text-center">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-brand-strong">
          {companyLabel || "Công vận hành Thuần Việt"}
        </div>
        <h2 className="mt-2 text-2xl font-black uppercase text-[#123f36]">
          {template.templateName}
        </h2>
        <p className="mt-2 text-xs text-[#71807c]">
          Bản nháp sống · dữ liệu thay đổi ngay khi nhập
        </p>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {definition.scalarFields.map((field) => (
          <div
            className="rounded-lg border border-[#e0e7e4] p-3"
            key={field.fieldId}
          >
            <div className="text-[10px] font-bold uppercase tracking-wide text-[#71807c]">
              {field.manualLabel || field.placeholder}
            </div>
            <div
              className="mt-1 min-h-5 whitespace-pre-wrap"
              style={fieldStyle(field.format)}
            >
              {displayValue(
                field,
                scalarValues[field.fieldId] || field.value || "",
              ) || "…"}
            </div>
          </div>
        ))}
      </div>
      {definition.tableGroups.map((group, groupIndex) => (
        <div className="mt-6" key={group.key}>
          <h3 className="mb-2 text-sm font-extrabold text-[#123f36]">
            {group.label || `Bảng dữ liệu ${groupIndex + 1}`}
          </h3>
          <div className="overflow-hidden rounded-lg border border-[#bccdc7]">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-[#eef4f1]">
                <tr>
                  {group.columns.map((column) => (
                    <th
                      className="border-r border-[#d9e3df] px-2 py-2 text-left last:border-r-0"
                      key={column.fieldId}
                    >
                      {column.manualLabel || column.placeholder}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(tableRows[group.key] || [{}]).map((row, rowIndex) => (
                  <tr className="border-t border-[#d9e3df]" key={rowIndex}>
                    {group.columns.map((column) => (
                      <td
                        className="border-r border-[#d9e3df] px-2 py-2 last:border-r-0"
                        key={column.fieldId}
                        style={fieldStyle(column.format)}
                      >
                        {column.sourceFieldKey === "rowNumber"
                          ? rowIndex + 1
                          : displayValue(column, row[column.fieldId] || "") ||
                            "…"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldShell({
  children,
  field,
}: {
  children: ReactNode;
  field: TemplateFieldDefinition;
}) {
  return (
    <label className="ui-module-field">
      <span className="ui-module-label">
        {field.manualLabel || field.placeholder}
        {field.required ? " *" : ""}
      </span>
      {children}
      {field.manualInputType === "formula" ? (
        <small className="text-xs text-muted">
          Tự tính theo công thức khi tạo file.
        </small>
      ) : null}
    </label>
  );
}

export function TemplateWorkspace({
  initial,
  initialEvaluationInstanceId = "",
  initialTemplateId = "",
}: {
  initial: TemplateWorkspaceSnapshot;
  initialEvaluationInstanceId?: string;
  initialTemplateId?: string;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState("");
  const [definition, setDefinition] = useState<TemplateFormDefinition | null>(
    null,
  );
  const [activeTemplate, setActiveTemplate] = useState<TemplateRecord | null>(
    null,
  );
  const [scalarValues, setScalarValues] = useState<Record<string, string>>({});
  const [tableRows, setTableRows] = useState<
    Record<string, Array<Record<string, string>>>
  >({});
  const [companyId, setCompanyId] = useState("");
  const [evaluationInstanceId, setEvaluationInstanceId] = useState("");
  const [note, setNote] = useState("");
  const [previewMode, setPreviewMode] = useState<"live" | "pdf" | "source">(
    "live",
  );
  const [draft, setDraft] = useState<TemplateOutputResult | null>(null);
  const [output, setOutput] = useState<TemplateOutputResult | null>(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const autoOpenedRef = useRef(false);

  const visible = useMemo(() => {
    const needle = query.toLocaleLowerCase("vi").trim();
    return initial.templates.filter(
      (template) =>
        !needle ||
        template.templateName.toLocaleLowerCase("vi").includes(needle) ||
        template.sourceFileName.toLocaleLowerCase("vi").includes(needle),
    );
  }, [initial.templates, query]);

  const companyLabel =
    definition?.companyOptions.find((item) => item.value === companyId)
      ?.label || "";

  const cleanupDraft = async (fileId: string) => {
    if (!fileId) return;
    await fetch("/api/templates/rpc", {
      body: JSON.stringify({
        method: "deleteTemplateDraftPreview",
        payload: { draftFileId: fileId },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => undefined);
  };

  useEffect(
    () => () => {
      if (draft?.outputFileId) void cleanupDraft(draft.outputFileId);
    },
    [draft?.outputFileId],
  );

  const loadTemplate = async (
    record: TemplateRecord,
    requestedEvaluationInstanceId = "",
  ) => {
    if (draft?.outputFileId) await cleanupDraft(draft.outputFileId);
    setBusy("Đang dựng biểu mẫu và nạp dữ liệu liên kết...");
    setProgress(34);
    try {
      const result = await templateRpc<{
        formDefinition: TemplateFormDefinition;
        template: TemplateRecord;
      }>("getTemplateFormDefinition", {
        ...(requestedEvaluationInstanceId
          ? {
              context: {
                evaluationInstanceId: requestedEvaluationInstanceId,
              },
            }
          : {}),
        templateId: record.templateId,
      });
      setProgress(100);
      setActiveId(record.templateId);
      setActiveTemplate(result.template);
      setDefinition(result.formDefinition);
      setScalarValues(
        Object.fromEntries(
          result.formDefinition.scalarFields.map((field) => [
            field.fieldId,
            field.value || "",
          ]),
        ),
      );
      setTableRows(
        Object.fromEntries(
          result.formDefinition.tableGroups.map((group) => [group.key, [{}]]),
        ),
      );
      setCompanyId(result.formDefinition.resolvedCompanyId || "");
      setEvaluationInstanceId(
        result.formDefinition.context.evaluationInstanceId || "",
      );
      setNote("");
      setDraft(null);
      setOutput(null);
      setPreviewMode("live");
      setSidebarOpen(false);
    } catch (error) {
      toast({
        message:
          error instanceof Error ? error.message : "Không mở được biểu mẫu.",
        title: "Không hoàn tất thao tác",
        tone: "error",
      });
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setProgress(0);
      }, 250);
    }
  };

  useEffect(() => {
    if (autoOpenedRef.current || !initialTemplateId) return;
    autoOpenedRef.current = true;
    const record = initial.templates.find(
      (template) =>
        template.id === initialTemplateId ||
        template.templateId === initialTemplateId,
    );
    if (!record) {
      toast({
        message: "Biểu mẫu đính kèm không còn hoạt động hoặc đã được đổi mã.",
        title: "Không mở được biểu mẫu đi kèm",
        tone: "warning",
      });
      return;
    }
    const timerId = window.setTimeout(() => {
      void loadTemplate(record, initialEvaluationInstanceId);
    }, 0);
    // Liên kết email chỉ được xử lý một lần khi mở trang.
    return () => window.clearTimeout(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEvaluationInstanceId, initialTemplateId]);

  const applyFormDefinition = (next: TemplateFormDefinition) => {
    setDefinition(next);
    setScalarValues(
      Object.fromEntries(
        next.scalarFields.map((field) => [field.fieldId, field.value || ""]),
      ),
    );
    setCompanyId(next.resolvedCompanyId || "");
    setEvaluationInstanceId(next.context.evaluationInstanceId || "");
    setDraft(null);
    setOutput(null);
    setPreviewMode("live");
  };

  const applyEvaluation = async (value: string) => {
    if (!activeTemplate || !definition) return;
    setEvaluationInstanceId(value);
    if (!value) {
      setScalarValues((current) => {
        const next = { ...current };
        definition.scalarFields
          .filter((field) => field.datasetKey === "evaluationResult")
          .forEach((field) => {
            next[field.fieldId] = "";
          });
        return next;
      });
      return;
    }
    setBusy("Đang nạp kết quả của nhân sự được đánh giá...");
    setProgress(38);
    try {
      const result = await templateRpc<{
        formDefinition: TemplateFormDefinition;
        template: TemplateRecord;
      }>("getTemplateFormDefinition", {
        context: { evaluationInstanceId: value },
        templateId: activeTemplate.templateId,
      });
      applyFormDefinition(result.formDefinition);
      setProgress(100);
    } catch (error) {
      toast({
        message:
          error instanceof Error
            ? error.message
            : "Không nạp được kết quả đánh giá.",
        title: "Không hoàn tất thao tác",
        tone: "error",
      });
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setProgress(0);
      }, 250);
    }
  };

  const setScalarValue = (field: TemplateFieldDefinition, value: string) => {
    setScalarValues((current) => {
      const next = { ...current, [field.fieldId]: value };
      if (!definition) return next;
      if (field.bindingMode === "scalar-selector") {
        const lookup = findLookup(
          definition.lookupRecords[field.datasetKey],
          value,
        );
        definition.scalarFields.forEach((candidate) => {
          if (
            candidate.bindingMode === "scalar-linked" &&
            candidate.datasetKey === field.datasetKey &&
            (!candidate.linkGroupKey ||
              candidate.linkGroupKey === field.fieldId ||
              linkedSelector(candidate, definition.scalarFields)?.fieldId ===
                field.fieldId)
          ) {
            next[candidate.fieldId] =
              lookup?.values[candidate.sourceFieldKey] || "";
          }
        });
      }
      return next;
    });
    if (draft) {
      setDraft(null);
      setPreviewMode("live");
    }
  };

  const setTableValue = (
    group: TemplateTableGroupDefinition,
    field: TemplateFieldDefinition,
    rowIndex: number,
    value: string,
  ) => {
    setTableRows((current) => {
      const rows = [...(current[group.key] || [{}])];
      const row = { ...(rows[rowIndex] || {}), [field.fieldId]: value };
      if (field.bindingMode === "table-selector" && definition) {
        const lookup = findLookup(
          definition.lookupRecords[field.datasetKey],
          value,
        );
        group.columns.forEach((candidate) => {
          if (
            candidate.bindingMode === "table-linked" &&
            candidate.datasetKey === field.datasetKey &&
            candidate.sourceFieldKey !== "rowNumber" &&
            (!candidate.linkGroupKey ||
              candidate.linkGroupKey === field.fieldId ||
              linkedSelector(candidate, group.columns)?.fieldId ===
                field.fieldId)
          ) {
            row[candidate.fieldId] =
              lookup?.values[candidate.sourceFieldKey] || "";
          }
        });
      }
      rows[rowIndex] = row;
      return { ...current, [group.key]: rows };
    });
    if (draft) {
      setDraft(null);
      setPreviewMode("live");
    }
  };

  const applyCompany = (value: string) => {
    setCompanyId(value);
    setOutput(null);
    if (!definition) return;
    const lookup = findLookup(definition.lookupRecords.company, value);
    setScalarValues((current) => {
      const next = { ...current };
      definition.scalarFields.forEach((field) => {
        if (
          field.bindingMode === "scalar-company-context" &&
          field.contextSource === "selected-company"
        ) {
          next[field.fieldId] = lookup?.values[field.sourceFieldKey] || "";
        } else if (
          field.datasetKey === "company" &&
          field.bindingMode === "scalar-selector"
        ) {
          next[field.fieldId] = value;
        }
      });
      definition.scalarFields.forEach((field) => {
        if (
          field.datasetKey !== "company" ||
          field.bindingMode !== "scalar-linked"
        ) {
          return;
        }
        const selector = linkedSelector(field, definition.scalarFields);
        const selectorValue = selector
          ? next[selector.fieldId] || value
          : value;
        next[field.fieldId] =
          findLookup(definition.lookupRecords.company, selectorValue)?.values[
            field.sourceFieldKey
          ] || "";
      });
      return next;
    });
    if (draft) {
      setDraft(null);
      setPreviewMode("live");
    }
    if (activeTemplate?.numbering.documentTypeId) {
      void templateRpc<{
        formDefinition: TemplateFormDefinition;
        template: TemplateRecord;
      }>("getTemplateFormDefinition", {
        context: { ...definition.context, companyId: value },
        templateId: activeTemplate.templateId,
      })
        .then((result) => {
          setDefinition((current) =>
            current
              ? { ...current, numbering: result.formDefinition.numbering }
              : current,
          );
          const numberingFields = result.formDefinition.scalarFields.filter(
            (field) =>
              field.fieldId ===
                result.formDefinition.numbering?.documentNumberFieldId ||
              (field.datasetKey === "system" &&
                ["documentNumber", "documentTypeName"].includes(
                  field.sourceFieldKey,
                )),
          );
          setScalarValues((current) => ({
            ...current,
            ...Object.fromEntries(
              numberingFields.map((field) => [field.fieldId, field.value]),
            ),
          }));
        })
        .catch(() => undefined);
    }
  };

  const payload = (): TemplateOutputPayload => ({
    companyId,
    context: {
      ...definition?.context,
      evaluationInstanceId:
        evaluationInstanceId || definition?.context.evaluationInstanceId,
    },
    note,
    previousDraftFileId: draft?.outputFileId || "",
    scalarValues,
    tableRows,
    templateId: activeTemplate?.templateId || activeId,
  });

  const validate = () => {
    if (!definition) return false;
    if (definition.requiresCompanyContext && !companyId) {
      toast({
        message: "Chọn công ty áp dụng để tự điền pháp nhân.",
        title: "Chưa đủ dữ liệu",
        tone: "warning",
      });
      return false;
    }
    if (definition.requiresEvaluationContext && !evaluationInstanceId) {
      toast({
        message: "Chọn kết quả của nhân sự được đánh giá để điền dữ liệu CnB.",
        title: "Chưa chọn kết quả đánh giá",
        tone: "warning",
      });
      return false;
    }
    const missingScalar = definition.scalarFields.find(
      (field) =>
        field.required &&
        !String(scalarValues[field.fieldId] || field.value || "").trim(),
    );
    if (missingScalar) {
      toast({
        message: `Vui lòng nhập ${missingScalar.manualLabel || missingScalar.placeholder}.`,
        title: "Chưa đủ dữ liệu",
        tone: "warning",
      });
      return false;
    }
    return true;
  };

  const createDraft = async () => {
    if (!validate()) return;
    setBusy("Đang tạo PDF nháp từ dữ liệu hiện tại...");
    setProgress(26);
    try {
      const timer = window.setInterval(
        () => setProgress((value) => Math.min(value + 7, 90)),
        800,
      );
      const result = await templateRpc<TemplateOutputResult>(
        "generateTemplateDraftPreview",
        payload() as unknown as Record<string, unknown>,
      );
      window.clearInterval(timer);
      setProgress(100);
      setDraft(result);
      setPreviewMode("pdf");
      toast({
        message: "PDF nháp đã phản ánh dữ liệu đang nhập.",
        title: "Đã tạo bản xem trước",
        tone: "success",
      });
    } catch (error) {
      toast({
        message:
          error instanceof Error ? error.message : "Không tạo được PDF nháp.",
        title: "Không hoàn tất thao tác",
        tone: "error",
      });
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setProgress(0);
      }, 250);
    }
  };

  const createOutput = async () => {
    if (!validate()) return;
    const outputWindow = window.open("about:blank", "_blank");
    setBusy("Đang trộn dữ liệu, tạo file và lưu lịch sử...");
    setProgress(24);
    try {
      const timer = window.setInterval(
        () => setProgress((value) => Math.min(value + 6, 91)),
        800,
      );
      const result = await templateRpc<TemplateOutputResult>(
        "generateTemplateOutput",
        payload() as unknown as Record<string, unknown>,
      );
      window.clearInterval(timer);
      setProgress(100);
      setOutput(result);
      if (outputWindow) outputWindow.location.href = result.outputUrl;
      toast({
        message: result.documentNumber
          ? `Đã cấp số ${result.documentNumber}, tạo file và lưu lịch sử PostgreSQL.`
          : "File đã lưu vào Drive và lịch sử PostgreSQL.",
        title: "Đã tạo biểu mẫu",
        tone: "success",
      });
    } catch (error) {
      outputWindow?.close();
      toast({
        message:
          error instanceof Error ? error.message : "Không tạo được file.",
        title: "Không hoàn tất thao tác",
        tone: "error",
      });
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setProgress(0);
      }, 250);
    }
  };

  return (
    <>
      <WriteLoadingOverlay
        message={`${busy}${progress ? ` · ${progress}%` : ""}`}
        show={Boolean(busy)}
      />
      <section className="mb-5 flex flex-wrap items-start justify-end gap-4">
        <div className="flex gap-2">
          <Button onClick={() => setSidebarOpen(true)} variant="secondary">
            <List size={17} />
            Danh sách biểu mẫu
          </Button>
          <Link
            aria-label="Đóng Biểu mẫu"
            className="ui-close-button"
            href="/"
            title="Về trang Dịch vụ"
          >
            <X size={20} />
          </Link>
        </div>
      </section>

      <div className="relative min-h-[740px] overflow-hidden rounded-[30px] border border-border bg-[#f2f2eb] shadow-[0_20px_54px_rgba(17,45,39,0.1)]">
        {sidebarOpen ? (
          <>
            <button
              aria-label="Đóng danh sách"
              className="absolute inset-0 z-20 bg-primary/20 backdrop-blur-[2px]"
              onClick={() => setSidebarOpen(false)}
              type="button"
            />
            <aside className="absolute inset-y-0 left-0 z-30 w-[min(390px,92%)] overflow-auto border-r border-border bg-white p-4 shadow-[20px_0_50px_rgba(17,45,39,0.13)]">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-accent">
                    Danh sách biểu mẫu
                  </div>
                  <h2 className="mt-1 text-xl font-extrabold text-primary">
                    {initial.templates.length} mẫu sẵn sàng
                  </h2>
                </div>
                <button
                  aria-label="Đóng danh sách"
                  className="ui-icon-button"
                  onClick={() => setSidebarOpen(false)}
                  type="button"
                >
                  <X size={17} />
                </button>
              </div>
              <label className="relative block">
                <Search
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-accent"
                  size={17}
                />
                <Input
                  className="pl-11"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm biểu mẫu"
                  value={query}
                />
              </label>
              <div className="mt-3 space-y-3">
                {visible.map((record) => (
                  <article
                    className={`rounded-2xl border p-4 transition ${
                      activeId === record.templateId
                        ? "border-accent bg-accent-soft"
                        : "border-border bg-surface hover:border-accent/40"
                    }`}
                    key={record.templateId}
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary">
                        <FileText size={20} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-extrabold text-primary">
                          {record.templateName}
                        </h3>
                        <p className="mt-1 truncate text-xs text-muted">
                          {record.fileType.toUpperCase()} · {record.fieldCount}{" "}
                          trường
                        </p>
                        {record.numbering.documentTypeId ? (
                          <Badge className="mt-2" tone="warning">
                            Cấp số · {record.numbering.documentTypeName}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {record.workingFileUrl ? (
                        <a
                          className="ui-button ui-button--secondary h-10 px-3 text-xs"
                          href={record.workingFileUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink size={14} />
                          File riêng
                        </a>
                      ) : (
                        <span />
                      )}
                      <Button
                        className="h-10"
                        onClick={() => loadTemplate(record)}
                        size="sm"
                      >
                        Chọn
                      </Button>
                    </div>
                  </article>
                ))}
                {!visible.length ? (
                  <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
                    Không tìm thấy biểu mẫu phù hợp.
                  </div>
                ) : null}
              </div>
            </aside>
          </>
        ) : null}

        {!definition || !activeTemplate ? (
          <div className="grid min-h-[740px] place-items-center p-6">
            <div className="max-w-xl rounded-[30px] border border-primary/10 bg-white p-10 text-center shadow-[0_20px_54px_rgba(17,45,39,0.1)]">
              <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-accent-soft text-accent">
                <FileText size={30} />
              </div>
              <Badge className="mt-5" tone="info">
                Biểu mẫu nội bộ
              </Badge>
              <h2 className="mt-3 text-2xl font-extrabold text-primary">
                Chọn một biểu mẫu để bắt đầu
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                File gốc, bản nháp sống và trường điền sẽ mở cùng một màn hình
                để đối chiếu trực tiếp.
              </p>
              <Button className="mt-5" onClick={() => setSidebarOpen(true)}>
                <List size={17} />
                Mở danh sách biểu mẫu
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[740px] gap-4 p-4 xl:grid-cols-[minmax(460px,.92fr)_minmax(520px,1.08fr)]">
            <section className="overflow-hidden rounded-3xl border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-primary">
                    {activeTemplate.workingFileName ||
                      activeTemplate.templateName}
                  </div>
                  <div className="text-xs text-muted">
                    Xem biểu mẫu · nháp sống · PDF nháp
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 rounded-full border border-border bg-surface-muted p-1">
                  {[
                    { key: "source" as const, label: "Biểu mẫu" },
                    { key: "live" as const, label: "Nháp" },
                    { key: "pdf" as const, label: "PDF nháp" },
                  ].map((mode) => (
                    <button
                      className={`rounded-full px-3 py-2 text-xs font-bold transition ${
                        previewMode === mode.key
                          ? "bg-primary text-white"
                          : "text-primary hover:bg-white"
                      }`}
                      disabled={mode.key === "pdf" && !draft}
                      key={mode.key}
                      onClick={() => setPreviewMode(mode.key)}
                      type="button"
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[760px] overflow-auto bg-[#e9ece9] p-3">
                {previewMode === "source" ? (
                  <iframe
                    className="h-full min-h-[720px] w-full rounded-xl border-0 bg-white"
                    src={previewUrl(activeTemplate)}
                    title="Biểu mẫu gốc"
                  />
                ) : previewMode === "pdf" && draft ? (
                  <iframe
                    className="h-full min-h-[720px] w-full rounded-xl border-0 bg-white"
                    src={draft.previewUrl}
                    title="PDF nháp"
                  />
                ) : (
                  <PreviewPaper
                    companyLabel={companyLabel}
                    definition={definition}
                    scalarValues={scalarValues}
                    tableRows={tableRows}
                    template={activeTemplate}
                  />
                )}
              </div>
            </section>

            <section className="max-h-[820px] overflow-auto rounded-3xl border border-border bg-white p-5">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                  <Badge tone="warning">Chi tiết biểu mẫu</Badge>
                  <h2 className="mt-2 text-2xl font-extrabold text-primary">
                    {activeTemplate.templateName}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Điền dữ liệu còn thiếu, kiểm tra nháp rồi tạo file hoàn
                    chỉnh.
                  </p>
                </div>
                <button
                  aria-label="Đổi biểu mẫu"
                  className="ui-icon-button"
                  onClick={() => setSidebarOpen(true)}
                  title="Đổi biểu mẫu"
                  type="button"
                >
                  <List size={17} />
                </button>
              </div>

              <div className="space-y-5">
                {definition.numbering ? (
                  <section className="rounded-2xl border border-accent/20 bg-[linear-gradient(145deg,#fffaf4,#f1f8f5)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <Badge tone="warning">Đánh số tự động</Badge>
                        <h3 className="mt-2 font-extrabold text-primary">
                          {definition.numbering.documentTypeName}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          Kế thừa đúng vòng lặp và điểm bắt đầu của pháp nhân.
                          Số được điền vào
                          {` {${definition.numbering.documentNumberPlaceholder || "placeholder đã chọn"}}`}
                          . Bản nháp không tiêu hao số.
                        </p>
                      </div>
                      <div className="rounded-xl border border-primary/10 bg-white px-3 py-2 text-right">
                        <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted">
                          Số dự kiến
                        </div>
                        <div className="mt-1 font-mono text-sm font-extrabold text-primary">
                          {definition.numbering.previewNumber ||
                            "Chọn pháp nhân"}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {definition.requiresCompanyContext ? (
                  <label className="ui-module-field">
                    <span className="ui-module-label">Công ty áp dụng *</span>
                    <Select
                      onChange={(event) => applyCompany(event.target.value)}
                      value={companyId}
                    >
                      <option value="">Chọn công ty</option>
                      {definition.companyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <small className="text-xs leading-5 text-muted">
                      Tên rút gọn, địa chỉ, mã số thuế và người đại diện được tự
                      động điền theo pháp nhân.
                    </small>
                  </label>
                ) : null}

                {definition.requiresEvaluationContext ? (
                  <label className="ui-module-field">
                    <span className="ui-module-label">
                      Kết quả nhân sự được đánh giá *
                    </span>
                    <Select
                      onChange={(event) =>
                        void applyEvaluation(event.target.value)
                      }
                      value={evaluationInstanceId}
                    >
                      <option value="">Chọn nhân sự và kết quả đã chốt</option>
                      {definition.evaluationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <small className="text-xs leading-5 text-muted">
                      Câu trả lời CnB, kết luận và điểm tổng được lấy từ đúng
                      phiếu này, không lấy theo người đang thao tác.
                    </small>
                  </label>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  {definition.scalarFields.map((field) => {
                    const records =
                      definition.lookupRecords[field.datasetKey] || [];
                    return (
                      <FieldShell field={field} key={field.fieldId}>
                        {field.bindingMode === "scalar-selector" ? (
                          <LookupInput
                            key={`${field.fieldId}:${scalarValues[field.fieldId] || ""}`}
                            onChange={(value) => setScalarValue(field, value)}
                            records={records}
                            value={scalarValues[field.fieldId] || ""}
                          />
                        ) : (
                          <ManualControl
                            field={field}
                            onChange={(value) => setScalarValue(field, value)}
                            value={
                              scalarValues[field.fieldId] || field.value || ""
                            }
                          />
                        )}
                      </FieldShell>
                    );
                  })}
                </div>

                <p className="rounded-2xl border border-primary/10 bg-surface-muted/60 px-4 py-3 text-xs leading-5 text-muted">
                  Trường được Admin cho phép sửa sẽ chỉnh ngay tại màn này,
                  trước khi bấm <strong>Tạo PDF nháp</strong> hoặc
                  <strong> Tạo file và in</strong>. Sau khi merge, hệ thống mở
                  bản Google Docs để chỉnh thêm; cũng có thể mở lại bằng nút
                  <strong> Mở file vừa tạo</strong>. PDF nháp chỉ dùng xem trước
                  và không chỉnh trực tiếp.
                </p>

                {definition.tableGroups.map((group, groupIndex) => {
                  const rows = tableRows[group.key] || [{}];
                  return (
                    <section
                      className="rounded-3xl border border-primary/10 bg-surface-muted/40 p-4"
                      key={group.key}
                    >
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <Badge tone="info">
                            Bảng {String(groupIndex + 1).padStart(2, "0")}
                          </Badge>
                          <h3 className="mt-1 font-extrabold text-primary">
                            {group.label || "Dữ liệu nhiều dòng"}
                          </h3>
                        </div>
                        <Button
                          onClick={() =>
                            setTableRows((current) => ({
                              ...current,
                              [group.key]: [...rows, {}],
                            }))
                          }
                          size="sm"
                          variant="secondary"
                        >
                          <Plus size={15} />
                          Thêm dòng
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {rows.map((row, rowIndex) => (
                          <article
                            className="rounded-2xl border border-border bg-white p-3"
                            key={rowIndex}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 text-sm font-extrabold text-primary">
                                <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent-strong">
                                  {rowIndex + 1}
                                </span>
                                Dòng {rowIndex + 1}
                              </div>
                              <button
                                aria-label={`Xóa dòng ${rowIndex + 1}`}
                                className="ui-icon-button size-9 text-danger"
                                disabled={rows.length === 1}
                                onClick={() =>
                                  setTableRows((current) => ({
                                    ...current,
                                    [group.key]: rows.filter(
                                      (_, index) => index !== rowIndex,
                                    ),
                                  }))
                                }
                                type="button"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              {group.columns.map((field) => {
                                const isStt =
                                  field.datasetKey === "system" &&
                                  field.sourceFieldKey === "rowNumber";
                                const records =
                                  definition.lookupRecords[field.datasetKey] ||
                                  [];
                                return (
                                  <FieldShell field={field} key={field.fieldId}>
                                    {isStt ? (
                                      <Input
                                        readOnly
                                        value={String(rowIndex + 1)}
                                      />
                                    ) : field.bindingMode ===
                                      "table-selector" ? (
                                      <LookupInput
                                        key={`${field.fieldId}:${rowIndex}:${row[field.fieldId] || ""}`}
                                        onChange={(value) =>
                                          setTableValue(
                                            group,
                                            field,
                                            rowIndex,
                                            value,
                                          )
                                        }
                                        records={records}
                                        value={row[field.fieldId] || ""}
                                      />
                                    ) : (
                                      <ManualControl
                                        field={field}
                                        onChange={(value) =>
                                          setTableValue(
                                            group,
                                            field,
                                            rowIndex,
                                            value,
                                          )
                                        }
                                        value={row[field.fieldId] || ""}
                                      />
                                    )}
                                  </FieldShell>
                                );
                              })}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  );
                })}

                <label className="ui-module-field">
                  <span className="ui-module-label">Ghi chú</span>
                  <textarea
                    className="ui-module-textarea"
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    value={note}
                  />
                </label>

                <div className="sticky bottom-0 -mx-5 border-t border-border bg-white/95 px-5 py-4 backdrop-blur">
                  {output?.documentNumber ? (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-primary px-3 py-2 text-white">
                      <span className="text-xs font-bold">
                        Số văn bản đã cấp
                      </span>
                      <strong className="font-mono text-sm">
                        {output.documentNumber}
                      </strong>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button onClick={createDraft} variant="secondary">
                      <Eye size={17} />
                      {draft ? "Cập nhật PDF nháp" : "Tạo PDF nháp"}
                    </Button>
                    <Button onClick={createOutput}>
                      <Printer size={17} />
                      Tạo file và in
                    </Button>
                    {output ? (
                      <a
                        className="ui-button ui-button--secondary"
                        href={output.outputUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <FileDown size={17} />
                        Mở file vừa tạo
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
