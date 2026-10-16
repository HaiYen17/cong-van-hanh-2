import "server-only";

import { randomBytes } from "node:crypto";

import { GoogleAuth, Impersonated, OAuth2Client } from "google-auth-library";

import { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  issueDocumentNumber,
  previewDocumentNumber,
} from "@/lib/document-issue";
import { getDriveFolders, parseDriveId } from "@/lib/drive";
import {
  buildEmployeeTemplateValues,
  EMPLOYEE_TEMPLATE_FIELD_OPTIONS,
  enforceSensitiveEmployeeFieldPolicy,
  formatTemplateDateValue,
  isSensitiveEmployeeFieldKey,
  sensitiveEmployeeFieldPolicyViolation,
} from "@/lib/templates/employee-fields";
import {
  deleteStoredTemplatePdf,
  storeTemplatePdf,
} from "@/lib/templates/pdf-storage";
import {
  buildEvaluationTemplateValues,
  evaluationTemplateSourceKey,
  type EvaluationTemplateField,
} from "@/lib/templates/evaluation-context";
import type {
  TemplateBindingMode,
  TemplateContextSource,
  TemplateDatasetKey,
  TemplateExecutionContext,
  TemplateFieldConfig,
  TemplateFieldDefinition,
  TemplateFieldFormat,
  TemplateFileType,
  TemplateFormDefinition,
  TemplateHistoryRecord,
  TemplateImportMode,
  TemplateInputType,
  TemplateLookupRecord,
  TemplateManagementSnapshot,
  TemplateOutputPayload,
  TemplateOutputResult,
  TemplateRecord,
  TemplateScanField,
  TemplateScanHint,
  TemplateScanOccurrence,
  TemplateScanResult,
  TemplateSourceInfo,
  TemplateTableGroupDefinition,
  TemplateWorkspaceSnapshot,
} from "@/lib/templates/types";

const TEMPLATE_FOLDER_FALLBACK = "13YQ3-pb9KBNIBvw-6nF_V9u2Ge_oGuQx";
const MAX_TEMPLATE_FILE_BYTES = 20 * 1024 * 1024;
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TEMPLATE_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];
const templateGoogleSourceAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
let templateGoogleClient: Impersonated | OAuth2Client | undefined;

async function getTemplateGoogleClient() {
  if (templateGoogleClient) return templateGoogleClient;
  const localQaAccessToken =
    process.env.NODE_ENV === "production"
      ? ""
      : text(process.env.TEMPLATE_GOOGLE_ACCESS_TOKEN);
  if (localQaAccessToken) {
    const localClient = new OAuth2Client();
    localClient.setCredentials({ access_token: localQaAccessToken });
    templateGoogleClient = localClient;
    return templateGoogleClient;
  }
  const targetPrincipal =
    process.env.TEMPLATE_GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT ||
    "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";
  templateGoogleClient = new Impersonated({
    lifetime: 3600,
    sourceClient: await templateGoogleSourceAuth.getClient(),
    targetPrincipal,
    targetScopes: TEMPLATE_GOOGLE_SCOPES,
  });
  return templateGoogleClient;
}

const DATASET_OPTIONS: Array<{ key: TemplateDatasetKey; label: string }> = [
  { key: "employee", label: "Nhân sự hệ thống" },
  { key: "company", label: "Công ty hệ thống" },
  { key: "evaluationResult", label: "Kết quả đánh giá / CnB" },
  { key: "product", label: "Danh mục sản phẩm / SKU" },
  { key: "partnerCustomer", label: "Đối tượng / khách hàng" },
  { key: "system", label: "Biến hệ thống" },
];

const MANUAL_INPUT_TYPES: Array<{ key: TemplateInputType; label: string }> = [
  { key: "text", label: "Một dòng" },
  { key: "textarea", label: "Nhiều dòng" },
  { key: "number", label: "Số" },
  { key: "date", label: "Ngày" },
  { key: "money", label: "Số tiền" },
  { key: "email", label: "Email" },
  { key: "select", label: "Danh sách chọn" },
  { key: "formula", label: "Công thức phụ thuộc" },
];

const SCALAR_BINDING_MODES: Array<{
  key: TemplateBindingMode;
  label: string;
}> = [
  { key: "scalar-actor", label: "Tự điền theo ngữ cảnh" },
  { key: "scalar-company-context", label: "Theo công ty áp dụng" },
  { key: "scalar-selector", label: "Trường chọn nguồn" },
  { key: "scalar-linked", label: "Tự điền theo liên kết" },
];

const TABLE_BINDING_MODES: Array<{
  key: TemplateBindingMode;
  label: string;
}> = [
  { key: "table-manual", label: "Nhập tay" },
  { key: "table-selector", label: "Cột chọn nguồn" },
  { key: "table-linked", label: "Tự điền theo liên kết" },
];

const COMPANY_FIELDS = [
  { key: "shortName", label: "Tên rút gọn" },
  { key: "legalName", label: "Tên hiển thị" },
  { key: "fullLegalName", label: "Tên pháp lý đầy đủ" },
  { key: "branchName", label: "Tên pháp lý / chi nhánh đã cấu hình" },
  { key: "code", label: "Mã công ty" },
  { key: "taxCode", label: "Mã số thuế" },
  { key: "address", label: "Địa chỉ mới" },
  { key: "oldAddress", label: "Địa chỉ cũ" },
  { key: "representative", label: "Người đại diện" },
  { key: "representativeBirthDate", label: "Ngày sinh người đại diện" },
  { key: "representativeIdentityNumber", label: "CCCD người đại diện" },
  { key: "representativeIdentityDate", label: "Ngày cấp CCCD người đại diện" },
  { key: "representativeIdentityPlace", label: "Nơi cấp CCCD người đại diện" },
  { key: "businessRegistration", label: "Số ĐKKD" },
];

const PRODUCT_FIELDS = [
  { key: "sku", label: "Mã SKU" },
  { key: "name", label: "Tên sản phẩm" },
  { key: "barcode", label: "Mã vạch" },
  { key: "unit", label: "Đơn vị tính" },
  { key: "color", label: "Màu sắc" },
  { key: "size", label: "Kích thước" },
  { key: "salePrice", label: "Giá bán" },
  { key: "purchasePrice", label: "Giá mua" },
];

const PARTNER_CUSTOMER_FIELDS = [
  { key: "name", label: "Tên đối tượng / khách hàng" },
  { key: "code", label: "Mã đối tượng" },
  { key: "taxCode", label: "Mã số thuế" },
  { key: "address", label: "Địa chỉ" },
  { key: "representative", label: "Người đại diện" },
  { key: "phone", label: "Số điện thoại" },
  { key: "email", label: "Email" },
];

const SYSTEM_FIELDS = [
  { key: "documentNumber", label: "Số văn bản được cấp" },
  { key: "documentTypeName", label: "Loại hồ sơ đánh số" },
  { key: "currentDate", label: "Ngày hiện tại (DD)" },
  { key: "currentFullDate", label: "Ngày DD/MM/YYYY hiện tại" },
  { key: "currentMonth", label: "Tháng hiện tại" },
  { key: "currentYear", label: "Năm hiện tại" },
  { key: "currentDateTime", label: "Ngày giờ hiện tại" },
  { key: "currentUserName", label: "Người đăng nhập" },
  { key: "currentUserTitle", label: "Chức danh người đăng nhập" },
  { key: "currentUserDepartment", label: "Phòng ban người đăng nhập" },
  { key: "evaluationCycleName", label: "Tên kỳ đánh giá" },
  { key: "evaluationTypeName", label: "Loại đánh giá" },
  { key: "evaluationReviewerRole", label: "Vai trò người đánh giá" },
  { key: "evaluationDeadline", label: "Hạn hoàn thành đánh giá" },
  { key: "evaluationLink", label: "Link mở phiếu đánh giá" },
  { key: "rowNumber", label: "Số thứ tự dòng (STT)" },
];

const EVALUATION_RESULT_FIELDS = [
  { key: "evaluationConclusion", label: "Kết luận đánh giá" },
  { key: "evaluationFinalScore", label: "Điểm tổng cuối cùng" },
  { key: "evaluationHrComment", label: "Nhận xét của CnB" },
  { key: "evaluationFinalizedAt", label: "Thời điểm CnB chốt kết quả" },
  { key: "evaluationFinalizedBy", label: "Người CnB chốt kết quả" },
];

const CONTEXT_SOURCE_OPTIONS: TemplateManagementSnapshot["contextSourceOptions"] =
  [
    {
      datasetKeys: ["employee"],
      description: "Người đang đăng nhập hoặc thao tác tạo biểu mẫu.",
      key: "actor",
      label: "Người đang thao tác",
    },
    {
      datasetKeys: ["employee"],
      description: "Nhân sự là đối tượng chính của phiếu đánh giá.",
      key: "subject",
      label: "Nhân sự được đánh giá",
    },
    {
      datasetKeys: ["employee"],
      description:
        "Đúng nhân sự của phiếu đánh giá đang mở; cho phép điền các trường hồ sơ nhạy cảm vào biểu mẫu kết quả.",
      key: "evaluation-subject",
      label: "Nhân sự của phiếu đánh giá (đủ hồ sơ)",
    },
    {
      datasetKeys: ["employee"],
      description: "Người thực sự nhận mail hoặc đang đến lượt chấm.",
      key: "recipient",
      label: "Người nhận mail / người chấm",
    },
    {
      datasetKeys: ["employee"],
      description: "Quản lý trực tiếp của nhân sự được đánh giá.",
      key: "manager",
      label: "Quản lý trực tiếp",
    },
    {
      datasetKeys: ["company"],
      description: "Pháp nhân của người đang thao tác.",
      key: "actor-company",
      label: "Công ty của người thao tác",
    },
    {
      datasetKeys: ["company"],
      description: "Pháp nhân liên kết với nhân sự được đánh giá.",
      key: "subject-company",
      label: "Công ty của nhân sự được đánh giá",
    },
    {
      datasetKeys: ["company"],
      description: "Pháp nhân do người dùng chọn tại lúc điền biểu mẫu.",
      key: "selected-company",
      label: "Công ty áp dụng được chọn",
    },
    {
      datasetKeys: ["system"],
      description: "Ngày giờ và thông tin phiên đăng nhập hiện tại.",
      key: "system",
      label: "Hệ thống hiện tại",
    },
    {
      datasetKeys: ["system"],
      description:
        "Tên kỳ, loại, vai trò, deadline và link của phiếu đánh giá.",
      key: "evaluation",
      label: "Kỳ và phiếu đánh giá",
    },
    {
      datasetKeys: ["evaluationResult"],
      description:
        "Kết quả và câu trả lời CnB của đúng nhân sự được đánh giá; ưu tiên phiếu được truyền vào.",
      key: "evaluation",
      label: "Kết quả của nhân sự được đánh giá",
    },
  ];

export class TemplateRuntimeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TemplateRuntimeError";
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

type DriveFileMeta = {
  id: string;
  mimeType: string;
  name: string;
  parents?: string[];
  webViewLink?: string;
};

type TemplateActor = {
  companyId: string;
  department: string;
  displayName: string;
  employeeCode: string;
  employeeId: string;
  title: string;
  userId: string;
};

type TemplateContextRecords = {
  actor: TemplateLookupRecord;
  evaluationSubject?: TemplateLookupRecord;
  manager?: TemplateLookupRecord;
  recipient: TemplateLookupRecord;
  subject: TemplateLookupRecord;
};

type TemplateLookupBundle = {
  actor: TemplateActor;
  actorRecord: TemplateLookupRecord;
  context: TemplateExecutionContext;
  contextRecords: TemplateContextRecords;
  evaluationOptions: TemplateFormDefinition["evaluationOptions"];
  evaluationValues: Record<string, string>;
  lookupRecords: Partial<Record<TemplateDatasetKey, TemplateLookupRecord[]>>;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (["1", "true", "yes", "có"].includes(normalized)) return true;
  if (["0", "false", "no", "không"].includes(normalized)) return false;
  return fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseArray(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeForMatch(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findContentValue(content: JsonRecord, ...aliases: string[]) {
  for (const alias of aliases) {
    if (content[alias] != null && text(content[alias])) return content[alias];
  }
  const normalizedAliases = aliases.map(normalizeForMatch);
  for (const [key, value] of Object.entries(content)) {
    if (
      normalizedAliases.includes(normalizeForMatch(key)) &&
      value != null &&
      text(value)
    ) {
      return value;
    }
  }
  return undefined;
}

function safeColor(value: unknown, fallback = "") {
  const normalized = text(value);
  return /^#[0-9a-f]{6}$/i.test(normalized)
    ? normalized.toUpperCase()
    : fallback;
}

function companyTaxCode(value: unknown) {
  const raw = text(value).replace(/\s+/g, "");
  return /^\d{9}$/.test(raw) ? `0${raw}` : raw;
}

function normalizeFormat(value: unknown): TemplateFieldFormat {
  const source = asRecord(value);
  const alignment = text(source.alignment);
  const transform = text(source.transform);
  const dateFormat = text(source.dateFormat);
  const numberFormat = text(source.numberFormat);
  return {
    alignment: ["center", "left", "right"].includes(alignment)
      ? (alignment as TemplateFieldFormat["alignment"])
      : "left",
    backgroundColor: safeColor(source.backgroundColor, "#FFFFFF"),
    bold: booleanValue(source.bold),
    border: booleanValue(source.border),
    dateFormat: ["dd/mm/yyyy", "dd-mm-yyyy", "yyyy-mm-dd"].includes(dateFormat)
      ? (dateFormat as TemplateFieldFormat["dateFormat"])
      : "dd/mm/yyyy",
    fontFamily: text(source.fontFamily) || "Times New Roman",
    fontSize: Math.min(Math.max(numberValue(source.fontSize, 12), 7), 48),
    italic: booleanValue(source.italic),
    numberFormat: ["decimal", "integer", "none", "percent"].includes(
      numberFormat,
    )
      ? (numberFormat as TemplateFieldFormat["numberFormat"])
      : "none",
    prefix: text(source.prefix),
    suffix: text(source.suffix),
    textColor: safeColor(source.textColor, "#000000"),
    transform: ["lowercase", "none", "titlecase", "uppercase"].includes(
      transform,
    )
      ? (transform as TemplateFieldFormat["transform"])
      : "none",
    underline: booleanValue(source.underline),
  };
}

function normalizeScanHint(value: unknown): TemplateScanHint {
  const source = asRecord(value);
  return {
    columnIndex: numberValue(source.columnIndex),
    containerType: text(source.containerType),
    locationKey: text(source.locationKey),
    rowIndex: numberValue(source.rowIndex),
    sheetName: text(source.sheetName),
    tableKey: text(source.tableKey),
  };
}

function slugify(value: unknown) {
  return normalizeForMatch(value).replace(/\s+/g, "-") || "truong";
}

function defaultContextSource(
  datasetKey: TemplateDatasetKey,
  bindingMode: TemplateBindingMode,
  sourceFieldKey = "",
): TemplateContextSource {
  if (datasetKey === "employee" && bindingMode === "scalar-actor") {
    return "actor";
  }
  if (datasetKey === "company" && bindingMode === "scalar-company-context") {
    return "selected-company";
  }
  if (datasetKey === "system") {
    return sourceFieldKey.startsWith("evaluation") ? "evaluation" : "system";
  }
  if (datasetKey === "evaluationResult") return "evaluation";
  return "";
}

function normalizeContextSource(
  value: unknown,
  datasetKey: TemplateDatasetKey,
  bindingMode: TemplateBindingMode,
  sourceFieldKey = "",
) {
  const requested = text(value) as TemplateContextSource;
  const allowed = CONTEXT_SOURCE_OPTIONS.filter((option) =>
    option.datasetKeys.includes(datasetKey),
  ).map((option) => option.key);
  return allowed.includes(requested)
    ? requested
    : defaultContextSource(datasetKey, bindingMode, sourceFieldKey);
}

const KNOWN_TEMPLATE_PLACEHOLDER_BINDINGS: Record<
  string,
  Partial<TemplateFieldConfig>
> = {
  contract_end_date: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "date",
    sourceFieldKey: "evaluationCnb.CONTRACT_END_DATE",
  },
  contract_start_date: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "date",
    sourceFieldKey: "evaluationCnb.CONTRACT_START_DATE",
  },
  contract_start_day: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "evaluationCnb.CONTRACT_START_DATE.day",
  },
  contract_start_month: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "evaluationCnb.CONTRACT_START_DATE.month",
  },
  contract_start_year: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "evaluationCnb.CONTRACT_START_DATE.year",
  },
  custom_cccd_gd: {
    bindingMode: "scalar-company-context",
    contextSource: "subject-company",
    datasetKey: "company",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "representativeIdentityNumber",
  },
  custom_chuc_danh: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "evaluationCnb.CUSTOM_JOB_TITLE",
  },
  custom_cong_ty: {
    bindingMode: "scalar-company-context",
    contextSource: "subject-company",
    datasetKey: "company",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "fullLegalName",
  },
  custom_contract_position_type: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "evaluationCnb.CUSTOM_POSITION_TYPE",
  },
  custom_dai_dien: {
    bindingMode: "scalar-company-context",
    contextSource: "subject-company",
    datasetKey: "company",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "representative",
  },
  custom_loai_hop_dong: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "evaluationCnb.CONTRACT_TYPE",
  },
  custom_ma_so_thue: {
    bindingMode: "scalar-company-context",
    contextSource: "subject-company",
    datasetKey: "company",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "taxCode",
  },
  custom_muc_luong_co_ban: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "money",
    sourceFieldKey: "evaluationCnb.CUSTOM_BASE_SALARY",
  },
  custom_ngay_cap_cccd_gd: {
    bindingMode: "scalar-company-context",
    contextSource: "subject-company",
    datasetKey: "company",
    isSystemField: true,
    manualInputType: "date",
    sourceFieldKey: "representativeIdentityDate",
  },
  custom_ngay_sinh_gd: {
    bindingMode: "scalar-company-context",
    contextSource: "subject-company",
    datasetKey: "company",
    isSystemField: true,
    manualInputType: "date",
    sourceFieldKey: "representativeBirthDate",
  },
  custom_phong_ban: {
    bindingMode: "scalar-system",
    contextSource: "evaluation",
    datasetKey: "evaluationResult",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "evaluationCnb.CUSTOM_DEPARTMENT",
  },
  employee_dob: {
    bindingMode: "scalar-actor",
    contextSource: "evaluation-subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "date",
    sourceFieldKey: "birthDate",
  },
  employee_code: {
    bindingMode: "scalar-actor",
    contextSource: "subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "employeeCode",
  },
  employee_name: {
    bindingMode: "scalar-actor",
    contextSource: "subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "fullName",
  },
  employee_ssn_date: {
    bindingMode: "scalar-actor",
    contextSource: "evaluation-subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "date",
    sourceFieldKey: "identityDate",
  },
  employee_ssn_no: {
    bindingMode: "scalar-actor",
    contextSource: "evaluation-subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "identityNumber",
  },
  employee_ssn_place: {
    bindingMode: "scalar-actor",
    contextSource: "evaluation-subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "identityPlace",
  },
  employee_permanent_address: {
    bindingMode: "scalar-actor",
    contextSource: "evaluation-subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "permanentResidence",
  },
  employee_personal_tax_code: {
    bindingMode: "scalar-actor",
    contextSource: "evaluation-subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "personalTaxCode",
  },
  employee_social_insurance_no: {
    bindingMode: "scalar-actor",
    contextSource: "evaluation-subject",
    datasetKey: "employee",
    isSystemField: true,
    manualInputType: "text",
    sourceFieldKey: "socialInsuranceNumber",
  },
};

