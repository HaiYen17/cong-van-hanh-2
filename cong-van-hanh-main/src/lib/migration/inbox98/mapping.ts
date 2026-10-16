import { createHash } from "node:crypto";

import type {
  InboxMigrationIssue,
  LegacyDriveFile,
  LegacyFollowUp,
  LegacyInboxSourceRow,
  LegacyLegalDossier,
  LegacyRequestItem,
  NormalizedLegacyInboxRecord,
} from "./types";

const SERVICE_MAP: Record<string, { code: string; label: string }> = {
  "03HOANUNGCHIPHI": {
    code: "expense-advance",
    label: "Hoàn ứng chi phí",
  },
  "05DEXUATCAPPHAT": {
    code: "asset-allocation",
    label: "Đề xuất cấp phát",
  },
  "06YEUCAUSUACHUABAOTRI": {
    code: "repair-request",
    label: "Yêu cầu sửa chữa",
  },
  "07DENGHIDONGDAUVACAPSOVANBAN": {
    code: "document-seal",
    label: "Đóng dấu & Ký số",
  },
  "08TRICHLUCVALUUTRUHOSO": {
    code: "document-archive",
    label: "Trích lục / lưu trữ hồ sơ",
  },
  "09CAPGIAYUYQUYENGIOITHIEU": {
    code: "authorization-letter",
    label: "Cấp giấy uỷ quyền / giới thiệu",
  },
  "10DANGKYCONGTAC": {
    code: "business-trip",
    label: "Đăng ký công tác",
  },
  "11YEUCAUHOTRO": {
    code: "support-request",
    label: "Hỗ trợ nội bộ",
  },
  "12REVIEWHOPDONG": {
    code: "review-contract",
    label: "Review hồ sơ",
  },
  "13GUITHUVIETTELPOST": {
    code: "send-mail",
    label: "Gửi thư",
  },
  "17KEHOACHXUONGDADUYET": {
    code: "workshop-plan",
    label: "Kế hoạch xưởng đã duyệt",
  },
  "18DATHANGXUONG": {
    code: "workshop-order",
    label: "Đặt hàng Xưởng",
  },
};

const FOLLOW_UP_BLOCKED_MODULES = [
  "document-seal",
  "document-archive",
  "authorization-letter",
  "asset-allocation",
  "repair-request",
  "support-request",
  "business-trip",
];

const KNOWN_ID_KEYS = new Set([
  "fileid",
  "providerfileid",
  "attachmentfileid",
  "archivesourcefileid",
  "sourcefileid",
  "storedfileid",
  "textfileid",
  "pdffileid",
  "resultfileid",
  "outputfileid",
]);

