import type {
  TemplateFieldConfig,
  TemplateInputType,
} from "@/lib/templates/types";

export type EmployeeTemplateFieldOption = {
  description?: string;
  inputType: TemplateInputType;
  key: string;
  label: string;
  sensitive?: boolean;
};

export type EmployeeTemplateValueSource = {
  bankAccount?: string | null;
  bankName?: string | null;
  birthDate?: string | null;
  companyId?: string | null;
  department?: string | null;
  email?: string | null;
  employeeCode?: string | null;
  fullName?: string | null;
  identityDate?: string | null;
  identityNumber?: string | null;
  identityPlace?: string | null;
  permanentResidence?: string | null;
  personalTaxCode?: string | null;
  phone?: string | null;
  socialInsuranceNumber?: string | null;
  status?: string | null;
  terminationDate?: string | null;
  title?: string | null;
};

export type TemplateDateParts = {
  day: number;
  month: number;
  year: number;
};

const SENSITIVE_EMPLOYEE_FIELD_KEYS = new Set([
  "age",
  "bankAccount",
  "bankName",
  "birthDate",
  "birthDay",
  "birthMonth",
  "birthYear",
  "identityDate",
  "identityNumber",
  "identityPlace",
  "permanentResidence",
  "personalTaxCode",
  "socialInsuranceNumber",
]);

export const EMPLOYEE_TEMPLATE_FIELD_OPTIONS: EmployeeTemplateFieldOption[] = [
  { inputType: "text", key: "employeeCode", label: "Mã nhân viên" },
  { inputType: "text", key: "fullName", label: "Họ và tên" },
  { inputType: "email", key: "email", label: "Email" },
  { inputType: "text", key: "phone", label: "Số điện thoại" },
  { inputType: "text", key: "department", label: "Phòng ban / khu vực" },
  { inputType: "text", key: "title", label: "Chức vụ / chức danh" },
  {
    description: "Chỉ tự điền từ hồ sơ của người đang thao tác.",
    inputType: "text",
    key: "identityNumber",
    label: "Số CCCD / giấy tờ",
    sensitive: true,
  },
  {
    description:
      "Tự điền từ hồ sơ người thao tác hoặc đúng nhân sự của phiếu đánh giá đang mở.",
    inputType: "text",
    key: "permanentResidence",
    label: "Địa chỉ thường trú",
    sensitive: true,
  },
  {
    description:
      "Tự điền từ hồ sơ người thao tác hoặc đúng nhân sự của phiếu đánh giá đang mở.",
    inputType: "text",
    key: "personalTaxCode",
    label: "Mã số thuế cá nhân",
    sensitive: true,
  },
  {
    description:
      "Tự điền từ hồ sơ người thao tác hoặc đúng nhân sự của phiếu đánh giá đang mở.",
    inputType: "text",
    key: "socialInsuranceNumber",
    label: "Số bảo hiểm xã hội",
    sensitive: true,
  },
  {
    description: "Chỉ tự điền từ hồ sơ của người đang thao tác.",
    inputType: "text",
    key: "identityPlace",
    label: "Nơi cấp CCCD",
    sensitive: true,
  },
  {
    description: "Chỉ tự điền từ hồ sơ của người đang thao tác.",
    inputType: "date",
    key: "identityDate",
    label: "Ngày cấp CCCD",
    sensitive: true,
  },
  {
    description: "Ngày sinh đầy đủ, chuẩn hóa từ DD/MM/YYYY hoặc YYYY-MM-DD.",
    inputType: "date",
    key: "birthDate",
    label: "Ngày sinh",
    sensitive: true,
  },
  {
    description: "Ngày trong tháng suy ra từ ngày sinh.",
    inputType: "number",
    key: "birthDay",
    label: "Ngày sinh (DD)",
    sensitive: true,
  },
  {
    description: "Tháng suy ra từ ngày sinh.",
    inputType: "number",
    key: "birthMonth",
    label: "Tháng sinh (MM)",
    sensitive: true,
  },
  {
    description: "Năm suy ra từ ngày sinh.",
    inputType: "number",
    key: "birthYear",
    label: "Năm sinh (YYYY)",
    sensitive: true,
  },
  {
    description: "Tuổi tròn tính theo ngày hiện tại.",
    inputType: "number",
    key: "age",
    label: "Tuổi hiện tại",
    sensitive: true,
  },
  {
    description: "Chỉ tự điền từ hồ sơ của người đang thao tác.",
    inputType: "text",
    key: "bankName",
    label: "Ngân hàng",
    sensitive: true,
  },
  {
    description: "Chỉ tự điền từ hồ sơ của người đang thao tác.",
    inputType: "text",
    key: "bankAccount",
    label: "Số tài khoản",
    sensitive: true,
  },
  { inputType: "text", key: "status", label: "Trạng thái nhân sự" },
  { inputType: "date", key: "terminationDate", label: "Ngày nghỉ việc" },
];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function validDateParts(day: number, month: number, year: number) {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return { day, month, year };
}

export function parseTemplateDateParts(
  value: unknown,
): TemplateDateParts | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return validDateParts(
      value.getDate(),
      value.getMonth() + 1,
      value.getFullYear(),
    );
  }
  const raw = text(value);
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/);
  if (iso) {
    return validDateParts(Number(iso[3]), Number(iso[2]), Number(iso[1]));
  }
  const compactIso = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactIso) {
    return validDateParts(
      Number(compactIso[3]),
      Number(compactIso[2]),
      Number(compactIso[1]),
    );
  }
  const vietnamese = raw.match(
    /^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})$/,
  );
  if (vietnamese) {
    return validDateParts(
      Number(vietnamese[1]),
      Number(vietnamese[2]),
      Number(vietnamese[3]),
    );
  }
  return null;
}