function applyKnownTemplatePlaceholderBinding(field: TemplateFieldConfig) {
  const binding = KNOWN_TEMPLATE_PLACEHOLDER_BINDINGS[field.placeholder];
  return binding ? ({ ...field, ...binding } as TemplateFieldConfig) : field;
}

function normalizeField(value: unknown, index: number): TemplateFieldConfig {
  const source = asRecord(value);
  const placeholder =
    text(source.placeholder || source.label || source.manualLabel) ||
    `Trường ${index + 1}`;
  const isTableField = booleanValue(source.isTableField);
  const isSystemField = booleanValue(source.isSystemField);
  const datasetKey = text(source.datasetKey) as TemplateDatasetKey;
  const inputType = (text(
    source.manualInputType || source.inputType || source.type,
  ) || "text") as TemplateInputType;
  const tableKey = isTableField
    ? text(source.tableKey) || `table-${slugify(placeholder)}`
    : "";
  let bindingMode = text(source.bindingMode) as TemplateBindingMode;
  if (!bindingMode) {
    bindingMode = isTableField
      ? isSystemField
        ? "table-linked"
        : "table-manual"
      : isSystemField
        ? datasetKey === "system"
          ? "scalar-system"
          : "scalar-actor"
        : "manual";
  }
  const sourceFieldKey = text(source.sourceFieldKey);
  const normalizedField: TemplateFieldConfig = {
    allowOverride: booleanValue(source.allowOverride),
    bindingMode,
    contextSource: normalizeContextSource(
      source.contextSource,
      datasetKey,
      bindingMode,
      sourceFieldKey,
    ),
    datasetKey: ([
      "",
      "company",
      "employee",
      "evaluationResult",
      "partnerCustomer",
      "product",
      "system",
    ].includes(datasetKey)
      ? datasetKey
      : "") as TemplateDatasetKey,
    fieldId:
      text(source.fieldId || source.id) ||
      `field-${slugify(placeholder)}-${index + 1}`,
    format: normalizeFormat(source.format),
    formulaExpression: text(source.formulaExpression),
    isSystemField,
    isTableField,
    linkGroupKey: text(source.linkGroupKey),
    manualInputType: MANUAL_INPUT_TYPES.some((item) => item.key === inputType)
      ? inputType
      : "text",
    manualLabel: text(source.manualLabel || source.label) || placeholder,
    options: Array.isArray(source.options)
      ? source.options.map(text).filter(Boolean)
      : text(source.options)
          .split(/\s*[|;,]\s*/)
          .filter(Boolean),
    placeholder,
    positionLabel: text(source.positionLabel),
    rawToken: text(source.rawToken) || `{${placeholder}}`,
    required: booleanValue(source.required),
    scanHints: parseArray(source.scanHints).map(normalizeScanHint),
    scanOrder: numberValue(source.scanOrder, index + 1),
    sourceFieldKey,
    tableKey,
    tableLabel: isTableField ? text(source.tableLabel) || "Bảng dữ liệu" : "",
  };
  return enforceSensitiveEmployeeFieldPolicy(
    applyKnownTemplatePlaceholderBinding(normalizedField),
  );
}

function normalizeScanResult(value: unknown): TemplateScanResult | JsonRecord {
  const parsed = parseJson(value);
  return asRecord(parsed);
}

function contentFields(content: JsonRecord) {
  const direct =
    findContentValue(
      content,
      "JSON trường",
      "Trường JSON",
      "Danh sách trường",
      "fields",
      "fieldDefinitions",
    ) ??
    Object.entries(content).find(
      ([key]) =>
        normalizeForMatch(key).includes("json") &&
        !normalizeForMatch(key).includes("scan"),
    )?.[1];
  return parseArray(direct)
    .map(normalizeField)
    .sort((left, right) => left.scanOrder - right.scanOrder);
}

function templateRecordFromDb(row: {
  code: string | null;
  content: unknown;
  createdAt: Date;
  id: string;
  name: string | null;
  sourceRow: number;
  status: string | null;
  updatedAt: Date;
}): TemplateRecord {
  const content = asRecord(row.content);
  const fields = contentFields(content);
  const fileType = text(
    findContentValue(content, "Loại file", "fileType"),
  ) as TemplateFileType;
  const importMode = text(
    findContentValue(content, "Nguồn nạp", "importMode"),
  ) as TemplateImportMode;
  const legacyDocumentNumberField = fields.find(
    (field) =>
      !field.isTableField &&
      field.datasetKey === "system" &&
      field.sourceFieldKey === "documentNumber",
  );
  return {
    createdAt: row.createdAt.toISOString(),
    fieldConfigs: fields,
    fieldCount: numberValue(
      findContentValue(content, "Số trường", "fieldCount"),
      fields.length,
    ),
    fileType: fileType === "spreadsheet" ? "spreadsheet" : "document",
    id: row.id,
    importMode: importMode === "file" ? "file" : "link",
    numbering: {
      customTextFieldId: text(
        findContentValue(
          content,
          "Trường cụm đánh số",
          "numberingCustomTextFieldId",
        ),
      ),
      documentNumberFieldId:
        text(
          findContentValue(
            content,
            "Trường nhận số văn bản",
            "numberingDocumentNumberFieldId",
          ),
        ) ||
        legacyDocumentNumberField?.fieldId ||
        "",
      documentNumberPlaceholder:
        text(
          findContentValue(
            content,
            "Placeholder nhận số văn bản",
            "numberingDocumentNumberPlaceholder",
          ),
        ) ||
        legacyDocumentNumberField?.placeholder ||
        "",
      documentTypeId: text(
        findContentValue(
          content,
          "Mã loại hồ sơ đánh số",
          "numberingDocumentTypeId",
        ),
      ),
      documentTypeName: text(
        findContentValue(
          content,
          "Loại hồ sơ đánh số",
          "numberingDocumentTypeName",
        ),
      ),
      signDateFieldId: text(
        findContentValue(
          content,
          "Trường ngày cấp số",
          "numberingSignDateFieldId",
        ),
      ),
    },
    rowIndex: row.sourceRow,
    scanMeta: normalizeScanResult(
      findContentValue(content, "JSON scan", "scanMeta"),
    ),
    sourceFileId: text(
      findContentValue(content, "File gốc ID", "sourceFileId"),
    ),
    sourceFileName: text(
      findContentValue(content, "Tên file nguồn", "sourceFileName"),
    ),
    sourceFileUrl: text(
      findContentValue(content, "File gốc URL", "sourceFileUrl"),
    ),
    sourceLink: text(findContentValue(content, "Link nguồn", "sourceLink")),
    status:
      row.status ||
      text(findContentValue(content, "Trạng thái", "status")) ||
      "Kích hoạt",
    templateId:
      row.code ||
      text(findContentValue(content, "Mã biểu mẫu", "templateId")) ||
      row.id,
    templateName:
      row.name ||
      text(findContentValue(content, "Tên biểu mẫu", "templateName")) ||
      "Biểu mẫu chưa đặt tên",
    updatedAt:
      text(findContentValue(content, "Cập nhật lúc", "updatedAt")) ||
      row.updatedAt.toISOString(),
    updatedBy: text(findContentValue(content, "Cập nhật bởi", "updatedBy")),
    workingFileId: text(
      findContentValue(content, "File làm việc ID", "workingFileId"),
    ),
    workingFileName: text(
      findContentValue(content, "Tên file làm việc", "workingFileName"),
    ),
    workingFileUrl: text(
      findContentValue(content, "File làm việc URL", "workingFileUrl"),
    ),
    workingMimeType: text(
      findContentValue(content, "Mime type", "workingMimeType"),
    ),
  };
}

function historyRecordFromDb(row: {
  code: string | null;
  content: unknown;
  createdAt: Date;
  id: string;
  name: string | null;
  sourceRow: number;
}): TemplateHistoryRecord {
  const content = asRecord(row.content);
  return {
    createdAt:
      text(findContentValue(content, "Ngày tạo", "createdAt")) ||
      row.createdAt.toISOString(),
    createdBy: text(findContentValue(content, "Người tạo", "createdBy")),
    employeeCode: text(findContentValue(content, "Mã nhân sự", "employeeCode")),
    historyId:
      row.code ||
      text(findContentValue(content, "Mã lịch sử", "historyId")) ||
      row.id,
    id: row.id,
    documentNumber: text(
      findContentValue(content, "Số văn bản", "documentNumber"),
    ),
    documentRegistryId: text(
      findContentValue(content, "Mã sổ văn bản", "documentRegistryId"),
    ),
    documentTypeName: text(
      findContentValue(content, "Loại hồ sơ đánh số", "documentTypeName"),
    ),
    outputFileId: text(
      findContentValue(content, "File kết quả ID", "outputFileId"),
    ),
    outputUrl: text(findContentValue(content, "File kết quả URL", "outputUrl")),
    rowIndex: row.sourceRow,
    templateId: text(findContentValue(content, "Mã biểu mẫu", "templateId")),
    templateName:
      row.name ||
      text(findContentValue(content, "Tên biểu mẫu", "templateName")),
  };
}

function isTemplateActive(status: unknown) {
  const normalized = normalizeForMatch(status);
  return !["vo hieu", "inactive", "archived"].includes(normalized);
}

function canManageTemplates(session: AppSession) {
  return (
    session.fullAccess ||
    session.roles.includes("admin") ||
    session.roles.includes("super-admin") ||
    session.moduleGroups.includes("admin-hanh-chinh") ||
    session.modules.includes("template-management")
  );
}

export function canUseTemplates(session: AppSession) {
  return (
    canManageTemplates(session) ||
    session.moduleGroups.includes("tien-ich") ||
    session.modules.includes("templates")
  );
}

function assertTemplateManager(session: AppSession) {
  if (!canManageTemplates(session)) {
    throw new TemplateRuntimeError(
      "Tài khoản chưa có quyền Cấu hình Biểu mẫu.",
      403,
    );
  }
}

function assertTemplateUser(session: AppSession) {
  if (!canUseTemplates(session)) {
    throw new TemplateRuntimeError(
      "Tài khoản chưa có quyền dùng Biểu mẫu.",
      403,
    );
  }
}

async function resolveTemplateActor(
  session: AppSession,
): Promise<TemplateActor> {
  const user = await getDb().user.findUnique({
    select: {
      displayName: true,
      employee: {
        select: {
          companyId: true,
          department: true,
          employeeCode: true,
          id: true,
          title: true,
        },
      },
    },
    where: { id: session.userId },
  });
  return {
    companyId: user?.employee?.companyId || "",
    department: user?.employee?.department || "",
    displayName: user?.displayName || session.displayName,
    employeeCode: user?.employee?.employeeCode || "",
    employeeId: user?.employee?.id || "",
    title: user?.employee?.title || "",
    userId: session.userId,
  };
}

export async function getTemplateManagementSnapshot(
  session: AppSession,
): Promise<TemplateManagementSnapshot> {
  assertTemplateManager(session);
  const db = getDb();
  const [templateRows, historyRows, documentTypes, evaluationDecisionFields] =
    await Promise.all([
      db.configurationRecord.findMany({
        orderBy: [{ updatedAt: "desc" }, { sourceRow: "asc" }],
        where: { recordType: "template" },
      }),
      db.configurationRecord.findMany({
        orderBy: [{ createdAt: "desc" }, { sourceRow: "desc" }],
        take: 250,
        where: { recordType: "template-history" },
      }),
      db.documentType.findMany({
        include: { _count: { select: { companyNumbering: true } } },
        orderBy: { name: "asc" },
        where: { status: "ACTIVE", takesNumber: true },
      }),
      db.evaluationRecord.findMany({
        orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
        where: {
          recordType: "evaluation-decision-field",
          status: { notIn: ["archived", "deleted", "inactive"] },
        },
      }),
    ]);
  const dynamicEvaluationFields = new Map<
    string,
    { key: string; label: string }
  >();
  evaluationDecisionFields.forEach((record) => {
    const content = asRecord(record.content);
    if (booleanValue(content.isActive, true) === false) return;
    if (text(content.role || content.answerRole).toLowerCase() !== "hr") return;
    const code = text(
      record.code || content.fieldCode || content.code || record.id,
    );
    if (!code) return;
    const key = evaluationTemplateSourceKey(code);
    if (!dynamicEvaluationFields.has(key)) {
      dynamicEvaluationFields.set(key, {
        key,
        label: `CnB · ${text(record.name || content.label || content.fieldLabel || code)}`,
      });
    }
  });
  return {
    companyFieldOptions: COMPANY_FIELDS,
    contextSourceOptions: CONTEXT_SOURCE_OPTIONS,
    datasetOptions: DATASET_OPTIONS,
    documentTypeOptions: documentTypes.map((documentType) => ({
      companyRuleCount: documentType._count.companyNumbering,
      cycle: documentType.cycle || "",
      id: documentType.id,
      name: documentType.name,
      requiresCustomText: Array.isArray(documentType.formatTokens)
        ? documentType.formatTokens.some(
            (token) => asRecord(token).type === "CUSTOM_TEXT",
          )
        : false,
    })),
    employeeFieldOptions: EMPLOYEE_TEMPLATE_FIELD_OPTIONS,
    evaluationResultFieldOptions: [
      ...EVALUATION_RESULT_FIELDS,
      ...dynamicEvaluationFields.values(),
    ],
    history: historyRows.map(historyRecordFromDb),
    importModes: [
      { key: "link", label: "Nạp link" },
      { key: "file", label: "Nạp file" },
    ],
    manualInputTypes: MANUAL_INPUT_TYPES,
    partnerCustomerFieldOptions: PARTNER_CUSTOMER_FIELDS,
    productFieldOptions: PRODUCT_FIELDS,
    scalarBindingModes: SCALAR_BINDING_MODES,
    systemFieldOptions: SYSTEM_FIELDS,
    tableBindingModes: TABLE_BINDING_MODES,
    templates: templateRows.map(templateRecordFromDb),
  };
}