const KNOWN_URL_KEYS = new Set([
  "url",
  "fileurl",
  "attachmenturl",
  "attachmentdownloadurl",
  "archivesourcefileurl",
  "sourcefileurl",
  "downloadurl",
  "pdfurl",
  "resulturl",
  "outputurl",
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeLegacyKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

export function inboxMigrationFingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function ensureUniqueLegacyRegistryIds(input: {
  issues: InboxMigrationIssue[];
  legalDossiers: LegacyLegalDossier[];
  requestCode: string;
}) {
  const usedIds = new Set<string>();
  const issues = [...input.issues];
  const legalDossiers = input.legalDossiers.map((dossier) => {
    const originalId =
      text(dossier.legacyRegistryId) ||
      `${input.requestCode}-R${String(dossier.itemIndex).padStart(2, "0")}`;
    if (!usedIds.has(originalId)) {
      usedIds.add(originalId);
      return dossier.legacyRegistryId === originalId
        ? dossier
        : { ...dossier, legacyRegistryId: originalId };
    }

    const canonicalId = `${input.requestCode}-R${String(
      dossier.itemIndex,
    ).padStart(2, "0")}`;
    let normalizedId = canonicalId;
    let suffix = 1;
    while (usedIds.has(normalizedId)) {
      normalizedId = `${canonicalId}-I${String(suffix).padStart(2, "0")}`;
      suffix += 1;
    }
    usedIds.add(normalizedId);

    const field = `payload.items[${dossier.itemIndex - 1}].registryId`;
    if (
      !issues.some(
        (issue) =>
          issue.code === "DUPLICATE_LEGACY_REGISTRY_ID_NORMALIZED" &&
          issue.field === field,
      )
    ) {
      issues.push({
        code: "DUPLICATE_LEGACY_REGISTRY_ID_NORMALIZED",
        field,
        message:
          `Mã sổ cũ ${originalId} bị trùng trong cùng hồ sơ; ` +
          `đã dùng khóa ${normalizedId} cho mục ${dossier.itemIndex}. ` +
          "Giá trị gốc vẫn được giữ trong raw payload để đối soát.",
        severity: "WARNING",
      });
    }
    return { ...dossier, legacyRegistryId: normalizedId };
  });

  return { issues, legalDossiers };
}

export function buildInboxExternalId(requestId: string) {
  return `98_Inbox:${text(requestId)}`;
}

export function buildInboxItemExternalId(
  requestId: string,
  itemIndex: number,
) {
  return `${buildInboxExternalId(requestId)}:item:${itemIndex}`;
}

export function buildInboxDossierExternalId(
  requestId: string,
  itemIndex: number,
) {
  return `${buildInboxExternalId(requestId)}:dossier:${itemIndex}`;
}

export function buildDriveExternalId(driveFileId: string) {
  return `GoogleDrive:${text(driveFileId)}`;
}

function safeObjectName(value: string) {
  return (
    value
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 180) || "tep-cu"
  );
}

export function buildLegacyGcsObjectKey(
  sourceKey: string,
  driveFileId: string,
  originalName: string,
  version = 1,
) {
  return [
    "legacy",
    text(sourceKey).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase(),
    text(driveFileId),
    `v${Math.max(1, Math.trunc(version || 1))}`,
    safeObjectName(originalName),
  ].join("/");
}

export function parseLegacyDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds =
      Date.UTC(1899, 11, 30) + Math.round(value * 24 * 60 * 60 * 1000);
    return new Date(milliseconds).toISOString();
  }
  const raw = text(value);
  if (!raw) return "";
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const match = raw.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (!match) return "";
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(
    Date.UTC(
      year,
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0),
    ),
  );
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function mapLegacyServiceCode(legacyCode: string) {
  const normalized = normalizeLegacyKey(legacyCode);
  const mapped = SERVICE_MAP[normalized];
  if (mapped) return { ...mapped, known: true };

  const fallback = text(legacyCode)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return {
    code: fallback ? `legacy-${fallback}` : "legacy-unknown",
    known: false,
    label: text(legacyCode) || "Dịch vụ cũ chưa xác định",
  };
}

export function mapLegacyStatus(legacyStatus: string) {
  const status = normalizeLegacyKey(legacyStatus);
  if (!status || status === "CHODUYET" || status === "MOIGUI") {
    return { known: Boolean(status), status: "SUBMITTED" as const };
  }
  if (
    status === "TIEPNHAN" ||
    status === "XULY" ||
    status === "DANGXULY" ||
    status === "DANGTIEPNHAN"
  ) {
    return { known: true, status: "IN_PROGRESS" as const };
  }
  if (
    status === "BOSUNGHOSO" ||
    status === "CANBOSUNG" ||
    status === "NEEDSINFO"
  ) {
    return { known: true, status: "NEEDS_INFO" as const };
  }
  if (status === "DADUYET" || status === "PHEDUYET") {
    return { known: true, status: "APPROVED" as const };
  }
  if (status === "TUCHOI" || status === "REJECTED") {
    return { known: true, status: "REJECTED" as const };
  }
  if (
    status === "HOANTHANH" ||
    status === "HOANTAT" ||
    status === "DONE" ||
    status === "COMPLETED"
  ) {
    return { known: true, status: "COMPLETED" as const };
  }
  if (
    status === "HUYDON" ||
    status === "DAHUY" ||
    status === "CANCELLED" ||
    status === "CANCELED"
  ) {
    return { known: true, status: "CANCELLED" as const };
  }
  return { known: false, status: "SUBMITTED" as const };
}

export function extractGoogleDriveId(value: unknown) {
  const raw = text(value).replace(/^['"]|['"]$/g, "");
  if (!raw || /\/folders\//i.test(raw)) return "";
  const match =
    raw.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]{10,})/i) ??
    raw.match(/[?&]id=([A-Za-z0-9_-]{10,})/i) ??
    raw.match(/\/d\/([A-Za-z0-9_-]{10,})/i);
  return match?.[1] ?? "";
}