export function toIsoTemplateDate(value: unknown) {
  const parts = parseTemplateDateParts(value);
  if (!parts) return text(value);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatTemplateDateValue(
  value: unknown,
  format: "dd/mm/yyyy" | "dd-mm-yyyy" | "yyyy-mm-dd" = "dd/mm/yyyy",
) {
  const parts = parseTemplateDateParts(value);
  if (!parts) return text(value);
  const dd = String(parts.day).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  const yyyy = String(parts.year).padStart(4, "0");
  if (format === "yyyy-mm-dd") return `${yyyy}-${mm}-${dd}`;
  if (format === "dd-mm-yyyy") return `${dd}-${mm}-${yyyy}`;
  return `${dd}/${mm}/${yyyy}`;
}

export function calculateEmployeeAge(value: unknown, now = new Date()) {
  const birth = parseTemplateDateParts(value);
  if (!birth) return "";
  const today = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Bangkok",
      year: "numeric",
    })
      .formatToParts(now)
      .filter((part) => ["day", "month", "year"].includes(part.type))
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"day" | "month" | "year", number>;
  let age = today.year - birth.year;
  if (
    today.month < birth.month ||
    (today.month === birth.month && today.day < birth.day)
  ) {
    age -= 1;
  }
  return age >= 0 && age <= 130 ? String(age) : "";
}

export function isSensitiveEmployeeFieldKey(fieldKey: unknown) {
  return SENSITIVE_EMPLOYEE_FIELD_KEYS.has(text(fieldKey));
}

export function sensitiveEmployeeFieldPolicyViolation(field: {
  bindingMode?: unknown;
  contextSource?: unknown;
  datasetKey?: unknown;
  isTableField?: unknown;
  sourceFieldKey?: unknown;
}) {
  if (
    text(field.datasetKey) !== "employee" ||
    !isSensitiveEmployeeFieldKey(field.sourceFieldKey)
  ) {
    return "";
  }
  if (Boolean(field.isTableField)) {
    return "Dữ liệu nhân sự nhạy cảm không được dùng trong bảng chọn nhiều nhân sự.";
  }
  if (
    text(field.bindingMode) !== "scalar-actor" ||
    !["actor", "evaluation-subject"].includes(text(field.contextSource))
  ) {
    return "Dữ liệu nhân sự nhạy cảm chỉ được tự điền từ người đang thao tác hoặc đúng nhân sự của phiếu đánh giá đang mở.";
  }
  return "";
}

export function enforceSensitiveEmployeeFieldPolicy(
  field: TemplateFieldConfig,
): TemplateFieldConfig {
  if (
    field.datasetKey !== "employee" ||
    !isSensitiveEmployeeFieldKey(field.sourceFieldKey)
  ) {
    return field;
  }
  const option = EMPLOYEE_TEMPLATE_FIELD_OPTIONS.find(
    (item) => item.key === field.sourceFieldKey,
  );
  return {
    ...field,
    allowOverride: false,
    bindingMode: "scalar-actor",
    contextSource:
      field.contextSource === "evaluation-subject"
        ? "evaluation-subject"
        : "actor",
    isTableField: false,
    linkGroupKey: "",
    manualInputType: option?.inputType || field.manualInputType,
    tableKey: "",
    tableLabel: "",
  };
}

function employeeStatusLabel(value: unknown) {
  const status = text(value).toUpperCase();
  if (status === "ACTIVE") return "Đang làm việc";
  if (status === "INACTIVE") return "Đã nghỉ / tạm ngưng";
  if (status === "ARCHIVED") return "Đã lưu trữ";
  return text(value);
}

export function buildEmployeeTemplateValues(
  employee: EmployeeTemplateValueSource,
  options: { includeSensitive?: boolean; now?: Date } = {},
) {
  const includeSensitive = options.includeSensitive !== false;
  const birth = parseTemplateDateParts(employee.birthDate);
  const values: Record<string, string> = {
    companyId: text(employee.companyId),
    department: text(employee.department),
    email: text(employee.email),
    employeeCode: text(employee.employeeCode),
    fullName: text(employee.fullName),
    phone: text(employee.phone),
    status: employeeStatusLabel(employee.status),
    terminationDate: toIsoTemplateDate(employee.terminationDate),
    title: text(employee.title),
  };
  if (!includeSensitive) return values;
  return {
    ...values,
    age: calculateEmployeeAge(employee.birthDate, options.now),
    bankAccount: text(employee.bankAccount),
    bankName: text(employee.bankName),
    birthDate: toIsoTemplateDate(employee.birthDate),
    birthDay: birth ? String(birth.day).padStart(2, "0") : "",
    birthMonth: birth ? String(birth.month).padStart(2, "0") : "",
    birthYear: birth ? String(birth.year) : "",
    identityDate: toIsoTemplateDate(employee.identityDate),
    identityNumber: text(employee.identityNumber),
    identityPlace: text(employee.identityPlace),
    permanentResidence: text(employee.permanentResidence),
    personalTaxCode: text(employee.personalTaxCode),
    socialInsuranceNumber: text(employee.socialInsuranceNumber),
  };
}