export async function getTemplateWorkspaceSnapshot(
  session: AppSession,
): Promise<TemplateWorkspaceSnapshot> {
  assertTemplateUser(session);
  const rows = await getDb().configurationRecord.findMany({
    orderBy: [{ updatedAt: "desc" }, { sourceRow: "asc" }],
    where: { recordType: "template" },
  });
  return {
    templates: rows
      .map(templateRecordFromDb)
      .filter((record) => isTemplateActive(record.status)),
  };
}

async function getTemplateFolderId() {
  const db = getDb();
  const folders = await getDriveFolders(db);
  return folders["template.templateDriveFolderId"] || TEMPLATE_FOLDER_FALLBACK;
}

function sourceFileType(name: string, mimeType: string): TemplateFileType {
  const lowerName = name.toLowerCase();
  if (
    mimeType === GOOGLE_DOC_MIME ||
    mimeType === DOCX_MIME ||
    /application\/msword/i.test(mimeType) ||
    /\.(doc|docx)$/i.test(lowerName)
  ) {
    return "document";
  }
  if (
    mimeType === GOOGLE_SHEET_MIME ||
    mimeType === XLSX_MIME ||
    /application\/vnd\.ms-excel/i.test(mimeType) ||
    /\.(xls|xlsx)$/i.test(lowerName)
  ) {
    return "spreadsheet";
  }
  throw new TemplateRuntimeError("Biểu mẫu chỉ hỗ trợ file Word hoặc Excel.");
}

function googleMimeFor(fileType: TemplateFileType) {
  return fileType === "document" ? GOOGLE_DOC_MIME : GOOGLE_SHEET_MIME;
}

function buildDriveUrl(fileId: string, fileType?: TemplateFileType) {
  if (fileType === "document") {
    return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`;
  }
  if (fileType === "spreadsheet") {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/edit`;
  }
  return `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`;
}

async function getDriveFileMeta(fileId: string): Promise<DriveFileMeta> {
  try {
    const client = await getTemplateGoogleClient();
    const response = await client.request<DriveFileMeta>({
      params: {
        fields: "id,name,mimeType,parents,webViewLink",
        supportsAllDrives: true,
      },
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    });
    return {
      id: text(response.data.id),
      mimeType: text(response.data.mimeType),
      name: text(response.data.name),
      parents: response.data.parents || [],
      webViewLink: text(response.data.webViewLink),
    };
  } catch {
    const serviceAccount =
      process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT ||
      "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";
    throw new TemplateRuntimeError(
      `Không đọc được file Drive. Hãy chia sẻ file cho ${serviceAccount}.`,
    );
  }
}

async function copyDriveFile(fileId: string, name: string, folderId?: string) {
  const client = await getTemplateGoogleClient();
  const response = await client.request<DriveFileMeta>({
    data: {
      name,
      ...(folderId ? { parents: [folderId] } : {}),
    },
    method: "POST",
    params: {
      fields: "id,name,mimeType,webViewLink",
      supportsAllDrives: true,
    },
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy`,
  });
  return response.data;
}

async function copyDriveFileWithFallback(
  fileId: string,
  name: string,
  preferredFolderId: string,
) {
  const source = await getDriveFileMeta(fileId);
  const folderCandidates = [
    preferredFolderId,
    ...(source.parents || []),
  ].filter(
    (folderId, index, values) => folderId && values.indexOf(folderId) === index,
  );
  let lastError: unknown;
  for (const folderId of folderCandidates) {
    try {
      return {
        file: await copyDriveFile(fileId, name, folderId),
        folderId,
      };
    } catch (error) {
      lastError = error;
    }
  }
  try {
    return {
      file: await copyDriveFile(fileId, name),
      folderId: "",
    };
  } catch (error) {
    lastError = error;
  }
  const serviceAccount =
    process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT ||
    "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";
  console.error(
    "Template Drive copy failed in all candidate folders",
    lastError,
  );
  throw new TemplateRuntimeError(
    `Không tạo được bản sao trên Drive. Hãy chia sẻ thư mục chứa biểu mẫu cho ${serviceAccount} với quyền Người chỉnh sửa.`,
  );
}

async function downloadDriveFile(
  fileId: string,
  mimeType: string,
): Promise<Buffer> {
  const client = await getTemplateGoogleClient();
  const isGoogleFile = mimeType.startsWith("application/vnd.google-apps.");
  const url = isGoogleFile
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const response = await client.request<ArrayBuffer>({
    params: isGoogleFile
      ? {
          mimeType: mimeType === GOOGLE_DOC_MIME ? DOCX_MIME : XLSX_MIME,
        }
      : { alt: "media", supportsAllDrives: true },
    responseType: "arraybuffer",
    url,
  });
  return Buffer.from(response.data);
}

async function exportGoogleFileAsPdf(fileId: string): Promise<Buffer> {
  const client = await getTemplateGoogleClient();
  const response = await client.request<ArrayBuffer>({
    params: { mimeType: "application/pdf" },
    responseType: "arraybuffer",
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export`,
  });
  const buffer = Buffer.from(response.data);
  if (!buffer.length || !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new TemplateRuntimeError(
      "Google Drive không trả về PDF hợp lệ từ biểu mẫu đã ghép dữ liệu.",
    );
  }
  return buffer;
}

async function uploadDriveFile(input: {
  buffer: Buffer;
  contentMimeType: string;
  folderId?: string;
  name: string;
  targetMimeType?: string;
}) {
  const boundary = `codex_template_${randomBytes(12).toString("hex")}`;
  const metadata = {
    mimeType: input.targetMimeType || input.contentMimeType,
    name: input.name,
    ...(input.folderId ? { parents: [input.folderId] } : {}),
  };
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.contentMimeType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const client = await getTemplateGoogleClient();
  const response = await client.request<DriveFileMeta>({
    data: Buffer.concat([head, input.buffer, tail]),
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    method: "POST",
    params: {
      fields: "id,name,mimeType,webViewLink",
      supportsAllDrives: true,
      uploadType: "multipart",
    },
    url: "https://www.googleapis.com/upload/drive/v3/files",
  });
  return response.data;
}

async function trashDriveFile(fileId: string) {
  if (!fileId) return;
  const client = await getTemplateGoogleClient();
  await client
    .request({
      data: { trashed: true },
      method: "PATCH",
      params: { supportsAllDrives: true },
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    })
    .catch(() => undefined);
}

async function importFromDriveLink(
  sourceLink: string,
  templateName: string,
): Promise<TemplateSourceInfo> {
  const fileId = parseDriveId(sourceLink);
  if (!fileId) {
    throw new TemplateRuntimeError("Link Google Drive chưa hợp lệ.");
  }
  const [meta, folderId] = await Promise.all([
    getDriveFileMeta(fileId),
    getTemplateFolderId(),
  ]);
  const fileType = sourceFileType(meta.name, meta.mimeType);
  let working: DriveFileMeta;
  if ([GOOGLE_DOC_MIME, GOOGLE_SHEET_MIME].includes(meta.mimeType)) {
    working = await copyDriveFile(
      fileId,
      `[BM] ${templateName || meta.name}`,
      folderId,
    );
  } else {
    const buffer = await downloadDriveFile(fileId, meta.mimeType);
    working = await uploadDriveFile({
      buffer,
      contentMimeType: meta.mimeType,
      folderId,
      name: `[BM] ${templateName || meta.name}`,
      targetMimeType: googleMimeFor(fileType),
    });
  }
  return {
    fileType,
    importMode: "link",
    sourceFileId: fileId,
    sourceFileName: meta.name,
    sourceFileUrl: meta.webViewLink || buildDriveUrl(fileId),
    sourceLink,
    workingFileId: working.id,
    workingFileName: working.name,
    workingFileUrl: working.webViewLink || buildDriveUrl(working.id, fileType),
    workingMimeType: working.mimeType || googleMimeFor(fileType),
  };
}

async function importFromUpload(
  file: File,
  templateName: string,
): Promise<TemplateSourceInfo> {
  if (file.size > MAX_TEMPLATE_FILE_BYTES) {
    throw new TemplateRuntimeError("File vượt quá giới hạn 20 MB.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileType = sourceFileType(file.name, file.type);
  const folderId = await getTemplateFolderId();
  const contentMimeType =
    file.type || (fileType === "document" ? DOCX_MIME : XLSX_MIME);
  const source = await uploadDriveFile({
    buffer,
    contentMimeType,
    folderId,
    name: file.name,
  });
  let working: DriveFileMeta | null = null;
  try {
    working = await uploadDriveFile({
      buffer,
      contentMimeType,
      folderId,
      name: `[BM] ${templateName || file.name.replace(/\.[^.]+$/, "")}`,
      targetMimeType: googleMimeFor(fileType),
    });
  } catch (error) {
    await trashDriveFile(source.id);
    throw error;
  }
  return {
    fileType,
    importMode: "file",
    sourceFileId: source.id,
    sourceFileName: source.name || file.name,
    sourceFileUrl: source.webViewLink || buildDriveUrl(source.id),
    sourceLink: "",
    workingFileId: working.id,
    workingFileName: working.name,
    workingFileUrl: working.webViewLink || buildDriveUrl(working.id, fileType),
    workingMimeType: working.mimeType || googleMimeFor(fileType),
  };
}

function collectPlaceholders(
  content: string,
  context: TemplateScanHint,
): TemplateScanOccurrence[] {
  const matches: TemplateScanOccurrence[] = [];
  const matcher = /(\$?\{([^{}]+)\})/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(content))) {
    const placeholder = text(match[2]);
    if (!placeholder) continue;
    matches.push({
      ...context,
      detectedTable: Boolean(context.tableKey),
      detectedTableLikely: false,
      placeholder,
      rawToken: match[1],
    });
  }
  return matches;
}

function docsElementText(value: unknown): string {
  const element = asRecord(value);
  const paragraph = asRecord(element.paragraph);
  const content = Array.isArray(paragraph.elements) ? paragraph.elements : [];
  return content
    .map((item) => String(asRecord(asRecord(item).textRun).content ?? ""))
    .join("");
}

async function scanGoogleDocument(fileId: string) {
  const client = await getTemplateGoogleClient();
  const response = await client.request<JsonRecord>({
    url: `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`,
  });
  const body = asRecord(response.data.body);
  const structural = Array.isArray(body.content) ? body.content : [];
  const occurrences: TemplateScanOccurrence[] = [];
  let tableCounter = 0;
  structural.forEach((element, bodyIndex) => {
    const node = asRecord(element);
    const table = asRecord(node.table);
    if (Array.isArray(table.tableRows)) {
      tableCounter += 1;
      const tableKey = `doc-table-${tableCounter}`;
      table.tableRows.forEach((row, rowIndex) => {
        const cells = Array.isArray(asRecord(row).tableCells)
          ? (asRecord(row).tableCells as unknown[])
          : [];
        const rowMatches: TemplateScanOccurrence[] = [];
        let cellsWithPlaceholders = 0;
        cells.forEach((cell, columnIndex) => {
          const cellContent = Array.isArray(asRecord(cell).content)
            ? (asRecord(cell).content as unknown[])
            : [];
          const cellText = cellContent.map(docsElementText).join("");
          const found = collectPlaceholders(cellText, {
            columnIndex: columnIndex + 1,
            containerType: "document-table-cell",
            locationKey: `${tableKey}-row-${rowIndex + 1}-col-${columnIndex + 1}`,
            rowIndex: rowIndex + 1,
            sheetName: "",
            tableKey,
          });
          if (found.length) cellsWithPlaceholders += 1;
          rowMatches.push(...found);
        });
        rowMatches.forEach((match) => {
          match.detectedTableLikely = cellsWithPlaceholders > 1;
          occurrences.push(match);
        });
      });
      return;
    }
    const paragraphText = docsElementText(node);
    occurrences.push(
      ...collectPlaceholders(paragraphText, {
        columnIndex: 0,
        containerType: "document-text",
        locationKey: `body-${bodyIndex + 1}`,
        rowIndex: 0,
        sheetName: "",
        tableKey: "",
      }),
    );
  });
  return buildScanResult("document", occurrences);
}

