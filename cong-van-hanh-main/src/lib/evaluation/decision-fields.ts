import {
  evaluationMailHtmlToText,
  sanitizeEvaluationMailHtml,
} from "./mail-template";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function valueText(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function comparable(value: unknown) {
  const normalized = valueText(value).toLocaleLowerCase("vi");
  if (["có", "co", "true"].includes(normalized)) return "yes";
  if (["không", "khong", "false"].includes(normalized)) return "no";
  return normalized;
}

export function evaluationDecisionAnswerValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean);
  const raw = valueText(value);
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(valueText).filter(Boolean);
    } catch {
      // Dữ liệu cũ có thể là chuỗi thường; giữ nguyên bên dưới.
    }
  }
  return [raw];
}

function configuredValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean);
  return valueText(value)
    .split(/[|;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function evaluationDecisionFieldIsVisible(
  fieldContent: JsonRecord,
  answers: JsonRecord,
) {
  const condition = record(fieldContent.visibilityCondition);
  const sourceFieldCode = valueText(
    condition.sourceFieldCode ||
      fieldContent.dependsOnFieldCode ||
      fieldContent.showWhenFieldCode,
  );
  if (!sourceFieldCode) return true;

  const actual = new Set(
    evaluationDecisionAnswerValues(answers[sourceFieldCode]).map(comparable),
  );
  const included = configuredValues(
    condition.includeValues ||
      fieldContent.conditionValues ||
      fieldContent.dependsOnValue ||
      fieldContent.showWhenValue,
  ).map(comparable);
  const excluded = configuredValues(
    condition.excludeValues || fieldContent.conditionExcludedValues,
  ).map(comparable);
  const mode =
    valueText(condition.matchMode || fieldContent.conditionMatchMode).toLowerCase() ===
    "all"
      ? "all"
      : "any";

  if (excluded.some((value) => actual.has(value))) return false;
  if (!included.length) return actual.size > 0;
  return mode === "all"
    ? included.every((value) => actual.has(value))
    : included.some((value) => actual.has(value));
}

export function evaluationDecisionAnswerIsPresent(
  value: unknown,
  fieldType: string,
) {
  if (fieldType === "multi_choice") {
    return evaluationDecisionAnswerValues(value).length > 0;
  }
  if (fieldType === "duration") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const duration = record(value);
      const unit = valueText(duration.unit).toLocaleLowerCase("vi");
      return (
        Boolean(duration.permanent) ||
        ["forever", "permanent", "vinh_vien", "vĩnh viễn"].includes(unit) ||
        Number(duration.amount) > 0
      );
    }
    const raw = valueText(value);
    if (!raw) return false;
    if (["permanent", "vinh_vien", "vĩnh viễn"].includes(raw.toLowerCase())) {
      return true;
    }
    try {
      const duration = record(JSON.parse(raw));
      const unit = valueText(duration.unit).toLocaleLowerCase("vi");
      return (
        Boolean(duration.permanent) ||
        ["forever", "permanent", "vinh_vien", "vĩnh viễn"].includes(unit) ||
        Number(duration.amount) > 0
      );
    } catch {
      return Number(raw.split(/[:|\s]+/)[0]) > 0;
    }
  }
  return Boolean(valueText(value));
}

export function evaluationDecisionQuestionHtml(fieldContent: JsonRecord) {
  return sanitizeEvaluationMailHtml(
    fieldContent.labelHtml || fieldContent.fieldLabelHtml || "",
  );
}

export function evaluationDecisionQuestionText(
  fieldContent: JsonRecord,
  fallback = "",
) {
  const html = evaluationDecisionQuestionHtml(fieldContent);
  const plainText = html
    ? evaluationMailHtmlToText(
        html.replace(
          /<(?:p|div|h1|h2|h3|blockquote|tr)(?:\s[^>]*)?>/gi,
          "\n",
        ),
      ).replace(/\n{2,}/g, "\n")
    : "";
  return (plainText || valueText(fallback)).normalize("NFC");
}