function likelyDriveId(value: unknown) {
  const raw = text(value);
  return /^[A-Za-z0-9_-]{10,}$/.test(raw) ? raw : "";
}

function descriptorFromObject(
  object: Record<string, unknown>,
  path: string,
): LegacyDriveFile | null {
  const normalized = new Map(
    Object.entries(object).map(([key, value]) => [normalizeLegacyKey(key), value]),
  );
  const folderContext = normalizeLegacyKey(path).includes("FOLDER");
  if (folderContext) return null;

  let driveFileId = "";
  for (const key of KNOWN_ID_KEYS) {
    const value = normalized.get(key.toUpperCase());
    if (value) {
      driveFileId = likelyDriveId(value) || extractGoogleDriveId(value);
      if (driveFileId) break;
    }
  }

  let legacyUrl = "";
  for (const key of KNOWN_URL_KEYS) {
    const value = normalized.get(key.toUpperCase());
    const candidate = text(value);
    if (candidate && !/\/folders\//i.test(candidate)) {
      legacyUrl = candidate;
      if (!driveFileId) driveFileId = extractGoogleDriveId(candidate);
      break;
    }
  }

  const hasFileContext = /(FILE|ATTACH|PDF|DOCUMENT|OUTPUT|RESULT|VERSION)/.test(
    normalizeLegacyKey(path),
  );
  if (!driveFileId && hasFileContext) {
    const candidateId = normalized.get("ID");
    driveFileId = likelyDriveId(candidateId);
  }
  if (!driveFileId && !legacyUrl) return null;

  const name =
    text(normalized.get("NAME")) ||
    text(normalized.get("FILENAME")) ||
    text(normalized.get("ORIGINALNAME")) ||
    (driveFileId ? `Google Drive ${driveFileId}` : "Tệp cũ");
  const size = Number(
    normalized.get("SIZE") ?? normalized.get("SIZEBYTES") ?? 0,
  );
  return {
    driveFileId,
    legacyUrl:
      legacyUrl ||
      (driveFileId
        ? `https://drive.google.com/open?id=${encodeURIComponent(driveFileId)}`
        : ""),
    mimeType: text(normalized.get("MIMETYPE")),
    name,
    payloadPath: path,
    sizeBytes: Number.isFinite(size) && size > 0 ? Math.trunc(size) : null,
  };
}

export function extractLegacyDriveFiles(
  payload: unknown,
  rootPath = "payload",
) {
  const files: LegacyDriveFile[] = [];

  function add(file: LegacyDriveFile | null) {
    if (!file || (!file.driveFileId && !file.legacyUrl)) return;
    if (/\/folders\//i.test(file.legacyUrl)) return;
    files.push(file);
  }

  function walk(value: unknown, path: string) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (!plainObject(value)) return;

    add(descriptorFromObject(value, path));
    const entries = Object.entries(value);
    const names = Array.isArray(value.fileNames)
      ? value.fileNames.map(text)
      : [];
    entries.forEach(([key, entry]) => {
      const normalizedKey = normalizeLegacyKey(key);
      if (
        Array.isArray(entry) &&
        (normalizedKey === "FILEURLS" ||
          normalizedKey === "ATTACHMENTURLS" ||
          normalizedKey === "RESULTURLS" ||
          normalizedKey === "OUTPUTURLS")
      ) {
        entry.forEach((url, index) => {
          const legacyUrl = text(url);
          if (!legacyUrl || /\/folders\//i.test(legacyUrl)) return;
          add({
            driveFileId: extractGoogleDriveId(legacyUrl),
            legacyUrl,
            mimeType: "",
            name: names[index] || `Tệp cũ ${index + 1}`,
            payloadPath: `${path}.${key}[${index}]`,
            sizeBytes: null,
          });
        });
      }
      if (
        typeof entry === "string" &&
        KNOWN_URL_KEYS.has(normalizedKey.toLowerCase()) &&
        !/FOLDER/.test(normalizedKey)
      ) {
        const legacyUrl = text(entry);
        if (legacyUrl && !/\/folders\//i.test(legacyUrl)) {
          add({
            driveFileId: extractGoogleDriveId(legacyUrl),
            legacyUrl,
            mimeType: "",
            name: text(value.fileName ?? value.name) || "Tệp cũ",
            payloadPath: `${path}.${key}`,
            sizeBytes: null,
          });
        }
      }
      if (
        typeof entry === "string" &&
        KNOWN_ID_KEYS.has(normalizedKey.toLowerCase()) &&
        !/FOLDER/.test(normalizedKey)
      ) {
        const driveFileId = likelyDriveId(entry);
        if (driveFileId) {
          add({
            driveFileId,
            legacyUrl:
              text(
                value.fileUrl ??
                  value.url ??
                  value.downloadUrl ??
                  value.attachmentUrl,
              ) ||
              `https://drive.google.com/open?id=${encodeURIComponent(driveFileId)}`,
            mimeType: text(value.mimeType),
            name: text(value.fileName ?? value.name) || `Google Drive ${driveFileId}`,
            payloadPath: `${path}.${key}`,
            sizeBytes:
              Number(value.size ?? value.sizeBytes) > 0
                ? Math.trunc(Number(value.size ?? value.sizeBytes))
                : null,
          });
        }
      }
      walk(entry, `${path}.${key}`);
    });
  }

  walk(payload, rootPath);
  const unique = new Map<string, LegacyDriveFile>();
  files.forEach((file) => {
    const key = file.driveFileId || file.legacyUrl;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, file);
      return;
    }
    unique.set(key, {
      driveFileId: current.driveFileId || file.driveFileId,
      legacyUrl: current.legacyUrl || file.legacyUrl,
      mimeType: current.mimeType || file.mimeType,
      name:
        current.name.startsWith("Google Drive ") || current.name === "Tệp cũ"
          ? file.name
          : current.name,
      payloadPath: current.payloadPath,
      sizeBytes: current.sizeBytes ?? file.sizeBytes,
    });
  });
  return [...unique.values()];
}