async function scanGoogleSpreadsheet(fileId: string) {
  const client = await getTemplateGoogleClient();
  const meta = await client.request<{
    sheets?: Array<{ properties?: { title?: string } }>;
  }>({
    params: { fields: "sheets(properties(title))" },
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}`,
  });
  const occurrences: TemplateScanOccurrence[] = [];
  for (const sheet of meta.data.sheets || []) {
    const sheetName = text(sheet.properties?.title);
    if (!sheetName) continue;
    const valuesResponse = await client.request<{ values?: unknown[][] }>({
      params: { majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" },
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}` +
        `/values/${encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!A1:ZZ1000`)}`,
    });
    (valuesResponse.data.values || []).forEach((row, rowIndex) => {
      const rowMatches: TemplateScanOccurrence[] = [];
      row.forEach((cell, columnIndex) => {
        rowMatches.push(
          ...collectPlaceholders(text(cell), {
            columnIndex: columnIndex + 1,
            containerType: "spreadsheet-cell",
            locationKey: `${sheetName}-r${rowIndex + 1}c${columnIndex + 1}`,
            rowIndex: rowIndex + 1,
            sheetName,
            tableKey: `${sheetName}-row-${rowIndex + 1}`,
          }),
        );
      });
      rowMatches.forEach((match) => {
        match.detectedTable = true;
        match.detectedTableLikely = rowMatches.length > 1;
        occurrences.push(match);
      });
    });
  }
  return buildScanResult("spreadsheet", occurrences);
}

function inferDefaultField(
  placeholder: string,
  occurrence: TemplateScanOccurrence,
  index: number,
): TemplateFieldConfig {
  const normalized = normalizeForMatch(placeholder);
  const isStt = ["stt", "so thu tu"].includes(normalized);
  const isSku =
    normalized === "ma sku" ||
    normalized === "sku" ||
    normalized === "ma san pham";
  const isProductName =
    normalized === "ten san pham" ||
    normalized === "san pham" ||
    normalized === "ten hang hoa";
  const isUnit = ["don vi tinh", "dvt"].includes(normalized);
  const isTableField =
    occurrence.detectedTableLikely || isStt || isSku || isProductName || isUnit;
  const tableKey = isTableField ? occurrence.tableKey : "";
  const fieldId = `field-${slugify(placeholder)}-${index + 1}`;
  let datasetKey: TemplateDatasetKey = "";
  let sourceFieldKey = "";
  let bindingMode: TemplateBindingMode = isTableField
    ? "table-manual"
    : "manual";
  let isSystemField = false;
  let linkGroupKey = "";

  if (isStt) {
    datasetKey = "system";
    sourceFieldKey = "rowNumber";
    bindingMode = "table-linked";
    isSystemField = true;
  } else if (isSku || isProductName || isUnit) {
    datasetKey = "product";
    sourceFieldKey = isSku ? "sku" : isProductName ? "name" : "unit";
    bindingMode = isSku ? "table-selector" : "table-linked";
    isSystemField = true;
    linkGroupKey = isSku ? fieldId : "";
  } else if (normalized === "ngay") {
    datasetKey = "system";
    sourceFieldKey = "currentDate";
    bindingMode = "scalar-system";
    isSystemField = true;
  } else if (normalized === "thang") {
    datasetKey = "system";
    sourceFieldKey = "currentMonth";
    bindingMode = "scalar-system";
    isSystemField = true;
  } else if (normalized === "nam") {
    datasetKey = "system";
    sourceFieldKey = "currentYear";
    bindingMode = "scalar-system";
    isSystemField = true;
  }

  return enforceSensitiveEmployeeFieldPolicy(
    applyKnownTemplatePlaceholderBinding({
      allowOverride: false,
      bindingMode,
      contextSource: defaultContextSource(
        datasetKey,
        bindingMode,
        sourceFieldKey,
      ),
      datasetKey,
      fieldId,
      format: normalizeFormat({}),
      formulaExpression: "",
      isSystemField,
      isTableField,
      linkGroupKey,
      manualInputType: "text",
      manualLabel: placeholder,
      options: [],
      placeholder,
      positionLabel:
        occurrence.containerType === "document-text"
          ? `Vị trí ${index + 1}`
          : `Vị trí ${index + 1} - hàng ${occurrence.rowIndex}, cột ${occurrence.columnIndex}`,
      rawToken: occurrence.rawToken || `{${placeholder}}`,
      required: false,
      scanHints: [],
      scanOrder: index + 1,
      sourceFieldKey,
      tableKey,
      tableLabel: tableKey ? "Bảng dữ liệu" : "",
    }),
  );
}

function buildScanResult(
  fileType: TemplateFileType,
  occurrences: TemplateScanOccurrence[],
): TemplateScanResult {
  const map = new Map<string, TemplateScanField>();
  occurrences.forEach((occurrence, occurrenceIndex) => {
    const key = occurrence.placeholder;
    let field = map.get(key);
    if (!field) {
      field = {
        defaultConfig: inferDefaultField(
          occurrence.placeholder,
          occurrence,
          map.size,
        ),
        firstOccurrenceIndex: occurrenceIndex,
        isTableDetected: false,
        occurrenceCount: 0,
        placeholder: occurrence.placeholder,
        rawToken: occurrence.rawToken,
        scanHints: [],
        suggestedTableKey: "",
      };
      map.set(key, field);
    }
    const hint: TemplateScanHint = {
      columnIndex: occurrence.columnIndex,
      containerType: occurrence.containerType,
      locationKey: occurrence.locationKey,
      rowIndex: occurrence.rowIndex,
      sheetName: occurrence.sheetName,
      tableKey: occurrence.tableKey,
    };
    field.occurrenceCount += 1;
    field.scanHints.push(hint);
    if (occurrence.detectedTableLikely && occurrence.tableKey) {
      field.isTableDetected = true;
      field.suggestedTableKey ||= occurrence.tableKey;
      field.defaultConfig.isTableField = true;
      field.defaultConfig.tableKey = occurrence.tableKey;
      field.defaultConfig.tableLabel ||= "Bảng dữ liệu";
      if (
        !field.defaultConfig.isSystemField &&
        field.defaultConfig.bindingMode === "manual"
      ) {
        field.defaultConfig.bindingMode = "table-manual";
      }
    }
    field.defaultConfig.scanHints = field.scanHints;
  });
  const fields = [...map.values()].sort(
    (left, right) => left.firstOccurrenceIndex - right.firstOccurrenceIndex,
  );
  const tableKeys = [
    ...new Set(
      fields.map((field) => field.defaultConfig.tableKey).filter(Boolean),
    ),
  ];
  return {
    fieldCount: fields.length,
    fields,
    fileType,
    occurrences,
    placeholderCount: occurrences.length,
    tables: tableKeys.map((key, index) => ({
      key,
      label: `Bảng dữ liệu ${String(index + 1).padStart(2, "0")}`,
    })),
  };
}

export async function importTemplateSource(
  session: AppSession,
  input: {
    file?: File;
    importMode: TemplateImportMode;
    sourceLink?: string;
    templateName: string;
  },
) {
  assertTemplateManager(session);
  const templateName = text(input.templateName);
  if (!templateName) {
    throw new TemplateRuntimeError("Vui lòng nhập tên biểu mẫu.");
  }
  let source: TemplateSourceInfo;
  if (input.importMode === "file") {
    if (!(input.file instanceof File)) {
      throw new TemplateRuntimeError("Vui lòng chọn file Word hoặc Excel.");
    }
    source = await importFromUpload(input.file, templateName);
  } else {
    const sourceLink = text(input.sourceLink);
    if (!sourceLink) {
      throw new TemplateRuntimeError("Vui lòng nhập link biểu mẫu.");
    }
    source = await importFromDriveLink(sourceLink, templateName);
  }
  try {
    const scanResult =
      source.fileType === "document"
        ? await scanGoogleDocument(source.workingFileId)
        : await scanGoogleSpreadsheet(source.workingFileId);
    return { scanResult, source };
  } catch (error) {
    await trashDriveFile(source.workingFileId);
    if (input.importMode === "file") await trashDriveFile(source.sourceFileId);
    throw error;
  }
}

function validateFieldRelationships(fields: TemplateFieldConfig[]) {
  if (!fields.length) {
    throw new TemplateRuntimeError("Biểu mẫu cần ít nhất một trường đã quét.");
  }
  const ids = new Set<string>();
  fields.forEach((field) => {
    if (!field.fieldId || ids.has(field.fieldId)) {
      throw new TemplateRuntimeError("Mã trường đang bị trùng hoặc để trống.");
    }
    ids.add(field.fieldId);
    if (!field.rawToken) {
      throw new TemplateRuntimeError(
        `Trường ${field.manualLabel || field.placeholder} thiếu placeholder.`,
      );
    }
    if (field.isTableField && !field.tableKey) {
      throw new TemplateRuntimeError(
        `Trường ${field.manualLabel || field.placeholder} chưa có nhóm bảng.`,
      );
    }
    const sensitivePolicyError = sensitiveEmployeeFieldPolicyViolation(field);
    if (sensitivePolicyError) {
      throw new TemplateRuntimeError(
        `Trường ${field.manualLabel || field.placeholder}: ${sensitivePolicyError}`,
      );
    }
  });
  fields.forEach((field) => {
    if (
      !["scalar-linked", "table-linked"].includes(field.bindingMode) ||
      field.datasetKey === "system"
    ) {
      return;
    }
    const selector = fields.find(
      (candidate) =>
        candidate.fieldId === field.linkGroupKey ||
        (candidate.datasetKey === field.datasetKey &&
          candidate.tableKey === field.tableKey &&
          ["scalar-selector", "table-selector"].includes(
            candidate.bindingMode,
          )),
    );
    if (!selector) {
      throw new TemplateRuntimeError(
        `Trường ${field.manualLabel || field.placeholder} chưa liên kết với trường chọn nguồn.`,
      );
    }
  });
}

function makeTemplateCode() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `TPL-${stamp}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function nextConfigurationSourceRow(recordType: string) {
  const last = await getDb().configurationRecord.findFirst({
    orderBy: { sourceRow: "desc" },
    select: { sourceRow: true },
    where: { recordType },
  });
  return Math.max((last?.sourceRow || 1) + 1, 2);
}

