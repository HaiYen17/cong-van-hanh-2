"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Archive,
  ArrowDown,
  ArrowUp,
  Bold,
  CheckCircle2,
  ExternalLink,
  FileClock,
  FileSearch,
  FileSpreadsheet,
  FileText,
  History,
  Hash,
  Italic,
  Link2,
  ListFilter,
  PaintBucket,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Underline,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { Badge, Button, FilePicker, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import { isSensitiveEmployeeFieldKey } from "@/lib/templates/employee-fields";
import type {
  TemplateDatasetKey,
  TemplateContextSource,
  TemplateFieldConfig,
  TemplateFieldFormat,
  TemplateImportMode,
  TemplateManagementSnapshot,
  TemplateRecord,
  TemplateScanResult,
  TemplateSourceInfo,
} from "@/lib/templates/types";

type RpcResponse<T> = {
  message?: string;
  ok: boolean;
  result?: T;
};

type EditorState = {
  fields: TemplateFieldConfig[];
  id: string;
  importMode: TemplateImportMode;
  numberingCustomTextFieldId: string;
  numberingDocumentNumberFieldId: string;
  numberingDocumentTypeId: string;
  numberingSignDateFieldId: string;
  scanMeta: TemplateScanResult | Record<string, unknown>;
  source: Partial<TemplateSourceInfo>;
  status: string;
  templateName: string;
};

const emptyEditor: EditorState = {
  fields: [],
  id: "",
  importMode: "link",
  numberingCustomTextFieldId: "",
  numberingDocumentNumberFieldId: "",
  numberingDocumentTypeId: "",
  numberingSignDateFieldId: "",
  scanMeta: {},
  source: {},
  status: "Kích hoạt",
  templateName: "",
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

function editorFromRecord(record: TemplateRecord): EditorState {
  return {
    fields: record.fieldConfigs,
    id: record.id,
    importMode: record.importMode,
    numberingCustomTextFieldId: record.numbering.customTextFieldId,
    numberingDocumentNumberFieldId: record.numbering.documentNumberFieldId,
    numberingDocumentTypeId: record.numbering.documentTypeId,
    numberingSignDateFieldId: record.numbering.signDateFieldId,
    scanMeta: record.scanMeta,
    source: {
      fileType: record.fileType,
      importMode: record.importMode,
      sourceFileId: record.sourceFileId,
      sourceFileName: record.sourceFileName,
      sourceFileUrl: record.sourceFileUrl,
      sourceLink: record.sourceLink,
      workingFileId: record.workingFileId,
      workingFileName: record.workingFileName,
      workingFileUrl: record.workingFileUrl,
      workingMimeType: record.workingMimeType,
    },
    status: record.status,
    templateName: record.templateName,
  };
}

function sourceOptions(
  snapshot: TemplateManagementSnapshot,
  datasetKey: TemplateDatasetKey,
) {
  if (datasetKey === "employee") return snapshot.employeeFieldOptions;
  if (datasetKey === "company") return snapshot.companyFieldOptions;
  if (datasetKey === "evaluationResult") {
    return snapshot.evaluationResultFieldOptions;
  }
  if (datasetKey === "product") return snapshot.productFieldOptions;
  if (datasetKey === "partnerCustomer") {
    return snapshot.partnerCustomerFieldOptions;
  }
  if (datasetKey === "system") return snapshot.systemFieldOptions;
  return [];
}

function employeeFieldOption(
  snapshot: TemplateManagementSnapshot,
  datasetKey: TemplateDatasetKey,
  sourceFieldKey: string,
) {
  if (datasetKey !== "employee") return undefined;
  return snapshot.employeeFieldOptions.find(
    (option) => option.key === sourceFieldKey,
  );
}

const EVALUATION_SYSTEM_FIELDS = new Set([
  "evaluationCycleName",
  "evaluationDeadline",
  "evaluationLink",
  "evaluationReviewerRole",
  "evaluationTypeName",
]);

function defaultContextSource(
  datasetKey: TemplateDatasetKey,
  sourceFieldKey = "",
): TemplateContextSource {
  if (datasetKey === "employee") return "actor";
  if (datasetKey === "company") return "selected-company";
  if (datasetKey === "evaluationResult") return "evaluation";
  if (datasetKey === "system") {
    return EVALUATION_SYSTEM_FIELDS.has(sourceFieldKey)
      ? "evaluation"
      : "system";
  }
  return "";
}

function contextSourceOptions(
  snapshot: TemplateManagementSnapshot,
  datasetKey: TemplateDatasetKey,
) {
  return snapshot.contextSourceOptions.filter((option) =>
    option.datasetKeys.includes(datasetKey),
  );
}

function formatBadge(field: TemplateFieldConfig) {
  if (field.datasetKey === "product") return "SKU / Sản phẩm";
  if (field.datasetKey === "evaluationResult") return "Kết quả CnB";
  if (field.datasetKey === "system" && field.sourceFieldKey === "rowNumber") {
    return "STT tự động";
  }
  if (field.isSystemField) return "Dữ liệu hệ thống";
  return "Nhập tay";
}

function FieldFormatToolbar({
  field,
  onChange,
}: {
  field: TemplateFieldConfig;
  onChange: (patch: Partial<TemplateFieldFormat>) => void;
}) {
  const format = field.format || {};
  const toggle = (key: "bold" | "italic" | "underline") =>
    onChange({ [key]: !format[key] });
  return (
    <div className="col-span-full rounded-2xl border border-primary/10 bg-[#f7f8f5] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-primary">
          <Sparkles size={15} className="text-accent" />
          Định dạng đầu ra
        </span>
        <span className="text-xs text-muted">
          Thao tác trực quan như Word; định dạng gốc của file vẫn được giữ.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[
          {
            active: format.bold,
            icon: Bold,
            key: "bold" as const,
            label: "Đậm",
          },
          {
            active: format.italic,
            icon: Italic,
            key: "italic" as const,
            label: "Nghiêng",
          },
          {
            active: format.underline,
            icon: Underline,
            key: "underline" as const,
            label: "Gạch chân",
          },
        ].map((item) => (
          <button
            aria-label={item.label}
            aria-pressed={Boolean(item.active)}
            className={`ui-icon-button ${item.active ? "border-accent bg-accent-soft text-accent-strong" : ""}`}
            key={item.key}
            onClick={() => toggle(item.key)}
            title={item.label}
            type="button"
          >
            <item.icon size={16} />
          </button>
        ))}
        <span className="mx-1 h-8 w-px bg-border" />
        {[
          { icon: AlignLeft, key: "left", label: "Căn trái" },
          { icon: AlignCenter, key: "center", label: "Căn giữa" },
          { icon: AlignRight, key: "right", label: "Căn phải" },
        ].map((item) => (
          <button
            aria-label={item.label}
            aria-pressed={format.alignment === item.key}
            className={`ui-icon-button ${format.alignment === item.key ? "border-accent bg-accent-soft text-accent-strong" : ""}`}
            key={item.key}
            onClick={() =>
              onChange({
                alignment: item.key as TemplateFieldFormat["alignment"],
              })
            }
            title={item.label}
            type="button"
          >
            <item.icon size={16} />
          </button>
        ))}
        <label className="flex h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-bold text-primary">
          <span>Màu chữ</span>
          <input
            aria-label="Màu chữ"
            className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
            onChange={(event) => onChange({ textColor: event.target.value })}
            type="color"
            value={format.textColor || "#000000"}
          />
        </label>
        <label className="flex h-11 items-center gap-2 rounded-full border border-border bg-white px-3 text-xs font-bold text-primary">
          <PaintBucket size={15} />
          <span>Nền</span>
          <input
            aria-label="Màu nền"
            className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
            onChange={(event) =>
              onChange({ backgroundColor: event.target.value })
            }
            type="color"
            value={format.backgroundColor || "#FFFFFF"}
          />
        </label>
        <Select
          aria-label="Kiểu chữ"
          className="h-11 w-[180px] rounded-full"
          onChange={(event) => onChange({ fontFamily: event.target.value })}
          value={format.fontFamily || "Times New Roman"}
        >
          <option>Be Vietnam Pro</option>
          <option>Arial</option>
          <option>Times New Roman</option>
          <option>Roboto</option>
        </Select>
        <Input
          aria-label="Cỡ chữ"
          className="h-11 w-20 rounded-full"
          max={48}
          min={7}
          onChange={(event) =>
            onChange({ fontSize: Number(event.target.value) || 12 })
          }
          type="number"
          value={format.fontSize || 12}
        />
        <Select
          aria-label="Chuyển kiểu chữ"
          className="h-11 w-[175px] rounded-full"
          onChange={(event) =>
            onChange({
              transform: event.target.value as TemplateFieldFormat["transform"],
            })
          }
          value={format.transform || "none"}
        >
          <option value="none">Giữ nguyên chữ</option>
          <option value="uppercase">IN HOA</option>
          <option value="lowercase">in thường</option>
          <option value="titlecase">Viết Hoa Đầu Từ</option>
        </Select>
        <button
          aria-pressed={Boolean(format.border)}
          className={`ui-button ui-button--secondary h-11 ${format.border ? "border-accent bg-accent-soft" : ""}`}
          onClick={() => onChange({ border: !format.border })}
          type="button"
        >
          Đóng khung
        </button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          className="h-10"
          onChange={(event) => onChange({ prefix: event.target.value })}
          placeholder="Tiền tố"
          value={format.prefix || ""}
        />
        <Input
          className="h-10"
          onChange={(event) => onChange({ suffix: event.target.value })}
          placeholder="Hậu tố"
          value={format.suffix || ""}
        />
        <Select
          className="h-10"
          onChange={(event) =>
            onChange({
              numberFormat: event.target
                .value as TemplateFieldFormat["numberFormat"],
            })
          }
          value={format.numberFormat || "none"}
        >
          <option value="none">Không định dạng số</option>
          <option value="integer">Số nguyên</option>
          <option value="decimal">Số thập phân</option>
          <option value="percent">Phần trăm</option>
        </Select>
        <Select
          className="h-10"
          onChange={(event) =>
            onChange({
              dateFormat: event.target
                .value as TemplateFieldFormat["dateFormat"],
            })
          }
          value={format.dateFormat || "dd/mm/yyyy"}
        >
          <option value="dd/mm/yyyy">Ngày DD/MM/YYYY</option>
          <option value="dd-mm-yyyy">Ngày DD-MM-YYYY</option>
          <option value="yyyy-mm-dd">Ngày YYYY-MM-DD</option>
        </Select>
      </div>
    </div>
  );
}

export function TemplateManagementWorkspace({
  initial,
}: {
  initial: TemplateManagementSnapshot;
}) {
  const { toast } = useToast();
  const fileRef = useRef<File | null>(null);
  const [snapshot, setSnapshot] = useState(initial);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [sourceLink, setSourceLink] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"definition" | "history">("definition");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);

  const visibleTemplates = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("vi");
    return snapshot.templates.filter(
      (record) =>
        !needle ||
        record.templateName.toLocaleLowerCase("vi").includes(needle) ||
        record.sourceFileName.toLocaleLowerCase("vi").includes(needle),
    );
  }, [search, snapshot.templates]);

  const selectedDocumentType = snapshot.documentTypeOptions.find(
    (item) => item.id === editor.numberingDocumentTypeId,
  );
  const scalarFieldOptions = editor.fields.filter(
    (field) => !field.isTableField,
  );
  const selectedDocumentNumberField = scalarFieldOptions.find(
    (field) => field.fieldId === editor.numberingDocumentNumberFieldId,
  );
  const hasDocumentNumberField = Boolean(
    selectedDocumentNumberField &&
    selectedDocumentNumberField.datasetKey === "system" &&
    selectedDocumentNumberField.sourceFieldKey === "documentNumber",
  );

  const assignDocumentNumberField = (fieldId: string) => {
    setEditor((current) => ({
      ...current,
      fields: current.fields.map((field) => {
        if (field.fieldId === fieldId) {
          return {
            ...field,
            allowOverride: false,
            bindingMode: "scalar-system",
            contextSource: "system",
            datasetKey: "system",
            isSystemField: true,
            isTableField: false,
            manualInputType: "text",
            sourceFieldKey: "documentNumber",
            tableKey: "",
            tableLabel: "",
          };
        }
        if (
          !field.isTableField &&
          field.datasetKey === "system" &&
          field.sourceFieldKey === "documentNumber"
        ) {
          return {
            ...field,
            bindingMode: "manual",
            contextSource: "",
            datasetKey: "",
            isSystemField: false,
            sourceFieldKey: "",
          };
        }
        return field;
      }),
      numberingDocumentNumberFieldId: fieldId,
    }));
  };

  const patchField = (fieldId: string, patch: Partial<TemplateFieldConfig>) => {
    setEditor((current) => ({
      ...current,
      fields: current.fields.map((field) => {
        if (field.fieldId !== fieldId) return field;
        const next = { ...field, ...patch };
        if (patch.isTableField === false) {
          next.tableKey = "";
          next.tableLabel = "";
          next.bindingMode = next.isSystemField ? "scalar-actor" : "manual";
          next.contextSource = next.isSystemField
            ? defaultContextSource(next.datasetKey, next.sourceFieldKey)
            : "";
        }
        if (patch.isTableField === true && !next.tableKey) {
          next.tableKey = `table-${field.scanOrder}`;
          next.tableLabel = "Bảng dữ liệu";
          next.bindingMode = next.isSystemField
            ? "table-linked"
            : "table-manual";
          next.contextSource = "";
        }
        if (patch.isSystemField === false) {
          next.datasetKey = "";
          next.sourceFieldKey = "";
          next.bindingMode = next.isTableField ? "table-manual" : "manual";
          next.linkGroupKey = "";
          next.contextSource = "";
        }
        if (patch.datasetKey != null) {
          next.sourceFieldKey = "";
          next.linkGroupKey = "";
          next.contextSource = next.isTableField
            ? ""
            : defaultContextSource(patch.datasetKey);
          next.bindingMode = next.isTableField
            ? "table-selector"
            : ["evaluationResult", "system"].includes(patch.datasetKey)
              ? "scalar-system"
              : "scalar-selector";
        }
        if (
          patch.sourceFieldKey != null &&
          ["evaluationResult", "system"].includes(next.datasetKey) &&
          !next.isTableField
        ) {
          next.contextSource = defaultContextSource(
            next.datasetKey,
            patch.sourceFieldKey,
          );
          next.bindingMode = "scalar-system";
        }
        if (patch.contextSource != null && !next.isTableField) {
          if (next.datasetKey === "employee") {
            next.bindingMode = "scalar-actor";
          } else if (next.datasetKey === "company") {
            next.bindingMode = "scalar-company-context";
          } else if (next.datasetKey === "system") {
            next.bindingMode = "scalar-system";
          } else if (next.datasetKey === "evaluationResult") {
            next.bindingMode = "scalar-system";
          }
        }
        const selectedEmployeeField = employeeFieldOption(
          snapshot,
          next.datasetKey,
          next.sourceFieldKey,
        );
        if (patch.sourceFieldKey != null && selectedEmployeeField?.inputType) {
          next.manualInputType = selectedEmployeeField.inputType;
        }
        if (
          selectedEmployeeField?.sensitive ||
          (next.datasetKey === "employee" &&
            isSensitiveEmployeeFieldKey(next.sourceFieldKey))
        ) {
          next.allowOverride = false;
          next.bindingMode = "scalar-actor";
          next.contextSource = ["actor", "evaluation-subject"].includes(
            next.contextSource,
          )
            ? next.contextSource
            : "actor";
          next.isTableField = false;
          next.linkGroupKey = "";
          next.tableKey = "";
          next.tableLabel = "";
        }
        return next;
      }),
    }));
  };

  const reset = () => {
    setEditor(emptyEditor);
    setSourceLink("");
    fileRef.current = null;
  };

  const scanTemplate = async () => {
    if (!editor.templateName.trim()) {
      toast({
        message: "Nhập tên biểu mẫu trước khi quét.",
        title: "Thiếu tên biểu mẫu",
        tone: "warning",
      });
      return;
    }
    const form = new FormData();
    form.set("importMode", editor.importMode);
    form.set("templateName", editor.templateName);
    if (editor.importMode === "link") form.set("sourceLink", sourceLink);
    if (editor.importMode === "file" && fileRef.current) {
      form.set("file", fileRef.current);
    }
    setBusy("Đang nạp file lên Drive và quét toàn bộ placeholder...");
    setProgress(18);
    let progressTimer: number | undefined;
    try {
      progressTimer = window.setInterval(
        () => setProgress((value) => Math.min(value + 8, 88)),
        700,
      );
      const response = await fetch("/api/templates/import", {
        body: form,
        method: "POST",
      });
      const body = (await response.json()) as RpcResponse<{
        scanResult: TemplateScanResult;
        source: TemplateSourceInfo;
      }>;
      if (!response.ok || !body.ok || !body.result) {
        throw new Error(body.message || "Không quét được biểu mẫu.");
      }
      setProgress(100);
      setEditor((current) => ({
        ...current,
        fields: body.result!.scanResult.fields.map(
          (field) => field.defaultConfig,
        ),
        scanMeta: body.result!.scanResult,
        source: body.result!.source,
      }));
      toast({
        message: `Đã nhận ${body.result.scanResult.fieldCount} trường tại ${body.result.scanResult.placeholderCount} vị trí.`,
        title: "Quét biểu mẫu thành công",
        tone: "success",
      });
    } catch (error) {
      toast({
        message:
          error instanceof Error ? error.message : "Không quét được biểu mẫu.",
        title: "Không hoàn tất thao tác",
        tone: "error",
      });
    } finally {
      if (progressTimer != null) {
        window.clearInterval(progressTimer);
      }
      window.setTimeout(() => {
        setBusy("");
        setProgress(0);
      }, 350);
    }
  };

  const save = async (mode: "format" | "template" = "template") => {
    if (!editor.templateName.trim() || !editor.fields.length) {
      toast({
        message: "Cần tên biểu mẫu và danh sách trường đã quét.",
        title: "Chưa đủ dữ liệu",
        tone: "warning",
      });
      return;
    }
    setBusy(
      mode === "format"
        ? "Đang lưu toàn bộ định dạng trường vào PostgreSQL..."
        : "Dữ liệu đang được ghi vào PostgreSQL...",
    );
    setProgress(45);
    try {
      const result = await templateRpc<{
        savedRecord: TemplateRecord;
        snapshot: TemplateManagementSnapshot;
      }>("saveTemplateConfig", {
        ...editor.source,
        fields: editor.fields,
        id: editor.id,
        importMode: editor.importMode,
        numberingCustomTextFieldId: editor.numberingCustomTextFieldId,
        numberingDocumentNumberFieldId: editor.numberingDocumentNumberFieldId,
        numberingDocumentTypeId: editor.numberingDocumentTypeId,
        numberingSignDateFieldId: editor.numberingSignDateFieldId,
        scanMeta: editor.scanMeta,
        status: editor.status,
        templateName: editor.templateName,
      });
      setProgress(100);
      setSnapshot(result.snapshot);
      setEditor(editorFromRecord(result.savedRecord));
      setSourceLink(result.savedRecord.sourceLink);
      toast({
        message:
          mode === "format"
            ? `Đã lưu định dạng của ${result.savedRecord.fieldCount} trường và đồng bộ sang Module Biểu mẫu.`
            : `${result.savedRecord.fieldCount} trường đã sẵn sàng cho người dùng.`,
        title: mode === "format" ? "Đã lưu định dạng" : "Đã lưu biểu mẫu",
        tone: "success",
      });
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không lưu được.",
        title: "Không hoàn tất thao tác",
        tone: "error",
      });
    } finally {
      window.setTimeout(() => {
        setBusy("");
        setProgress(0);
      }, 350);
    }
  };

  const changeStatus = async (record: TemplateRecord) => {
    const status = record.status === "Vô hiệu" ? "Kích hoạt" : "Vô hiệu";
    setBusy(
      `Đang ${status === "Kích hoạt" ? "kích hoạt" : "tạm khóa"} biểu mẫu...`,
    );
    try {
      setSnapshot(
        await templateRpc<TemplateManagementSnapshot>("setTemplateStatus", {
          id: record.id,
          status,
        }),
      );
      toast({
        message: `${record.templateName}: ${status}.`,
        title: "Đã cập nhật trạng thái",
        tone: "success",
      });
    } catch (error) {
      toast({
        message:
          error instanceof Error ? error.message : "Không cập nhật được.",
        title: "Không hoàn tất thao tác",
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  };

  const deleteHistory = async (id: string) => {
    const reason = window.prompt("Nhập lý do xóa lịch sử tạo file:");
    if (!reason?.trim()) return;
    setBusy("Đang xóa file đầu ra và lịch sử trên PostgreSQL...");
    try {
      setSnapshot(
        await templateRpc<TemplateManagementSnapshot>("deleteTemplateHistory", {
          id,
          reason,
        }),
      );
      toast({
        title: "Đã xóa lịch sử và file đầu ra",
        tone: "success",
      });
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không xóa được.",
        title: "Không hoàn tất thao tác",
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <WriteLoadingOverlay
        message={
          busy
            ? `${busy}${progress ? ` · ${progress}%` : ""}`
            : "Đang xử lý Biểu mẫu..."
        }
        show={Boolean(busy)}
      />
      <section className="mb-5 flex flex-wrap items-start justify-end gap-4">
        <div className="flex flex-wrap gap-2">
          <Link
            className="ui-button ui-button--secondary"
            href="/nguoi-thuan-viet/bieu-mau"
          >
            <FileText size={17} />
            Mở Biểu mẫu người dùng
          </Link>
          <Button onClick={reset} variant="secondary">
            <RotateCcw size={17} />
            Biểu mẫu mới
          </Button>
          <Button onClick={() => void save("template")}>
            <Save size={17} />
            Lưu biểu mẫu
          </Button>
        </div>
      </section>

      <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-border bg-surface p-2 shadow-[0_10px_24px_rgba(17,45,39,0.05)]">
        <button
          className={`ui-button ${tab === "definition" ? "ui-button--primary" : "ui-button--secondary"}`}
          onClick={() => setTab("definition")}
          type="button"
        >
          <FileSearch size={17} />
          Định nghĩa biểu mẫu
        </button>
        <button
          className={`ui-button ${tab === "history" ? "ui-button--primary" : "ui-button--secondary"}`}
          onClick={() => setTab("history")}
          type="button"
        >
          <History size={17} />
          Lịch sử tạo file · {snapshot.history.length}
        </button>
      </div>

      {tab === "history" ? (
        <section className="ui-module-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-accent">
                PostgreSQL + Google Drive
              </div>
              <h2 className="mt-1 text-xl font-extrabold text-primary">
                Lịch sử tạo file
              </h2>
            </div>
            <FileClock className="text-accent" />
          </div>
          <div className="overflow-auto rounded-2xl border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Biểu mẫu</th>
                  <th className="px-4 py-3">Người tạo</th>
                  <th className="px-4 py-3">Thời gian</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.history.map((item) => (
                  <tr className="border-t border-border" key={item.id}>
                    <td className="px-4 py-3 font-bold text-primary">
                      <div>{item.templateName}</div>
                      {item.documentNumber ? (
                        <div className="mt-1 font-mono text-xs text-accent">
                          {item.documentNumber}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {item.createdBy || item.employeeCode || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(item.createdAt).toLocaleString("vi-VN")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {item.outputUrl ? (
                          <a
                            className="ui-icon-button"
                            href={item.outputUrl}
                            rel="noreferrer"
                            target="_blank"
                            title="Mở file"
                          >
                            <ExternalLink size={16} />
                          </a>
                        ) : null}
                        <button
                          className="ui-icon-button text-danger"
                          onClick={() => deleteHistory(item.id)}
                          title="Xóa lịch sử"
                          type="button"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!snapshot.history.length ? (
              <div className="p-8 text-center text-sm text-muted">
                Chưa có file nào được tạo.
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_390px]">
          <main className="space-y-5">
            <section className="ui-module-panel p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-accent">
                    Bước 1
                  </div>
                  <h2 className="mt-1 text-xl font-extrabold text-primary">
                    Nạp và quét file nguồn
                  </h2>
                </div>
                {editor.source.workingFileUrl ? (
                  <a
                    className="ui-button ui-button--secondary"
                    href={editor.source.workingFileUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink size={16} />
                    Mở bản làm việc
                  </a>
                ) : null}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="ui-module-field lg:col-span-2">
                  <span className="ui-module-label">Tên biểu mẫu *</span>
                  <Input
                    onChange={(event) =>
                      setEditor((current) => ({
                        ...current,
                        templateName: event.target.value,
                      }))
                    }
                    placeholder="Ví dụ: Phiếu đề nghị xuất kho"
                    value={editor.templateName}
                  />
                </label>
                <section className="lg:col-span-2 rounded-2xl border border-primary/10 bg-[linear-gradient(145deg,#fffaf4,#f5f9f7)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                        <Hash size={18} />
                      </div>
                      <div>
                        <div className="font-extrabold text-primary">
                          Đánh số hồ sơ tự động
                        </div>
                        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                          Biểu mẫu kế thừa vòng lặp, định dạng và số bắt đầu
                          riêng của từng pháp nhân từ Cấu hình loại hồ sơ.
                        </p>
                      </div>
                    </div>
                    {selectedDocumentType ? (
                      <Badge tone="success">
                        {selectedDocumentType.companyRuleCount} pháp nhân có số
                        riêng
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Không cấp số</Badge>
                    )}
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="ui-module-field md:col-span-2">
                      <span className="ui-module-label">
                        Loại hồ sơ kế thừa
                      </span>
                      <Select
                        onChange={(event) =>
                          setEditor((current) => ({
                            ...current,
                            fields: current.fields.map((field) =>
                              !field.isTableField &&
                              field.datasetKey === "system" &&
                              field.sourceFieldKey === "documentNumber"
                                ? {
                                    ...field,
                                    bindingMode: "manual",
                                    contextSource: "",
                                    datasetKey: "",
                                    isSystemField: false,
                                    sourceFieldKey: "",
                                  }
                                : field,
                            ),
                            numberingCustomTextFieldId: "",
                            numberingDocumentNumberFieldId: "",
                            numberingDocumentTypeId: event.target.value,
                            numberingSignDateFieldId: "",
                          }))
                        }
                        value={editor.numberingDocumentTypeId}
                      >
                        <option value="">Không cấp số cho biểu mẫu này</option>
                        {snapshot.documentTypeOptions.map((documentType) => (
                          <option key={documentType.id} value={documentType.id}>
                            {documentType.name}
                            {documentType.cycle
                              ? ` · ${documentType.cycle}`
                              : ""}
                          </option>
                        ))}
                      </Select>
                    </label>

                    {selectedDocumentType ? (
                      <>
                        <label className="ui-module-field md:col-span-2">
                          <span className="ui-module-label">
                            Vị trí nhận số trong file *
                          </span>
                          <Select
                            onChange={(event) =>
                              assignDocumentNumberField(event.target.value)
                            }
                            value={editor.numberingDocumentNumberFieldId}
                          >
                            <option value="">
                              Chọn placeholder sẽ được thay bằng số văn bản
                            </option>
                            {scalarFieldOptions.map((field) => (
                              <option key={field.fieldId} value={field.fieldId}>
                                {`{${field.placeholder}}`}
                                {field.positionLabel
                                  ? ` · ${field.positionLabel}`
                                  : ` · Vị trí ${field.scanOrder}`}
                              </option>
                            ))}
                          </Select>
                          <small className="mt-1 text-xs leading-5 text-muted">
                            Hệ thống thay đúng placeholder đã chọn trên file
                            Word/Excel; không tự đoán theo tọa độ hay nội dung
                            gần đó.
                          </small>
                        </label>

                        <label className="ui-module-field">
                          <span className="ui-module-label">
                            Trường ngày cấp số
                          </span>
                          <Select
                            onChange={(event) =>
                              setEditor((current) => ({
                                ...current,
                                numberingSignDateFieldId: event.target.value,
                              }))
                            }
                            value={editor.numberingSignDateFieldId}
                          >
                            <option value="">Dùng ngày tạo file</option>
                            {scalarFieldOptions.map((field) => (
                              <option key={field.fieldId} value={field.fieldId}>
                                {field.manualLabel || field.placeholder}
                              </option>
                            ))}
                          </Select>
                        </label>

                        {selectedDocumentType.requiresCustomText ? (
                          <label className="ui-module-field">
                            <span className="ui-module-label">
                              Trường cho Cụm tự định nghĩa *
                            </span>
                            <Select
                              onChange={(event) =>
                                setEditor((current) => ({
                                  ...current,
                                  numberingCustomTextFieldId:
                                    event.target.value,
                                }))
                              }
                              value={editor.numberingCustomTextFieldId}
                            >
                              <option value="">
                                Chọn trường cung cấp nội dung
                              </option>
                              {scalarFieldOptions.map((field) => (
                                <option
                                  key={field.fieldId}
                                  value={field.fieldId}
                                >
                                  {field.manualLabel || field.placeholder}
                                </option>
                              ))}
                            </Select>
                          </label>
                        ) : null}

                        <div
                          className={`md:col-span-2 rounded-xl border px-3 py-2 text-xs font-bold leading-5 ${
                            hasDocumentNumberField
                              ? "border-[#19865f]/20 bg-[#edf9f4] text-[#17664a]"
                              : "border-accent/25 bg-accent-soft text-primary"
                          }`}
                        >
                          {hasDocumentNumberField
                            ? `Số văn bản sẽ được điền đúng vào {${selectedDocumentNumberField?.placeholder || ""}}. Bản PDF nháp dùng số dự kiến; số thật chỉ được cấp khi tạo file hoàn chỉnh.`
                            : "Chưa chọn vị trí nhận số. Nếu file chưa có ô phù hợp, hãy thêm một placeholder như {Số văn bản} vào file nguồn rồi quét lại."}
                        </div>
                      </>
                    ) : null}
                  </div>
                </section>
                <button
                  className={`flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left transition ${editor.importMode === "link" ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}
                  onClick={() =>
                    setEditor((current) => ({
                      ...current,
                      importMode: "link",
                    }))
                  }
                  type="button"
                >
                  <Link2 className="text-accent" />
                  <span>
                    <strong className="block text-primary">
                      Nạp link Drive
                    </strong>
                    <small className="text-muted">
                      Word, Excel, Docs hoặc Sheets
                    </small>
                  </span>
                </button>
                <button
                  className={`flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left transition ${editor.importMode === "file" ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}
                  onClick={() =>
                    setEditor((current) => ({
                      ...current,
                      importMode: "file",
                    }))
                  }
                  type="button"
                >
                  <Upload className="text-accent" />
                  <span>
                    <strong className="block text-primary">Nạp file mới</strong>
                    <small className="text-muted">Tối đa 20 MB</small>
                  </span>
                </button>
                {editor.importMode === "link" ? (
                  <label className="ui-module-field lg:col-span-2">
                    <span className="ui-module-label">Link biểu mẫu *</span>
                    <Input
                      onChange={(event) => setSourceLink(event.target.value)}
                      placeholder="Dán link Google Drive"
                      value={sourceLink}
                    />
                  </label>
                ) : (
                  <div className="lg:col-span-2">
                    <FilePicker
                      accept=".doc,.docx,.xls,.xlsx"
                      maxFileSizeBytes={20 * 1024 * 1024}
                      maxFiles={1}
                      onFilesChange={(files) => {
                        fileRef.current = files[0] || null;
                      }}
                      triggerLabel="Chọn file Word hoặc Excel"
                      triggerStyle="dashed"
                    />
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-primary/15 bg-surface-muted/60 p-4">
                <div className="flex items-center gap-3">
                  {editor.fields.length ? (
                    <CheckCircle2 className="text-[#19865f]" />
                  ) : (
                    <FileSearch className="text-accent" />
                  )}
                  <div>
                    <div className="font-bold text-primary">
                      {editor.fields.length
                        ? `${editor.fields.length} trường đã nhận diện`
                        : "Chưa quét biểu mẫu"}
                    </div>
                    <div className="text-xs text-muted">
                      Hệ thống tự dò placeholder dạng {"{Tên trường}"}.
                    </div>
                  </div>
                </div>
                <Button onClick={scanTemplate} variant="secondary">
                  <RefreshCw size={16} />
                  Quét biểu mẫu
                </Button>
              </div>
            </section>

            <section className="ui-module-panel p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-accent">
                    Bước 2
                  </div>
                  <h2 className="mt-1 text-xl font-extrabold text-primary">
                    Thành phần và định dạng
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{editor.fields.length} trường</Badge>
                  <Button
                    disabled={!editor.fields.length}
                    onClick={() => void save("format")}
                    size="sm"
                    variant="secondary"
                  >
                    <Save size={15} />
                    Lưu định dạng
                  </Button>
                </div>
              </div>
              <div className="space-y-4">
                {editor.fields.length ? (
                  <div className="rounded-2xl border border-[#b7dfd1] bg-[#eff9f5] px-4 py-3 text-sm leading-6 text-primary">
                    <strong>Ngữ cảnh thông minh:</strong> mỗi trường có thể lấy
                    dữ liệu của người đang thao tác, nhân sự được đánh giá,
                    người nhận mail/người chấm, quản lý hoặc công ty của đúng
                    nhân sự. Khi mở Biểu mẫu độc lập, các ngữ cảnh chưa được
                    truyền vào sẽ an toàn quay về người đang đăng nhập.
                  </div>
                ) : null}
                {editor.fields.map((field, fieldIndex) => {
                  const selectors = editor.fields.filter(
                    (candidate) =>
                      candidate.fieldId !== field.fieldId &&
                      candidate.datasetKey === field.datasetKey &&
                      candidate.tableKey === field.tableKey &&
                      ["scalar-selector", "table-selector"].includes(
                        candidate.bindingMode,
                      ),
                  );
                  const availableContexts = contextSourceOptions(
                    snapshot,
                    field.datasetKey,
                  ).filter(
                    (option) =>
                      !isSensitiveEmployeeFieldKey(field.sourceFieldKey) ||
                      ["actor", "evaluation-subject"].includes(option.key),
                  );
                  const selectedContext = availableContexts.find(
                    (option) => option.key === field.contextSource,
                  );
                  const selectedEmployeeField = employeeFieldOption(
                    snapshot,
                    field.datasetKey,
                    field.sourceFieldKey,
                  );
                  const isSensitiveEmployeeField = Boolean(
                    selectedEmployeeField?.sensitive ||
                    (field.datasetKey === "employee" &&
                      isSensitiveEmployeeFieldKey(field.sourceFieldKey)),
                  );
                  const bindingOptions = (
                    field.isTableField
                      ? snapshot.tableBindingModes
                      : snapshot.scalarBindingModes
                  ).filter(
                    (option) =>
                      !isSensitiveEmployeeField ||
                      option.key === "scalar-actor",
                  );
                  return (
                    <article
                      className="rounded-3xl border border-primary/10 bg-white p-4 shadow-[0_12px_28px_rgba(17,45,39,0.06)]"
                      key={field.fieldId}
                    >
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-extrabold text-primary">
                              {field.placeholder}
                            </h3>
                            <Badge
                              tone={field.isTableField ? "warning" : "neutral"}
                            >
                              {field.isTableField ? "Bảng lặp" : "Trường đơn"}
                            </Badge>
                            <Badge
                              tone={field.isSystemField ? "success" : "info"}
                            >
                              {formatBadge(field)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {field.rawToken} ·{" "}
                            {field.positionLabel || `Vị trí ${field.scanOrder}`}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button
                            aria-label="Đưa trường lên"
                            className="ui-icon-button"
                            disabled={fieldIndex === 0}
                            onClick={() =>
                              setEditor((current) => {
                                const fields = [...current.fields];
                                [fields[fieldIndex - 1], fields[fieldIndex]] = [
                                  fields[fieldIndex],
                                  fields[fieldIndex - 1],
                                ];
                                return {
                                  ...current,
                                  fields: fields.map((item, index) => ({
                                    ...item,
                                    scanOrder: index + 1,
                                  })),
                                };
                              })
                            }
                            type="button"
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            aria-label="Đưa trường xuống"
                            className="ui-icon-button"
                            disabled={fieldIndex === editor.fields.length - 1}
                            onClick={() =>
                              setEditor((current) => {
                                const fields = [...current.fields];
                                [fields[fieldIndex + 1], fields[fieldIndex]] = [
                                  fields[fieldIndex],
                                  fields[fieldIndex + 1],
                                ];
                                return {
                                  ...current,
                                  fields: fields.map((item, index) => ({
                                    ...item,
                                    scanOrder: index + 1,
                                  })),
                                };
                              })
                            }
                            type="button"
                          >
                            <ArrowDown size={15} />
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-surface-muted/50 px-4 text-sm font-bold text-primary">
                          <input
                            checked={field.isTableField}
                            className="size-4 accent-[var(--accent)]"
                            onChange={(event) =>
                              patchField(field.fieldId, {
                                isTableField: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          Nằm trong bảng nhiều dòng
                        </label>
                        <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-surface-muted/50 px-4 text-sm font-bold text-primary">
                          <input
                            checked={field.isSystemField}
                            className="size-4 accent-[var(--accent)]"
                            onChange={(event) =>
                              patchField(field.fieldId, {
                                isSystemField: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          Lấy từ dữ liệu hệ thống
                        </label>
                        {field.isTableField ? (
                          <>
                            <label className="ui-module-field">
                              <span className="ui-module-label">
                                Tên nhóm bảng
                              </span>
                              <Input
                                onChange={(event) =>
                                  patchField(field.fieldId, {
                                    tableKey: event.target.value,
                                  })
                                }
                                value={field.tableKey}
                              />
                            </label>
                            <label className="ui-module-field">
                              <span className="ui-module-label">Nhãn bảng</span>
                              <Input
                                onChange={(event) =>
                                  patchField(field.fieldId, {
                                    tableLabel: event.target.value,
                                  })
                                }
                                value={field.tableLabel}
                              />
                            </label>
                          </>
                        ) : null}
                        {field.isSystemField ? (
                          <>
                            <label className="ui-module-field">
                              <span className="ui-module-label">
                                Nguồn dữ liệu
                              </span>
                              <Select
                                onChange={(event) =>
                                  patchField(field.fieldId, {
                                    datasetKey: event.target
                                      .value as TemplateDatasetKey,
                                  })
                                }
                                value={field.datasetKey}
                              >
                                <option value="">Chọn nguồn</option>
                                {snapshot.datasetOptions.map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {option.label}
                                  </option>
                                ))}
                              </Select>
                            </label>
                            <label className="ui-module-field">
                              <span className="ui-module-label">
                                Thành phần
                              </span>
                              <Select
                                onChange={(event) =>
                                  patchField(field.fieldId, {
                                    sourceFieldKey: event.target.value,
                                  })
                                }
                                value={field.sourceFieldKey}
                              >
                                <option value="">Chọn thành phần</option>
                                {sourceOptions(snapshot, field.datasetKey).map(
                                  (option) => (
                                    <option key={option.key} value={option.key}>
                                      {option.label}
                                      {employeeFieldOption(
                                        snapshot,
                                        field.datasetKey,
                                        option.key,
                                      )?.sensitive
                                        ? " · Nhạy cảm"
                                        : ""}
                                    </option>
                                  ),
                                )}
                              </Select>
                            </label>
                            {isSensitiveEmployeeField ? (
                              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 md:col-span-2">
                                <strong>Dữ liệu nhạy cảm:</strong>{" "}
                                {selectedEmployeeField?.description ||
                                  "Trường này chỉ tự điền từ hồ sơ người đang thao tác hoặc đúng nhân sự của phiếu đánh giá; không dùng để tra cứu nhân sự tùy ý."}
                              </div>
                            ) : null}
                            {!field.isTableField &&
                            [
                              "employee",
                              "company",
                              "evaluationResult",
                              "system",
                            ].includes(field.datasetKey) ? (
                              <label className="ui-module-field md:col-span-2">
                                <span className="ui-module-label">
                                  Ngữ cảnh dữ liệu
                                </span>
                                <Select
                                  onChange={(event) =>
                                    patchField(field.fieldId, {
                                      contextSource: event.target
                                        .value as TemplateContextSource,
                                    })
                                  }
                                  value={field.contextSource}
                                >
                                  <option value="">Theo cấu hình cũ</option>
                                  {availableContexts.map((option) => (
                                    <option key={option.key} value={option.key}>
                                      {option.label}
                                    </option>
                                  ))}
                                </Select>
                                <small className="text-xs leading-5 text-muted">
                                  {selectedContext?.description ||
                                    "Giữ cách lấy dữ liệu tương thích với biểu mẫu cũ."}
                                </small>
                              </label>
                            ) : null}
                            <label className="ui-module-field">
                              <span className="ui-module-label">Cách điền</span>
                              <Select
                                onChange={(event) =>
                                  patchField(field.fieldId, {
                                    bindingMode: event.target
                                      .value as TemplateFieldConfig["bindingMode"],
                                  })
                                }
                                value={field.bindingMode}
                              >
                                {bindingOptions.map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {option.label}
                                  </option>
                                ))}
                                {field.datasetKey === "system" ? (
                                  <option value="scalar-system">
                                    Giá trị hệ thống
                                  </option>
                                ) : null}
                                {field.datasetKey === "evaluationResult" ? (
                                  <option value="scalar-system">
                                    Kết quả đánh giá tự động
                                  </option>
                                ) : null}
                              </Select>
                            </label>
                            {["scalar-linked", "table-linked"].includes(
                              field.bindingMode,
                            ) && field.datasetKey !== "system" ? (
                              <label className="ui-module-field">
                                <span className="ui-module-label">
                                  Liên kết theo trường chọn
                                </span>
                                <Select
                                  onChange={(event) =>
                                    patchField(field.fieldId, {
                                      linkGroupKey: event.target.value,
                                    })
                                  }
                                  value={field.linkGroupKey}
                                >
                                  <option value="">
                                    Tự dò trong cùng nhóm
                                  </option>
                                  {selectors.map((selector) => (
                                    <option
                                      key={selector.fieldId}
                                      value={selector.fieldId}
                                    >
                                      {selector.manualLabel}
                                    </option>
                                  ))}
                                </Select>
                              </label>
                            ) : null}
                            <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-surface-muted/50 px-4 text-sm font-bold text-primary">
                              <input
                                checked={field.allowOverride}
                                className="size-4 accent-[var(--accent)]"
                                disabled={isSensitiveEmployeeField}
                                onChange={(event) =>
                                  patchField(field.fieldId, {
                                    allowOverride: event.target.checked,
                                  })
                                }
                                type="checkbox"
                              />
                              {isSensitiveEmployeeField
                                ? "Không cho sửa dữ liệu nhạy cảm"
                                : "Cho phép sửa giá trị ở màn Biểu mẫu trước khi merge"}
                            </label>
                          </>
                        ) : (
                          <>
                            <label className="ui-module-field">
                              <span className="ui-module-label">
                                Nhãn hiển thị
                              </span>
                              <Input
                                onChange={(event) =>
                                  patchField(field.fieldId, {
                                    manualLabel: event.target.value,
                                  })
                                }
                                value={field.manualLabel}
                              />
                            </label>
                            <label className="ui-module-field">
                              <span className="ui-module-label">Kiểu nhập</span>
                              <Select
                                onChange={(event) =>
                                  patchField(field.fieldId, {
                                    manualInputType: event.target
                                      .value as TemplateFieldConfig["manualInputType"],
                                  })
                                }
                                value={field.manualInputType}
                              >
                                {snapshot.manualInputTypes.map((option) => (
                                  <option key={option.key} value={option.key}>
                                    {option.label}
                                  </option>
                                ))}
                              </Select>
                            </label>
                            {field.manualInputType === "select" ? (
                              <label className="ui-module-field md:col-span-2">
                                <span className="ui-module-label">
                                  Các lựa chọn
                                </span>
                                <Input
                                  onChange={(event) =>
                                    patchField(field.fieldId, {
                                      options: event.target.value
                                        .split("|")
                                        .map((item) => item.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                  placeholder="Lựa chọn 1 | Lựa chọn 2"
                                  value={field.options.join(" | ")}
                                />
                              </label>
                            ) : null}
                            {field.manualInputType === "formula" ? (
                              <label className="ui-module-field md:col-span-2">
                                <span className="ui-module-label">
                                  Công thức phụ thuộc
                                </span>
                                <Input
                                  onChange={(event) =>
                                    patchField(field.fieldId, {
                                      formulaExpression: event.target.value,
                                    })
                                  }
                                  placeholder="{Số lượng} x {Đơn giá}"
                                  value={field.formulaExpression}
                                />
                              </label>
                            ) : null}
                          </>
                        )}
                        <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-surface-muted/50 px-4 text-sm font-bold text-primary">
                          <input
                            checked={field.required}
                            className="size-4 accent-[var(--accent)]"
                            onChange={(event) =>
                              patchField(field.fieldId, {
                                required: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          Bắt buộc nhập
                        </label>
                        <FieldFormatToolbar
                          field={field}
                          onChange={(formatPatch) =>
                            patchField(field.fieldId, {
                              format: { ...field.format, ...formatPatch },
                            })
                          }
                        />
                      </div>
                    </article>
                  );
                })}
                {!editor.fields.length ? (
                  <div className="grid min-h-56 place-items-center rounded-3xl border border-dashed border-border bg-surface-muted/40 p-8 text-center">
                    <div>
                      <FileText className="mx-auto text-accent" size={36} />
                      <h3 className="mt-3 font-extrabold text-primary">
                        Quét file để bắt đầu định nghĩa
                      </h3>
                      <p className="mt-1 text-sm text-muted">
                        Mã SKU, Tên sản phẩm và STT tự động sẽ được gợi ý ngay
                        khi hệ thống nhận ra placeholder tương ứng.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
              {editor.fields.length ? (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <p className="max-w-2xl text-xs leading-5 text-muted">
                    Lưu định dạng sẽ ghi toàn bộ kiểu chữ, màu, căn lề, khung,
                    tiền tố và hậu tố của các trường; Module Biểu mẫu người dùng
                    nhận thay đổi ngay ở lần mở tiếp theo.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void save("format")}
                      variant="secondary"
                    >
                      <Save size={16} />
                      Lưu định dạng
                    </Button>
                    <Button onClick={() => void save("template")}>
                      <CheckCircle2 size={16} />
                      Lưu và phát hành
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          </main>

          <aside className="space-y-5 xl:sticky xl:top-4 xl:self-start">
            <section className="ui-module-panel p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-accent">
                    Mẫu đã định nghĩa
                  </div>
                  <h2 className="mt-1 text-lg font-extrabold text-primary">
                    {snapshot.templates.length} biểu mẫu
                  </h2>
                </div>
                <ListFilter className="text-accent" />
              </div>
              <label className="relative block">
                <Search
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-accent"
                  size={17}
                />
                <Input
                  className="pl-11"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm biểu mẫu"
                  value={search}
                />
              </label>
              <div className="mt-3 max-h-[720px] space-y-3 overflow-auto pr-1">
                {visibleTemplates.map((record) => (
                  <article
                    className={`rounded-2xl border p-4 transition ${
                      editor.id === record.id
                        ? "border-accent bg-accent-soft"
                        : "border-border bg-white"
                    }`}
                    key={record.id}
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary">
                        {record.fileType === "spreadsheet" ? (
                          <FileSpreadsheet size={20} />
                        ) : (
                          <FileText size={20} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-primary">
                          {record.templateName}
                        </h3>
                        <p className="mt-1 truncate text-xs text-muted">
                          {record.sourceFileName || record.workingFileName}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Badge
                            tone={
                              record.status === "Vô hiệu"
                                ? "neutral"
                                : "success"
                            }
                          >
                            {record.status}
                          </Badge>
                          <Badge tone="info">{record.fieldCount} trường</Badge>
                          {record.numbering.documentTypeId ? (
                            <>
                              <Badge tone="warning">
                                Cấp số · {record.numbering.documentTypeName}
                              </Badge>
                              <Badge tone="info">
                                {record.numbering.documentNumberPlaceholder
                                  ? `{${record.numbering.documentNumberPlaceholder}}`
                                  : "Chưa chọn vị trí nhận số"}
                              </Badge>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Button
                        className="px-2"
                        onClick={() => {
                          setEditor(editorFromRecord(record));
                          setSourceLink(record.sourceLink);
                          window.scrollTo({ behavior: "smooth", top: 0 });
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        Sửa
                      </Button>
                      <button
                        className="ui-icon-button mx-auto"
                        onClick={() => changeStatus(record)}
                        title={
                          record.status === "Vô hiệu" ? "Kích hoạt" : "Tạm khóa"
                        }
                        type="button"
                      >
                        <Archive size={16} />
                      </button>
                      {record.workingFileUrl ? (
                        <a
                          className="ui-icon-button mx-auto"
                          href={record.workingFileUrl}
                          rel="noreferrer"
                          target="_blank"
                          title="Mở file"
                        >
                          <ExternalLink size={16} />
                        </a>
                      ) : (
                        <span />
                      )}
                    </div>
                  </article>
                ))}
                {!visibleTemplates.length ? (
                  <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
                    Không tìm thấy biểu mẫu phù hợp.
                  </div>
                ) : null}
              </div>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