function payloadRows(payload: Record<string, unknown>) {
  const candidates = [
    payload.payload,
    payload.rows,
    payload.items,
    payload.payload0,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(plainObject);
    }
    if (plainObject(candidate)) return [candidate];
  }
  return [payload];
}

function itemTitle(
  item: Record<string, unknown>,
  serviceLabel: string,
  itemIndex: number,
) {
  const documentType = text(
    item.documentTypeName ?? item.loai ?? item.documentTypeChoice,
  );
  const partner = text(
    item.partner ??
      item.partnerName ??
      item.storageCounterparty ??
      item.assignee,
  );
  return (
    text(
      item.title ??
        item.name ??
        item.hoso ??
        item.recordName ??
        item.itemName ??
        item.description,
    ) ||
    [documentType, partner].filter(Boolean).join(" · ") ||
    `${serviceLabel} · mục ${itemIndex}`
  );
}

function itemStatus(
  item: Record<string, unknown>,
  requestStatus: NormalizedLegacyInboxRecord["status"],
) {
  const raw = normalizeLegacyKey(
    item.fulfillmentStatus ??
      item.archiveFulfillmentStatus ??
      item.outputStatus ??
      item.resultStatus,
  );
  if (raw === "DONE" || raw === "COMPLETED" || raw === "HOANTHANH") {
    return "COMPLETED";
  }
  if (raw === "PENDING" || raw === "CHOXULY") return "PENDING";
  if (requestStatus === "COMPLETED") return "COMPLETED";
  if (requestStatus === "CANCELLED") return "CANCELLED";
  return "PENDING";
}

function issuedRows(payload: Record<string, unknown>) {
  return Array.isArray(payload.documentRegistryIssuedItems)
    ? payload.documentRegistryIssuedItems.filter(plainObject)
    : [];
}

function findIssuedRow(
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
  itemIndex: number,
) {
  const expectedRegistryId = text(item.registryId);
  const rows = issuedRows(payload);
  return (
    rows.find(
      (entry) =>
        expectedRegistryId &&
        text(entry.registryId) === expectedRegistryId,
    ) ??
    rows.find((entry) => {
      const registryId = text(entry.registryId);
      return registryId.endsWith(`-R${String(itemIndex).padStart(2, "0")}`);
    }) ??
    rows[itemIndex - 1] ??
    {}
  );
}

function isStorageArchiveItem(item: Record<string, unknown>) {
  const moduleKey = normalizeLegacyKey(item.module ?? item.mode);
  return (
    moduleKey.includes("LUUTRU") ||
    Boolean(
      item.storageGeneratedName ||
        item.storageFolderId ||
        item.storageSummary ||
        item.files,
    )
  );
}