export async function saveTemplateConfig(
  session: AppSession,
  payload: JsonRecord,
) {
  assertTemplateManager(session);
  const actor = await resolveTemplateActor(session);
  const templateName = text(payload.templateName);
  if (!templateName) {
    throw new TemplateRuntimeError("Vui lòng nhập tên biểu mẫu.");
  }
  let fields = Array.isArray(payload.fields)
    ? payload.fields
        .map(normalizeField)
        .sort((a, b) => a.scanOrder - b.scanOrder)
    : [];
  const numberingDocumentTypeId = text(payload.numberingDocumentTypeId);
  const numberingCustomTextFieldId = text(payload.numberingCustomTextFieldId);
  const legacyDocumentNumberField = fields.find(
    (field) =>
      !field.isTableField &&
      field.datasetKey === "system" &&
      field.sourceFieldKey === "documentNumber",
  );
  const numberingDocumentNumberFieldId = numberingDocumentTypeId
    ? text(payload.numberingDocumentNumberFieldId) ||
      legacyDocumentNumberField?.fieldId ||
      ""
    : "";
  const numberingSignDateFieldId = text(payload.numberingSignDateFieldId);
  const numberingDocumentNumberField = numberingDocumentNumberFieldId
    ? fields.find(
        (field) =>
          !field.isTableField &&
          field.fieldId === numberingDocumentNumberFieldId,
      )
    : null;
  if (numberingDocumentTypeId && !numberingDocumentNumberField) {
    throw new TemplateRuntimeError(
      "Hãy chọn chính xác placeholder/vị trí trong file sẽ nhận số văn bản.",
    );
  }
  if (numberingDocumentNumberField) {
    fields = fields.map((field): TemplateFieldConfig => {
      if (field.fieldId === numberingDocumentNumberField.fieldId) {
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
    });
  }
  validateFieldRelationships(fields);
  const scalarFieldIds = new Set(
    fields.filter((field) => !field.isTableField).map((field) => field.fieldId),
  );
  if (
    numberingCustomTextFieldId &&
    !scalarFieldIds.has(numberingCustomTextFieldId)
  ) {
    throw new TemplateRuntimeError(
      "Trường cụm tự định nghĩa không còn tồn tại.",
    );
  }
  if (
    numberingSignDateFieldId &&
    !scalarFieldIds.has(numberingSignDateFieldId)
  ) {
    throw new TemplateRuntimeError("Trường ngày cấp số không còn tồn tại.");
  }
  const workingFileId = text(payload.workingFileId);
  const workingMimeType = text(payload.workingMimeType);
  if (!workingFileId || !workingMimeType) {
    throw new TemplateRuntimeError(
      "Biểu mẫu chưa có file làm việc. Hãy quét lại trước khi lưu.",
    );
  }
  const db = getDb();
  const numberingDocumentType = numberingDocumentTypeId
    ? await db.documentType.findFirst({
        where: {
          id: numberingDocumentTypeId,
          status: "ACTIVE",
          takesNumber: true,
        },
      })
    : null;
  if (numberingDocumentTypeId && !numberingDocumentType) {
    throw new TemplateRuntimeError(
      "Loại hồ sơ đánh số không còn hoạt động hoặc không hỗ trợ cấp số.",
    );
  }
  const requiresCustomText = Array.isArray(numberingDocumentType?.formatTokens)
    ? numberingDocumentType.formatTokens.some(
        (token) => asRecord(token).type === "CUSTOM_TEXT",
      )
    : false;
  if (requiresCustomText && !numberingCustomTextFieldId) {
    throw new TemplateRuntimeError(
      "Quy cách của loại hồ sơ có Cụm tự định nghĩa; hãy chọn trường cung cấp nội dung này.",
    );
  }
  const requestedId = text(payload.id || payload.templateId);
  const existing = requestedId
    ? await db.configurationRecord.findFirst({
        where: {
          recordType: "template",
          OR: [{ id: requestedId }, { code: requestedId }],
        },
      })
    : null;
  const duplicate = await db.configurationRecord.findFirst({
    where: {
      id: existing ? { not: existing.id } : undefined,
      name: { equals: templateName, mode: "insensitive" },
      recordType: "template",
    },
  });
  if (duplicate) {
    throw new TemplateRuntimeError("Tên biểu mẫu này đã tồn tại.");
  }
  const templateId =
    existing?.code || text(payload.templateId) || makeTemplateCode();
  const status = text(payload.status) || "Kích hoạt";
  const now = new Date().toISOString();
  const content = {
    "Cập nhật bởi": actor.displayName,
    "Cập nhật lúc": now,
    "File gốc ID": text(payload.sourceFileId),
    "File gốc URL": text(payload.sourceFileUrl),
    "File làm việc ID": workingFileId,
    "File làm việc URL": text(payload.workingFileUrl),
    "JSON scan": JSON.stringify(asRecord(payload.scanMeta)),
    "JSON trường": JSON.stringify(fields),
    "Link nguồn": text(payload.sourceLink),
    "Loại file":
      text(payload.fileType) ||
      (workingMimeType === GOOGLE_SHEET_MIME ? "spreadsheet" : "document"),
    "Mã biểu mẫu": templateId,
    "Mã loại hồ sơ đánh số": numberingDocumentType?.id || "",
    "Mime type": workingMimeType,
    "Nguồn nạp": text(payload.importMode) || "link",
    "Số trường": String(fields.length),
    "Trường nhận số văn bản": numberingDocumentType
      ? numberingDocumentNumberFieldId
      : "",
    "Placeholder nhận số văn bản": numberingDocumentType
      ? numberingDocumentNumberField?.placeholder || ""
      : "",
    "Trường cụm đánh số": numberingDocumentType
      ? numberingCustomTextFieldId
      : "",
    "Trường ngày cấp số": numberingDocumentType ? numberingSignDateFieldId : "",
    "Tên biểu mẫu": templateName,
    "Loại hồ sơ đánh số": numberingDocumentType?.name || "",
    "Tên file nguồn": text(payload.sourceFileName),
    "Tên file làm việc": text(payload.workingFileName),
    "Trạng thái": status,
  };
  const row = existing
    ? await db.configurationRecord.update({
        data: {
          code: templateId,
          content: content as Prisma.InputJsonValue,
          name: templateName,
          status,
        },
        where: { id: existing.id },
      })
    : await db.configurationRecord.create({
        data: {
          code: templateId,
          content: content as Prisma.InputJsonValue,
          name: templateName,
          recordType: "template",
          sourceRow: await nextConfigurationSourceRow("template"),
          sourceSheet: "03_Biểu mẫu",
          status,
        },
      });
  await db.auditLog.create({
    data: {
      action: existing ? "UPDATE" : "CREATE",
      actorId: session.userId,
      metadata: {
        fieldCount: fields.length,
        numberingDocumentNumberFieldId,
        numberingDocumentTypeId: numberingDocumentType?.id || "",
        templateId,
      },
      summary: `${existing ? "Updated" : "Created"} template ${templateName}.`,
      targetId: row.id,
      targetType: "ConfigurationRecord",
    },
  });
  return {
    savedRecord: templateRecordFromDb(row),
    snapshot: await getTemplateManagementSnapshot(session),
  };
}

export async function setTemplateStatus(
  session: AppSession,
  payload: JsonRecord,
) {
  assertTemplateManager(session);
  const id = text(payload.id || payload.templateId);
  const status = text(payload.status);
  if (!id || !["Kích hoạt", "Vô hiệu"].includes(status)) {
    throw new TemplateRuntimeError("Trạng thái biểu mẫu chưa hợp lệ.");
  }
  const db = getDb();
  const row = await db.configurationRecord.findFirst({
    where: {
      recordType: "template",
      OR: [{ id }, { code: id }],
    },
  });
  if (!row) throw new TemplateRuntimeError("Không tìm thấy biểu mẫu.");
  const content = { ...asRecord(row.content), "Trạng thái": status };
  await db.configurationRecord.update({
    data: {
      content: content as Prisma.InputJsonValue,
      status,
    },
    where: { id: row.id },
  });
  await db.auditLog.create({
    data: {
      action: "UPDATE",
      actorId: session.userId,
      metadata: { status },
      summary: `Changed template status to ${status}.`,
      targetId: row.id,
      targetType: "ConfigurationRecord",
    },
  });
  return getTemplateManagementSnapshot(session);
}

async function findTemplateRecord(identifier: string) {
  const row = await getDb().configurationRecord.findFirst({
    where: {
      recordType: "template",
      OR: [{ id: identifier }, { code: identifier }],
    },
  });
  return row ? templateRecordFromDb(row) : null;
}

function lookupRecord(
  key: string,
  label: string,
  values: Record<string, unknown>,
): TemplateLookupRecord {
  const normalizedValues = Object.fromEntries(
    Object.entries(values).map(([field, value]) => [field, text(value)]),
  );
  return {
    key,
    label,
    searchText: normalizeForMatch(
      [key, label, ...Object.values(normalizedValues)].join(" "),
    ),
    values: normalizedValues,
  };
}

function normalizeReviewerRole(value: unknown) {
  const normalized = normalizeForMatch(value);
  if (
    ["self", "employee", "staff", "nhan su", "nhan vien"].includes(normalized)
  ) {
    return "self";
  }
  if (["manager", "cap tren", "quan ly"].includes(normalized)) return "manager";
  if (["peer", "dong nghiep"].includes(normalized)) return "peer";
  if (normalized === "hr") return "hr";
  if (normalized === "bod") return "bod";
  return text(value);
}

function reviewerRoleLabel(value: unknown) {
  const role = normalizeReviewerRole(value);
  return (
    {
      bod: "BOD",
      hr: "HR",
      manager: "Quản lý trực tiếp",
      peer: "Đồng nghiệp",
      self: "Bản thân",
    }[role] || text(value)
  );
}

function systemValues(
  actor: TemplateActor,
  context: TemplateExecutionContext = {},
) {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return {
    documentNumber: "",
    documentTypeName: "",
    currentDate: String(now.getDate()).padStart(2, "0"),
    currentDateTime: dateTimeFormatter.format(now),
    currentFullDate: dateFormatter.format(now),
    currentMonth: String(now.getMonth() + 1).padStart(2, "0"),
    currentUserDepartment: actor.department,
    currentUserName: actor.displayName,
    currentUserTitle: actor.title,
    currentYear: String(now.getFullYear()),
    evaluationCycleName: text(context.cycleName),
    evaluationDeadline: text(context.deadline),
    evaluationLink: text(context.evaluationLink),
    evaluationReviewerRole: reviewerRoleLabel(context.reviewerRole),
    evaluationTypeName: text(context.evaluationType),
    rowNumber: "",
  };
}

function valueFromLookup(
  records: TemplateLookupRecord[] | undefined,
  lookupKey: string,
  sourceFieldKey: string,
) {
  const record = records?.find(
    (item) =>
      item.key === lookupKey ||
      normalizeForMatch(item.label) === normalizeForMatch(lookupKey),
  );
  return record?.values[sourceFieldKey] || "";
}

function recordsForDataset(
  lookupRecords: Partial<Record<TemplateDatasetKey, TemplateLookupRecord[]>>,
  datasetKey: TemplateDatasetKey,
) {
  if (!datasetKey) return [];
  return lookupRecords[datasetKey] || [];
}

function selectorForField(
  field: TemplateFieldConfig,
  fields: TemplateFieldConfig[],
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

async function buildTemplateLookupRecords(
  template: TemplateRecord,
  session: AppSession,
  requestedContext: TemplateExecutionContext = {},
  evaluationContentOverrides: JsonRecord = {},
): Promise<TemplateLookupBundle> {
  const datasets = new Set(
    template.fieldConfigs.map((field) => field.datasetKey).filter(Boolean),
  );
  const db = getDb();
  const actor = await resolveTemplateActor(session);
  const evaluationInstanceId = text(requestedContext.evaluationInstanceId);
  const evaluationInstance = evaluationInstanceId
    ? await findTemplateEvaluationInstance(evaluationInstanceId)
    : null;
  const instanceContent = {
    ...asRecord(evaluationInstance?.content),
    ...evaluationContentOverrides,
  };
  const reviewerRole = normalizeReviewerRole(
    requestedContext.reviewerRole || instanceContent.currentStepRole,
  );
  const subjectEmployeeCode =
    text(
      requestedContext.subjectEmployeeCode || instanceContent.employeeCode,
    ) || actor.employeeCode;
  const evaluationSubjectEmployeeCode = text(instanceContent.employeeCode);
  const managerEmployeeCode = text(
    requestedContext.managerEmployeeCode || instanceContent.managerEmployeeCode,
  );
  const reviewerCodeByRole: Record<string, string> = {
    bod: text(instanceContent.bodEmployeeCode),
    hr: text(instanceContent.hrEmployeeCode),
    indirect_manager: text(instanceContent.indirectManagerEmployeeCode),
    manager: managerEmployeeCode,
    peer: text(instanceContent.peerEmployeeCode),
    self: subjectEmployeeCode,
  };
  const recipientEmployeeCode =
    text(requestedContext.recipientEmployeeCode) ||
    reviewerCodeByRole[reviewerRole] ||
    actor.employeeCode;
  if (
    evaluationInstance &&
    !canManageTemplates(session) &&
    actor.employeeCode &&
    ![
      subjectEmployeeCode,
      managerEmployeeCode,
      text(instanceContent.indirectManagerEmployeeCode),
      text(instanceContent.peerEmployeeCode),
      text(instanceContent.hrEmployeeCode),
      text(instanceContent.bodEmployeeCode),
    ].includes(actor.employeeCode)
  ) {
    throw new TemplateRuntimeError(
      "Bạn không thuộc phạm vi của phiếu đánh giá dùng để dựng biểu mẫu.",
      403,
    );
  }
  const needsEmployeeContext =
    datasets.has("employee") ||
    Boolean(evaluationInstanceId) ||
    template.fieldConfigs.some((field) =>
      [
        "actor",
        "actor-company",
        "evaluation-subject",
        "manager",
        "recipient",
        "subject",
        "subject-company",
      ].includes(field.contextSource),
    );
  const needsCompanyContext =
    Boolean(template.numbering.documentTypeId) ||
    datasets.has("company") ||
    template.fieldConfigs.some((field) =>
      ["actor-company", "selected-company", "subject-company"].includes(
        field.contextSource,
      ),
    );
  const [companies, employees, products, actorUser, evaluationSubjectEmployee] =
    await Promise.all([
      needsCompanyContext
        ? db.company.findMany({
            orderBy: [{ shortName: "asc" }, { legalName: "asc" }],
            where: { status: "ACTIVE" },
          })
        : Promise.resolve([]),
      needsEmployeeContext
        ? db.employee.findMany({
            orderBy: { fullName: "asc" },
            take: 5000,
            where: { status: "ACTIVE" },
          })
        : Promise.resolve([]),
      datasets.has("product")
        ? db.warehouseProduct.findMany({
            orderBy: [{ name: "asc" }, { sku: "asc" }],
            take: 5000,
            where: { status: "ACTIVE" },
          })
        : Promise.resolve([]),
      db.user.findUnique({
        include: { employee: true },
        where: { id: session.userId },
      }),
      evaluationInstance && evaluationSubjectEmployeeCode
        ? db.employee.findUnique({
            where: { employeeCode: evaluationSubjectEmployeeCode },
          })
        : Promise.resolve(null),
    ]);
  const actorRecord = actorUser?.employee
    ? lookupRecord(
        actorUser.employee.employeeCode,
        actorUser.employee.fullName,
        buildEmployeeTemplateValues(actorUser.employee),
      )
    : lookupRecord(session.userId, actor.displayName, {
        companyId: actor.companyId,
        department: actor.department,
        employeeCode: actor.employeeCode,
        fullName: actor.displayName,
        title: actor.title,
      });
  const employeeRecords = employees.map((employee) =>
    lookupRecord(
      employee.employeeCode,
      employee.fullName,
      buildEmployeeTemplateValues(employee, { includeSensitive: false }),
    ),
  );
  const employeeByCode = (employeeCode: string) =>
    employeeRecords.find((record) => record.key === employeeCode);
  const subjectRecord =
    employeeByCode(subjectEmployeeCode) ||
    (subjectEmployeeCode === actor.employeeCode ? actorRecord : undefined) ||
    actorRecord;
  const evaluationSubjectRecord = evaluationSubjectEmployee
    ? lookupRecord(
        evaluationSubjectEmployee.employeeCode,
        evaluationSubjectEmployee.fullName,
        buildEmployeeTemplateValues(evaluationSubjectEmployee),
      )
    : undefined;
  const recipientRecord =
    employeeByCode(recipientEmployeeCode) ||
    (recipientEmployeeCode === actor.employeeCode ? actorRecord : undefined) ||
    actorRecord;
  const managerRecord = managerEmployeeCode
    ? employeeByCode(managerEmployeeCode)
    : undefined;
  const subjectCompanyId =
    text(requestedContext.companyId) ||
    text(subjectRecord.values.companyId) ||
    actor.companyId;
  const needsEvaluationResult =
    datasets.has("evaluationResult") ||
    template.fieldConfigs.some(
      (field) =>
        field.contextSource === "evaluation" ||
        field.contextSource === "evaluation-subject",
    );
  const resultCandidates = needsEvaluationResult
    ? await db.evaluationRecord.findMany({
        orderBy: { updatedAt: "desc" },
        take: 2_000,
        where: {
          recordType: "evaluation-final-result",
          status: { notIn: ["archived", "deleted", "inactive"] },
        },
      })
    : [];
  const evaluationIdentifiers = new Set(
    [
      evaluationInstance?.id,
      evaluationInstance?.code,
      instanceContent.id,
      instanceContent.instanceId,
      instanceContent.evaluationInstanceId,
      evaluationInstanceId,
    ]
      .map(text)
      .filter(Boolean),
  );
  const evaluationResult =
    resultCandidates.find((record) => {
      const content = asRecord(record.content);
      const references = [
        record.parentId,
        content.instanceId,
        content.evaluationInstanceId,
      ]
        .map(text)
        .filter(Boolean);
      return (
        evaluationIdentifiers.size > 0 &&
        references.some((reference) => evaluationIdentifiers.has(reference))
      );
    }) ||
    (text(requestedContext.subjectEmployeeCode)
      ? resultCandidates.find(
          (record) =>
            text(asRecord(record.content).employeeCode) === subjectRecord.key,
        )
      : null) ||
    null;
  const decisionFieldRows = needsEvaluationResult
    ? await db.evaluationRecord.findMany({
        where: {
          recordType: "evaluation-decision-field",
          status: { notIn: ["archived", "deleted", "inactive"] },
        },
      })
    : [];
  const decisionFields: EvaluationTemplateField[] = decisionFieldRows
    .map((record) => {
      const content = asRecord(record.content);
      return {
        code: text(
          record.code || content.fieldCode || content.code || record.id,
        ),
        fieldType: text(content.fieldType || content.type || "text"),
        label: text(
          record.name || content.label || content.fieldLabel || record.code,
        ),
        role: text(content.role || content.answerRole).toLowerCase(),
      };
    })
    .filter((field) => field.code && field.role === "hr")
    .map(({ code, fieldType, label }) => ({ code, fieldType, label }));
  const evaluationValues = buildEvaluationTemplateValues(
    evaluationResult?.content || {},
    decisionFields,
    instanceContent,
  );
  const visibleEvaluationResults = canManageTemplates(session)
    ? resultCandidates
    : resultCandidates.filter(
        (record) =>
          text(asRecord(record.content).employeeCode) === actor.employeeCode,
      );
  const evaluationOptions = visibleEvaluationResults
    .map((record) => {
      const content = asRecord(record.content);
      const value = text(
        content.evaluationInstanceId || content.instanceId || record.parentId,
      );
      const finalizedAt = text(content.finalizedAt);
      const dateLabel = finalizedAt
        ? new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(new Date(finalizedAt))
        : "";
      return {
        employeeCode: text(content.employeeCode),
        label: [
          text(content.employeeName || record.name),
          text(content.decisionOptionLabel),
          dateLabel,
        ]
          .filter(Boolean)
          .join(" · "),
        value,
      };
    })
    .filter((option) => option.value);
  const context: TemplateExecutionContext = {
    companyId: subjectCompanyId,
    cycleName: text(requestedContext.cycleName || instanceContent.cycleName),
    deadline: text(requestedContext.deadline || instanceContent.deadline),
    evaluationInstanceId:
      evaluationInstanceId ||
      text(instanceContent.id || instanceContent.instanceId),
    evaluationLink:
      text(requestedContext.evaluationLink) ||
      (evaluationInstanceId
        ? `/danh-gia?instanceId=${encodeURIComponent(evaluationInstanceId)}`
        : ""),
    evaluationType: text(
      requestedContext.evaluationType ||
        instanceContent.evaluationTypeName ||
        instanceContent.cycleTypeName,
    ),
    managerEmployeeCode,
    recipientEmployeeCode: recipientRecord.key,
    reviewerRole,
    subjectEmployeeCode: subjectRecord.key,
  };
  return {
    actor,
    actorRecord,
    context,
    contextRecords: {
      actor: actorRecord,
      evaluationSubject: evaluationSubjectRecord,
      manager: managerRecord,
      recipient: recipientRecord,
      subject: subjectRecord,
    },
    evaluationOptions,
    evaluationValues,
    lookupRecords: {
      company: companies.map((company) => {
        const representativeEmployee = employees.find(
          (employee) =>
            employee.companyId === company.id &&
            normalizeForMatch(employee.fullName) ===
              normalizeForMatch(company.representative),
        );
        return lookupRecord(
          company.id,
          company.shortName || company.legalName,
          {
            address: company.address,
            branchName: company.branchName,
            businessRegistration: company.businessRegistration,
            code: company.code,
            fullLegalName: company.branchName || company.legalName,
            legalName: company.legalName,
            oldAddress: company.oldAddress,
            representative: company.representative,
            representativeBirthDate: representativeEmployee?.birthDate,
            representativeIdentityDate: representativeEmployee?.identityDate,
            representativeIdentityNumber:
              representativeEmployee?.identityNumber,
            representativeIdentityPlace: representativeEmployee?.identityPlace,
            shortName: company.shortName || company.legalName,
            taxCode: companyTaxCode(company.taxCode),
          },
        );
      }),
      employee: employeeRecords,
      evaluationResult: [] as TemplateLookupRecord[],
      partnerCustomer: [] as TemplateLookupRecord[],
      product: products.map((product) =>
        lookupRecord(product.id, `${product.sku} · ${product.name}`, {
          barcode: product.barcode,
          color: product.color,
          name: product.name,
          purchasePrice: product.purchasePrice,
          salePrice: product.salePrice,
          size: product.size,
          sku: product.sku,
          unit: product.unit,
        }),
      ),
      system: [] as TemplateLookupRecord[],
    },
  };
}

async function findTemplateEvaluationInstance(identifier: string) {
  const normalized = text(identifier);
  if (!normalized) return null;
  const db = getDb();
  const exact = await db.evaluationRecord.findFirst({
    where: {
      recordType: "evaluation-instance",
      OR: [{ id: normalized }, { code: normalized }],
    },
  });
  if (exact) return exact;
  const recentInstances = await db.evaluationRecord.findMany({
    orderBy: { updatedAt: "desc" },
    take: 2_000,
    where: { recordType: "evaluation-instance" },
  });
  return (
    recentInstances.find((record) => {
      const content = asRecord(record.content);
      return [content.id, content.instanceId, content.instanceCode]
        .map(text)
        .includes(normalized);
    }) || null
  );
}

function normalizeExecutionContext(value: unknown): TemplateExecutionContext {
  const source = asRecord(value);
  return {
    companyId: text(source.companyId),
    cycleName: text(source.cycleName),
    deadline: text(source.deadline),
    evaluationInstanceId: text(source.evaluationInstanceId),
    evaluationLink: text(source.evaluationLink),
    evaluationType: text(source.evaluationType),
    managerEmployeeCode: text(source.managerEmployeeCode),
    recipientEmployeeCode: text(source.recipientEmployeeCode),
    reviewerRole: text(source.reviewerRole),
    subjectEmployeeCode: text(source.subjectEmployeeCode),
  };
}

function contextEmployeeRecord(
  field: TemplateFieldConfig,
  records: TemplateContextRecords,
) {
  if (field.contextSource === "evaluation-subject") {
    return records.evaluationSubject;
  }
  if (field.contextSource === "subject") return records.subject;
  if (field.contextSource === "recipient") return records.recipient;
  if (field.contextSource === "manager") return records.manager;
  return records.actor;
}

function contextEmployeeValue(
  field: TemplateFieldConfig,
  records: TemplateContextRecords,
) {
  if (
    isSensitiveEmployeeFieldKey(field.sourceFieldKey) &&
    (field.bindingMode !== "scalar-actor" ||
      !["actor", "evaluation-subject"].includes(field.contextSource))
  ) {
    return "";
  }
  return (
    contextEmployeeRecord(field, records)?.values[field.sourceFieldKey] || ""
  );
}

function contextCompanyId(
  field: TemplateFieldConfig,
  bundle: TemplateLookupBundle,
  selectedCompanyId = "",
) {
  if (field.contextSource === "actor-company") {
    return bundle.actor.companyId;
  }
  if (field.contextSource === "subject-company") {
    return text(bundle.context.companyId);
  }
  return selectedCompanyId;
}

function buildFieldDefinition(
  field: TemplateFieldConfig,
  bundle: TemplateLookupBundle,
  selectedCompanyId = "",
): TemplateFieldDefinition {
  let value = "";
  if (field.datasetKey === "system") {
    value =
      systemValues(bundle.actor, bundle.context)[
        field.sourceFieldKey as keyof ReturnType<typeof systemValues>
      ] || "";
  } else if (field.datasetKey === "evaluationResult") {
    value = bundle.evaluationValues[field.sourceFieldKey] || "";
  } else if (
    field.datasetKey === "employee" &&
    field.bindingMode === "scalar-actor"
  ) {
    value = contextEmployeeValue(field, bundle.contextRecords);
  } else if (
    field.datasetKey === "company" &&
    field.bindingMode === "scalar-company-context"
  ) {
    value = valueFromLookup(
      bundle.lookupRecords.company,
      contextCompanyId(field, bundle, selectedCompanyId),
      field.sourceFieldKey,
    );
  }
  const readOnly =
    field.manualInputType === "formula" ||
    (field.isSystemField && !field.allowOverride) ||
    ["scalar-linked", "scalar-system", "table-linked"].includes(
      field.bindingMode,
    );
  return { ...field, readOnly, value };
}

export async function getTemplateFormDefinition(
  session: AppSession,
  payload: JsonRecord,
) {
  assertTemplateUser(session);
  const templateId = text(payload.templateId || payload.id);
  const template = await findTemplateRecord(templateId);
  if (!template || !isTemplateActive(template.status)) {
    throw new TemplateRuntimeError("Không tìm thấy biểu mẫu cần điền.", 404);
  }
  const requestedContext = normalizeExecutionContext(payload.context);
  const bundle = await buildTemplateLookupRecords(
    template,
    session,
    requestedContext,
  );
  const { context, lookupRecords } = bundle;
  const requiresSelectedCompany =
    template.fieldConfigs.some(
      (field) =>
        field.bindingMode === "scalar-company-context" &&
        field.contextSource === "selected-company",
    ) || Boolean(template.numbering.documentTypeId);
  const requiresEvaluationContext = template.fieldConfigs.some(
    (field) =>
      field.datasetKey === "evaluationResult" ||
      field.contextSource === "evaluation-subject",
  );
  const selectedCompanyId = text(requestedContext.companyId);
  const resolvedCompanyId = requiresSelectedCompany
    ? selectedCompanyId || text(context.companyId)
    : text(context.companyId);
  let numbering: TemplateFormDefinition["numbering"] = null;
  if (template.numbering.documentTypeId) {
    numbering = {
      companyId: resolvedCompanyId,
      documentNumberFieldId: template.numbering.documentNumberFieldId,
      documentNumberPlaceholder: template.numbering.documentNumberPlaceholder,
      documentTypeId: template.numbering.documentTypeId,
      documentTypeName: template.numbering.documentTypeName,
      enabled: true,
      previewNumber: "",
      serial: null,
      startIndex: null,
    };
    if (resolvedCompanyId) {
      const preview = await previewDocumentNumber(getDb(), {
        companyId: resolvedCompanyId,
        documentTypeId: template.numbering.documentTypeId,
        partnerAbbr: null,
        signDate: new Date(),
      });
      if (preview.ok) {
        numbering = {
          ...numbering,
          documentTypeName: template.numbering.documentTypeName,
          previewNumber: preview.documentNumber,
          serial: preview.serial,
          startIndex: preview.startIndex,
        };
      }
    }
  }
  const scalarFields = template.fieldConfigs
    .filter((field) => !field.isTableField)
    .map((field) => buildFieldDefinition(field, bundle, resolvedCompanyId));
  if (numbering) {
    scalarFields.forEach((field) => {
      if (
        field.fieldId === template.numbering.documentNumberFieldId ||
        (field.datasetKey === "system" &&
          field.sourceFieldKey === "documentNumber")
      ) {
        field.value = numbering?.previewNumber || "Sẽ cấp khi tạo file";
      }
      if (field.sourceFieldKey === "documentTypeName") {
        field.value = numbering?.documentTypeName || "";
      }
    });
  }
  const groups = new Map<string, TemplateTableGroupDefinition>();
  template.fieldConfigs
    .filter((field) => field.isTableField)
    .forEach((field) => {
      const key = field.tableKey || "table";
      const current = groups.get(key) || {
        columns: [],
        key,
        label: field.tableLabel || "Bảng dữ liệu",
      };
      current.columns.push(
        buildFieldDefinition(field, bundle, resolvedCompanyId),
      );
      groups.set(key, current);
    });
  const formDefinition: TemplateFormDefinition = {
    companyOptions: (lookupRecords.company || []).map((record) => ({
      label: record.label,
      value: record.key,
    })),
    context,
    evaluationOptions: bundle.evaluationOptions,
    lookupRecords,
    numbering,
    requiresCompanyContext: requiresSelectedCompany,
    requiresEvaluationContext,
    resolvedCompanyId,
    scalarFields,
    tableGroups: [...groups.values()],
  };
  return { formDefinition, template };
}

function parseNumeric(value: unknown) {
  const normalized = text(value)
    .replace(/\s/g, "")
    .replace(/₫|đ/gi, "")
    .replace(/,/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tokenizeFormula(source: string) {
  const tokens: Array<{ type: string; value: number | string }> = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9.]/.test(source[index])) index += 1;
      tokens.push({
        type: "number",
        value: Number(source.slice(start, index)),
      });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
        index += 1;
      }
      tokens.push({
        type: "name",
        value: source.slice(start, index).toLowerCase(),
      });
      continue;
    }
    if ("+-*/(),".includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }
    throw new TemplateRuntimeError("Công thức có ký tự chưa hỗ trợ.");
  }
  return tokens;
}

