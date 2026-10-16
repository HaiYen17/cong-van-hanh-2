import { asRecord, booleanValue, numberValue, text, type JsonRecord } from "@/lib/operations/json";

type DecisionCalculationField = {
  code?: unknown;
  content?: unknown;
  id?: unknown;
};

type NormalizedDuration = {
  amount: number;
  permanent: boolean;
  unit: "" | "day" | "month" | "year";
};

function normalizedDurationUnit(value: unknown) {
  const unit = text(value).toLocaleLowerCase("vi");
  if (["day", "days", "ngay", "ngày"].includes(unit)) return "day";
  if (["month", "months", "thang", "tháng"].includes(unit)) return "month";
  if (["year", "years", "nam", "năm"].includes(unit)) return "year";
  return "";
}

export function normalizeEvaluationDecisionDuration(
  value: unknown,
): NormalizedDuration {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = asRecord(value);
    const rawUnit = text(record.unit).toLocaleLowerCase("vi");
    return {
      amount: Math.max(0, Math.floor(numberValue(record.amount))),
      permanent:
        booleanValue(record.permanent) ||
        ["forever", "permanent", "vinh_vien", "vĩnh viễn"].includes(
          rawUnit,
        ),
      unit: normalizedDurationUnit(rawUnit),
    };
  }
  const raw = text(value);
  if (!raw) return { amount: 0, permanent: false, unit: "" };
  if (
    ["forever", "permanent", "vinh_vien", "vĩnh viễn"].includes(
      raw.toLocaleLowerCase("vi"),
    )
  ) {
    return { amount: 0, permanent: true, unit: "" };
  }
  try {
    return normalizeEvaluationDecisionDuration(JSON.parse(raw));
  } catch {
    const [amount, unit] = raw.split(/[:|\s]+/);
    return {
      amount: Math.max(0, Math.floor(numberValue(amount))),
      permanent: false,
      unit: normalizedDurationUnit(unit),
    };
  }
}

function validUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseEvaluationDecisionDate(value: unknown) {
  const raw = text(value);
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (match) {
    return validUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (!match) return null;
  return validUtcDate(Number(match[3]), Number(match[2]), Number(match[1]));
}

function daysInUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addUtcMonthsClamped(date: Date, amount: number) {
  const sourceDay = date.getUTCDate();
  const targetMonthIndex = date.getUTCMonth() + amount;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  date.setUTCFullYear(
    targetYear,
    normalizedMonth,
    Math.min(sourceDay, daysInUtcMonth(targetYear, normalizedMonth)),
  );
}

function addUtcYearsClamped(date: Date, amount: number) {
  const sourceDay = date.getUTCDate();
  const targetYear = date.getUTCFullYear() + amount;
  const month = date.getUTCMonth();
  date.setUTCFullYear(
    targetYear,
    month,
    Math.min(sourceDay, daysInUtcMonth(targetYear, month)),
  );
}

export function calculateEvaluationDecisionEndDate(
  startValue: unknown,
  durationValue: unknown,
) {
  const duration = normalizeEvaluationDecisionDuration(durationValue);
  if (duration.permanent) return "Vĩnh viễn";
  if (!duration.amount || !duration.unit) return "";
  const date = parseEvaluationDecisionDate(startValue);
  if (!date) return "";
  if (duration.unit === "day") {
    date.setUTCDate(date.getUTCDate() + duration.amount);
  } else if (duration.unit === "month") {
    addUtcMonthsClamped(date, duration.amount);
  } else {
    addUtcYearsClamped(date, duration.amount);
  }
  return date.toISOString().slice(0, 10);
}

export function applyEvaluationDecisionCalculations(
  fields: DecisionCalculationField[],
  answers: JsonRecord,
) {
  const calculatedFields = fields.filter((field) => {
    const content = asRecord(field.content);
    return text(content.fieldType || content.type).toLowerCase() === "calculated_date";
  });
  for (let pass = 0; pass <= calculatedFields.length; pass += 1) {
    let changed = false;
    for (const field of calculatedFields) {
      const content = asRecord(field.content);
      const code = text(field.code || field.id);
      if (!code) continue;
      const calculated = calculateEvaluationDecisionEndDate(
        answers[
          text(content.calculationStartFieldCode || content.startFieldCode)
        ],
        answers[
          text(
            content.calculationDurationFieldCode ||
              content.durationFieldCode,
          )
        ],
      );
      if (answers[code] === calculated) continue;
      answers[code] = calculated;
      changed = true;
    }
    if (!changed) break;
  }
  return answers;
}
