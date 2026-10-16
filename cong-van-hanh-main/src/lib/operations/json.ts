export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonRecord;
}

export function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

export function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (["1", "true", "yes", "active"].includes(normalized)) return true;
  if (["0", "false", "no", "inactive"].includes(normalized)) return false;
  return fallback;
}

export function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function uniqueCode(prefix: string) {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 7)
    .toUpperCase()}`;
}