function evaluateFormula(
  expression: string,
  resolver: (key: string) => number,
) {
  const source = expression
    .replace(/làm\s*tròn|lam\s*tron/gi, "round")
    .replace(/\{([^{}]+)\}/g, (_, key) => String(resolver(key)))
    .replace(/\[([^[\]]+)\]/g, (_, key) => String(resolver(key)))
    .replace(/[xX×]/g, "*")
    .replace(/:/g, "/");
  const tokens = tokenizeFormula(source);
  let position = 0;
  const peek = () => tokens[position];
  const consume = (type: string) => {
    if (peek()?.type === type) return tokens[position++];
    return null;
  };
  const parsePrimary = (): number => {
    const token = peek();
    if (!token) throw new TemplateRuntimeError("Công thức chưa đủ dữ liệu.");
    if (consume("number")) return Number(token.value) || 0;
    if (consume("name")) {
      if (token.value !== "round") {
        throw new TemplateRuntimeError("Công thức chỉ hỗ trợ hàm round.");
      }
      if (!consume("(")) {
        throw new TemplateRuntimeError("Hàm round thiếu dấu mở ngoặc.");
      }
      const value = parseExpression();
      const digits = consume(",") ? parseExpression() : 0;
      if (!consume(")")) {
        throw new TemplateRuntimeError("Hàm round thiếu dấu đóng ngoặc.");
      }
      const factor = Math.pow(10, digits);
      return Math.round(value * factor) / factor;
    }
    if (consume("(")) {
      const nested = parseExpression();
      if (!consume(")")) {
        throw new TemplateRuntimeError("Công thức thiếu dấu đóng ngoặc.");
      }
      return nested;
    }
    throw new TemplateRuntimeError("Công thức chưa hợp lệ.");
  };
  const parseUnary = (): number => {
    if (consume("+")) return parseUnary();
    if (consume("-")) return -parseUnary();
    return parsePrimary();
  };
  const parseTerm = (): number => {
    let value = parseUnary();
    while (true) {
      if (consume("*")) value *= parseUnary();
      else if (consume("/")) value /= parseUnary();
      else break;
    }
    return value;
  };
  const parseExpression = (): number => {
    let value = parseTerm();
    while (true) {
      if (consume("+")) value += parseTerm();
      else if (consume("-")) value -= parseTerm();
      else break;
    }
    return value;
  };
  const result = parseExpression();
  if (position < tokens.length || !Number.isFinite(result)) {
    throw new TemplateRuntimeError("Công thức chưa hợp lệ.");
  }
  return result;
}

function titleCase(value: string) {
  return value
    .toLocaleLowerCase("vi")
    .replace(/(^|\s)\p{L}/gu, (match) => match.toLocaleUpperCase("vi"));
}

function formatFieldValue(value: unknown, field: TemplateFieldConfig) {
  let result = text(value);
  const format = field.format || {};
  const numberLocale =
    field.datasetKey === "evaluationResult" ? "en-US" : "vi-VN";
  if (field.manualInputType === "money") {
    result = new Intl.NumberFormat(numberLocale).format(parseNumeric(result));
  } else if (format.numberFormat && format.numberFormat !== "none" && result) {
    const number = parseNumeric(result);
    if (format.numberFormat === "percent") {
      result = `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }).format(number)}%`;
    } else {
      result = new Intl.NumberFormat(numberLocale, {
        maximumFractionDigits: format.numberFormat === "integer" ? 0 : 4,
      }).format(number);
    }
  }
  if (field.manualInputType === "date" && result) {
    result = formatTemplateDateValue(
      result,
      field.datasetKey === "evaluationResult"
        ? "dd/mm/yyyy"
        : format.dateFormat,
    );
  }
  if (format.transform === "uppercase") result = result.toLocaleUpperCase("vi");
  if (format.transform === "lowercase") result = result.toLocaleLowerCase("vi");
  if (format.transform === "titlecase") result = titleCase(result);
  return `${format.prefix || ""}${result}${format.suffix || ""}`;
}

function templateTokenVariants(rawToken: string, placeholder = "") {
  const configured = text(rawToken) || (placeholder ? `{${placeholder}}` : "");
  if (!configured) return [];
  const braced = configured.match(/^\$?\{[^{}]+\}$/)
    ? configured.replace(/^\$/, "")
    : "";
  return [
    ...new Set(
      [braced ? `$${braced}` : "", configured, braced].filter(Boolean),
    ),
  ].sort((left, right) => right.length - left.length);
}

function setTemplateReplacement(
  replacements: Map<string, string>,
  field: TemplateFieldConfig,
  value: string,
) {
  templateTokenVariants(field.rawToken, field.placeholder).forEach((token) => {
    replacements.set(token, value);
  });
}

function formulaValueMap(
  fields: TemplateFieldConfig[],
  values: Record<string, string>,
) {
  const map = new Map<string, number>();
  fields.forEach((field) => {
    const value = parseNumeric(values[field.fieldId]);
    [field.fieldId, field.placeholder, field.manualLabel].forEach((key) => {
      if (key) map.set(normalizeForMatch(key), value);
    });
  });
  return map;
}

function applyFormulas(
  fields: TemplateFieldConfig[],
  values: Record<string, string>,
) {
  const formulas = fields.filter(
    (field) =>
      field.manualInputType === "formula" && field.formulaExpression.trim(),
  );
  for (let pass = 0; pass < 4; pass += 1) {
    const map = formulaValueMap(fields, values);
    formulas.forEach((field) => {
      values[field.fieldId] = String(
        Math.round(
          evaluateFormula(
            field.formulaExpression,
            (key) => map.get(normalizeForMatch(key)) || 0,
          ) * 10000,
        ) / 10000,
      );
    });
  }
}

async function resolveOutputValues(
  template: TemplateRecord,
  session: AppSession,
  payload: TemplateOutputPayload,
  systemOverrides: Record<string, string> = {},
) {
  const requestedContext = normalizeExecutionContext(payload.context);
  const bundle = await buildTemplateLookupRecords(
    template,
    session,
    requestedContext,
    asRecord(payload.evaluationContentOverrides),
  );
  const { actor, context, contextRecords, lookupRecords } = bundle;
  const scalarValues: Record<string, string> = {
    ...(payload.scalarValues || {}),
  };
  const system: Record<string, string> = {
    ...systemValues(actor, context),
    ...systemOverrides,
  };
  const companyId = text(payload.companyId);
  const scalarFields = template.fieldConfigs.filter(
    (field) => !field.isTableField,
  );
  const hasAllowedOverride = (field: TemplateFieldConfig) =>
    field.allowOverride &&
    Object.prototype.hasOwnProperty.call(scalarValues, field.fieldId);
  if (companyId) {
    scalarFields
      .filter(
        (field) =>
          field.datasetKey === "company" &&
          field.bindingMode === "scalar-selector" &&
          !scalarValues[field.fieldId],
      )
      .forEach((field) => {
        scalarValues[field.fieldId] = companyId;
      });
  }
  scalarFields.forEach((field) => {
    if (hasAllowedOverride(field)) {
      return;
    } else if (field.datasetKey === "system") {
      scalarValues[field.fieldId] =
        system[field.sourceFieldKey as keyof typeof system] || "";
    } else if (field.datasetKey === "evaluationResult") {
      scalarValues[field.fieldId] =
        bundle.evaluationValues[field.sourceFieldKey] || "";
    } else if (
      field.datasetKey === "employee" &&
      field.bindingMode === "scalar-actor"
    ) {
      scalarValues[field.fieldId] = contextEmployeeValue(field, contextRecords);
    } else if (
      field.datasetKey === "company" &&
      field.bindingMode === "scalar-company-context"
    ) {
      scalarValues[field.fieldId] = valueFromLookup(
        lookupRecords.company,
        contextCompanyId(field, bundle, companyId),
        field.sourceFieldKey,
      );
    } else if (field.bindingMode === "scalar-linked") {
      const selector = selectorForField(field, scalarFields);
      const selectorValue = selector
        ? scalarValues[selector.fieldId] || ""
        : "";
      scalarValues[field.fieldId] = valueFromLookup(
        recordsForDataset(lookupRecords, field.datasetKey),
        selectorValue,
        field.sourceFieldKey,
      );
    }
  });
  if (
    template.numbering.documentNumberFieldId &&
    Object.prototype.hasOwnProperty.call(systemOverrides, "documentNumber")
  ) {
    scalarValues[template.numbering.documentNumberFieldId] =
      systemOverrides.documentNumber || "";
  }
  scalarFields
    .filter((field) => field.bindingMode === "scalar-selector")
    .forEach((field) => {
      const selectedKey = scalarValues[field.fieldId] || "";
      const selectedValue = valueFromLookup(
        recordsForDataset(lookupRecords, field.datasetKey),
        selectedKey,
        field.sourceFieldKey,
      );
      if (selectedValue) {
        scalarValues[field.fieldId] = selectedValue;
      }
    });
  applyFormulas(scalarFields, scalarValues);

  const tableRows: Record<string, Array<Record<string, string>>> = {};
  const tableFields = template.fieldConfigs.filter(
    (field) => field.isTableField,
  );
  const tableKeys = [...new Set(tableFields.map((field) => field.tableKey))];
  tableKeys.forEach((tableKey) => {
    const fields = tableFields.filter((field) => field.tableKey === tableKey);
    const sourceRows = payload.tableRows?.[tableKey] || [{}];
    tableRows[tableKey] = sourceRows.map((sourceRow, rowIndex) => {
      const row = { ...sourceRow };
      fields.forEach((field) => {
        if (
          field.datasetKey === "system" &&
          field.sourceFieldKey === "rowNumber"
        ) {
          row[field.fieldId] = String(rowIndex + 1);
        } else if (field.bindingMode === "table-linked") {
          const selector = selectorForField(field, fields);
          const selectorValue = selector ? row[selector.fieldId] || "" : "";
          row[field.fieldId] = valueFromLookup(
            recordsForDataset(lookupRecords, field.datasetKey),
            selectorValue,
            field.sourceFieldKey,
          );
        }
      });
      fields
        .filter((field) => field.bindingMode === "table-selector")
        .forEach((field) => {
          const selectedKey = row[field.fieldId] || "";
          const selectedValue = valueFromLookup(
            recordsForDataset(lookupRecords, field.datasetKey),
            selectedKey,
            field.sourceFieldKey,
          );
          if (selectedValue) {
            row[field.fieldId] = selectedValue;
          }
        });
      const combined = {
        ...scalarValues,
        ...row,
      };
      applyFormulas([...scalarFields, ...fields], combined);
      fields
        .filter((field) => field.manualInputType === "formula")
        .forEach((field) => {
          row[field.fieldId] = combined[field.fieldId] || "";
        });
      return row;
    });
  });

  const scalarReplacements = new Map<string, string>();
  scalarFields.forEach((field) => {
    setTemplateReplacement(
      scalarReplacements,
      field,
      formatFieldValue(scalarValues[field.fieldId], field),
    );
  });
  return {
    actor,
    scalarReplacements,
    scalarValues,
    tableRows,
  };
}

function hexToRgb(value: string) {
  const hex = safeColor(value).replace("#", "");
  if (!hex) return undefined;
  return {
    color: {
      rgbColor: {
        blue: parseInt(hex.slice(4, 6), 16) / 255,
        green: parseInt(hex.slice(2, 4), 16) / 255,
        red: parseInt(hex.slice(0, 2), 16) / 255,
      },
    },
  };
}

function docsTextStyle(format: TemplateFieldFormat) {
  return {
    backgroundColor: hexToRgb(format.backgroundColor || ""),
    bold: Boolean(format.bold),
    foregroundColor: hexToRgb(format.textColor || ""),
    italic: Boolean(format.italic),
    underline: Boolean(format.underline),
    weightedFontFamily: format.fontFamily
      ? { fontFamily: format.fontFamily }
      : undefined,
    fontSize: format.fontSize
      ? { magnitude: format.fontSize, unit: "PT" }
      : undefined,
  };
}

function docsTextStyleFields(format: TemplateFieldFormat) {
  return [
    format.backgroundColor ? "backgroundColor" : "",
    "bold",
    format.textColor ? "foregroundColor" : "",
    "italic",
    "underline",
    format.fontFamily ? "weightedFontFamily" : "",
    format.fontSize ? "fontSize" : "",
  ]
    .filter(Boolean)
    .join(",");
}

type DocsTableNode = {
  startIndex: number;
  tableRows: unknown[];
};

function getDocsTable(
  document: JsonRecord,
  tableKey: string,
): DocsTableNode | null {
  const tableNumber = Math.max(
    numberValue(tableKey.match(/doc-table-(\d+)/)?.[1], 1),
    1,
  );
  const body = asRecord(document.body);
  const tables = (Array.isArray(body.content) ? body.content : [])
    .map(asRecord)
    .filter((element) => Array.isArray(asRecord(element.table).tableRows));
  const element = tables[tableNumber - 1];
  if (!element) return null;
  return {
    startIndex: numberValue(element.startIndex),
    tableRows: asRecord(element.table).tableRows as unknown[],
  };
}

