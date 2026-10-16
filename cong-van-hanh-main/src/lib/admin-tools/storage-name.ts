export type StorageNameInput = {
  companyName?: string | null;
  companyShortName?: string | null;
  counterparty?: string | null;
  documentTypeName?: string | null;
  issuedDate?: Date | string | null;
  revision?: number | string | null;
  summary?: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function shortDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00.000Z`)
        : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCFullYear()).slice(-2),
  ].join(".");
}

export function normalizeVietnamese(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function isContractLikeDocumentType(value: unknown) {
  const normalized = normalizeVietnamese(value);
  return normalized.startsWith("hop dong") || normalized.startsWith("phu luc");
}

export function buildLegalDossierStorageName(input: StorageNameInput) {
  const companyCode = clean(input.companyShortName || input.companyName);
  const documentTypeName = clean(input.documentTypeName);
  const summary = clean(input.summary);
  const counterparty = clean(input.counterparty);
  const revision = clean(input.revision);
  const issuedDate = shortDate(input.issuedDate);
  const mainParts: string[] = [];
  const tailParts: string[] = [];

  if (companyCode) mainParts.push(`[${companyCode}]`);
  if (documentTypeName) mainParts.push(documentTypeName);
  if (summary) mainParts.push(summary);
  if (counterparty) tailParts.push(counterparty);
  if (revision) tailParts.push(`Lần ${revision}`);
  if (issuedDate) tailParts.push(issuedDate);

  const head = mainParts.join(" - ");
  if (!head) return "";
  return tailParts.length ? `${head} | ${tailParts.join(" | ")}` : head;
}

export function safeStoredFileBaseName(value: unknown) {
  return clean(value)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 170) || "tep-luu-tru";
}
