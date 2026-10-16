import { parseTemplateDateParts } from "@/lib/templates/employee-fields";

type JsonRecord = Record<string, unknown>;

export type EvaluationTemplateField = {
  code: string;
  fieldType: string;
  label: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function parseObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asRecord(value);
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function formatDate(value: unknown, includeTime = false) {
  const raw = text(value);
  if (!raw) return "";
  const parsedParts = parseTemplateDateParts(raw);
  if (parsedParts && !includeTime) {
    return `${String(parsedParts.day).padStart(2, "0")}/${String(parsedParts.month).padStart(2, "0")}/${String(parsedParts.year).padStart(4, "0")}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      ...(includeTime ? { hour: "2-digit", hourCycle: "h23", minute: "2-digit" } : {}),
      month: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => ["day", "hour", "minute", "month", "year"].includes(part.type))
      .map((part) => [part.type, part.value]),
  );
  const formattedDate = `${parts.day}/${parts.month}/${parts.year}`;
  return includeTime && parts.hour && parts.minute
    ? `${formattedDate} ${parts.hour}:${parts.minute}`
    : formattedDate;
}

function durationUnitLabel(value: unknown) {
  const unit = text(value).toLowerCase();
  if (["day", "days", "ngay", "ngày"].includes(unit)) return "ngày";
  if (["month", "months", "thang", "tháng"].includes(unit)) return "tháng";
  if (["year", "years", "nam", "năm"].includes(unit)) return "năm";
  return unit;
}

export function evaluationTemplateSourceKey(code: unknown) {
  return `evaluationCnb.${text(code)}`;
}

export function formatEvaluationTemplateAnswer(
  value: unknown,
  fieldType: unknown,
) {
  const type = text(fieldType).toLowerCase().replace(/\s+/g, "_");
  if (value == null || value === "") return "";
  if (type === "duration") {
    const duration = parseObject(value);
    const unit = text(duration.unit).toLowerCase();
    if (
      duration.permanent === true ||
      ["forever", "permanent", "vinh_vien", "vĩnh_viễn"].includes(unit)
    ) {
      return "Vĩnh viễn";
    }
    const amount = text(duration.amount);
    return [amount, durationUnitLabel(unit)].filter(Boolean).join(" ");
  }
  if (["date", "calculated_date"].includes(type)) return formatDate(value);
  if (["currency", "number"].includes(type)) {
    const amount = Number(
      text(value).replace(/\s/g, "").replace(/₫|vn(?:d|đ)|đ/gi, "").replace(/[,.](?=\d{3}(?:\D|$))/g, ""),
    );
    return Number.isFinite(amount)
      ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)
      : text(value);
  }
  if (type === "percent") {
    const raw = text(value);
    return raw.endsWith("%") ? raw : `${raw}%`;
  }
  if (type === "yes_no" && typeof value === "boolean") {
    return value ? "Có" : "Không";
  }
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return text(value);
}

export function buildEvaluationTemplateValues(
  resultContentValue: unknown,
  fields: EvaluationTemplateField[],
  instanceContentValue: unknown = {},
) {
  const resultContent = asRecord(resultContentValue);
  const instanceContent = asRecord(instanceContentValue);
  const answers = {
    ...asRecord(instanceContent.cnbConclusionAnswers),
    ...asRecord(resultContent.cnbConclusionAnswers),
  };
  const answerByNormalizedCode = new Map(
    Object.entries(answers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const values: Record<string, string> = {
    evaluationConclusion: text(
      resultContent.decisionOptionLabel || instanceContent.decisionOptionLabel,
    ),
    evaluationFinalScore: text(
      resultContent.finalScore ?? instanceContent.finalScore,
    ),
    evaluationFinalizedAt: formatDate(
      resultContent.finalizedAt || instanceContent.finalizedAt,
      true,
    ),
    evaluationFinalizedBy: text(
      resultContent.finalizedBy || instanceContent.finalizedBy,
    ),
    evaluationHrComment: text(
      resultContent.hrComment || instanceContent.hrComment,
    ),
  };
  const fieldByCode = new Map(
    fields.map((field) => [field.code.toLowerCase(), field]),
  );
  Object.entries(answers).forEach(([code, answer]) => {
    const field = fieldByCode.get(code.toLowerCase());
    const sourceKey = evaluationTemplateSourceKey(code);
    values[sourceKey] = formatEvaluationTemplateAnswer(
      answer,
      field?.fieldType || "text",
    );
    const dateParts = parseTemplateDateParts(answer);
    if (dateParts) {
      values[`${sourceKey}.day`] = String(dateParts.day).padStart(2, "0");
      values[`${sourceKey}.month`] = String(dateParts.month).padStart(2, "0");
      values[`${sourceKey}.year`] = String(dateParts.year).padStart(4, "0");
    }
  });
  fields.forEach((field) => {
    const answer = answerByNormalizedCode.get(field.code.toLowerCase());
    const sourceKey = evaluationTemplateSourceKey(field.code);
    values[sourceKey] = formatEvaluationTemplateAnswer(answer, field.fieldType);
    const dateParts = parseTemplateDateParts(answer);
    if (dateParts) {
      values[`${sourceKey}.day`] = String(dateParts.day).padStart(2, "0");
      values[`${sourceKey}.month`] = String(dateParts.month).padStart(2, "0");
      values[`${sourceKey}.year`] = String(dateParts.year).padStart(4, "0");
    }
  });
  return values;
}
