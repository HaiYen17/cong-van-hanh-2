export type DigitalSignatureSummary = {
  counterparty: string;
  documentType: string;
  summary: string;
  value: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseDigitalSummary(text: string): DigitalSignatureSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error("AI chưa trả tóm tắt JSON hợp lệ.");
  }
  const data = objectValue(parsed);
  const result = Object.fromEntries(
    ["documentType", "counterparty", "value", "summary"].map((key) => {
      if (
        data[key] !== null &&
        data[key] !== undefined &&
        typeof data[key] !== "string"
      ) {
        throw new Error("AI trả tóm tắt sai cấu trúc.");
      }
      return [
        key,
        String(data[key] || "").trim().slice(0, key === "summary" ? 12_000 : 2_000),
      ];
    }),
  ) as DigitalSignatureSummary;
  if (!result.summary) throw new Error("AI chưa trả nội dung tóm tắt.");
  return result;
}