function normalizeOffice(item: Record<string, unknown>) {
  const label = text(
    item.submissionOffice ??
      item.officeName ??
      item.khuVucNop ??
      item.submissionOfficeLabel,
  );
  const key = text(item.submissionOfficeKey ?? item.officeKey);
  if (key || label) return { key, label };
  return { key: "", label: "" };
}

function normalizeDossier(
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
  requestCode: string,
  serviceCode: string,
  requestStatus: NormalizedLegacyInboxRecord["status"],
  itemIndex: number,
): LegacyLegalDossier | null {
  if (
    serviceCode !== "document-seal" &&
    !(serviceCode === "document-archive" && isStorageArchiveItem(item))
  ) {
    return null;
  }
  const issued = findIssuedRow(payload, item, itemIndex);
  const meta = plainObject(item.documentNumberMeta)
    ? item.documentNumberMeta
    : {};
  const documentNumber = text(
    issued.documentNumber ??
      issued.currentNumber ??
      item.documentNumber ??
      item.issuedNumber ??
      item.soVanBan,
  );
  const explicitTakesNumber = item.takesNumber;
  const takesNumber =
    typeof explicitTakesNumber === "boolean"
      ? explicitTakesNumber
      : documentNumber
        ? true
        : Number(item.documentTypeRowIndex || 0) === 0
          ? false
          : null;
  const files = extractLegacyDriveFiles(item, `payload.items[${itemIndex - 1}]`);
  const condition = text(item.documentCondition ?? item.condition);
  let fileStatus = files.length ? "STORED" : "PENDING_UPLOAD";
  if (requestStatus === "CANCELLED") fileStatus = "CANCELLED";
  else if (
    serviceCode === "document-seal" &&
    !files.length &&
    normalizeLegacyKey(condition).includes("SCAN")
  ) {
    fileStatus = "PENDING_SCAN";
  } else if (
    serviceCode === "document-seal" &&
    normalizeLegacyKey(condition).includes("KHONGYEUCAULUU")
  ) {
    fileStatus = "NO_SCAN";
  }

  let numberStatus = "UNDECIDED";
  if (documentNumber) numberStatus = "ISSUED";
  else if (requestStatus === "CANCELLED") {
    numberStatus = "CANCELLED_BEFORE_ISSUE";
  } else if (takesNumber === false) numberStatus = "NONE";
  else if (takesNumber === true) numberStatus = "PENDING";

  const office = normalizeOffice(item);
  const signDate =
    parseLegacyDate(item.date ?? item.signDate ?? item.storageIssuedDate) || "";
  const revisionValue = Number(item.storageRevision);
  const serialValue = Number(issued.serial ?? meta.serial);
  return {
    companyName: text(item.companyName ?? item.phapNhan ?? issued.companyName),
    companyShortName: text(item.companyShortName),
    condition,
    documentNumber,
    documentTypeName: text(
      item.documentTypeName ?? item.loai ?? issued.documentTypeName,
    ),
    documentTypeRow:
      Number(item.documentTypeRowIndex) > 0
        ? Math.trunc(Number(item.documentTypeRowIndex))
        : null,
    fileStatus,
    generatedStorageName: text(
      item.storageGeneratedName ??
        item.generatedName ??
        item.documentName ??
        item.hoso ??
        item.name,
    ),
    itemIndex,
    legacyRegistryId:
      text(item.registryId ?? issued.registryId) ||
      `${requestCode}-R${String(itemIndex).padStart(2, "0")}`,
    numberStatus,
    orderStatus: requestStatus,
    partnerName: text(item.partner ?? issued.partnerName),
    revision:
      Number.isFinite(revisionValue) && revisionValue >= 0
        ? Math.trunc(revisionValue)
        : null,
    serial:
      Number.isFinite(serialValue) && serialValue > 0
        ? Math.trunc(serialValue)
        : null,
    signDate,
    storageCounterparty: text(
      item.storageCounterparty ?? item.partner ?? issued.partnerName,
    ),
    storageIssuedDate:
      parseLegacyDate(item.storageIssuedDate ?? item.date) || "",
    storageSummary: text(
      item.storageSummary ?? item.detail ?? item.note ?? item.reason,
    ),
    submissionOfficeKey: office.key,
    submissionOfficeLabel: office.label,
    takesNumber,
  };
}

