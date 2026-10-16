export const DIGITAL_SIGNATURE_STAMP = "Ký số";
export const LEGACY_ELECTRONIC_SIGNATURE_STAMP = "Ký điện tử";
// Giữ export cũ để các module lịch sử không bị gãy trong lúc đổi tên nghiệp vụ.
export const ELECTRONIC_SIGNATURE_STAMP = DIGITAL_SIGNATURE_STAMP;
export const ELECTRONIC_SIGNATURE_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ELECTRONIC_SIGNATURE_INPUT_PURPOSE =
  "ELECTRONIC_SIGNATURE_INPUT";
export const ELECTRONIC_SIGNATURE_OUTPUT_PURPOSE =
  "ELECTRONIC_SIGNATURE_OUTPUT";
export const LEGAL_DOSSIER_FILE_ENTITY = "LEGAL_DOSSIER";

export type ElectronicSignatureFileDescriptor = {
  fileId: string;
  mimeType: string;
  name: string;
  size: number;
  url: string;
};

export type DigitalSignaturePlacement = {
  height: number;
  id: string;
  page: number;
  pageHeight: number;
  pageWidth: number;
  width: number;
  x: number;
  y: number;
};

export type DigitalSignatureSummary = {
  counterparty: string;
  documentType: string;
  summary: string;
  value: string;
};

export type ElectronicSignaturePayloadItem = Record<string, unknown>;

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ")
    .trim();
}

function stampsOf(item: ElectronicSignaturePayloadItem) {
  const raw = Array.isArray(item.sealTypes)
    ? item.sealTypes
    : Array.isArray(item.stamps)
      ? item.stamps
      : Array.isArray(item.dau)
        ? item.dau
        : [item.sealTypes ?? item.stamps ?? item.dau].filter(Boolean);
  return raw.map(normalize);
}

export function isElectronicSignatureItem(
  item: ElectronicSignaturePayloadItem,
) {
  const stamps = stampsOf(item);
  return (
    item.electronicSignature === true ||
    item.digitalSignature === true ||
    stamps.includes(normalize(DIGITAL_SIGNATURE_STAMP)) ||
    stamps.includes(normalize(LEGACY_ELECTRONIC_SIGNATURE_STAMP))
  );
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function digitalSignaturePlacements(
  item: ElectronicSignaturePayloadItem,
): DigitalSignaturePlacement[] {
  if (!Array.isArray(item.signaturePlacements)) return [];
  return item.signaturePlacements
    .map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const placement = raw as Record<string, unknown>;
      const page = finiteNumber(placement.page);
      const x = finiteNumber(placement.x);
      const y = finiteNumber(placement.y);
      const width = finiteNumber(placement.width);
      const height = finiteNumber(placement.height);
      const pageWidth = finiteNumber(placement.pageWidth);
      const pageHeight = finiteNumber(placement.pageHeight);
      if (
        !Number.isInteger(page) || page < 1 || page > 2000 ||
        x < 0 ||
        y < 0 ||
        width <= 0 ||
        height <= 0 ||
        x + width > 1.000001 ||
        y + height > 1.000001 ||
        pageWidth <= 0 ||
        pageHeight <= 0
      ) {
        return null;
      }
      return {
        height,
        id: String(placement.id || `signature-${page}-${index + 1}`),
        page,
        pageHeight,
        pageWidth,
        width,
        x,
        y,
      } satisfies DigitalSignaturePlacement;
    })
    .filter((item): item is DigitalSignaturePlacement => Boolean(item));
}

export function payloadItems(payload: ElectronicSignaturePayloadItem) {
  const raw =
    payload.payload ??
    payload.items ??
    payload.rows ??
    payload.payload0;
  if (Array.isArray(raw)) {
    return raw.filter(
      (item): item is ElectronicSignaturePayloadItem =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
  }
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? [raw as ElectronicSignaturePayloadItem]
    : [];
}

export function replacePayloadItems(
  payload: ElectronicSignaturePayloadItem,
  items: ElectronicSignaturePayloadItem[],
) {
  const next = JSON.parse(
    JSON.stringify(payload ?? {}),
  ) as ElectronicSignaturePayloadItem;
  if (Array.isArray(next.payload)) next.payload = items;
  else if (Array.isArray(next.items)) next.items = items;
  else if (Array.isArray(next.rows)) next.rows = items;
  else if (
    next.payload0 &&
    typeof next.payload0 === "object" &&
    !Array.isArray(next.payload0) &&
    items.length === 1
  ) {
    next.payload0 = items[0];
  } else {
    next.items = items;
  }
  if (
    next.payload0 &&
    typeof next.payload0 === "object" &&
    !Array.isArray(next.payload0) &&
    items[0]
  ) {
    next.payload0 = items[0];
  }
  return next;
}

export function signatureFiles(
  item: ElectronicSignaturePayloadItem,
  kind: "input" | "output",
) {
  const value =
    kind === "input"
      ? item.signatureInputFiles
      : item.signatureOutputFiles ?? item.resultFiles;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (file): file is ElectronicSignatureFileDescriptor =>
      Boolean(file) && typeof file === "object" && !Array.isArray(file),
  );
}

export function electronicSignatureMissingOutputIndexes(
  payload: ElectronicSignaturePayloadItem,
) {
  return payloadItems(payload)
    .map((item, index) => ({ index, item }))
    .filter(
      ({ item }) =>
        isElectronicSignatureItem(item) &&
        signatureFiles(item, "output").length === 0,
    )
    .map(({ index }) => index);
}

export function electronicSignatureFileIds(
  payload: ElectronicSignaturePayloadItem,
) {
  const ids = new Set<string>();
  for (const item of payloadItems(payload)) {
    for (const file of [
      ...signatureFiles(item, "input"),
      ...signatureFiles(item, "output"),
    ]) {
      if (file.fileId) ids.add(file.fileId);
    }
  }
  return ids;
}