function docsCellText(cell: unknown) {
  const content = Array.isArray(asRecord(cell).content)
    ? (asRecord(cell).content as unknown[])
    : [];
  return content.map(docsElementText).join("").replace(/\n+$/, "");
}

function docsCellTextRanges(cell: unknown) {
  const ranges: Array<{ endIndex: number; startIndex: number }> = [];
  const content = Array.isArray(asRecord(cell).content)
    ? (asRecord(cell).content as unknown[])
    : [];
  content.forEach((element) => {
    const paragraph = asRecord(asRecord(element).paragraph);
    (Array.isArray(paragraph.elements) ? paragraph.elements : []).forEach(
      (piece) => {
        const node = asRecord(piece);
        const runText = String(asRecord(node.textRun).content ?? "").replace(
          /\n$/,
          "",
        );
        if (!runText) return;
        ranges.push({
          endIndex: numberValue(node.startIndex) + runText.length,
          startIndex: numberValue(node.startIndex),
        });
      },
    );
  });
  return ranges;
}

async function docsGet(fileId: string) {
  const client = await getTemplateGoogleClient();
  const response = await client.request<JsonRecord>({
    url: `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`,
  });
  return response.data;
}

async function docsBatchUpdate(fileId: string, requests: JsonRecord[]) {
  if (!requests.length) return;
  const client = await getTemplateGoogleClient();
  await client.request({
    data: { requests },
    method: "POST",
    url: `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}:batchUpdate`,
  });
}

function replaceTokens(source: string, replacements: Map<string, string>) {
  let result = source;
  replacements.forEach((value, token) => {
    result = result.split(token).join(value);
  });
  return result;
}

async function renderGoogleDocument(input: {
  fileId: string;
  scalarReplacements: Map<string, string>;
  tableRows: Record<string, Array<Record<string, string>>>;
  template: TemplateRecord;
}) {
  let document = await docsGet(input.fileId);
  const replaceRequests: JsonRecord[] = [
    ...input.scalarReplacements.entries(),
  ].map(([token, replacement]) => ({
    replaceAllText: {
      containsText: { matchCase: true, text: token },
      replaceText: replacement,
    },
  }));
  // Google Docs giữ nguyên style của placeholder khi replaceAllText. Không áp
  // một format chung lên mọi lần xuất hiện vì cùng biến có thể nằm ở tiêu đề,
  // dòng nghiêng và nội dung thường. Font/cỡ/đậm/nghiêng do chính file mẫu quyết
  // định; hệ thống chỉ chuẩn hóa giá trị ngày, số và chữ trước khi merge.
  await docsBatchUpdate(input.fileId, replaceRequests);

  const tableKeys = [
    ...new Set(
      input.template.fieldConfigs
        .filter((field) => field.isTableField)
        .map((field) => field.tableKey),
    ),
  ];
  for (const tableKey of tableKeys) {
    const fields = input.template.fieldConfigs.filter(
      (field) => field.tableKey === tableKey,
    );
    const rows = input.tableRows[tableKey]?.length
      ? input.tableRows[tableKey]
      : [{}];
    document = await docsGet(input.fileId);
    let table = getDocsTable(document, tableKey);
    if (!table) continue;
    const templateRowNumber =
      fields
        .flatMap((field) => field.scanHints)
        .find((hint) => hint.tableKey === tableKey)?.rowIndex || 1;
    const templateRowIndex = Math.max(templateRowNumber - 1, 0);
    const templateRow = asRecord(table.tableRows[templateRowIndex]);
    const templateCells = Array.isArray(templateRow.tableCells)
      ? (templateRow.tableCells as unknown[])
      : [];
    const cellTemplates = templateCells.map(docsCellText);
    for (let index = 1; index < rows.length; index += 1) {
      await docsBatchUpdate(input.fileId, [
        {
          insertTableRow: {
            insertBelow: true,
            tableCellLocation: {
              columnIndex: 0,
              rowIndex: templateRowIndex + index - 1,
              tableStartLocation: { index: table.startIndex },
            },
          },
        },
      ]);
    }
    document = await docsGet(input.fileId);
    table = getDocsTable(document, tableKey);
    if (!table) continue;
    const cellEdits: Array<{
      cell: unknown;
      format?: TemplateFieldFormat;
      text: string;
    }> = [];
    rows.forEach((row, rowIndex) => {
      const targetRow = asRecord(table!.tableRows[templateRowIndex + rowIndex]);
      const targetCells = Array.isArray(targetRow.tableCells)
        ? (targetRow.tableCells as unknown[])
        : [];
      targetCells.forEach((cell, columnIndex) => {
        const replacements = new Map(input.scalarReplacements);
        const fieldsInCell = fields.filter((field) =>
          field.scanHints.some(
            (hint) =>
              hint.tableKey === tableKey &&
              hint.rowIndex === templateRowNumber &&
              hint.columnIndex === columnIndex + 1,
          ),
        );
        fieldsInCell.forEach((field) => {
          setTemplateReplacement(
            replacements,
            field,
            formatFieldValue(row[field.fieldId], field),
          );
        });
        cellEdits.push({
          cell,
          format: fieldsInCell[0]?.format,
          text: replaceTokens(cellTemplates[columnIndex] || "", replacements),
        });
      });
    });
    cellEdits.sort(
      (left, right) =>
        numberValue(asRecord(right.cell).startIndex) -
        numberValue(asRecord(left.cell).startIndex),
    );
    const requests: JsonRecord[] = [];
    cellEdits.forEach((edit) => {
      const ranges = docsCellTextRanges(edit.cell).sort(
        (left, right) => right.startIndex - left.startIndex,
      );
      ranges.forEach((range) => {
        requests.push({ deleteContentRange: { range } });
      });
      const editCellContent = asRecord(edit.cell).content;
      const firstCellElement = Array.isArray(editCellContent)
        ? editCellContent[0]
        : undefined;
      const startIndex =
        numberValue(asRecord(firstCellElement).startIndex) ||
        numberValue(asRecord(edit.cell).startIndex) + 1;
      if (edit.text) {
        requests.push({
          insertText: { location: { index: startIndex }, text: edit.text },
        });
        if (edit.format) {
          requests.push({
            updateTextStyle: {
              fields: docsTextStyleFields(edit.format),
              range: {
                endIndex: startIndex + edit.text.length,
                startIndex,
              },
              textStyle: docsTextStyle(edit.format),
            },
          });
        }
      }
    });
    await docsBatchUpdate(input.fileId, requests);
  }
}

function sheetColumnLetter(columnIndex: number) {
  let value = columnIndex;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result || "A";
}

function sheetsCellFormat(format: TemplateFieldFormat) {
  const foreground = hexToRgb(format.textColor || "")?.color?.rgbColor;
  const background = hexToRgb(format.backgroundColor || "")?.color?.rgbColor;
  return {
    backgroundColor: background,
    borders: format.border
      ? {
          bottom: {
            color: { red: 0.1, green: 0.25, blue: 0.22 },
            style: "SOLID",
          },
          left: {
            color: { red: 0.1, green: 0.25, blue: 0.22 },
            style: "SOLID",
          },
          right: {
            color: { red: 0.1, green: 0.25, blue: 0.22 },
            style: "SOLID",
          },
          top: { color: { red: 0.1, green: 0.25, blue: 0.22 }, style: "SOLID" },
        }
      : undefined,
    horizontalAlignment: format.alignment?.toUpperCase(),
    textFormat: {
      bold: Boolean(format.bold),
      fontFamily: format.fontFamily || "Times New Roman",
      fontSize: format.fontSize || 12,
      foregroundColor: foreground,
      italic: Boolean(format.italic),
      underline: Boolean(format.underline),
    },
    wrapStrategy: "WRAP",
  };
}

async function renderGoogleSpreadsheet(input: {
  fileId: string;
  scalarReplacements: Map<string, string>;
  tableRows: Record<string, Array<Record<string, string>>>;
  template: TemplateRecord;
}) {
  const client = await getTemplateGoogleClient();
  const meta = await client.request<{
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  }>({
    params: { fields: "sheets(properties(sheetId,title))" },
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.fileId)}`,
  });
  const sheetMap = new Map(
    (meta.data.sheets || []).map((sheet) => [
      text(sheet.properties?.title),
      numberValue(sheet.properties?.sheetId),
    ]),
  );
  const structuralRequests: JsonRecord[] = [];
  const tableKeys = [
    ...new Set(
      input.template.fieldConfigs
        .filter((field) => field.isTableField)
        .map((field) => field.tableKey),
    ),
  ];
  tableKeys.forEach((tableKey) => {
    const fields = input.template.fieldConfigs.filter(
      (field) => field.tableKey === tableKey,
    );
    const hint = fields.flatMap((field) => field.scanHints)[0];
    if (!hint) return;
    const sheetId = sheetMap.get(hint.sheetName);
    const rowCount = Math.max(input.tableRows[tableKey]?.length || 1, 1);
    if (sheetId == null || rowCount <= 1) return;
    structuralRequests.push({
      insertDimension: {
        inheritFromBefore: true,
        range: {
          dimension: "ROWS",
          endIndex: hint.rowIndex - 1 + rowCount,
          sheetId,
          startIndex: hint.rowIndex,
        },
      },
    });
    structuralRequests.push({
      copyPaste: {
        destination: {
          endRowIndex: hint.rowIndex - 1 + rowCount,
          sheetId,
          startRowIndex: hint.rowIndex,
        },
        pasteType: "PASTE_NORMAL",
        source: {
          endRowIndex: hint.rowIndex,
          sheetId,
          startRowIndex: hint.rowIndex - 1,
        },
      },
    });
  });
  if (structuralRequests.length) {
    await client.request({
      data: { requests: structuralRequests },
      method: "POST",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.fileId)}:batchUpdate`,
    });
  }
  const replacementRequests: JsonRecord[] = [
    ...input.scalarReplacements.entries(),
  ].map(([find, replacement]) => ({
    findReplace: {
      allSheets: true,
      find,
      matchCase: true,
      replacement,
    },
  }));
  const formatRequests: JsonRecord[] = [];
  input.template.fieldConfigs
    .filter((field) => !field.isTableField)
    .forEach((field) => {
      field.scanHints.forEach((hint) => {
        const sheetId = sheetMap.get(hint.sheetName);
        if (sheetId == null || !hint.rowIndex || !hint.columnIndex) return;
        formatRequests.push({
          repeatCell: {
            cell: { userEnteredFormat: sheetsCellFormat(field.format) },
            fields: "userEnteredFormat",
            range: {
              endColumnIndex: hint.columnIndex,
              endRowIndex: hint.rowIndex,
              sheetId,
              startColumnIndex: hint.columnIndex - 1,
              startRowIndex: hint.rowIndex - 1,
            },
          },
        });
      });
    });
  const valueUpdates: Array<{ range: string; values: string[][] }> = [];
  tableKeys.forEach((tableKey) => {
    const fields = input.template.fieldConfigs.filter(
      (field) => field.tableKey === tableKey,
    );
    const rows = input.tableRows[tableKey]?.length
      ? input.tableRows[tableKey]
      : [{}];
    fields.forEach((field) => {
      const hints = field.scanHints.filter(
        (hint) => hint.tableKey === tableKey,
      );
      hints.forEach((hint) => {
        const sheetId = sheetMap.get(hint.sheetName);
        rows.forEach((row, rowIndex) => {
          const targetRow = hint.rowIndex + rowIndex;
          valueUpdates.push({
            range: `'${hint.sheetName.replace(/'/g, "''")}'!${sheetColumnLetter(hint.columnIndex)}${targetRow}`,
            values: [[formatFieldValue(row[field.fieldId], field)]],
          });
          if (sheetId != null) {
            formatRequests.push({
              repeatCell: {
                cell: { userEnteredFormat: sheetsCellFormat(field.format) },
                fields: "userEnteredFormat",
                range: {
                  endColumnIndex: hint.columnIndex,
                  endRowIndex: targetRow,
                  sheetId,
                  startColumnIndex: hint.columnIndex - 1,
                  startRowIndex: targetRow - 1,
                },
              },
            });
          }
        });
      });
    });
  });
  if (replacementRequests.length || formatRequests.length) {
    await client.request({
      data: { requests: [...replacementRequests, ...formatRequests] },
      method: "POST",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.fileId)}:batchUpdate`,
    });
  }
  if (valueUpdates.length) {
    await client.request({
      data: {
        data: valueUpdates,
        valueInputOption: "USER_ENTERED",
      },
      method: "POST",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.fileId)}/values:batchUpdate`,
    });
  }
}