function normalizeFollowUp(
  payload: Record<string, unknown>,
): LegacyFollowUp | null {
  const raw = plainObject(payload.followUp) ? payload.followUp : null;
  if (!raw) return null;
  const normalizedStatus = normalizeLegacyKey(raw.status);
  const completedAt = parseLegacyDate(raw.completedAt);
  const required =
    raw.required === true ||
    Boolean(raw.type || raw.status || raw.requestedAt) ||
    Boolean(completedAt);
  if (!required) return null;
  const rawBlocks = Array.isArray(raw.blocksModules)
    ? raw.blocksModules.map(text).filter(Boolean)
    : raw.blocksModules === false
      ? []
      : FOLLOW_UP_BLOCKED_MODULES;
  return {
    blocksModules: rawBlocks,
    completedAt,
    reason:
      text(raw.reason ?? raw.note ?? raw.label) ||
      "Bắt buộc nộp lại bản ký.",
    requestedAt: parseLegacyDate(raw.requestedAt),
    status:
      completedAt ||
      normalizedStatus === "COMPLETED" ||
      normalizedStatus === "HOANTHANH"
        ? "COMPLETED"
        : "PENDING",
    type: text(raw.type) || "SIGNED_COPY",
  };
}

function asJsonObject(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;
}

export function normalizeLegacyInboxRow(
  source: LegacyInboxSourceRow,
): NormalizedLegacyInboxRecord {
  const issues: InboxMigrationIssue[] = [];
  const requestCode = text(source.requestId);
  if (!requestCode) {
    issues.push({
      code: "REQUEST_ID_MISSING",
      field: "Mã đơn DV",
      message: "Dòng nguồn thiếu Mã đơn DV nên không thể tạo khóa bất biến.",
      severity: "ERROR",
    });
  }

  let rawPayload: Record<string, unknown> = {};
  try {
    const parsed = source.payloadRaw ? JSON.parse(source.payloadRaw) : {};
    if (plainObject(parsed)) rawPayload = parsed;
    else {
      issues.push({
        code: "PAYLOAD_NOT_OBJECT",
        field: "Dữ liệu JSON",
        message: "Dữ liệu JSON phải là một object.",
        severity: "ERROR",
      });
    }
  } catch (error) {
    issues.push({
      code: "PAYLOAD_INVALID_JSON",
      field: "Dữ liệu JSON",
      message:
        error instanceof Error
          ? `Không đọc được JSON: ${error.message}`
          : "Không đọc được JSON.",
      severity: "ERROR",
    });
  }

  const legacyServiceCode =
    text(source.serviceCode) || text(rawPayload.serviceCode);
  const service = mapLegacyServiceCode(legacyServiceCode);
  if (!service.known) {
    issues.push({
      code: "SERVICE_CODE_UNKNOWN",
      field: "Mã Hệ thống",
      message: `Chưa có mapping chuẩn cho mã dịch vụ “${legacyServiceCode || "(trống)"}”.`,
      severity: "WARNING",
    });
  }

  const legacyStatus = text(source.status) || text(rawPayload.stage);
  const mappedStatus = mapLegacyStatus(legacyStatus);
  if (!mappedStatus.known) {
    issues.push({
      code: "STATUS_UNKNOWN",
      field: "Trạng thái",
      message: `Trạng thái “${legacyStatus || "(trống)"}” tạm ánh xạ thành SUBMITTED.`,
      severity: "WARNING",
    });
  }

  const creatorEmployeeCode =
    text(source.creatorEmployeeCode) ||
    text(rawPayload.employeeId) ||
    text(rawPayload.requesterEmployeeId) ||
    (plainObject(rawPayload.employee) ? text(rawPayload.employee.id) : "");
  if (!creatorEmployeeCode) {
    issues.push({
      code: "CREATOR_EMPLOYEE_CODE_MISSING",
      field: "MNV Người tạo",
      message: "Thiếu mã nhân viên người tạo; importer sẽ không gán người đang chạy.",
      severity: "ERROR",
    });
  }

  const createdAt =
    parseLegacyDate(rawPayload.createdAt) ||
    parseLegacyDate(source.createdAt);
  if (!createdAt) {
    issues.push({
      code: "CREATED_AT_INVALID",
      field: "Ngày tạo",
      message: "Không đọc được ngày tạo của yêu cầu.",
      severity: "ERROR",
    });
  }
  const updatedAt =
    parseLegacyDate(rawPayload.updatedAt) || createdAt;
  const completedAt =
    parseLegacyDate(rawPayload.completedAt ?? rawPayload.finishedAt) ||
    (mappedStatus.status === "COMPLETED" ? updatedAt : "");
  const creatorName =
    text(source.creatorName) ||
    text(rawPayload.employeeName) ||
    text(rawPayload.requesterName) ||
    (plainObject(rawPayload.employee) ? text(rawPayload.employee.name) : "");
  const creatorDepartment =
    text(source.creatorDepartment) ||
    text(rawPayload.requesterDepartment) ||
    (plainObject(rawPayload.employee) ? text(rawPayload.employee.dept) : "");

  const rows = payloadRows(rawPayload);
  const requestItems: LegacyRequestItem[] = rows.map((item, index) => {
    const itemIndex = index + 1;
    return {
      files: extractLegacyDriveFiles(
        item,
        `payload.items[${itemIndex - 1}]`,
      ),
      itemIndex,
      payload: asJsonObject(item),
      status: itemStatus(item, mappedStatus.status),
      title: itemTitle(item, service.label, itemIndex),
    };
  });

  const files = extractLegacyDriveFiles(rawPayload);
  const rawLegalDossiers = rows
    .map((item, index) =>
      normalizeDossier(
        rawPayload,
        item,
        requestCode,
        service.code,
        mappedStatus.status,
        index + 1,
      ),
    )
    .filter((entry): entry is LegacyLegalDossier => Boolean(entry));
  const uniqueDossiers = ensureUniqueLegacyRegistryIds({
    issues,
    legalDossiers: rawLegalDossiers,
    requestCode,
  });

  const note = text(source.errorNote) || text(rawPayload.note);
  const serviceName = text(rawPayload.serviceName) || service.label;
  const payload = {
    ...asJsonObject(rawPayload),
    _legacy98Inbox: {
      creatorDepartment,
      creatorEmployeeCode,
      creatorName,
      errorNote: text(source.errorNote),
      legacyServiceCode,
      legacyStatus,
      rawPayload: asJsonObject(rawPayload),
      rawPayloadText: source.payloadRaw,
      requestId: requestCode,
      source: "98_Inbox",
      sourceRow: source.rowNumber,
    },
  };
  const normalizedWithoutFingerprint = {
    completedAt,
    createdAt,
    creatorDepartment,
    creatorEmployeeCode,
    creatorName,
    externalId: buildInboxExternalId(
      requestCode || `ROW:${source.rowNumber}`,
    ),
    files,
    followUp: normalizeFollowUp(rawPayload),
    legacyServiceCode,
    legacyStatus,
    legalDossiers: uniqueDossiers.legalDossiers,
    note,
    payload,
    priority:
      rawPayload.urgent === true ||
      requestItems.some((item) => item.payload.urgent === true)
        ? "Khẩn"
        : "Bình thường",
    requestCode,
    requestItems,
    serviceCode: service.code,
    serviceLabel: serviceName,
    sourceRow: source.rowNumber,
    status: mappedStatus.status,
    title:
      text(rawPayload.displayDocumentName ?? rawPayload.documentName) ||
      `${serviceName} · ${requestItems.length} mục`,
    updatedAt,
  };
  return {
    ...normalizedWithoutFingerprint,
    fingerprint: inboxMigrationFingerprint(normalizedWithoutFingerprint),
    issues: uniqueDossiers.issues,
  };
}

export type IdempotencyDecision =
  | "CREATE"
  | "REPAIR_MAP"
  | "SKIP"
  | "UPDATE";

export function decideIdempotentWrite(input: {
  entityExists: boolean;
  existingFingerprint?: string | null;
  hasExternalMap: boolean;
  nextFingerprint: string;
}): IdempotencyDecision {
  if (!input.hasExternalMap && !input.entityExists) return "CREATE";
  if (!input.hasExternalMap && input.entityExists) return "REPAIR_MAP";
  if (!input.entityExists) return "CREATE";
  return input.existingFingerprint === input.nextFingerprint
    ? "SKIP"
    : "UPDATE";
}