function safeOutputName(templateName: string, actorName: string) {
  const date = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .format(new Date())
    .replace(/\//g, "-");
  return `${templateName} - ${actorName} - ${date}`.slice(0, 180);
}

function templateSignDate(value: unknown) {
  const raw = text(value);
  if (!raw) return new Date();
  const vietnamese = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = vietnamese
    ? `${vietnamese[3]}-${vietnamese[2].padStart(2, "0")}-${vietnamese[1].padStart(2, "0")}`
    : raw.slice(0, 10);
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function templateNumberingParams(
  template: TemplateRecord,
  session: AppSession,
  payload: TemplateOutputPayload,
) {
  if (!template.numbering.documentTypeId) return null;
  const scalarValues = payload.scalarValues || {};
  const context = normalizeExecutionContext(payload.context);
  const companyId = text(payload.companyId || context.companyId);
  if (!companyId) {
    throw new TemplateRuntimeError(
      "Vui lòng chọn pháp nhân trước khi tạo biểu mẫu có cấp số.",
    );
  }
  return {
    companyId,
    createdById: session.userId,
    createdByName: session.displayName,
    documentTypeId: template.numbering.documentTypeId,
    note: `Biểu mẫu · ${template.templateName}`,
    partnerAbbr: template.numbering.customTextFieldId
      ? text(scalarValues[template.numbering.customTextFieldId])
      : null,
    partnerName: template.templateName,
    signDate: template.numbering.signDateFieldId
      ? templateSignDate(scalarValues[template.numbering.signDateFieldId])
      : new Date(),
  };
}

async function buildTemplateOutput(
  template: TemplateRecord,
  session: AppSession,
  payload: TemplateOutputPayload,
  draft: boolean,
  systemOverrides: Record<string, string> = {},
): Promise<TemplateOutputResult> {
  const resolved = await resolveOutputValues(
    template,
    session,
    payload,
    systemOverrides,
  );
  const name = `${draft ? "[NHÁP] " : ""}${safeOutputName(
    template.templateName,
    resolved.actor.displayName,
  )}`;
  if (draft) {
    const folderId = await getTemplateFolderId();
    const copiedResult = await copyDriveFileWithFallback(
      template.workingFileId,
      `${name} - nguồn PDF`,
      folderId,
    );
    const copied = copiedResult.file;
    if (!copied.id) {
      throw new TemplateRuntimeError(
        "Google Drive không trả ID file tạm để xuất PDF nháp.",
      );
    }
    try {
      if (template.fileType === "spreadsheet") {
        await renderGoogleSpreadsheet({
          fileId: copied.id,
          scalarReplacements: resolved.scalarReplacements,
          tableRows: resolved.tableRows,
          template,
        });
      } else {
        await renderGoogleDocument({
          fileId: copied.id,
          scalarReplacements: resolved.scalarReplacements,
          tableRows: resolved.tableRows,
          template,
        });
      }
      const pdfBuffer = await exportGoogleFileAsPdf(copied.id);
      return await storeTemplatePdf({
        buffer: pdfBuffer,
        draft: true,
        fileName: `${name}.pdf`,
        session,
        templateId: template.templateId,
      });
    } finally {
      await trashDriveFile(copied.id);
    }
  }
  const folderId = await getTemplateFolderId();
  const copiedResult = await copyDriveFileWithFallback(
    template.workingFileId,
    name,
    folderId,
  );
  const copied = copiedResult.file;
  if (!copied.id) {
    throw new TemplateRuntimeError("Google Drive không trả ID file đầu ra.");
  }
  try {
    if (template.fileType === "spreadsheet") {
      await renderGoogleSpreadsheet({
        fileId: copied.id,
        scalarReplacements: resolved.scalarReplacements,
        tableRows: resolved.tableRows,
        template,
      });
    } else {
      await renderGoogleDocument({
        fileId: copied.id,
        scalarReplacements: resolved.scalarReplacements,
        tableRows: resolved.tableRows,
        template,
      });
    }
    const outputUrl =
      copied.webViewLink || buildDriveUrl(copied.id, template.fileType);
    return {
      generatedAt: new Date().toISOString(),
      outputFileId: copied.id,
      outputFileName: copied.name,
      outputUrl,
      previewUrl:
        template.fileType === "document"
          ? `https://docs.google.com/document/d/${encodeURIComponent(copied.id)}/preview`
          : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(copied.id)}/preview`,
    };
  } catch (error) {
    await trashDriveFile(copied.id);
    throw error;
  }
}

export type EvaluationTemplatePdfAttachment = {
  content: Buffer;
  contentType: "application/pdf";
  fileName: string;
};

export type EvaluationAttachmentNumberingMode = "issue" | "preview" | "none";

export type EvaluationTemplatePdfInput = {
  evaluationContentOverrides?: JsonRecord;
  evaluationInstanceId: string;
  mergeOverrides?: Record<string, unknown>;
  numberingMode?: EvaluationAttachmentNumberingMode;
  recipientEmployeeCode?: string;
  reviewerRole?: string;
  templateId: string;
};

async function evaluationAttachmentNumberingOverrides(input: {
  evaluationInstanceId: string;
  mode: EvaluationAttachmentNumberingMode;
  payload: TemplateOutputPayload;
  session: AppSession;
  subjectName: string;
  template: TemplateRecord;
}) {
  const numberingParams = templateNumberingParams(
    input.template,
    input.session,
    input.payload,
  );
  if (!numberingParams || input.mode === "none") {
    return {
      documentNumber: "",
      documentTypeName: numberingParams
        ? input.template.numbering.documentTypeName
        : "",
    };
  }
  if (input.mode === "preview") {
    const preview = await previewDocumentNumber(getDb(), numberingParams);
    if (!preview.ok) throw new TemplateRuntimeError(preview.error);
    return {
      documentNumber: preview.documentNumber,
      documentTypeName: input.template.numbering.documentTypeName,
    };
  }

  // Một phiếu + một biểu mẫu chỉ được cấp một số. Khi email được gửi lại,
  // gửi cho nhiều vai trò hoặc worker retry, dùng lại đúng số đã phát hành.
  const note = `evaluation-mail-template:${input.evaluationInstanceId}:${input.template.templateId}`;
  const existing = await getDb().documentRegistry.findFirst({
    orderBy: { createdAt: "asc" },
    select: { documentNumber: true },
    where: {
      companyId: numberingParams.companyId,
      documentTypeId: numberingParams.documentTypeId,
      note,
      status: "ISSUED",
    },
  });
  if (existing?.documentNumber) {
    return {
      documentNumber: existing.documentNumber,
      documentTypeName: input.template.numbering.documentTypeName,
    };
  }
  const issued = await issueDocumentNumber(getDb(), {
    ...numberingParams,
    note,
    partnerName: `${input.template.templateName} · ${input.subjectName}`,
  });
  if (!issued.ok) throw new TemplateRuntimeError(issued.error);
  return {
    documentNumber: issued.documentNumber,
    documentTypeName: input.template.numbering.documentTypeName,
  };
}

async function prepareEvaluationTemplatePdf(input: EvaluationTemplatePdfInput) {
  const template = await findTemplateRecord(text(input.templateId));
  if (!template || !isTemplateActive(template.status)) {
    throw new TemplateRuntimeError(
      "Biểu mẫu PDF đính kèm không còn hoạt động.",
      404,
    );
  }
  const evaluationInstanceId = text(input.evaluationInstanceId);
  const evaluationInstance =
    await findTemplateEvaluationInstance(evaluationInstanceId);
  if (!evaluationInstance) {
    throw new TemplateRuntimeError(
      "Không tìm thấy phiếu đánh giá để sinh PDF đính kèm.",
      404,
    );
  }
  const instanceContent = asRecord(evaluationInstance.content);
  const subjectEmployeeCode = text(instanceContent.employeeCode);
  const subjectEmployee = subjectEmployeeCode
    ? await getDb().employee.findUnique({
        select: {
          companyId: true,
          fullName: true,
          user: { select: { id: true } },
        },
        where: { employeeCode: subjectEmployeeCode },
      })
    : null;
  const subjectName = text(
    subjectEmployee?.fullName ||
      instanceContent.employeeName ||
      evaluationInstance.name ||
      subjectEmployeeCode ||
      "Nhân sự",
  );
  const systemSession: AppSession = {
    displayName: subjectName,
    fullAccess: true,
    moduleGroups: ["admin-hanh-chinh"],
    modules: ["template-management", "templates"],
    permissions: [],
    roles: ["super-admin"],
    userId:
      subjectEmployee?.user?.id || `evaluation-mail:${evaluationInstance.id}`,
  };
  const requestedOverrides = asRecord(input.mergeOverrides);
  const scalarValues = Object.fromEntries(
    template.fieldConfigs
      .filter(
        (field) =>
          !field.isTableField &&
          field.allowOverride &&
          field.manualInputType !== "formula" &&
          Object.prototype.hasOwnProperty.call(requestedOverrides, field.fieldId),
      )
      .map((field) => [field.fieldId, text(requestedOverrides[field.fieldId])]),
  );
  const payload: TemplateOutputPayload = {
    companyId: subjectEmployee?.companyId || "",
    context: {
      companyId: subjectEmployee?.companyId || "",
      evaluationInstanceId,
      recipientEmployeeCode: text(input.recipientEmployeeCode),
      reviewerRole: text(input.reviewerRole),
      subjectEmployeeCode,
    },
    evaluationContentOverrides: asRecord(input.evaluationContentOverrides),
    scalarValues,
    tableRows: {},
    templateId: template.templateId,
  };
  return {
    evaluationInstanceId,
    payload,
    subjectEmployeeCode,
    subjectName,
    systemSession,
    template,
  };
}

async function resolveEvaluationTemplatePdf(
  prepared: Awaited<ReturnType<typeof prepareEvaluationTemplatePdf>>,
  numberingMode: EvaluationAttachmentNumberingMode,
) {
  const {
    evaluationInstanceId,
    payload,
    subjectName,
    systemSession,
    template,
  } = prepared;
  // Nguồn của phiếu đánh giá được resolve tự động, nên phải lấy giá trị thật
  // trước khi xác định ngày/ký hiệu cấp số (payload ban đầu không có input tay).
  const resolvedSourceValues = await resolveOutputValues(
    template,
    systemSession,
    payload,
  );
  const numberingOverrides = await evaluationAttachmentNumberingOverrides({
    evaluationInstanceId,
    mode: numberingMode,
    payload: {
      ...payload,
      scalarValues: resolvedSourceValues.scalarValues,
    },
    session: systemSession,
    subjectName,
    template,
  });
  const resolved = await resolveOutputValues(
    template,
    systemSession,
    payload,
    numberingOverrides,
  );
  const outputName = safeOutputName(template.templateName, subjectName);
  return { numberingOverrides, outputName, resolved };
}

export async function previewEvaluationTemplatePdfMerge(
  input: EvaluationTemplatePdfInput,
) {
  const prepared = await prepareEvaluationTemplatePdf(input);
  const output = await resolveEvaluationTemplatePdf(
    prepared,
    input.numberingMode || "preview",
  );
  return {
    documentNumber: output.numberingOverrides.documentNumber,
    evaluationInstanceId: prepared.evaluationInstanceId,
    mergeValues: Object.fromEntries(
      prepared.template.fieldConfigs
        .filter((field) => !field.isTableField)
        .map((field) => [
          field.placeholder,
          formatFieldValue(output.resolved.scalarValues[field.fieldId], field),
        ]),
    ),
    fields: prepared.template.fieldConfigs
      .filter((field) => !field.isTableField)
      .map((field) => ({
        allowOverride:
          field.allowOverride && field.manualInputType !== "formula",
        displayValue: formatFieldValue(
          output.resolved.scalarValues[field.fieldId],
          field,
        ),
        fieldId: field.fieldId,
        inputType: field.manualInputType,
        label: field.manualLabel || field.placeholder,
        options: field.options,
        placeholder: field.placeholder,
        value: output.resolved.scalarValues[field.fieldId] || "",
      })),
    outputFileName: `${output.outputName}.pdf`,
    subjectEmployeeCode: prepared.subjectEmployeeCode,
    subjectName: prepared.subjectName,
    templateId: prepared.template.templateId,
    templateName: prepared.template.templateName,
  };
}

export async function generateEvaluationTemplatePdfAttachment(
  input: EvaluationTemplatePdfInput,
): Promise<EvaluationTemplatePdfAttachment> {
  const prepared = await prepareEvaluationTemplatePdf(input);
  const { outputName, resolved } = await resolveEvaluationTemplatePdf(
    prepared,
    input.numberingMode || "issue",
  );
  const { template } = prepared;
  const folderId = await getTemplateFolderId();
  const copiedResult = await copyDriveFileWithFallback(
    template.workingFileId,
    `[MAIL] ${outputName} - nguồn PDF`,
    folderId,
  );
  const copied = copiedResult.file;
  if (!copied.id) {
    throw new TemplateRuntimeError(
      "Google Drive không trả ID file tạm để sinh PDF đính kèm.",
    );
  }
  try {
    if (template.fileType === "spreadsheet") {
      await renderGoogleSpreadsheet({
        fileId: copied.id,
        scalarReplacements: resolved.scalarReplacements,
        tableRows: resolved.tableRows,
        template,
      });
    } else {
      await renderGoogleDocument({
        fileId: copied.id,
        scalarReplacements: resolved.scalarReplacements,
        tableRows: resolved.tableRows,
        template,
      });
    }
    return {
      content: await exportGoogleFileAsPdf(copied.id),
      contentType: "application/pdf",
      fileName: `${outputName}.pdf`,
    };
  } finally {
    await trashDriveFile(copied.id);
  }
}

async function appendTemplateHistory(
  session: AppSession,
  template: TemplateRecord,
  payload: TemplateOutputPayload,
  output: TemplateOutputResult,
) {
  const actor = await resolveTemplateActor(session);
  const historyId = `TPLH-${randomBytes(5).toString("hex").toUpperCase()}`;
  const db = getDb();
  const content = {
    "File kết quả ID": output.outputFileId,
    "File kết quả URL": output.outputUrl,
    "JSON dữ liệu": JSON.stringify({
      companyId: payload.companyId || "",
      note: payload.note || "",
      scalarValues: payload.scalarValues || {},
      tableRows: payload.tableRows || {},
    }),
    "Mã biểu mẫu": template.templateId,
    "Mã lịch sử": historyId,
    "Mã nhân sự": actor.employeeCode,
    "Mã sổ văn bản": output.documentRegistryId || "",
    "Ngày tạo": output.generatedAt,
    "Người tạo": actor.displayName,
    "Số văn bản": output.documentNumber || "",
    "Tên biểu mẫu": template.templateName,
    "Loại hồ sơ đánh số": output.documentTypeName || "",
  };
  const history = await db.configurationRecord.create({
    data: {
      code: historyId,
      content: content as Prisma.InputJsonValue,
      name: template.templateName,
      recordType: "template-history",
      sourceRow: await nextConfigurationSourceRow("template-history"),
      sourceSheet: "05_Biểu mẫu lịch sử",
    },
  });
  await db.auditLog.create({
    data: {
      action: "CREATE",
      actorId: session.userId,
      metadata: {
        historyId,
        documentNumber: output.documentNumber || "",
        documentRegistryId: output.documentRegistryId || "",
        outputFileId: output.outputFileId,
        templateId: template.templateId,
      },
      summary: `Generated template output ${historyId}.`,
      targetId: history.id,
      targetType: "ConfigurationRecord",
    },
  });
}

export async function generateTemplateDraftPreview(
  session: AppSession,
  payload: TemplateOutputPayload,
) {
  assertTemplateUser(session);
  const template = await findTemplateRecord(text(payload.templateId));
  if (!template)
    throw new TemplateRuntimeError("Không tìm thấy biểu mẫu.", 404);
  if (payload.previousDraftFileId) {
    const previousId = text(payload.previousDraftFileId);
    if (!(await deleteStoredTemplatePdf(previousId))) {
      await trashDriveFile(previousId);
    }
  }
  const numberingParams = templateNumberingParams(template, session, payload);
  const numberingPreview = numberingParams
    ? await previewDocumentNumber(getDb(), numberingParams)
    : null;
  if (numberingPreview && !numberingPreview.ok) {
    throw new TemplateRuntimeError(numberingPreview.error);
  }
  return buildTemplateOutput(template, session, payload, true, {
    documentNumber: numberingPreview?.ok ? numberingPreview.documentNumber : "",
    documentTypeName: numberingParams
      ? template.numbering.documentTypeName
      : "",
  });
}

export async function deleteTemplateDraftPreview(
  session: AppSession,
  payload: JsonRecord,
) {
  assertTemplateUser(session);
  const fileId = text(payload.draftFileId || payload.fileId);
  if (!(await deleteStoredTemplatePdf(fileId))) {
    await trashDriveFile(fileId);
  }
  return { ok: true };
}

export async function generateTemplateOutput(
  session: AppSession,
  payload: TemplateOutputPayload,
) {
  assertTemplateUser(session);
  const template = await findTemplateRecord(text(payload.templateId));
  if (!template || !isTemplateActive(template.status)) {
    throw new TemplateRuntimeError("Không tìm thấy biểu mẫu cần tạo.", 404);
  }
  const numberingParams = templateNumberingParams(template, session, payload);
  const issued = numberingParams
    ? await issueDocumentNumber(getDb(), numberingParams)
    : null;
  if (issued && !issued.ok) {
    throw new TemplateRuntimeError(issued.error);
  }
  let output: TemplateOutputResult | null = null;
  try {
    output = await buildTemplateOutput(template, session, payload, false, {
      documentNumber: issued?.ok ? issued.documentNumber : "",
      documentTypeName: numberingParams
        ? template.numbering.documentTypeName
        : "",
    });
    const completedOutput: TemplateOutputResult = {
      ...output,
      ...(issued?.ok
        ? {
            documentNumber: issued.documentNumber,
            documentRegistryId: issued.id,
            documentTypeName: template.numbering.documentTypeName,
          }
        : {}),
    };
    await appendTemplateHistory(session, template, payload, completedOutput);
    return completedOutput;
  } catch (error) {
    if (output?.outputFileId) await trashDriveFile(output.outputFileId);
    if (issued?.ok) {
      await getDb().documentRegistry.updateMany({
        data: {
          note: `Hủy tự động vì tạo biểu mẫu thất bại · ${template.templateName}`,
          status: "CANCELLED",
        },
        where: { id: issued.id, status: "ISSUED" },
      });
    }
    throw error;
  }
}

export async function deleteTemplateHistory(
  session: AppSession,
  payload: JsonRecord,
) {
  assertTemplateManager(session);
  const id = text(payload.id || payload.historyId);
  const reason = text(payload.reason);
  if (!reason) {
    throw new TemplateRuntimeError("Vui lòng nhập lý do xóa lịch sử.");
  }
  const db = getDb();
  const row = await db.configurationRecord.findFirst({
    where: {
      recordType: "template-history",
      OR: [{ id }, { code: id }],
    },
  });
  if (!row) throw new TemplateRuntimeError("Không tìm thấy lịch sử.", 404);
  const history = historyRecordFromDb(row);
  if (
    history.outputFileId &&
    !(await deleteStoredTemplatePdf(history.outputFileId))
  ) {
    await trashDriveFile(history.outputFileId);
  }
  await db.configurationRecord.delete({ where: { id: row.id } });
  await db.auditLog.create({
    data: {
      action: "DELETE",
      actorId: session.userId,
      metadata: { reason },
      summary: `Deleted template history ${history.historyId}: ${reason}`,
      targetId: row.id,
      targetType: "ConfigurationRecord",
    },
  });
  return getTemplateManagementSnapshot(session);
}

export async function dispatchTemplateRpc(
  session: AppSession,
  method: string,
  payload: JsonRecord,
) {
  switch (method) {
    case "getTemplateManagementData":
      return getTemplateManagementSnapshot(session);
    case "getTemplateWorkspaceData":
      return getTemplateWorkspaceSnapshot(session);
    case "getTemplateFormDefinition":
      return getTemplateFormDefinition(session, payload);
    case "saveTemplateConfig":
      return saveTemplateConfig(session, payload);
    case "setTemplateStatus":
      return setTemplateStatus(session, payload);
    case "generateTemplateDraftPreview":
      return generateTemplateDraftPreview(
        session,
        payload as TemplateOutputPayload,
      );
    case "deleteTemplateDraftPreview":
      return deleteTemplateDraftPreview(session, payload);
    case "generateTemplateOutput":
      return generateTemplateOutput(session, payload as TemplateOutputPayload);
    case "deleteTemplateHistory":
      return deleteTemplateHistory(session, payload);
    default:
      throw new TemplateRuntimeError(
        `Phương thức Biểu mẫu không được hỗ trợ: ${method}`,
        404,
      );
  }
}
