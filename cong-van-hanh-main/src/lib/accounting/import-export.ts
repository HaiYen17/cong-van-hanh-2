import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import type { Cell, Row, Worksheet } from "exceljs";
import { GoogleAuth } from "google-auth-library";
import type { PoolClient as PgPoolClient } from "pg";

import { ACCOUNTING_SCHEMA } from "@/lib/accounting/constants";
import { buildAccountingDisclosureSemanticRecords } from "@/lib/accounting/disclosure-semantics";
import { buildAccountingDisclosureReportRecords } from "@/lib/accounting/disclosure-report";
import { parseAccountingDisclosureWorkbook } from "@/lib/accounting/disclosure-template";
import {
  assertAccountingSchema,
  firstRow,
  getAccountingPool,
  withAccountingTransaction,
} from "@/lib/accounting/database";
import {
  cleanText,
  isJsonObject,
  normalizeRecordPayload,
  recordMeta,
} from "@/lib/accounting/normalize";
import { getAccountingConfigData } from "@/lib/accounting/repository";
import type {
  AccountingRecord,
  AccountingRecordType,
  JsonObject,
} from "@/lib/accounting/types";
import { AccountingRpcError } from "@/lib/accounting/types";
import { validateAccountingRecords } from "@/lib/accounting/validation";

const TEMPLATE_VERSION = "KHUON_BAO_CAO_V1";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_RECORDS = 5_000;
const MAX_LAYOUT_REPORTS = 50;
const MAX_LAYOUT_ROWS = 600;
const MAX_LAYOUT_COLUMNS = 20;
const driveAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

const RECORD_SELECT = `
  record_id, version_id, record_type, entity_key, parent_key, company_key,
  display_code, display_name, status_label, valid_from, valid_to, sort_order,
  payload, created_at, created_by, updated_at, updated_by, deleted_at
`;

type DbRecordRow = {
  company_key: string;
  created_at: Date | string;
  created_by: string;
  deleted_at: Date | string | null;
  display_code: string;
  display_name: string;
  entity_key: string;
  parent_key: string;
  payload: JsonObject | string | null;
  record_id: string;
  record_type: AccountingRecordType;
  sort_order: number | string;
  status_label: string;
  updated_at: Date | string;
  updated_by: string;
  valid_from: string;
  valid_to: string;
  version_id: string;
};

type VersionRow = {
  status_code: string;
  version_id: string;
};

type FilePayload = {
  dataUrl?: unknown;
  driveFileId?: unknown;
  driveUrl?: unknown;
  fileName?: unknown;
  googleDriveUrl?: unknown;
  mimeType?: unknown;
  name?: unknown;
  size?: unknown;
};

type ImportedRecord = {
  payload: JsonObject;
  recordType: AccountingRecordType;
  sourceRow: number;
  sourceSheet: string;
};

type AccountImportItem = JsonObject & {
  accountCode: string;
  accountName: string;
  companyKey: string;
  logicalAccountKey: string;
  parentCode: string;
  sourceRow: number;
  sourceSheet: string;
  status: string;
  validFrom: string;
  validTo: string;
};

type PreparedItem = ImportedRecord & {
  existing: AccountingRecord | null;
  identity: string;
  nextRecord: AccountingRecord;
  unchanged: boolean;
};

type PreparedImport = {
  counts: {
    byType: Record<string, number>;
    createCount: number;
    totalCount: number;
    unchangedCount: number;
    updateCount: number;
  };
  errors: string[];
  items: PreparedItem[];
  validation: ReturnType<typeof validateAccountingRecords>;
};

type LayoutReportSummary = {
  columnCount: number;
  displayTitle: string;
  formulaCellCount: number;
  headerRowCount: number;
  ignoredValueCount: number;
  mergedCellCount: number;
  previewColumns: string[];
  previewRows: string[][];
  reportKey: string;
  reportName: string;
  rowCount: number;
  sourceRange: string;
  sourceSheet: string;
};

type LayoutReadResult = {
  errors: string[];
  records: ImportedRecord[];
  reports: LayoutReportSummary[];
  stats: {
    formulaCellCount: number;
    ignoredValueCount: number;
    mergedCellCount: number;
    reportCount: number;
  };
  warnings: string[];
};

type MergeInfo = {
  columnSpan: number;
  rowSpan: number;
  startColumn: number;
  startRow: number;
};

type MergeMaps = {
  covered: Map<string, string>;
  origins: Map<string, MergeInfo>;
};

function iso(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parsePayload(value: DbRecordRow["payload"]): JsonObject {
  if (isJsonObject(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isJsonObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function recordView(row: DbRecordRow): AccountingRecord {
  return {
    companyKey: row.company_key || "",
    createdAt: iso(row.created_at),
    createdBy: row.created_by || "",
    displayCode: row.display_code || "",
    displayName: row.display_name || "",
    entityKey: row.entity_key,
    isDeleted: false,
    parentKey: row.parent_key || "",
    payload: parsePayload(row.payload),
    recordId: row.record_id,
    recordType: row.record_type,
    sortOrder: Number(row.sort_order || 0),
    status: row.status_label || "",
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by || "",
    validFrom: row.valid_from || "",
    validTo: row.valid_to || "",
    versionId: row.version_id,
  };
}

function normalizeVietnamese(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase();
}

function canonicalKey(value: unknown) {
  return normalizeVietnamese(value)
    .toUpperCase()
    .replace(/[^A-Z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function accountCode(value: unknown) {
  return cleanText(value).replace(/\s+/g, "");
}

function headerKey(value: unknown) {
  return normalizeVietnamese(value).replace(/[^a-z0-9]/g, "");
}

function normalizeIsoDate(value: unknown, label: string, required = false) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  const input = cleanText(value);
  if (!input && !required) {
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new AccountingRpcError(`${label} phải có định dạng YYYY-MM-DD.`);
  }
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== input) {
    throw new AccountingRpcError(`${label} không hợp lệ.`);
  }
  return input;
}

function previousIsoDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function comparable(value: unknown) {
  return JSON.stringify(stable(value));
}

function comparableAccount(value: JsonObject) {
  return comparable({
    accountCode: cleanText(value.accountCode),
    accountName: cleanText(value.accountName),
    companyKey: canonicalKey(value.companyKey),
    description: cleanText(value.description),
    englishName: cleanText(value.englishName),
    level: cleanText(value.level),
    logicalAccountKey: canonicalKey(value.logicalAccountKey),
    nature: cleanText(value.nature),
    parentCode: accountCode(value.parentCode),
    status: canonicalKey(value.status || "ACTIVE"),
    validFrom: cleanText(value.validFrom),
    validTo: cleanText(value.validTo),
  });
}

function identity(recordType: AccountingRecordType, entityKey: string) {
  return `${recordType}|${entityKey}`;
}

function rowCellValue(cell: Cell) {
  if (cell.value instanceof Date) {
    return cell.value.toISOString().slice(0, 10);
  }
  if (isJsonObject(cell.value) && "result" in cell.value) {
    const result = cell.value.result;
    return result instanceof Date ? result.toISOString().slice(0, 10) : cleanText(result);
  }
  return cleanText(cell.text || cell.value);
}

function formulaInCell(cell: Cell) {
  return Boolean(
    isJsonObject(cell.value) &&
      ("formula" in cell.value || "sharedFormula" in cell.value),
  );
}

function rowValues(row: Row, columnCount: number) {
  const values: string[] = [];
  for (let column = 1; column <= columnCount; column += 1) {
    values.push(rowCellValue(row.getCell(column)));
  }
  return values;
}

function filePayload(value: unknown): FilePayload {
  if (!isJsonObject(value)) {
    throw new AccountingRpcError("Tệp nhập không hợp lệ.");
  }
  return value;
}

function sourceFileName(input: FilePayload) {
  return cleanText(input.name || input.fileName) || "Tệp Excel đã chọn.xlsx";
}

function parseDataUrl(value: unknown) {
  const input = cleanText(value);
  const match = input.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new AccountingRpcError("Nội dung tệp tải lên không phải data URL base64 hợp lệ.");
  }
  return Buffer.from(match[2].replace(/\s+/g, ""), "base64");
}

function driveDownloadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AccountingRpcError("Liên kết Google Drive/Google Sheet không hợp lệ.");
  }
  if (!["docs.google.com", "drive.google.com"].includes(url.hostname.toLowerCase())) {
    throw new AccountingRpcError("Chỉ chấp nhận liên kết từ Google Drive hoặc Google Sheets.");
  }
  const sheetMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (sheetMatch) {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetMatch[1])}/export?format=xlsx`;
  }
  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  const id = fileMatch?.[1] || url.searchParams.get("id");
  if (!id) {
    throw new AccountingRpcError("Không đọc được mã tệp từ liên kết Google Drive.");
  }
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

async function workbookBuffer(inputValue: unknown) {
  const input = filePayload(inputValue);
  const declaredSize = Number(input.size || 0);
  if (declaredSize > MAX_FILE_BYTES) {
    throw new AccountingRpcError("Tệp cấu hình vượt 8 MB.");
  }
  let buffer: Buffer;
  if (cleanText(input.dataUrl)) {
    buffer = parseDataUrl(input.dataUrl);
  } else {
    const driveReference = cleanText(
      input.driveFileId || input.driveUrl || input.googleDriveUrl,
    );
    if (!driveReference) {
      throw new AccountingRpcError("Vui lòng chọn tệp Excel hoặc cung cấp liên kết Google Drive.");
    }
    const directUrl = /^https?:\/\//i.test(driveReference)
      ? driveDownloadUrl(driveReference)
      : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveReference)}`;
    const headers: HeadersInit = {};
    let bearer = cleanText(process.env.GOOGLE_DRIVE_BEARER_TOKEN);
    if (!bearer) {
      bearer = cleanText(await driveAuth.getAccessToken().catch(() => ""));
    }
    if (bearer) {
      headers.Authorization = `Bearer ${bearer}`;
    }
    const response = await fetch(directUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new AccountingRpcError(
        "Không tải được tệp Google Drive. Hãy chia sẻ quyền xem cho tài khoản dịch vụ cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com hoặc tải tệp lên trực tiếp.",
        response.status === 401 || response.status === 403 ? 403 : 400,
      );
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_FILE_BYTES) {
      throw new AccountingRpcError("Tệp cấu hình vượt 8 MB.");
    }
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (!buffer.length) {
    throw new AccountingRpcError("Tệp Excel đang trống.");
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new AccountingRpcError("Tệp cấu hình vượt 8 MB.");
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    throw new AccountingRpcError(
      "Định dạng .xls cũ cần được lưu lại thành .xlsx trước khi nạp vào nền tảng mới.",
    );
  }
  return { buffer, fileName: sourceFileName(input) };
}

async function readWorkbook(input: unknown) {
  const source = await workbookBuffer(input);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      source.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new AccountingRpcError(
      "Không đọc được workbook. Hãy kiểm tra tệp là Excel .xlsx hợp lệ và không đặt mật khẩu.",
    );
  }
  if (!workbook.worksheets.length) {
    throw new AccountingRpcError("Workbook không có trang tính.");
  }
  return { ...source, workbook };
}

async function assertDraftVersion(
  client: PgPoolClient,
  versionId: string,
  lock = true,
) {
  const result = await client.query<VersionRow>(
    `SELECT version_id, status_code
     FROM ${ACCOUNTING_SCHEMA}.config_versions
     WHERE version_id = $1
     ${lock ? "FOR UPDATE" : ""}`,
    [versionId],
  );
  const version = firstRow(result.rows, "Không tìm thấy phiên bản cấu hình.");
  if (version.status_code !== "DRAFT") {
    throw new AccountingRpcError("Chỉ được chỉnh sửa phiên bản đang soạn.", 409);
  }
  return version;
}

async function selectVersionRecords(
  client: PgPoolClient,
  versionId: string,
  lock = false,
) {
  const result = await client.query<DbRecordRow>(
    `SELECT ${RECORD_SELECT}
     FROM ${ACCOUNTING_SCHEMA}.config_records
     WHERE version_id = $1
       AND record_type <> 'CONFIG_VERSION'
       AND deleted_at IS NULL
     ${lock ? "FOR UPDATE" : ""}`,
    [versionId],
  );
  return result.rows.map(recordView);
}

async function portalCompanyKeys(versionId: string, client?: PgPoolClient) {
  const executor = client ?? getAccountingPool();
  const result = await executor.query<{ code: string }>(
    `SELECT code
     FROM public."Company"
     WHERE "archivedAt" IS NULL
     ORDER BY code`,
  );
  if (result.rows.length) {
    return result.rows.map((row) => canonicalKey(row.code)).filter(Boolean);
  }
  const fallback = await executor.query<{ company_key: string }>(
    `SELECT DISTINCT company_key
     FROM ${ACCOUNTING_SCHEMA}.config_records
     WHERE version_id = $1
       AND record_type = 'COMPANY'
       AND deleted_at IS NULL
     ORDER BY company_key`,
    [versionId],
  );
  return fallback.rows.map((row) => canonicalKey(row.company_key)).filter(Boolean);
}

async function appendAudit(
  client: PgPoolClient,
  input: {
    action: string;
    actorEmail: string;
    after: unknown;
    before: unknown;
    displayName: string;
    note: string;
    recordId: string;
    recordType: string;
    versionId: string;
  },
) {
  await client.query(
    `INSERT INTO ${ACCOUNTING_SCHEMA}.audit_events(
       audit_id, action, version_id, record_id, record_type, display_name,
       before_data, after_data, actor_email, note
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
    [
      randomUUID(),
      input.action,
      input.versionId,
      input.recordId,
      input.recordType,
      input.displayName,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.actorEmail,
      input.note,
    ],
  );
}

async function touchVersion(
  client: PgPoolClient,
  versionId: string,
  actorEmail: string,
) {
  await client.query(
    `UPDATE ${ACCOUNTING_SCHEMA}.config_versions
     SET updated_at = now(), updated_by = $1
     WHERE version_id = $2`,
    [actorEmail, versionId],
  );
}

async function upsertRecord(
  client: PgPoolClient,
  input: {
    action: string;
    actorEmail: string;
    existing: AccountingRecord | null;
    note: string;
    payload: JsonObject;
    recordId?: string;
    recordType: AccountingRecordType;
    versionId: string;
  },
) {
  const normalized = normalizeRecordPayload(input.recordType, input.payload);
  const meta = recordMeta(input.recordType, normalized);
  const recordId = input.recordId || input.existing?.recordId || randomUUID();
  if (
    input.existing &&
    input.recordId &&
    input.recordId !== input.existing.recordId
  ) {
    throw new AccountingRpcError(
      "Mã bản ghi nhập không khớp bản ghi đang có; hãy xem trước lại dữ liệu.",
      409,
    );
  }
  const locked = await client.query<{
    deleted_at: Date | string | null;
    record_type: string;
    version_id: string;
  }>(
    `SELECT version_id, record_type, deleted_at
     FROM ${ACCOUNTING_SCHEMA}.config_records
     WHERE record_id = $1
     FOR UPDATE`,
    [recordId],
  );
  const lockedRecord = locked.rows[0];
  if (input.existing) {
    if (
      !lockedRecord ||
      lockedRecord.version_id !== input.versionId ||
      lockedRecord.record_type !== input.recordType ||
      lockedRecord.deleted_at
    ) {
      throw new AccountingRpcError(
        "Bản ghi cấu hình đã thay đổi sau lúc xem trước; hãy tải lại và thử lại.",
        409,
      );
    }
  } else if (lockedRecord) {
    throw new AccountingRpcError(
      "Mã bản ghi mới đã tồn tại trong kho cấu hình; hãy xem trước lại dữ liệu.",
      409,
    );
  }

  const values = [
    recordId,
    input.versionId,
    input.recordType,
    meta.entityKey,
    meta.parentKey,
    meta.companyKey,
    meta.displayCode,
    meta.displayName,
    meta.status,
    meta.validFrom,
    meta.validTo,
    meta.sortOrder,
    JSON.stringify(normalized),
    input.actorEmail,
  ];
  const result = input.existing
    ? await client.query<DbRecordRow>(
        `UPDATE ${ACCOUNTING_SCHEMA}.config_records
         SET entity_key = $4,
             parent_key = $5,
             company_key = $6,
             display_code = $7,
             display_name = $8,
             status_label = $9,
             valid_from = $10,
             valid_to = $11,
             sort_order = $12,
             payload = $13::jsonb,
             updated_at = now(),
             updated_by = $14
         WHERE record_id = $1
           AND version_id = $2
           AND record_type = $3
           AND deleted_at IS NULL
         RETURNING ${RECORD_SELECT}`,
        values,
      )
    : await client.query<DbRecordRow>(
        `INSERT INTO ${ACCOUNTING_SCHEMA}.config_records(
           record_id, version_id, record_type, entity_key, parent_key, company_key,
           display_code, display_name, status_label, valid_from, valid_to,
           sort_order, payload, created_by, updated_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$14
         )
         RETURNING ${RECORD_SELECT}`,
        values,
      );
  const saved = recordView(firstRow(result.rows, "Không đọc lại được bản ghi vừa lưu."));
  await appendAudit(client, {
    action: input.action,
    actorEmail: input.actorEmail,
    after: saved,
    before: input.existing,
    displayName: saved.displayName,
    note: input.note,
    recordId: saved.recordId,
    recordType: saved.recordType,
    versionId: saved.versionId,
  });
  return saved;
}

function virtualRecord(
  recordType: AccountingRecordType,
  versionId: string,
  rawPayload: JsonObject,
  actorEmail: string,
  existing: AccountingRecord | null,
) {
  const payload = normalizeRecordPayload(recordType, rawPayload);
  const meta = recordMeta(recordType, payload);
  const now = new Date().toISOString();
  return {
    companyKey: meta.companyKey,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actorEmail,
    displayCode: meta.displayCode,
    displayName: meta.displayName,
    entityKey: meta.entityKey,
    isDeleted: false as const,
    parentKey: meta.parentKey,
    payload,
    recordId: existing?.recordId || randomUUID(),
    recordType,
    sortOrder: meta.sortOrder,
    status: meta.status,
    updatedAt: now,
    updatedBy: actorEmail,
    validFrom: meta.validFrom,
    validTo: meta.validTo,
    versionId,
  };
}

function prepareImport(
  currentRecords: AccountingRecord[],
  importedRecords: ImportedRecord[],
  versionId: string,
  actorEmail: string,
) {
  const currentByIdentity = new Map(
    currentRecords.map((record) => [
      identity(record.recordType, record.entityKey),
      record,
    ]),
  );
  const candidateById = new Map(
    currentRecords.map((record) => [record.recordId, record]),
  );
  const seen = new Map<string, string>();
  const errors: string[] = [];
  const items: PreparedItem[] = [];
  const counts = {
    byType: {} as Record<string, number>,
    createCount: 0,
    totalCount: 0,
    unchangedCount: 0,
    updateCount: 0,
  };

  for (const item of importedRecords) {
    try {
      const normalized = normalizeRecordPayload(item.recordType, item.payload);
      const meta = recordMeta(item.recordType, normalized);
      const key = identity(item.recordType, meta.entityKey);
      const source = `${item.sourceSheet}!${item.sourceRow}`;
      if (seen.has(key)) {
        errors.push(`${source}: trùng khóa với ${seen.get(key)}.`);
        continue;
      }
      seen.set(key, source);
      const existing = currentByIdentity.get(key) || null;
      const nextRecord = virtualRecord(
        item.recordType,
        versionId,
        normalized,
        actorEmail,
        existing,
      );
      const unchanged =
        Boolean(existing) &&
        comparable(existing?.payload) === comparable(nextRecord.payload);
      counts.totalCount += 1;
      counts.byType[item.recordType] =
        Number(counts.byType[item.recordType] || 0) + 1;
      if (unchanged) {
        counts.unchangedCount += 1;
      } else if (existing) {
        counts.updateCount += 1;
      } else {
        counts.createCount += 1;
      }
      items.push({
        ...item,
        existing,
        identity: key,
        nextRecord,
        payload: normalized,
        unchanged,
      });
      if (!unchanged) {
        candidateById.set(nextRecord.recordId, nextRecord);
      }
    } catch (error) {
      errors.push(
        `${item.sourceSheet}!${item.sourceRow}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return {
    counts,
    errors,
    items,
    validation: validateAccountingRecords([...candidateById.values()]),
  } satisfies PreparedImport;
}

function resolveAccountColumns(values: string[]) {
  const map = new Map<string, number>();
  values.forEach((value, index) => {
    const key = headerKey(value);
    if (key && !map.has(key)) {
      map.set(key, index);
    }
  });
  const index = (aliases: string[]) => {
    for (const alias of aliases) {
      const found = map.get(headerKey(alias));
      if (found !== undefined) {
        return found;
      }
    }
    return -1;
  };
  const columns = {
    accountCode: index(["AccountCode", "Số tài khoản", "Mã tài khoản", "Tài khoản"]),
    accountName: index(["AccountName", "Tên tài khoản"]),
    companyKey: index(["CompanyCode", "Company Key", "Mã công ty", "Công ty"]),
    description: index(["Description", "Diễn giải", "Mô tả"]),
    englishName: index(["EnglishName", "Tên tiếng Anh"]),
    level: index(["Level", "Cấp", "Bậc"]),
    logicalAccountKey: index(["LogicalAccountKey", "Khóa tài khoản logic", "Khóa logic"]),
    nature: index(["Nature", "Tính chất"]),
    parentCode: index(["ParentCode", "Tài khoản cha", "Mã cha"]),
    status: index(["Status", "Trạng thái"]),
    validFrom: index(["ValidFrom", "Hiệu lực từ"]),
    validTo: index(["ValidTo", "Hiệu lực đến"]),
  };
  return columns.accountCode >= 0 && columns.accountName >= 0 ? columns : null;
}

function deriveParentCodes(items: AccountImportItem[]) {
  const byCompany = new Map<string, Set<string>>();
  for (const item of items) {
    const codes = byCompany.get(item.companyKey) || new Set<string>();
    codes.add(item.accountCode);
    byCompany.set(item.companyKey, codes);
  }
  for (const item of items) {
    if (item.parentCode) {
      continue;
    }
    item.parentCode =
      [...(byCompany.get(item.companyKey) || [])]
        .filter(
          (candidate) =>
            candidate !== item.accountCode &&
            item.accountCode.startsWith(candidate),
        )
        .sort((left, right) => right.length - left.length)[0] || "";
  }
  return items;
}

function readAccounts(
  workbook: ExcelJS.Workbook,
  options: { companyKey: string; validFrom: string },
) {
  let match:
    | {
        columns: NonNullable<ReturnType<typeof resolveAccountColumns>>;
        headerRowNumber: number;
        sheet: Worksheet;
      }
    | undefined;
  for (const sheet of workbook.worksheets) {
    const maxRow = Math.min(Math.max(sheet.rowCount, 1), 20);
    const maxColumn = Math.min(Math.max(sheet.columnCount, 1), 80);
    for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
      const columns = resolveAccountColumns(
        rowValues(sheet.getRow(rowNumber), maxColumn),
      );
      if (columns) {
        match = { columns, headerRowNumber: rowNumber, sheet };
        break;
      }
    }
    if (match) {
      break;
    }
  }
  if (!match) {
    throw new AccountingRpcError(
      "Không tìm thấy dòng tiêu đề có cột Số tài khoản và Tên tài khoản.",
    );
  }

  const items: AccountImportItem[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  const value = (row: Row, column: number) =>
    column >= 0 ? rowCellValue(row.getCell(column + 1)) : "";

  for (
    let rowNumber = match.headerRowNumber + 1;
    rowNumber <= match.sheet.rowCount;
    rowNumber += 1
  ) {
    const row = match.sheet.getRow(rowNumber);
    const code = accountCode(value(row, match.columns.accountCode));
    const name = value(row, match.columns.accountName);
    if (!code && !name) {
      continue;
    }
    if (!code || !name) {
      errors.push(`Dòng ${rowNumber}: thiếu Mã hoặc Tên tài khoản.`);
      continue;
    }
    const companyKey = canonicalKey(
      value(row, match.columns.companyKey) || options.companyKey,
    );
    if (!companyKey) {
      errors.push(
        `Dòng ${rowNumber}: thiếu Mã công ty và chưa chọn công ty áp dụng.`,
      );
      continue;
    }
    let validFrom = value(row, match.columns.validFrom) || options.validFrom;
    let validTo = value(row, match.columns.validTo);
    try {
      validFrom = normalizeIsoDate(validFrom, `Hiệu lực từ dòng ${rowNumber}`);
      validTo = normalizeIsoDate(validTo, `Hiệu lực đến dòng ${rowNumber}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const key = `${companyKey}|${code}|${validFrom || "OPEN"}`;
    if (seen.has(key)) {
      errors.push(
        `Dòng ${rowNumber}: trùng tài khoản ${code} với dòng ${seen.get(key)}.`,
      );
      continue;
    }
    seen.set(key, rowNumber);
    const statusText = normalizeVietnamese(value(row, match.columns.status));
    items.push({
      accountCode: code,
      accountName: name,
      companyKey,
      description: value(row, match.columns.description),
      englishName: value(row, match.columns.englishName),
      level: value(row, match.columns.level) || String(code.length),
      logicalAccountKey: canonicalKey(value(row, match.columns.logicalAccountKey)),
      nature: value(row, match.columns.nature),
      parentCode: accountCode(value(row, match.columns.parentCode)),
      sourceRow: rowNumber,
      sourceSheet: match.sheet.name,
      status:
        statusText &&
        /(ngung|khong|vo hieu|inactive)/i.test(statusText)
          ? "INACTIVE"
          : "ACTIVE",
      validFrom,
      validTo,
    });
  }
  deriveParentCodes(items);
  if (items.some((item) => !item.logicalAccountKey)) {
    warnings.push(
      "Tệp chưa có Khóa tài khoản logic cho một số tài khoản. Hệ thống sẽ tự tạo khóa ban đầu và có thể chỉnh sau.",
    );
  }
  if (match.columns.companyKey < 0) {
    warnings.push(
      "Tệp không có Mã công ty; hệ thống dùng phạm vi công ty đã chọn cho toàn bộ dòng.",
    );
  }
  return {
    errors,
    headerRowNumber: match.headerRowNumber,
    items,
    sheetName: match.sheet.name,
    warnings,
  };
}

function expandAccounts(
  items: AccountImportItem[],
  companyKeys: string[],
) {
  return items.flatMap((item) =>
    item.companyKey === "TAT_CA_CONG_TY" && companyKeys.length
      ? companyKeys.map((companyKey) => ({ ...item, companyKey }))
      : [item],
  );
}

function mergeMaps(sheet: Worksheet, maxRow: number, maxColumn: number) {
  const originCells = new Map<
    string,
    { maxColumn: number; maxRow: number; minColumn: number; minRow: number }
  >();
  for (let row = 1; row <= maxRow; row += 1) {
    for (let column = 1; column <= maxColumn; column += 1) {
      const cell = sheet.getCell(row, column);
      if (!cell.isMerged) {
        continue;
      }
      const master = cell.master;
      const key = master.address;
      const current = originCells.get(key) || {
        maxColumn: Number(master.col),
        maxRow: Number(master.row),
        minColumn: Number(master.col),
        minRow: Number(master.row),
      };
      current.minRow = Math.min(current.minRow, row);
      current.maxRow = Math.max(current.maxRow, row);
      current.minColumn = Math.min(current.minColumn, column);
      current.maxColumn = Math.max(current.maxColumn, column);
      originCells.set(key, current);
    }
  }
  const maps: MergeMaps = { covered: new Map(), origins: new Map() };
  for (const [address, range] of originCells) {
    const info = {
      columnSpan: range.maxColumn - range.minColumn + 1,
      rowSpan: range.maxRow - range.minRow + 1,
      startColumn: range.minColumn,
      startRow: range.minRow,
    };
    maps.origins.set(`${range.minRow}:${range.minColumn}`, info);
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (
        let column = range.minColumn;
        column <= range.maxColumn;
        column += 1
      ) {
        if (row !== range.minRow || column !== range.minColumn) {
          maps.covered.set(`${row}:${column}`, address);
        }
      }
    }
  }
  return maps;
}

function mergedCellText(
  sheet: Worksheet,
  maps: MergeMaps,
  row: number,
  column: number,
) {
  const cell = sheet.getCell(row, column);
  if (rowCellValue(cell)) {
    return rowCellValue(cell);
  }
  const masterAddress = maps.covered.get(`${row}:${column}`);
  return masterAddress ? rowCellValue(sheet.getCell(masterAddress)) : "";
}

function colorHex(color: { argb?: string; indexed?: number; theme?: number } | undefined) {
  const argb = color?.argb;
  if (!argb || !/^[0-9A-F]{8}$/i.test(argb)) {
    return "";
  }
  const value = `#${argb.slice(2).toLowerCase()}`;
  return ["#ffffff", "#000000"].includes(value) ? "" : value;
}

function borderStyle(cell: Cell) {
  const strong = new Set(["medium", "mediumDashDot", "mediumDashDotDot", "mediumDashed", "thick", "double"]);
  const top = strong.has(cleanText(cell.border.top?.style));
  const bottom = strong.has(cleanText(cell.border.bottom?.style));
  const left = strong.has(cleanText(cell.border.left?.style));
  const right = strong.has(cleanText(cell.border.right?.style));
  const width = [cell.border.top, cell.border.bottom, cell.border.left, cell.border.right].some(
    (border) => ["thick", "double"].includes(cleanText(border?.style)),
  )
    ? 4
    : 3;
  const borderPreset =
    (left || right) && (top || bottom)
      ? "OUTLINE"
      : top && bottom
        ? "TOP_BOTTOM"
        : top
          ? "TOP"
          : bottom
            ? "BOTTOM"
            : left || right
              ? "OUTLINE"
              : "";
  return borderPreset ? { borderPreset, borderWidth: width } : {};
}

function cellStyle(cell: Cell, maps: MergeMaps) {
  const style: JsonObject = {};
  if (cell.font.bold) style.bold = true;
  if (cell.font.italic) style.italic = true;
  if (cell.font.size && cell.font.size >= 8 && cell.font.size <= 32) {
    style.fontSize = cell.font.size;
  }
  const align = cleanText(cell.alignment.horizontal).toUpperCase();
  if (["LEFT", "CENTER", "RIGHT"].includes(align)) style.align = align;
  const textColor = colorHex(cell.font.color);
  if (textColor) style.textColor = textColor;
  const fill =
    cell.fill.type === "pattern" ? colorHex(cell.fill.fgColor) : "";
  if (fill) style.fillColor = fill;
  if (cell.numFmt && !["General", "@"].includes(cell.numFmt)) {
    style.numberFormat = cell.numFmt;
  }
  Object.assign(style, borderStyle(cell));
  const merge = maps.origins.get(`${cell.row}:${cell.col}`);
  if (merge) {
    style.mergeColumnSpan = merge.columnSpan;
    style.mergeRowSpan = merge.rowSpan;
  }
  return style;
}

function marker(value: string) {
  return value.match(/^\[([^\[\]]+)\]$/)?.[1]?.trim() || "";
}

function heading(value: string) {
  const match = value.match(/^(#{1,6})\s+(.+)$/);
  return match ? { level: match[1].length, text: match[2].trim() } : null;
}

function inferColumnType(label: string, offset: number) {
  const value = normalizeVietnamese(label);
  if (/so tai khoan|ma tai khoan|ma so|ma dong|row code/.test(value)) return "ROW_CODE";
  if (/thuyet minh|ghi chu|note/.test(value)) return "NOTE_REFERENCE";
  if (
    /chi tieu|noi dung|ten tai khoan|dien giai|khoan muc|description/.test(
      value,
    ) ||
    offset === 0
  ) {
    return "LABEL";
  }
  if (/nam truoc|ky truoc|previous/.test(value)) return "PREVIOUS_PERIOD";
  if (/ke hoach|ngan sach|budget/.test(value)) return "BUDGET";
  if (/chenh lech|variance/.test(value)) return "VARIANCE";
  if (/hop nhat|consolidated/.test(value)) return "CONSOLIDATED";
  if (/cong ty|company/.test(value)) return "COMPANY";
  return "CURRENT_PERIOD";
}

function valueBasis(label: string) {
  const value = normalizeVietnamese(label);
  if (/dau ky|opening/.test(value)) return "OPENING";
  if (/cuoi ky|ending|closing/.test(value)) return "ENDING";
  if (/luy ke|ytd|dau nam/.test(value)) return "YTD";
  if (/phat sinh|trong ky|period/.test(value)) return "PERIOD";
  return "ENDING";
}

function suggestedMetric(label: string) {
  const value = normalizeVietnamese(label);
  const basis = valueBasis(label);
  const side = /\bno\b|debit/.test(value)
    ? "DEBIT"
    : /\bco\b|credit/.test(value)
      ? "CREDIT"
      : "NET";
  if (basis === "OPENING") return `OPENING_${side}`;
  if (basis === "PERIOD") return `PERIOD_${side}`;
  if (basis === "YTD") return `YTD_${side}`;
  return `CLOSING_${side}`;
}

function reportType(value: string) {
  const name = normalizeVietnamese(value);
  if (/hop nhat/.test(name)) return "CONSOLIDATED";
  if (/ket qua.*kinh doanh|bao cao.*thu nhap/.test(name)) {
    return "INCOME_STATEMENT";
  }
  if (/luu chuyen.*tien/.test(name)) return "CASH_FLOW_INDIRECT";
  if (/tinh hinh.*tai chinh|can doi.*ke toan/.test(name)) {
    return "FINANCIAL_POSITION";
  }
  return "MANAGEMENT";
}

function rowStats(
  sheet: Worksheet,
  maps: MergeMaps,
  rowNumber: number,
  maxColumn: number,
) {
  const stats = {
    boldCount: 0,
    fillCount: 0,
    formulaCount: 0,
    mergedCount: 0,
    nonEmpty: 0,
    numericCount: 0,
  };
  for (let column = 1; column <= maxColumn; column += 1) {
    const cell = sheet.getCell(rowNumber, column);
    if (rowCellValue(cell)) stats.nonEmpty += 1;
    if (formulaInCell(cell)) stats.formulaCount += 1;
    if (typeof cell.value === "number") stats.numericCount += 1;
    if (cell.font.bold) stats.boldCount += 1;
    if (cell.fill.type === "pattern" && colorHex(cell.fill.fgColor)) {
      stats.fillCount += 1;
    }
    if (maps.origins.has(`${rowNumber}:${column}`)) stats.mergedCount += 1;
  }
  return stats;
}

function readLayoutWorkbook(
  workbook: ExcelJS.Workbook,
  sourceName: string,
) {
  const result: LayoutReadResult = {
    errors: [],
    records: [],
    reports: [],
    stats: {
      formulaCellCount: 0,
      ignoredValueCount: 0,
      mergedCellCount: 0,
      reportCount: 0,
    },
    warnings: [],
  };
  const ignored = new Set([
    "HUONG_DAN",
    "HƯỚNG_DẪN",
    "HUONG DAN",
    "README",
    "CACH_NAP",
    "CÁCH_NẠP",
  ]);

  for (const sheet of workbook.worksheets) {
    if (ignored.has(sheet.name.toUpperCase())) continue;
    if (result.reports.length >= MAX_LAYOUT_REPORTS) break;
    const maxRow = Math.min(sheet.rowCount, MAX_LAYOUT_ROWS * 2);
    const maxColumn = Math.min(sheet.columnCount, MAX_LAYOUT_COLUMNS);
    if (!maxRow || !maxColumn) continue;
    if (sheet.columnCount > MAX_LAYOUT_COLUMNS) {
      result.warnings.push(
        `${sheet.name}: chỉ nạp ${MAX_LAYOUT_COLUMNS} cột đầu tiên để bản báo cáo còn sử dụng được trên màn hình.`,
      );
    }
    if (sheet.rowCount > maxRow) {
      result.warnings.push(
        `${sheet.name}: tệp có quá nhiều dòng; hệ thống chỉ đọc phần khuôn đầu tiên. Dữ liệu chi tiết không được nạp.`,
      );
    }
    const maps = mergeMaps(sheet, maxRow, maxColumn);
    const markers: { column: number; name: string; row: number }[] = [];
    for (let row = 1; row <= maxRow; row += 1) {
      for (let column = 1; column <= maxColumn; column += 1) {
        const name = marker(rowCellValue(sheet.getCell(row, column)));
        if (name) markers.push({ column, name, row });
      }
    }
    markers.sort((left, right) => left.row - right.row || left.column - right.column);
    const blocks = markers.length
      ? markers.map((item, index) => ({
          endRow: (markers[index + 1]?.row || maxRow + 1) - 1,
          explicit: true,
          markerRow: item.row,
          name: item.name,
          startRow: item.row + 1,
        }))
      : [
          {
            endRow: maxRow,
            explicit: false,
            markerRow: 1,
            name: sheet.name,
            startRow: 1,
          },
        ];
    if (!markers.length) {
      result.warnings.push(
        `${sheet.name}: chưa có [Tên báo cáo], hệ thống tạm dùng tên trang tính.`,
      );
    }

    for (const block of blocks) {
      if (
        result.reports.length >= MAX_LAYOUT_REPORTS ||
        block.startRow > block.endRow
      ) {
        continue;
      }
      let firstTableRow = -1;
      for (let row = block.startRow; row <= block.endRow; row += 1) {
        let first = "";
        for (let column = 1; column <= maxColumn; column += 1) {
          first ||= rowCellValue(sheet.getCell(row, column));
        }
        if (heading(first)) continue;
        if (rowStats(sheet, maps, row, maxColumn).nonEmpty >= 2) {
          firstTableRow = row;
          break;
        }
      }
      let headerDepth = 0;
      if (firstTableRow > 0) {
        for (
          let row = firstTableRow;
          row <= block.endRow && headerDepth < 4;
          row += 1
        ) {
          const stats = rowStats(sheet, maps, row, maxColumn);
          if (!stats.nonEmpty || stats.formulaCount) break;
          if (headerDepth > 0 && (stats.numericCount || !(stats.boldCount || stats.fillCount || stats.mergedCount))) {
            break;
          }
          headerDepth += 1;
        }
      }
      let tableStartColumn = maxColumn;
      let tableEndColumn = 1;
      const scanStart = firstTableRow > 0 ? firstTableRow : block.startRow;
      for (let row = scanStart; row <= block.endRow; row += 1) {
        for (let column = 1; column <= maxColumn; column += 1) {
          const cell = sheet.getCell(row, column);
          if (rowCellValue(cell) || formulaInCell(cell)) {
            tableStartColumn = Math.min(tableStartColumn, column);
            tableEndColumn = Math.max(tableEndColumn, column);
          }
          const merge = maps.origins.get(`${row}:${column}`);
          if (merge) {
            tableEndColumn = Math.max(
              tableEndColumn,
              Math.min(maxColumn, column + merge.columnSpan - 1),
            );
          }
        }
      }
      if (tableEndColumn < tableStartColumn) {
        tableStartColumn = 1;
        tableEndColumn = 1;
      }
      const headerRows = Array.from(
        { length: headerDepth },
        (_, index) => firstTableRow + index,
      );
      const rawWidths = Array.from(
        { length: tableEndColumn - tableStartColumn + 1 },
        (_, index) => Number(sheet.getColumn(tableStartColumn + index).width || 12),
      );
      const totalWidth = rawWidths.reduce((sum, width) => sum + width, 0) || 1;
      const columns = rawWidths.map((width, index) => {
        const column = tableStartColumn + index;
        const parts: string[] = [];
        for (const row of headerRows) {
          const part = mergedCellText(sheet, maps, row, column);
          if (part && parts.at(-1) !== part) parts.push(part);
        }
        const path = parts.join(" · ") || `Cột ${index + 1}`;
        const type = inferColumnType(path, index);
        return {
          align: type === "LABEL" ? "LEFT" : "CENTER",
          columnKey: `COT_${String(index + 1).padStart(2, "0")}`,
          columnLabel: parts.at(-1) || path,
          columnType: type,
          headerGroup: parts.length > 1 ? parts.slice(0, -1).join(" · ") : "",
          sortOrder: (index + 1) * 10,
          status: "ACTIVE",
          valueBasis: valueBasis(path),
          width: Math.max(8, Math.round((width * 1_000) / totalWidth) / 10),
        };
      });
      let bestTitle:
        | { column: number; fontSize: number; row: number; score: number; text: string }
        | undefined;
      let primaryHeading:
        | { column: number; level: number; row: number; text: string }
        | undefined;
      const titleEnd = firstTableRow > 0 ? firstTableRow - 1 : block.endRow;
      for (let row = block.startRow; row <= titleEnd; row += 1) {
        let text = "";
        let column = 1;
        for (; column <= maxColumn; column += 1) {
          text = rowCellValue(sheet.getCell(row, column));
          if (text) break;
        }
        if (!text) continue;
        const parsedHeading = heading(text);
        if (parsedHeading?.level === 1 && !primaryHeading) {
          primaryHeading = { column, row, ...parsedHeading };
        }
        const shownText = parsedHeading?.text || text;
        const fontSize = Number(sheet.getCell(row, column).font.size || 0);
        const score =
          fontSize +
          (/bao cao|bang /.test(normalizeVietnamese(shownText)) ? 20 : 0);
        if (!bestTitle || score > bestTitle.score) {
          bestTitle = { column, fontSize, row, score, text: shownText };
        }
      }
      let reportName = cleanText(block.name || sheet.name);
      if (!block.explicit && bestTitle?.text) reportName = bestTitle.text;
      const displayTitle =
        primaryHeading?.text || bestTitle?.text || reportName;
      const baseReportKey =
        canonicalKey(reportName).slice(0, 70) ||
        `BAO_CAO_${result.reports.length + 1}`;
      const sourceRange = `${sheet.name}!A${block.explicit ? block.markerRow : block.startRow}:T${block.endRow}`;
      const titleCell = primaryHeading
        ? sheet.getCell(primaryHeading.row, primaryHeading.column)
        : bestTitle
          ? sheet.getCell(bestTitle.row, bestTitle.column)
          : undefined;
      const reportPayload: JsonObject = {
        confidence: "REVIEW",
        displayTitle,
        hideColumnHeader: true,
        importTrace: {
          importedAt: new Date().toISOString(),
          sourceName,
          sourceRange,
          sourceSheet: sheet.name,
          sourceType: "EXCEL_UPLOAD",
          version: TEMPLATE_VERSION,
        },
        reportKey: baseReportKey,
        reportName,
        reportType: reportType(`${displayTitle} ${reportName}`),
        sourceNote: sourceRange,
        sourceRef: sourceName,
        status: "ACTIVE",
        titleColor: titleCell ? colorHex(titleCell.font.color) : "",
        titleFontSize: Math.max(
          16,
          Math.min(36, Number(titleCell?.font.size || 20)),
        ),
      };
      result.records.push({
        payload: reportPayload,
        recordType: "REPORT",
        sourceRow: block.startRow,
        sourceSheet: sheet.name,
      });
      columns.forEach((column) => {
        result.records.push({
          payload: { ...column, reportKey: baseReportKey, sourceRef: sourceRange },
          recordType: "REPORT_COLUMN",
          sourceRow: firstTableRow > 0 ? firstTableRow : block.startRow,
          sourceSheet: sheet.name,
        });
      });

      const rowPayloads: JsonObject[] = [];
      let formulaCellCount = 0;
      let ignoredValueCount = 0;
      let mergedCellCount = 0;
      for (
        let row = block.startRow;
        row <= block.endRow && rowPayloads.length < MAX_LAYOUT_ROWS;
        row += 1
      ) {
        if (primaryHeading?.row === row || (!block.explicit && bestTitle?.row === row)) {
          continue;
        }
        const stats = rowStats(sheet, maps, row, maxColumn);
        if (!stats.nonEmpty && !stats.formulaCount) {
          if (rowPayloads.length && rowPayloads.at(-1)?.rowType !== "SPACER") {
            rowPayloads.push({
              cells: {},
              reportKey: baseReportKey,
              rowCode: `R${String(rowPayloads.length + 1).padStart(3, "0")}`,
              rowHeight: Number(sheet.getRow(row).height || 24),
              rowLabel: "Dòng trống",
              rowType: "SPACER",
              sortOrder: (rowPayloads.length + 1) * 10,
              sourceRef: `${sheet.name}!${row}`,
              status: "ACTIVE",
            });
          }
          continue;
        }
        const sequence = rowPayloads.length + 1;
        const isHeader = headerRows.includes(row);
        const isPreamble = firstTableRow > 0 && row < firstTableRow;
        let headingInfo: ReturnType<typeof heading> = null;
        for (let column = 1; column <= maxColumn; column += 1) {
          const value = rowCellValue(sheet.getCell(row, column));
          if (value) {
            headingInfo = heading(value);
            break;
          }
        }
        const cells: JsonObject = {};
        let firstText = "";
        let displayCode = "";
        columns.forEach((columnDefinition, offset) => {
          const column = tableStartColumn + offset;
          if (maps.covered.has(`${row}:${column}`)) return;
          const sourceCell = sheet.getCell(row, column);
          const sourceText = rowCellValue(sourceCell);
          const sourceFormula = formulaInCell(sourceCell);
          const config: JsonObject = {
            ...cellStyle(sourceCell, maps),
            sourceCell: `${sheet.name}!${sourceCell.address}`,
          };
          const isValueColumn = !["LABEL", "ROW_CODE", "NOTE_REFERENCE"].includes(
            columnDefinition.columnType,
          );
          if (headingInfo) {
            if (offset !== 0) return;
            config.contentKind = headingInfo.level === 1 ? "TITLE" : "TEXT";
            config.text = headingInfo.text;
            config.bold = true;
            config.align = headingInfo.level === 1 ? "CENTER" : "LEFT";
            config.fontSize = Math.max(
              Number(config.fontSize || 0),
              Math.max(12, 22 - headingInfo.level * 2),
            );
            config.mergeColumnSpan = columns.length;
            firstText = headingInfo.text;
          } else if (isHeader) {
            config.contentKind = "TEXT";
            config.text = sourceText;
            config.bold = true;
            config.align = cleanText(config.align) || "CENTER";
            firstText ||= sourceText;
          } else if (isPreamble) {
            config.contentKind = sourceText ? "TEXT" : "SPACER";
            config.text = sourceText;
            if (sourceText && stats.nonEmpty === 1 && !config.mergeColumnSpan) {
              config.mergeColumnSpan = columns.length;
            }
            firstText ||= sourceText;
          } else if (sourceFormula || isValueColumn) {
            config.contentKind = sourceFormula ? "FORMULA" : "ACCOUNT_SET";
            config.text = "";
            config.formulaRequired = true;
            config.sourceFormulaRemoved = sourceFormula;
            config.suggestedMetricKey = suggestedMetric(
              `${columnDefinition.headerGroup} ${columnDefinition.columnLabel}`,
            );
            if (sourceFormula) {
              config.operator = "LINE_EXPRESSION";
            } else {
              const metric = cleanText(config.suggestedMetricKey);
              const parts = metric.split("_");
              const side = parts.at(-1) || "NET";
              const basis = parts.slice(0, -1).join("_");
              config.metricKey = metric;
              config.operator = ["PERIOD", "YTD"].includes(basis)
                ? "MOVEMENT"
                : "BALANCE";
              config.periodBasis = basis === "CLOSING" ? "ENDING" : basis;
              config.side = side;
              config.terms = [
                {
                  accountSetKey: "",
                  metricKey: metric,
                  operator: config.operator,
                  periodBasis: config.periodBasis,
                  side,
                  sign: 1,
                },
              ];
            }
            formulaCellCount += 1;
            if (sourceText && !sourceFormula) ignoredValueCount += 1;
          } else {
            config.contentKind = sourceText ? "TEXT" : "SPACER";
            config.text = sourceText;
            if (columnDefinition.columnType === "ROW_CODE") {
              displayCode = sourceText;
            }
            if (columnDefinition.columnType === "LABEL") firstText ||= sourceText;
          }
          if (
            Number(config.mergeColumnSpan || 1) > 1 ||
            Number(config.mergeRowSpan || 1) > 1
          ) {
            mergedCellCount += 1;
          }
          cells[columnDefinition.columnKey] = config;
        });
        firstText ||=
          Object.values(cells)
            .filter(isJsonObject)
            .map((cell) => cleanText(cell.text))
            .find(Boolean) || `Dòng ${sequence}`;
        const normalizedLabel = normalizeVietnamese(firstText);
        const rowTypeValue = headingInfo
          ? headingInfo.level === 1
            ? "TITLE"
            : "SECTION"
          : isHeader
            ? "SECTION"
            : isPreamble
              ? stats.boldCount
                ? "SECTION"
                : "NOTE"
              : /^tong|tong cong|cong /.test(normalizedLabel)
                ? "TOTAL"
                : "DATA";
        rowPayloads.push({
          cells,
          confidence: "REVIEW",
          displayCode,
          headingLevel: headingInfo?.level || 0,
          isTableHeader: isHeader,
          reportKey: baseReportKey,
          rowCode: `R${String(sequence).padStart(3, "0")}`,
          rowHeight: Math.max(18, Math.min(120, Number(sheet.getRow(row).height || 24))),
          rowLabel: firstText,
          rowType: rowTypeValue,
          sortOrder: sequence * 10,
          sourceNote: sourceName,
          sourceRef: `${sheet.name}!${row}`,
          status: "ACTIVE",
        });
      }
      rowPayloads.forEach((payload) => {
        result.records.push({
          payload,
          recordType: "REPORT_ROW",
          sourceRow: Number(cleanText(payload.sourceRef).match(/!(\d+)$/)?.[1] || block.startRow),
          sourceSheet: sheet.name,
        });
      });
      const summary: LayoutReportSummary = {
        columnCount: columns.length,
        displayTitle,
        formulaCellCount,
        headerRowCount: headerRows.length,
        ignoredValueCount,
        mergedCellCount,
        previewColumns: columns.slice(0, 8).map((column) => column.columnLabel),
        previewRows: rowPayloads.slice(0, 12).map((payload) =>
          columns.slice(0, 8).map((column) => {
            const cell = isJsonObject(payload.cells)
              ? payload.cells[column.columnKey]
              : null;
            return isJsonObject(cell) && cell.formulaRequired
              ? "Chưa thiết lập công thức"
              : isJsonObject(cell)
                ? cleanText(cell.text)
                : "";
          }),
        ),
        reportKey: baseReportKey,
        reportName,
        rowCount: rowPayloads.length,
        sourceRange,
        sourceSheet: sheet.name,
      };
      result.reports.push(summary);
      result.stats.formulaCellCount += formulaCellCount;
      result.stats.ignoredValueCount += ignoredValueCount;
      result.stats.mergedCellCount += mergedCellCount;
    }
  }
  result.stats.reportCount = result.reports.length;
  if (!result.reports.length) {
    result.errors.push(
      "Không tìm thấy khuôn báo cáo nào. Hãy thêm [Tên báo cáo] hoặc kiểm tra trang tính có nội dung.",
    );
  }
  if (result.reports.length >= MAX_LAYOUT_REPORTS) {
    result.warnings.push(
      `Chỉ nạp tối đa ${MAX_LAYOUT_REPORTS} báo cáo trong một lần.`,
    );
  }
  return result;
}

function prepareLayoutKeys(
  imported: ImportedRecord[],
  current: AccountingRecord[],
  modeValue: unknown,
) {
  const mode = canonicalKey(modeValue || "CREATE_NEW");
  const used = new Set(
    current
      .filter((record) => record.recordType === "REPORT")
      .map((record) => record.entityKey),
  );
  const keyMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  for (const item of imported) {
    if (item.recordType !== "REPORT") continue;
    const original = canonicalKey(item.payload.reportKey);
    if (!original || keyMap.has(original)) continue;
    let next = original;
    let name = cleanText(item.payload.reportName);
    if (mode === "CREATE_NEW" && used.has(next)) {
      let suffix = 2;
      while (used.has(`${original}_NAP_${suffix}`)) suffix += 1;
      next = `${original}_NAP_${suffix}`;
      name = `${name} (Bản nạp ${suffix})`;
    }
    used.add(next);
    keyMap.set(original, next);
    nameMap.set(original, name);
  }
  return imported.map((item) => {
    const payload = structuredClone(item.payload);
    const original = canonicalKey(payload.reportKey);
    if (keyMap.has(original)) payload.reportKey = keyMap.get(original);
    if (item.recordType === "REPORT" && nameMap.has(original)) {
      payload.reportName = nameMap.get(original);
    }
    return { ...item, payload };
  });
}

function accountCounts(
  items: AccountImportItem[],
  records: AccountingRecord[],
) {
  const existing = new Map(
    records
      .filter((record) => record.recordType === "ACCOUNT")
      .map((record) => [
        `${record.companyKey}|${record.displayCode}|${record.validFrom || "OPEN"}`,
        record,
      ]),
  );
  const counts = {
    createCount: 0,
    totalCount: items.length,
    unchangedCount: 0,
    updateCount: 0,
  };
  for (const item of items) {
    const key = `${item.companyKey}|${item.accountCode}|${item.validFrom || "OPEN"}`;
    const current = existing.get(key);
    if (!current) counts.createCount += 1;
    else if (comparableAccount(current.payload) === comparableAccount(item)) {
      counts.unchangedCount += 1;
    } else counts.updateCount += 1;
  }
  return counts;
}

export async function createAccountingReportConfigTemplate(
  payload: JsonObject,
  actorEmail: string,
) {
  void payload;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = actorEmail;
  workbook.created = new Date();
  workbook.modified = new Date();
  const guide = workbook.addWorksheet("HUONG_DAN", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const guideRows = [
    ["CÁCH VIẾT", "HỆ THỐNG SẼ HIỂU"],
    ["[Tên báo cáo]", "Bắt đầu một báo cáo mới và dùng tên này trong danh sách cấu hình."],
    ["# Tiêu đề cấp 1", "Tiêu đề chính in trên báo cáo: tự căn giữa, in đậm và tăng cỡ chữ."],
    ["## Tiêu đề cấp 2", "Tiêu đề nhóm lớn."],
    ["### Tiêu đề cấp 3", "Tiêu đề nhóm nhỏ hơn. Có thể dùng tiếp ####, #####, ######."],
    ["Bảng Excel bình thường", "Giữ nguyên ô gộp, độ rộng cột, chiều cao hàng, chữ, màu, căn lề và viền nhấn."],
    ["Ô công thức hoặc ô số liệu", "Không nạp số và không nạp công thức Excel. Hệ thống đánh dấu để thiết lập công thức trên ứng dụng."],
    ["Nhiều báo cáo", "Viết thêm một dòng [Tên báo cáo khác] bên dưới hoặc đặt ở trang tính khác."],
    ["An toàn", "Luôn xem bản dựng trước khi áp dụng. Mặc định tạo mẫu mới, không ghi đè mẫu đang có."],
    ["Người tạo tệp hướng dẫn", actorEmail],
  ];
  guide.addRows(guideRows);
  guide.columns = [{ width: 30 }, { width: 95 }];
  guide.getRow(1).height = 26;
  guide.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF114C41" } };
  });
  guide.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber > 1) {
      row.getCell(1).font = { bold: true, color: { argb: "FF114C41" } };
    }
  });

  const example = workbook.addWorksheet("KHUON_BAO_CAO", {
    views: [{ state: "frozen", ySplit: 5 }],
  });
  example.addRows([
    ["[Báo cáo kết quả hoạt động kinh doanh]", "", "", "", ""],
    ["# BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH", "", "", "", ""],
    ["## Năm tài chính 2026", "", "", "", ""],
    ["", "", "", "", ""],
    ["Chỉ tiêu", "Mã số", "Thuyết minh", "Năm nay", "Năm trước"],
    ["1. Doanh thu bán hàng và cung cấp dịch vụ", "01", "", "", ""],
    ["2. Các khoản giảm trừ doanh thu", "02", "", "", ""],
    ["3. Doanh thu thuần (10 = 01 - 02)", "10", "", "", ""],
    ["", "", "", "", ""],
  ]);
  example.mergeCells("A1:E1");
  example.mergeCells("A2:E2");
  example.mergeCells("A3:E3");
  example.columns = [
    { width: 52 },
    { width: 13 },
    { width: 17 },
    { width: 19 },
    { width: 19 },
  ];
  example.getCell("A1").font = { bold: true, color: { argb: "FFB85B22" } };
  example.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7DF" } };
  example.getCell("A2").font = { bold: true, color: { argb: "FF114C41" }, size: 18 };
  example.getCell("A2").alignment = { horizontal: "center" };
  example.getCell("A3").font = { bold: true, color: { argb: "FF54706A" }, size: 12 };
  example.getCell("A3").alignment = { horizontal: "center" };
  const header = example.getRow(5);
  header.height = 28;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF114C41" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF8F0" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF54706A" } },
      left: { style: "thin", color: { argb: "FFC8D7D2" } },
      right: { style: "thin", color: { argb: "FFC8D7D2" } },
      top: { style: "medium", color: { argb: "FF54706A" } },
    };
  });
  for (let row = 6; row <= 8; row += 1) {
    for (let column = 1; column <= 5; column += 1) {
      example.getCell(row, column).border = {
        bottom: {
          style: row === 8 ? "medium" : "thin",
          color: { argb: row === 8 ? "FF114C41" : "FFC8D7D2" },
        },
        left: { style: "thin", color: { argb: "FFC8D7D2" } },
        right: { style: "thin", color: { argb: "FFC8D7D2" } },
        top: {
          style: row === 8 ? "medium" : "thin",
          color: { argb: row === 8 ? "FF114C41" : "FFC8D7D2" },
        },
      };
    }
  }
  example.getRow(8).font = { bold: true };
  example.getColumn(2).numFmt = "@";
  example.getColumn(4).numFmt = "#,##0;[Red](#,##0)";
  example.getColumn(5).numFmt = "#,##0;[Red](#,##0)";

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const base64 = bytes.toString("base64");
  const dataUrl =
    "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," +
    base64;
  const fileName = `Mau_nap_khuon_Bao_cao_Ke_toan_${new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/\D/g, "")}.xlsx`;
  return {
    base64,
    fileId: "",
    fileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ok: true,
    templateVersion: TEMPLATE_VERSION,
    url: dataUrl,
    xlsxUrl: dataUrl,
    message: "Đã tạo tệp mẫu nạp khuôn Báo cáo Kế toán.",
  };
}

type ConfiguredTemplateFormula = {
  accountMembers: string;
  accountSets: string;
  columnKey: string;
  columnLabel: string;
  conditions: string;
  counterAccountMembers: string;
  counterAccountSets: string;
  evidenceComponents: ConfiguredTemplateEvidenceComponent[];
  evidenceComplete: boolean;
  evidenceDifference: number;
  evidenceExplanation: string;
  evidenceStatus: string;
  evidenceValue: number | null;
  evidenceWarning: string;
  formula: string;
  shortFormula: string;
  numericExpression: string;
  periodBasis: string;
  rowCode: string;
  rowLabel: string;
  side: string;
  sourceKeys: string;
};

type ConfiguredTemplateEvidenceComponent = {
  accountName: string;
  accountNumber: string;
  companyKey: string;
  counterAccountName: string;
  counterAccountNumber: string;
  dataSpaceName: string;
  datasetType: string;
  entryCount: number;
  formulaSign: number;
  label: string;
  periodFrom: string;
  periodTo: string;
  signedValue: number;
  sourceName: string;
  sourceKey: string;
  tracePath: string;
};

const REPORT_OPERATOR_LABELS: Record<string, string> = {
  BALANCE: "Số dư",
  CASH_MOVEMENT: "Dòng tiền",
  CROSS_REPORT: "Lấy từ báo cáo khác",
  DELTA_BALANCE: "Chênh lệch số dư",
  LINE_EXPRESSION: "Công thức theo mã dòng",
  LINE_REFERENCE: "Tham chiếu dòng",
  MANUAL_ADJUSTMENT: "Điều chỉnh có lịch sử",
  MOVEMENT: "Phát sinh",
  MOVEMENT_DETAIL: "Phát sinh có tài khoản đối ứng",
  PROFIT_LOSS_ACTIVITY: "Thu nhập/chi phí trong kỳ",
  SUBTRACT_LINES: "Lấy dòng này trừ dòng kia",
  SUM_LINES: "Cộng các dòng",
};

const REPORT_METRIC_LABELS: Record<string, string> = {
  CLOSING_CREDIT: "Số dư Có cuối kỳ",
  CLOSING_CREDIT_BALANCE: "Số dư ròng bên Có cuối kỳ",
  CLOSING_DEBIT: "Số dư Nợ cuối kỳ",
  CLOSING_DEBIT_BALANCE: "Số dư ròng bên Nợ cuối kỳ",
  CLOSING_NET: "Chênh lệch Nợ − Có cuối kỳ",
  DELTA_CREDIT_BALANCE: "Tăng/giảm số dư ròng bên Có",
  DELTA_DEBIT_BALANCE: "Tăng/giảm số dư ròng bên Nợ",
  OPENING_CREDIT: "Số dư Có đầu kỳ",
  OPENING_CREDIT_BALANCE: "Số dư ròng bên Có đầu kỳ",
  OPENING_DEBIT: "Số dư Nợ đầu kỳ",
  OPENING_DEBIT_BALANCE: "Số dư ròng bên Nợ đầu kỳ",
  OPENING_NET: "Chênh lệch Nợ − Có đầu kỳ",
  PERIOD_CREDIT: "Phát sinh Có trong kỳ",
  PERIOD_DEBIT: "Phát sinh Nợ trong kỳ",
  PERIOD_NET: "Chênh lệch Nợ − Có phát sinh trong kỳ",
  YTD_CREDIT: "Lũy kế phát sinh Có từ đầu năm",
  YTD_DEBIT: "Lũy kế phát sinh Nợ từ đầu năm",
};

const REPORT_PERIOD_LABELS: Record<string, string> = {
  DELTA: "Chênh lệch",
  ENDING: "Cuối kỳ",
  OPENING: "Đầu kỳ",
  PERIOD: "Trong kỳ",
  YTD: "Lũy kế từ đầu năm",
};

const REPORT_SIDE_LABELS: Record<string, string> = {
  CREDIT: "Có",
  CREDIT_BALANCE: "Số dư ròng bên Có",
  DEBIT: "Nợ",
  DEBIT_BALANCE: "Số dư ròng bên Nợ",
  NET: "Nợ − Có",
};

function reportTemplateSort(left: AccountingRecord, right: AccountingRecord) {
  return (
    Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
    left.displayCode.localeCompare(right.displayCode, "vi", { numeric: true })
  );
}

function reportTemplatePayload(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function reportTemplateStringList(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : cleanText(value).split(/[\n,;]+/);
  return Array.from(
    new Set(source.map(cleanText).filter(Boolean)),
  );
}

function reportTemplateStyle(
  rowPayload: JsonObject,
  cellPayload: JsonObject,
  columnPayload: JsonObject,
  styles: Map<string, JsonObject>,
) {
  const style = {
    ...reportTemplatePayload(styles.get(canonicalKey(rowPayload.styleKey))),
  };
  for (const key of [
    "bold",
    "italic",
    "uppercase",
    "align",
    "numberFormat",
    "indent",
    "fontSize",
    "textColor",
    "fillColor",
    "borderPreset",
    "borderWidth",
  ]) {
    if (rowPayload[key] !== undefined && rowPayload[key] !== "") {
      style[key] = rowPayload[key];
    }
    if (cellPayload[key] !== undefined && cellPayload[key] !== "") {
      style[key] = cellPayload[key];
    }
  }
  if (!cleanText(style.align)) {
    style.align =
      columnPayload.align ||
      (canonicalKey(columnPayload.columnType) === "LABEL" ? "LEFT" : "RIGHT");
  }
  return style;
}

function reportTemplateColumnPeriodBasis(columnPayload: JsonObject) {
  const selector = canonicalKey(columnPayload.periodSelector);
  if (["OPENING_OF_CURRENT_RANGE", "END_OF_PRIOR_YEAR"].includes(selector)) {
    return "OPENING";
  }
  const aliases: Record<string, string> = {
    CLOSING: "ENDING",
    CLOSING_BALANCE: "ENDING",
    CURRENT_MOVEMENT: "PERIOD",
    OPENING_BALANCE: "OPENING",
    YEAR_TO_DATE: "YTD",
  };
  const valueBasis = aliases[canonicalKey(columnPayload.valueBasis)] ||
    canonicalKey(columnPayload.valueBasis);
  return ["OPENING", "PERIOD", "YTD", "ENDING", "DELTA"].includes(valueBasis)
    ? valueBasis
    : "";
}

function reportTemplateMetricLabel(term: JsonObject, columnPeriodBasis = "") {
  const usesColumnBasis = term.useColumnBasis !== false && Boolean(columnPeriodBasis);
  const metricKey = canonicalKey(term.metricKey);
  const operator = canonicalKey(term.operator || "BALANCE");
  const metricSide = metricKey.includes("CREDIT")
    ? metricKey.includes("BALANCE")
      ? "CREDIT_BALANCE"
      : "CREDIT"
    : metricKey.includes("DEBIT")
      ? metricKey.includes("BALANCE")
        ? "DEBIT_BALANCE"
        : "DEBIT"
      : metricKey.includes("NET")
        ? "NET"
        : "";
  const metricPeriod = metricKey.startsWith("OPENING_")
    ? "OPENING"
    : metricKey.startsWith("CLOSING_")
      ? "ENDING"
      : metricKey.startsWith("YTD_")
        ? "YTD"
        : metricKey.startsWith("PERIOD_")
          ? "PERIOD"
          : metricKey.startsWith("DELTA_")
            ? "DELTA"
            : "";
  const movementOperator = [
    "MOVEMENT",
    "MOVEMENT_DETAIL",
    "CASH_MOVEMENT",
    "PROFIT_LOSS_ACTIVITY",
  ].includes(operator);
  const periodBasis = movementOperator
    ? canonicalKey(term.periodBasis || metricPeriod || "PERIOD")
    : usesColumnBasis
      ? columnPeriodBasis
      : canonicalKey(term.periodBasis || metricPeriod || "ENDING");
  const side = canonicalKey(term.side || metricSide || "NET");
  const period = REPORT_PERIOD_LABELS[periodBasis] || periodBasis;
  const sideLabel = REPORT_SIDE_LABELS[side] || side;
  if (operator === "DELTA_BALANCE") {
    return `mức tăng/giảm ${sideLabel.toLocaleLowerCase("vi")} giữa đầu kỳ và cuối kỳ`;
  }
  if (movementOperator) {
    return `phát sinh ${sideLabel} ${period.toLocaleLowerCase("vi")}`;
  }
  return `số dư ${sideLabel} ${period.toLocaleLowerCase("vi")}`;
}

function reportTemplateFormulaTerms(rule: JsonObject) {
  if (Array.isArray(rule.terms) && rule.terms.length) {
    return rule.terms.map(reportTemplatePayload);
  }
  if (
    cleanText(rule.accountSetKey) ||
    cleanText(rule.operator) ||
    cleanText(rule.expression)
  ) {
    return [rule];
  }
  return [];
}

type ReportTemplateAccountMember = {
  companyKey: string;
  matchType: string;
  matchValue: string;
  role: string;
};

function reportTemplateAccountMemberLabel(member: ReportTemplateAccountMember) {
  const values = reportTemplateStringList(member.matchValue);
  const labels = values.map((value) => {
    const cleaned = value.replace(/^TK\s*/i, "").trim();
    const suffix = canonicalKey(member.matchType) === "PREFIX" && !cleaned.endsWith("*")
      ? "*"
      : "";
    return `TK ${cleaned}${suffix}`;
  });
  return labels.join(", ");
}

function reportTemplateAccountMemberText(
  accountSetKey: unknown,
  accountMembers: Map<string, ReportTemplateAccountMember[]>,
) {
  const members = accountMembers.get(canonicalKey(accountSetKey)) || [];
  if (!members.length) return "Chưa khai báo tài khoản thành phần";
  const definitions = new Map<string, string[]>();
  for (const member of members) {
    const companyKey = canonicalKey(member.companyKey) || "TẤT CẢ CÔNG TY";
    const definition = `${canonicalKey(member.role || "INCLUDE")}|${canonicalKey(member.matchType || "EXACT")}|${member.matchValue}`;
    const companies = definitions.get(definition) || [];
    if (!companies.includes(companyKey)) companies.push(companyKey);
    definitions.set(definition, companies);
  }
  const grouped = new Map<string, { include: string[]; exclude: string[] }>();
  for (const [definition, companies] of definitions) {
    const [role, matchType, ...valueParts] = definition.split("|");
    const companyLabel = companies.sort().join(", ");
    const bucket = grouped.get(companyLabel) || { include: [], exclude: [] };
    const label = reportTemplateAccountMemberLabel({
      companyKey: companyLabel,
      matchType,
      matchValue: valueParts.join("|"),
      role,
    });
    if (role === "EXCLUDE") bucket.exclude.push(label);
    else bucket.include.push(label);
    grouped.set(companyLabel, bucket);
  }
  return Array.from(grouped.entries())
    .map(([companies, bucket]) => {
      const scope = companies === "TẤT CẢ CÔNG TY" ? "" : `${companies}: `;
      const include = bucket.include.length ? `gồm ${bucket.include.join(", ")}` : "";
      const exclude = bucket.exclude.length ? `loại ${bucket.exclude.join(", ")}` : "";
      return `${scope}${[include, exclude].filter(Boolean).join("; ")}`;
    })
    .join(" | ");
}

function reportTemplateShortExpression(value: unknown) {
  const source = cleanText(value).replace(/^\s*=\s*/, "");
  if (!source) return "";
  if (/\[[^\]]+\]/.test(source)) {
    return source.replace(/\s*([+\-*/])\s*/g, " $1 ");
  }
  return source
    .replace(/([A-Za-z0-9_.:-]+)/g, "[$1]")
    .replace(/\s*([+\-*/])\s*/g, " $1 ");
}

function reportTemplateShortAccountMembers(
  accountSetKey: unknown,
  accountMembers: Map<string, ReportTemplateAccountMember[]>,
) {
  const members = accountMembers.get(canonicalKey(accountSetKey)) || [];
  const include: string[] = [];
  const exclude: string[] = [];
  for (const member of members) {
    const target = canonicalKey(member.role || "INCLUDE") === "EXCLUDE"
      ? exclude
      : include;
    for (const value of reportTemplateStringList(member.matchValue)) {
      const cleaned = value.replace(/^TK\s*/i, "").trim();
      const token = canonicalKey(member.matchType) === "PREFIX" && !cleaned.endsWith("*")
        ? `${cleaned}*`
        : cleaned;
      if (token && !target.includes(token)) target.push(token);
    }
  }
  return { include, exclude };
}

function reportTemplateShortMetricCode(
  term: JsonObject,
  columnPayload: JsonObject,
) {
  const columnPeriodBasis = reportTemplateColumnPeriodBasis(columnPayload);
  const metricKey = canonicalKey(term.metricKey);
  const operator = canonicalKey(term.operator || "BALANCE");
  const metricSide = metricKey.includes("CREDIT")
    ? metricKey.includes("BALANCE") ? "CREDIT_BALANCE" : "CREDIT"
    : metricKey.includes("DEBIT")
      ? metricKey.includes("BALANCE") ? "DEBIT_BALANCE" : "DEBIT"
      : "NET";
  const metricPeriod = metricKey.startsWith("OPENING_")
    ? "OPENING"
    : metricKey.startsWith("CLOSING_")
      ? "ENDING"
      : metricKey.startsWith("YTD_")
        ? "YTD"
        : metricKey.startsWith("PERIOD_")
          ? "PERIOD"
          : metricKey.startsWith("DELTA_") ? "DELTA" : "";
  const movement = [
    "MOVEMENT",
    "MOVEMENT_DETAIL",
    "CASH_MOVEMENT",
    "PROFIT_LOSS_ACTIVITY",
  ].includes(operator);
  const period = movement
    ? canonicalKey(term.periodBasis || metricPeriod || "PERIOD")
    : term.useColumnBasis !== false && columnPeriodBasis
      ? columnPeriodBasis
      : canonicalKey(term.periodBasis || metricPeriod || "ENDING");
  const side = canonicalKey(term.side || metricSide || "NET");
  if (operator === "DELTA_BALANCE" || period === "DELTA") {
    return side.startsWith("CREDIT")
      ? "TANG_GIAM_DUCO"
      : side.startsWith("DEBIT") ? "TANG_GIAM_DUNO" : "TANG_GIAM_NO_TRU_CO";
  }
  if (movement || period === "PERIOD") {
    return side.startsWith("CREDIT")
      ? "PSCO"
      : side.startsWith("DEBIT") ? "PSNO" : "PSNO_TRU_PSCO";
  }
  if (period === "YTD") {
    return side.startsWith("CREDIT")
      ? "LKCO"
      : side.startsWith("DEBIT") ? "LKNO" : "LKNO_TRU_LKCO";
  }
  const suffix = period === "OPENING" ? "_DK" : "";
  return `${side.startsWith("CREDIT") ? "DUCO" : side.startsWith("DEBIT") ? "DUNO" : "NO_TRU_CO"}${suffix}`;
}

function reportTemplateShortFormula(
  rule: JsonObject,
  accountMembers: Map<string, ReportTemplateAccountMember[]>,
  columnPayload: JsonObject = {},
) {
  const expression = cleanText(rule.expression);
  if (expression) return reportTemplateShortExpression(expression);
  const terms = reportTemplateFormulaTerms(rule);
  if (!terms.length) {
    return reportTemplateStringList(rule.lineRefs)
      .map((rowCode) => `[${rowCode}]`)
      .join(" + ");
  }
  return terms.map((term, index) => {
    const operator = canonicalKey(term.operator || rule.operator);
    let body = "";
    if (["LINE_REFERENCE", "REPORT_LINE"].includes(operator)) {
      body = `[${cleanText(term.targetRowCode || term.lineRef) || "?"}]`;
    } else if (operator === "CROSS_REPORT") {
      body = `[${cleanText(term.targetReportKey) || "?"}:${cleanText(term.targetRowCode) || "?"}]`;
    } else if (operator === "MANUAL_ADJUSTMENT") {
      body = "DIEU_CHINH_DA_DUYET";
    } else if (["SUM_LINES", "SUBTRACT_LINES", "LINE_EXPRESSION"].includes(operator)) {
      body = reportTemplateShortExpression(term.expression || term.lineRefs || rule.expression || rule.lineRefs);
    } else {
      const accountSetKey = term.accountSetKey || rule.accountSetKey;
      const members = reportTemplateShortAccountMembers(accountSetKey, accountMembers);
      const counterKey = term.counterAccountSetKey || rule.counterAccountSetKey;
      const filters = reportTemplatePayload(term.filters || rule.filters);
      const metricCode = reportTemplateShortMetricCode({ ...rule, ...term }, columnPayload);
      if (
        members.include.length
        && !members.exclude.length
        && !cleanText(counterKey)
        && !(Array.isArray(filters.conditions) && filters.conditions.length)
      ) {
        body = members.include
          .map((accountNumber) => `${metricCode}(${accountNumber})`)
          .join(" + ");
      } else {
        const parts = [members.include.join(", ") || canonicalKey(accountSetKey) || "?"];
        if (members.exclude.length) parts.push(`loại: ${members.exclude.join(", ")}`);
      if (cleanText(counterKey)) {
        const counter = reportTemplateShortAccountMembers(counterKey, accountMembers);
        parts.push(`đối ứng: ${counter.include.join(", ") || canonicalKey(counterKey)}`);
        if (counter.exclude.length) parts.push(`loại đối ứng: ${counter.exclude.join(", ")}`);
      }
      if (Array.isArray(filters.conditions) && filters.conditions.length) {
        parts.push(`${filters.conditions.length} điều kiện`);
      }
        body = `${metricCode}(${parts.join("; ")})`;
      }
    }
    const negative = Number(term.sign) < 0;
    if (negative && body.includes(" + ")) body = `(${body})`;
    return `${index === 0 ? negative ? "- " : "" : negative ? " - " : " + "}${body}`;
  }).join("");
}

function reportTemplateAccountSetText(
  accountSetKey: unknown,
  accountSets: Map<string, string>,
  accountMembers: Map<string, ReportTemplateAccountMember[]>,
) {
  const key = canonicalKey(accountSetKey);
  if (!key) return "chưa chọn nhóm tài khoản";
  const name = accountSets.get(key) || key;
  return `${name} [${reportTemplateAccountMemberText(key, accountMembers)}]`;
}

function reportTemplateAccountSetName(
  accountSetKey: unknown,
  accountSets: Map<string, string>,
) {
  const key = canonicalKey(accountSetKey);
  return key ? accountSets.get(key) || key : "nhóm tài khoản chưa được chọn";
}

function reportTemplateFormulaText(
  rule: JsonObject,
  accountSets: Map<string, string>,
  accountMembers: Map<string, ReportTemplateAccountMember[]>,
  columnPayload: JsonObject = {},
) {
  const columnPeriodBasis = reportTemplateColumnPeriodBasis(columnPayload);
  const expression = cleanText(rule.expression);
  if (expression) return `Tính theo các mã dòng: ${expression.replace(/^\s*=\s*/, "")}.`;
  const terms = reportTemplateFormulaTerms(rule);
  if (terms.length) {
    return terms
      .map((term, index) => {
        const action = Number(term.sign) < 0 ? "Trừ" : index === 0 ? "Lấy" : "Cộng";
        const operator = canonicalKey(term.operator || rule.operator);
        if (operator === "CROSS_REPORT") {
          return `${action} số tại dòng ${cleanText(term.targetRowCode || rule.targetRowCode) || "chưa chọn"} của báo cáo “${cleanText(term.targetReportKey || rule.targetReportKey) || "chưa chọn"}”.`;
        }
        if (operator === "LINE_REFERENCE") {
          return `${action} số tại dòng ${cleanText(term.targetRowCode || term.lineRef || rule.targetRowCode || rule.lineRefs) || "chưa chọn"} của chính báo cáo này.`;
        }
        if (operator === "MANUAL_ADJUSTMENT") {
          return `${action} khoản điều chỉnh đã được lưu trong lịch sử.`;
        }
        if (["SUM_LINES", "SUBTRACT_LINES", "LINE_EXPRESSION"].includes(operator)) {
          const reference = cleanText(term.expression || term.lineRefs || rule.expression || rule.lineRefs);
          return `${action} theo các mã dòng${reference ? `: ${reference}` : " đã cấu hình"}.`;
        }
        const accountSetKey = canonicalKey(term.accountSetKey || rule.accountSetKey);
        const accountSet = reportTemplateAccountSetName(accountSetKey, accountSets);
        const counterAccountSetKey = canonicalKey(
          term.counterAccountSetKey || rule.counterAccountSetKey,
        );
        if (counterAccountSetKey) {
          const counterAccountSet = reportTemplateAccountSetName(counterAccountSetKey, accountSets);
          const side = canonicalKey(term.side || rule.side || "NET");
          if (side === "DEBIT") {
            return `${action} phát sinh Nợ trong kỳ của nhóm “${accountSet}” khi phía đối ứng là Có của nhóm “${counterAccountSet}”.`;
          }
          if (side === "CREDIT") {
            return `${action} phát sinh Có trong kỳ của nhóm “${accountSet}” khi phía đối ứng là Nợ của nhóm “${counterAccountSet}”.`;
          }
          return `${action} ${reportTemplateMetricLabel({ ...rule, ...term }, columnPeriodBasis)} của nhóm “${accountSet}”, với tài khoản đối ứng thuộc nhóm “${counterAccountSet}”.`;
        }
        return `${action} ${reportTemplateMetricLabel({ ...rule, ...term }, columnPeriodBasis)} của nhóm “${accountSet}”.`;
      })
      .join(" ");
  }
  const operator = canonicalKey(rule.operator);
  return REPORT_OPERATOR_LABELS[operator] || operator;
}

function reportTemplateFormulaDetails(
  rule: JsonObject,
  accountSets: Map<string, string>,
  accountMembers: Map<string, ReportTemplateAccountMember[]>,
  columnPayload: JsonObject = {},
) {
  const terms = reportTemplateFormulaTerms(rule);
  const columnPeriodBasis = reportTemplateColumnPeriodBasis(columnPayload);
  const accountSetKeys = terms.flatMap((term) =>
    reportTemplateStringList(term.accountSetKey || rule.accountSetKey),
  );
  const sourceKeys = terms.flatMap((term) =>
    reportTemplateStringList(term.sourceKey || rule.sourceKey),
  );
  const counterAccountSetKeys = terms.flatMap((term) =>
    reportTemplateStringList(
      term.counterAccountSetKey || rule.counterAccountSetKey,
    ),
  );
  const periods = terms.flatMap((term) => {
    const period = term.useColumnBasis === false
      ? term.periodBasis || rule.periodBasis
      : columnPeriodBasis || term.periodBasis || rule.periodBasis;
    return reportTemplateStringList(period);
  });
  const sides = terms.flatMap((term) =>
    reportTemplateStringList(term.side || rule.side),
  );
  const references = terms.flatMap((term) =>
    reportTemplateStringList(
      term.conditionKey ||
        term.lineRefs ||
        term.expression ||
        term.targetReportKey ||
        rule.conditionKey ||
        rule.lineRefs ||
        rule.targetReportKey,
    ),
  );
  return {
    accountMembers: Array.from(new Set(accountSetKeys))
      .map((key) => reportTemplateAccountMemberText(key, accountMembers))
      .join(" | "),
    accountSets: Array.from(new Set(accountSetKeys))
      .map((key) => accountSets.get(canonicalKey(key)) || key)
      .join("; "),
    conditions: Array.from(new Set(references)).join("; "),
    counterAccountMembers: Array.from(new Set(counterAccountSetKeys))
      .map((key) => reportTemplateAccountMemberText(key, accountMembers))
      .join(" | "),
    counterAccountSets: Array.from(new Set(counterAccountSetKeys))
      .map((key) => accountSets.get(canonicalKey(key)) || key)
      .join("; "),
    formula: reportTemplateFormulaText(rule, accountSets, accountMembers, columnPayload),
    shortFormula: reportTemplateShortFormula(rule, accountMembers, columnPayload),
    periodBasis: Array.from(new Set(periods))
      .map((value) => REPORT_PERIOD_LABELS[canonicalKey(value)] || value)
      .join("; "),
    side: Array.from(new Set(sides))
      .map((value) => REPORT_SIDE_LABELS[canonicalKey(value)] || value)
      .join("; "),
    sourceKeys: Array.from(new Set(sourceKeys)).join("; "),
  };
}

function reportTemplateCellRule(
  rowPayload: JsonObject,
  cellPayload: JsonObject,
  rules: Map<string, JsonObject>,
) {
  const hasInlineRule = [
    "contentKind",
    "accountSetKey",
    "operator",
    "expression",
    "terms",
  ].some((key) => {
    const value = cellPayload[key];
    return value !== undefined && value !== "" && !(Array.isArray(value) && !value.length);
  });
  return hasInlineRule
    ? cellPayload
    : reportTemplatePayload(rules.get(canonicalKey(rowPayload.ruleKey)));
}

function reportTemplateHeaderRows(columns: AccountingRecord[]) {
  const hasGroup = columns.some((column) => cleanText(column.payload.headerGroup));
  if (!hasGroup) {
    return [
      columns.map((column) => ({
        columnSpan: 1,
        label: cleanText(column.payload.columnLabel),
        rowSpan: 1,
      })),
    ];
  }
  const top: Array<{ columnSpan: number; label: string; rowSpan: number }> = [];
  const bottom: Array<{ columnSpan: number; label: string; rowSpan: number }> = [];
  for (let index = 0; index < columns.length; ) {
    const column = columns[index];
    const group = cleanText(column.payload.headerGroup);
    if (!group) {
      top.push({
        columnSpan: 1,
        label: cleanText(column.payload.columnLabel),
        rowSpan: 2,
      });
      index += 1;
      continue;
    }
    let span = 1;
    while (
      index + span < columns.length &&
      cleanText(columns[index + span].payload.headerGroup) === group
    ) {
      span += 1;
    }
    top.push({ columnSpan: span, label: group, rowSpan: 1 });
    for (let offset = 0; offset < span; offset += 1) {
      bottom.push({
        columnSpan: 1,
        label: cleanText(columns[index + offset].payload.columnLabel),
        rowSpan: 1,
      });
    }
    index += span;
  }
  return [top, bottom];
}

function reportTemplateColor(value: unknown, fallback: string) {
  const color = cleanText(value).replace("#", "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(color) ? `FF${color}` : fallback;
}

function reportTemplateBorder(style: JsonObject) {
  const preset = canonicalKey(style.borderPreset || "DEFAULT");
  const width = Number(style.borderWidth || 1);
  const strong = { style: width >= 4 ? "thick" : "medium", color: { argb: "FF114C41" } } as const;
  const thin = { style: "thin", color: { argb: "FFD1DDDA" } } as const;
  return {
    bottom: ["BOTTOM", "TOP_BOTTOM", "OUTLINE"].includes(preset) ? strong : thin,
    left: preset === "OUTLINE" ? strong : thin,
    right: preset === "OUTLINE" ? strong : thin,
    top: ["TOP", "TOP_BOTTOM", "OUTLINE"].includes(preset) ? strong : thin,
  };
}

function reportTemplateEvidenceNumber(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  }).format(Math.abs(number));
}

function reportTemplateEvidenceIsNegative(
  component: ConfiguredTemplateEvidenceComponent,
) {
  return Math.abs(component.signedValue) > 0.00005
    ? component.signedValue < 0
    : component.formulaSign < 0;
}

function reportTemplateEvidenceSourceName(item: JsonObject) {
  const direct = cleanText(item.sourceName);
  if (direct) return direct;
  const labels: Record<string, string> = {
    ACCOUNT_DETAIL: "Sổ chi tiết tài khoản AMIS",
    ACCOUNT_LEDGER: "Sổ chi tiết tài khoản AMIS",
    GENERAL_LEDGER: "Sổ nhật ký chung AMIS",
    MANUAL_ADJUSTMENT: "Lịch sử điều chỉnh kế toán",
    TRIAL_BALANCE: "Bảng cân đối tài khoản AMIS",
  };
  return labels[canonicalKey(item.datasetType)] || "Dữ liệu kế toán đã đồng bộ";
}

function reportTemplateEvidenceIndex(output: JsonObject | undefined) {
  const index = new Map<string, JsonObject>();
  const rows = Array.isArray(output?.rows) ? output.rows : [];
  for (const rawRow of rows) {
    const row = reportTemplatePayload(rawRow);
    const rowCode = canonicalKey(row.rowCode);
    for (const rawCell of Array.isArray(row.cells) ? row.cells : []) {
      const cell = reportTemplatePayload(rawCell);
      const evidence = reportTemplatePayload(cell.evidence);
      const columnKey = canonicalKey(cell.columnKey);
      if (rowCode && columnKey && Object.keys(evidence).length) {
        index.set(`${rowCode}::${columnKey}`, evidence);
      }
    }
  }
  return index;
}

function reportTemplateEvidenceDetails(evidence: JsonObject | undefined) {
  if (!evidence) {
    return {
      components: [] as ConfiguredTemplateEvidenceComponent[],
      evidenceComplete: false,
      evidenceDifference: 0,
      evidenceExplanation: "",
      numericExpression: "",
      evidenceStatus: "CHƯA CÓ DỮ LIỆU CHỨNG MINH",
      evidenceValue: null as number | null,
      evidenceWarning: "Chưa nhận được dữ liệu chứng minh cho ô báo cáo này.",
    };
  }
  const components = (Array.isArray(evidence.components) ? evidence.components : [])
    .map((raw): ConfiguredTemplateEvidenceComponent => {
      const item = reportTemplatePayload(raw);
      return {
        accountName: cleanText(item.accountName),
        accountNumber: cleanText(item.accountNumber),
        companyKey: cleanText(item.companyKey),
        counterAccountName: cleanText(item.counterAccountName),
        counterAccountNumber: cleanText(item.counterAccountNumber),
        dataSpaceName: cleanText(item.dataSpaceName),
        datasetType: cleanText(item.datasetType),
        entryCount: Number(item.entryCount || 0),
        formulaSign: Number(item.formulaSign) < 0 ? -1 : 1,
        label: cleanText(item.label) || "Thành phần theo công thức",
        periodFrom: cleanText(item.periodFrom),
        periodTo: cleanText(item.periodTo),
        signedValue: Number(item.signedValue || 0),
        sourceName: reportTemplateEvidenceSourceName(item),
        sourceKey: cleanText(item.sourceKey),
        tracePath: cleanText(item.tracePath || item.label) || "Thành phần theo công thức",
      };
    })
    .filter((item) => Number.isFinite(item.signedValue));
  const visible = components;
  const resultValue = Number(evidence.value || 0);
  const tracedValue = visible.reduce((sum, item) => sum + item.signedValue, 0);
  const reportedDifference = Number(evidence.difference);
  const difference = Number.isFinite(reportedDifference)
    ? reportedDifference
    : resultValue - tracedValue;
  const explicitComplete = typeof evidence.isComplete === "boolean" ? evidence.isComplete : undefined;
  const evidenceComplete = explicitComplete ?? Math.abs(difference) <= 0.0001;
  const evidenceWarning = cleanText(evidence.warning);
  const noActivity =
    evidenceComplete &&
    visible.length > 0 &&
    visible.every((item) => Math.abs(item.signedValue) <= 0.00005);
  const numericTerms = visible.map((item, index) => {
    const prefix = reportTemplateEvidenceIsNegative(item)
      ? index
        ? "− "
        : "−"
      : index
        ? "+ "
        : "";
    return `${prefix}${reportTemplateEvidenceNumber(item.signedValue)}`;
  });
  const explanationTerms = visible.map((item, index) => {
    const prefix = reportTemplateEvidenceIsNegative(item)
      ? index
        ? "− "
        : "−"
      : index
        ? "+ "
        : "";
    return `${prefix}[${item.tracePath}: ${reportTemplateEvidenceNumber(item.signedValue)}]`;
  });
  const numericCalculation = `= ${numericTerms.join(" ") || "0"} = ${reportTemplateEvidenceNumber(tracedValue)}`;
  return {
    components,
    evidenceComplete,
    evidenceDifference: difference,
    evidenceStatus: evidenceComplete
      ? noActivity
        ? "Công thức hợp lệ - kỳ này không phát sinh"
        : "Đủ nguồn - đã khớp"
      : "Chưa đủ nguồn",
    evidenceValue: Number.isFinite(resultValue) ? resultValue : null,
    evidenceWarning: evidenceComplete
      ? noActivity
        ? "Công thức vẫn được xuất đầy đủ; kỳ đã chọn không phát sinh số liệu."
        : ""
      : evidenceWarning || `Còn chênh lệch ${reportTemplateEvidenceNumber(difference)} chưa truy được nguồn.`,
    numericExpression: evidenceComplete
      ? numericCalculation
      : `${numericCalculation} | Kết quả báo cáo: ${resultValue < 0 ? "−" : ""}${reportTemplateEvidenceNumber(resultValue)} | Chưa giải thích: ${difference < 0 ? "−" : ""}${reportTemplateEvidenceNumber(difference)}`,
    evidenceExplanation: `= ${explanationTerms.join(" ") || "[Không phát sinh: 0]"}`,
  };
}

function reportTemplateReadableAccountText(item: ConfiguredTemplateFormula) {
  const lines: string[] = [];
  if (item.accountSets) lines.push(`Nhóm tài khoản: ${item.accountSets}`);
  if (item.accountMembers) lines.push(`Gồm: ${item.accountMembers}`);
  if (item.counterAccountSets) {
    lines.push(`Nhóm tài khoản đối ứng: ${item.counterAccountSets}`);
  }
  if (item.counterAccountMembers) {
    lines.push(`Tài khoản đối ứng gồm: ${item.counterAccountMembers}`);
  }
  if (item.conditions) lines.push(`Điều kiện/tham chiếu: ${item.conditions}`);
  if (item.sourceKeys) lines.push(`Nguồn lấy số: ${item.sourceKeys}`);
  return lines.join("\n");
}

function reportTemplateReadableEvidenceText(item: ConfiguredTemplateFormula) {
  if (item.evidenceValue === null) {
    return [
      "Chưa có số liệu để chứng minh cho kỳ đã chọn.",
      item.evidenceWarning,
      "Công thức mẫu vẫn được giữ nguyên ở cột bên trái.",
    ].filter(Boolean).join("\n");
  }
  const lines = [
    `Tính bằng số: ${item.numericExpression || `= ${reportTemplateEvidenceNumber(item.evidenceValue)}`}`,
    item.evidenceExplanation
      ? `Mỗi số là gì: ${item.evidenceExplanation}`
      : "Mỗi số là gì: kỳ này không phát sinh dữ liệu nguồn.",
    `Kiểm tra: ${item.evidenceStatus}`,
  ];
  if (item.evidenceWarning) lines.push(`Lưu ý: ${item.evidenceWarning}`);
  if (item.evidenceComponents.length) {
    lines.push(
      `${item.evidenceComponents.length} thành phần nguồn; xem toàn bộ bút toán ở sheet “Nguồn số liệu đã dùng”.`,
    );
  }
  return lines.join("\n");
}

function buildReadableConfiguredTemplateSheet(input: {
  columns: AccountingRecord[];
  evidenceMode: boolean;
  evidenceOutput?: JsonObject;
  formulaRows: ConfiguredTemplateFormula[];
  reportPayload: JsonObject;
  rows: AccountingRecord[];
  sheet: ExcelJS.Worksheet;
  styles: Map<string, JsonObject>;
  title: string;
  versionName?: string;
}) {
  const {
    columns,
    evidenceMode,
    evidenceOutput,
    formulaRows,
    reportPayload,
    rows,
    sheet,
    styles,
    title,
    versionName,
  } = input;
  const nonValueTypes = new Set(["LABEL", "ROW_CODE", "NOTE_REFERENCE"]);
  const valueSpan = evidenceMode ? 4 : 3;
  const layouts: Array<{
    column: AccountingRecord;
    isValue: boolean;
    payload: JsonObject;
    span: number;
    start: number;
  }> = [];
  let physicalColumn = 1;
  for (const column of columns) {
    const payload = reportTemplatePayload(column.payload);
    const isValue = !nonValueTypes.has(canonicalKey(payload.columnType));
    const span = isValue ? valueSpan : 1;
    layouts.push({ column, isValue, payload, span, start: physicalColumn });
    if (isValue) {
      if (evidenceMode) {
        sheet.getColumn(physicalColumn).width = 17;
        sheet.getColumn(physicalColumn + 1).width = 48;
        sheet.getColumn(physicalColumn + 2).width = 62;
        sheet.getColumn(physicalColumn + 3).width = 38;
      } else {
        sheet.getColumn(physicalColumn).width = 52;
        sheet.getColumn(physicalColumn + 1).width = 48;
        sheet.getColumn(physicalColumn + 2).width = 38;
      }
    } else {
      sheet.getColumn(physicalColumn).width = Math.max(
        10,
        Math.min(48, Number(payload.width || (canonicalKey(payload.columnType) === "LABEL" ? 40 : 13))),
      );
    }
    physicalColumn += span;
  }
  const lastColumn = Math.max(1, physicalColumn - 1);
  const formulaIndex = new Map(
    formulaRows.map((item) => [
      `${canonicalKey(item.rowCode)}::${canonicalKey(item.columnKey)}`,
      item,
    ]),
  );
  const headerCell = (row: number, column: number, value: string) => {
    const cell = sheet.getCell(row, column);
    cell.value = value;
    cell.font = { bold: true, color: { argb: "FF114C41" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF8F0" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = reportTemplateBorder({ borderPreset: "DEFAULT" });
  };
  const mergeAndStyleHeader = (
    fromRow: number,
    fromColumn: number,
    toRow: number,
    toColumn: number,
    value: string,
  ) => {
    if (fromRow !== toRow || fromColumn !== toColumn) {
      sheet.mergeCells(fromRow, fromColumn, toRow, toColumn);
    }
    headerCell(fromRow, fromColumn, value);
    for (let row = fromRow; row <= toRow; row += 1) {
      for (let column = fromColumn; column <= toColumn; column += 1) {
        sheet.getCell(row, column).border = reportTemplateBorder({ borderPreset: "DEFAULT" });
      }
    }
  };

  sheet.properties.defaultRowHeight = 20;
  sheet.views = [{ state: "frozen", ySplit: 6, showGridLines: false }];
  sheet.pageSetup = {
    fitToPage: true,
    fitToHeight: 0,
    fitToWidth: 1,
    margins: { bottom: 0.35, footer: 0.2, header: 0.2, left: 0.25, right: 0.25, top: 0.35 },
    orientation: "landscape",
    paperSize: 9,
    printTitlesRow: "1:6",
  };
  sheet.mergeCells(1, 1, 1, lastColumn);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, color: { argb: "FF114C41" }, size: 17 };
  titleCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 31;
  sheet.mergeCells(2, 1, 2, lastColumn);
  const subtitle = sheet.getCell(2, 1);
  subtitle.value = [
    evidenceMode ? "BÁO CÁO KÈM CÔNG THỨC VÀ SỐ LIỆU CHỨNG MINH" : "MẪU BÁO CÁO KÈM CÔNG THỨC DỄ ĐỌC",
    versionName ? `Phiên cấu hình: ${versionName}` : "",
    evidenceMode && evidenceOutput
      ? `Kỳ chứng minh: ${cleanText(evidenceOutput.periodFrom)} → ${cleanText(evidenceOutput.periodTo)}`
      : "",
  ].filter(Boolean).join(" · ");
  subtitle.font = { italic: true, color: { argb: "FF60736F" }, size: 10 };
  subtitle.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.mergeCells(3, 1, 3, lastColumn);
  const guide = sheet.getCell(3, 1);
  guide.value = evidenceMode
    ? "Cách đọc: mỗi cột số của báo cáo có Số báo cáo, Công thức dễ hiểu, Số liệu chứng minh và Công thức ngắn gọn. Màu đỏ nhạt nghĩa là còn thiếu nguồn hoặc có chênh lệch cần kiểm tra."
    : "Cách đọc: mỗi cột số của báo cáo có Công thức dễ hiểu, Nhóm/tài khoản áp dụng và Công thức ngắn gọn. Công thức vẫn xuất hiện kể cả khi kỳ hiện tại chưa phát sinh số liệu.";
  guide.font = { color: { argb: "FF315E55" }, size: 10 };
  guide.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FBF8" } };
  guide.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  guide.border = reportTemplateBorder({ borderPreset: "OUTLINE", borderWidth: 2 });
  sheet.getRow(3).height = 34;

  const hideHeader = reportPayload.hideColumnHeader === true;
  const headerStart = 4;
  const headerEnd = hideHeader ? 3 : 6;
  const dataStart = headerEnd + 1;
  if (!hideHeader) {
    for (let index = 0; index < layouts.length; ) {
      const layout = layouts[index];
      const columnLabel = cleanText(layout.payload.columnLabel || layout.column.displayName);
      const group = cleanText(layout.payload.headerGroup);
      if (!layout.isValue) {
        mergeAndStyleHeader(4, layout.start, 6, layout.start, columnLabel);
        index += 1;
        continue;
      }
      if (group) {
        let groupEnd = index;
        let groupLastColumn = layout.start + layout.span - 1;
        while (
          groupEnd + 1 < layouts.length &&
          layouts[groupEnd + 1].isValue &&
          cleanText(layouts[groupEnd + 1].payload.headerGroup) === group
        ) {
          groupEnd += 1;
          groupLastColumn = layouts[groupEnd].start + layouts[groupEnd].span - 1;
        }
        mergeAndStyleHeader(4, layout.start, 4, groupLastColumn, group);
        for (let child = index; child <= groupEnd; child += 1) {
          const childLayout = layouts[child];
          mergeAndStyleHeader(
            5,
            childLayout.start,
            5,
            childLayout.start + childLayout.span - 1,
            cleanText(childLayout.payload.columnLabel || childLayout.column.displayName),
          );
          const subheaders = evidenceMode
            ? ["Số báo cáo", "Công thức dễ hiểu", "Số liệu chứng minh", "Công thức ngắn gọn"]
            : ["Công thức dễ hiểu", "Nhóm/tài khoản áp dụng", "Công thức ngắn gọn"];
          subheaders.forEach((label, offset) => headerCell(6, childLayout.start + offset, label));
        }
        index = groupEnd + 1;
        continue;
      }
      mergeAndStyleHeader(4, layout.start, 5, layout.start + layout.span - 1, columnLabel);
      const subheaders = evidenceMode
        ? ["Số báo cáo", "Công thức dễ hiểu", "Số liệu chứng minh", "Công thức ngắn gọn"]
        : ["Công thức dễ hiểu", "Nhóm/tài khoản áp dụng", "Công thức ngắn gọn"];
      subheaders.forEach((label, offset) => headerCell(6, layout.start + offset, label));
      index += 1;
    }
    [4, 5, 6].forEach((row) => { sheet.getRow(row).height = 27; });
  }

  rows.forEach((row, rowIndex) => {
    const rowPayload = reportTemplatePayload(row.payload);
    const rowType = canonicalKey(rowPayload.rowType || "DATA");
    const rowCode = cleanText(rowPayload.displayCode || rowPayload.rowCode || row.displayCode);
    const rowLabel = cleanText(rowPayload.rowLabel || row.displayName);
    const cellConfigs = reportTemplatePayload(rowPayload.cells);
    const targetRow = dataStart + rowIndex;
    if (rowType === "TITLE") {
      sheet.mergeCells(targetRow, 1, targetRow, lastColumn);
      const cell = sheet.getCell(targetRow, 1);
      cell.value = rowLabel;
      cell.font = { bold: true, color: { argb: "FF114C41" }, size: 14 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = reportTemplateBorder({ borderPreset: "OUTLINE", borderWidth: 2 });
      sheet.getRow(targetRow).height = 31;
      return;
    }
    if (rowType === "SPACER") {
      sheet.getRow(targetRow).height = Math.max(10, Number(rowPayload.rowHeight || 12));
      return;
    }
    let longestText = rowLabel.length;
    layouts.forEach((layout) => {
      const columnKey = cleanText(layout.payload.columnKey);
      const cellPayload = reportTemplatePayload(
        cellConfigs[columnKey] || cellConfigs[canonicalKey(columnKey)],
      );
      const style = reportTemplateStyle(rowPayload, cellPayload, layout.payload, styles);
      const baseFont = {
        bold: Boolean(style.bold || ["SECTION", "SUBTOTAL", "TOTAL"].includes(rowType)),
        color: { argb: reportTemplateColor(style.textColor, "FF183F37") },
        italic: Boolean(style.italic),
        size: style.fontSize ? Math.max(8, Math.min(24, Number(style.fontSize))) : 10,
      };
      const baseFill = reportTemplateColor(style.fillColor, "FFFFFFFF");
      const border = reportTemplateBorder(style);
      if (!layout.isValue) {
        const columnType = canonicalKey(layout.payload.columnType);
        const value = columnType === "ROW_CODE"
          ? rowCode
          : columnType === "NOTE_REFERENCE"
            ? cleanText(rowPayload.noteReference)
            : cleanText(cellPayload.text || rowLabel);
        const cell = sheet.getCell(targetRow, layout.start);
        cell.value = style.uppercase ? value.toLocaleUpperCase("vi") : value;
        cell.font = baseFont;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: baseFill } };
        cell.alignment = {
          horizontal: columnType === "LABEL" ? "left" : "center",
          indent: Math.max(0, Math.min(15, Number(style.indent || 0))),
          vertical: "top",
          wrapText: true,
        };
        cell.border = border;
        return;
      }
      const item = formulaIndex.get(`${canonicalKey(rowCode)}::${canonicalKey(columnKey)}`);
      const formulaText = item?.formula || "Chưa thiết lập công thức";
      const accountText = item ? reportTemplateReadableAccountText(item) : "";
      const shortFormula = item?.shortFormula || "Chưa thiết lập công thức";
      longestText = Math.max(longestText, formulaText.length, accountText.length, shortFormula.length);
      if (evidenceMode) {
        const valueCell = sheet.getCell(targetRow, layout.start);
        valueCell.value = item?.evidenceValue ?? null;
        valueCell.numFmt = cleanText(style.numberFormat || layout.payload.numberFormat) || "#,##0;[Red](#,##0);-";
        valueCell.font = { ...baseFont, bold: true, color: { argb: "FF183F37" } };
        valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FBF8" } };
        valueCell.alignment = { horizontal: "right", vertical: "top", wrapText: true };
        valueCell.border = border;

        const formulaCell = sheet.getCell(targetRow, layout.start + 1);
        formulaCell.value = [formulaText, accountText].filter(Boolean).join("\n\n");
        formulaCell.font = { ...baseFont, color: { argb: "FF183F37" } };
        formulaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBF5" } };
        formulaCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
        formulaCell.border = border;

        const evidenceText = item ? reportTemplateReadableEvidenceText(item) : "Chưa có dữ liệu chứng minh.";
        const evidenceCell = sheet.getCell(targetRow, layout.start + 2);
        evidenceCell.value = evidenceText;
        evidenceCell.font = {
          ...baseFont,
          color: { argb: item?.evidenceComplete ? "FF176B50" : "FFB42318" },
        };
        evidenceCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: item?.evidenceComplete ? "FFEAF7F0" : "FFFFE9E7" },
        };
        evidenceCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
        evidenceCell.border = border;
        longestText = Math.max(longestText, evidenceText.length);

        const shortFormulaCell = sheet.getCell(targetRow, layout.start + 3);
        shortFormulaCell.value = shortFormula;
        shortFormulaCell.font = { ...baseFont, bold: true, color: { argb: shortFormula === "Chưa thiết lập công thức" ? "FFB42318" : "FF114C41" } };
        shortFormulaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: shortFormula === "Chưa thiết lập công thức" ? "FFFFE9E7" : "FFEDF8F0" } };
        shortFormulaCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
        shortFormulaCell.border = border;
      } else {
        const formulaCell = sheet.getCell(targetRow, layout.start);
        formulaCell.value = formulaText;
        formulaCell.font = { ...baseFont, color: { argb: "FF183F37" } };
        formulaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBF5" } };
        formulaCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
        formulaCell.border = border;

        const accountCell = sheet.getCell(targetRow, layout.start + 1);
        accountCell.value = accountText || "Công thức này không dùng trực tiếp nhóm tài khoản.";
        accountCell.font = { ...baseFont, color: { argb: "FF315E55" } };
        accountCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FBF8" } };
        accountCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
        accountCell.border = border;

        const shortFormulaCell = sheet.getCell(targetRow, layout.start + 2);
        shortFormulaCell.value = shortFormula;
        shortFormulaCell.font = { ...baseFont, bold: true, color: { argb: shortFormula === "Chưa thiết lập công thức" ? "FFB42318" : "FF114C41" } };
        shortFormulaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: shortFormula === "Chưa thiết lập công thức" ? "FFFFE9E7" : "FFEDF8F0" } };
        shortFormulaCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
        shortFormulaCell.border = border;
      }
    });
    const configuredHeight = Number(rowPayload.rowHeight || 0);
    const readableHeight = Math.max(32, Math.min(150, 22 + Math.ceil(longestText / 52) * 12));
    sheet.getRow(targetRow).height = configuredHeight
      ? Math.max(readableHeight, Math.min(150, configuredHeight))
      : readableHeight;
  });
  sheet.views = [{
    state: "frozen",
    xSplit: layouts.filter((layout) => !layout.isValue).length,
    ySplit: Math.max(3, dataStart - 1),
    showGridLines: false,
  }];
}

export async function buildConfiguredAccountingReportTemplate(
  input: {
    actorEmail: string;
    evidenceOutput?: JsonObject;
    exportMode?: string;
    records: AccountingRecord[];
    reportKey: string;
    versionName?: string;
  },
) {
  const reportKey = canonicalKey(input.reportKey);
  const evidenceMode = canonicalKey(input.exportMode) === "EVIDENCE";
  const evidenceIndex = reportTemplateEvidenceIndex(input.evidenceOutput);
  const report = input.records.find(
    (record) =>
      record.recordType === "REPORT" && canonicalKey(record.entityKey) === reportKey,
  );
  if (!report) {
    throw new AccountingRpcError("Không tìm thấy mẫu báo cáo cần xuất.", 404);
  }
  const columns = input.records
    .filter(
      (record) =>
        record.recordType === "REPORT_COLUMN" &&
        canonicalKey(record.payload.reportKey) === reportKey,
    )
    .sort(reportTemplateSort);
  if (!columns.length) {
    throw new AccountingRpcError("Mẫu báo cáo chưa có cột để xuất.");
  }
  const rows = input.records
    .filter(
      (record) =>
        record.recordType === "REPORT_ROW" &&
        canonicalKey(record.payload.reportKey) === reportKey,
    )
    .sort(reportTemplateSort);
  const rules = new Map(
    input.records
      .filter((record) => record.recordType === "RULE")
      .map((record) => [canonicalKey(record.entityKey), reportTemplatePayload(record.payload)]),
  );
  const styles = new Map(
    input.records
      .filter((record) => record.recordType === "STYLE")
      .map((record) => [canonicalKey(record.entityKey), reportTemplatePayload(record.payload)]),
  );
  const accountSets = new Map(
    input.records
      .filter((record) => record.recordType === "ACCOUNT_SET")
      .map((record) => [canonicalKey(record.entityKey), record.displayName]),
  );
  const accountMembers = new Map<string, ReportTemplateAccountMember[]>();
  for (const record of input.records.filter(
    (item) => item.recordType === "ACCOUNT_SET_MEMBER",
  )) {
    const payload = reportTemplatePayload(record.payload);
    const setKey = canonicalKey(payload.accountSetKey || payload.setKey || record.parentKey);
    if (!setKey) continue;
    const members = accountMembers.get(setKey) || [];
    members.push({
      companyKey: cleanText(payload.companyKey || record.companyKey),
      matchType: cleanText(payload.matchType || "EXACT"),
      matchValue: cleanText(payload.matchValue || payload.accountCode),
      role: cleanText(payload.role || "INCLUDE"),
    });
    accountMembers.set(setKey, members);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.actorEmail;
  workbook.created = new Date();
  workbook.modified = new Date();
  const readableSheet = workbook.addWorksheet(
    evidenceMode ? "Báo cáo & chứng minh" : "Báo cáo & công thức",
  );
  const sheet = workbook.addWorksheet("Khuôn kỹ thuật", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  sheet.state = "hidden";
  sheet.properties.defaultRowHeight = 18;
  sheet.views = [{ showGridLines: false }];
  columns.forEach((column, index) => {
    const payload = reportTemplatePayload(column.payload);
    sheet.getColumn(index + 1).width = Math.max(
      10,
      Math.min(65, Number(payload.width || (canonicalKey(payload.columnType) === "LABEL" ? 44 : 16))),
    );
  });

  const reportPayload = reportTemplatePayload(report.payload);
  const reportName = cleanText(reportPayload.reportName || report.displayName);
  const displayTitle = cleanText(reportPayload.displayTitle || reportName);
  sheet.mergeCells(1, 1, 1, columns.length);
  const title = sheet.getCell(1, 1);
  title.value = displayTitle || reportName;
  title.font = { bold: true, color: { argb: "FF114C41" }, size: 16 };
  title.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, columns.length);
  const subtitle = sheet.getCell(2, 1);
  subtitle.value = `${evidenceMode ? "CÔNG THỨC KÈM SỐ LIỆU CHỨNG MINH" : "CÔNG THỨC MẪU"}${input.versionName ? ` · ${input.versionName}` : ""}${evidenceMode && input.evidenceOutput ? ` · ${cleanText(input.evidenceOutput.periodFrom)} → ${cleanText(input.evidenceOutput.periodTo)}` : ""}`;
  subtitle.font = { italic: true, color: { argb: "FF60736F" }, size: 10 };
  subtitle.alignment = { horizontal: "center", vertical: "middle" };

  const headerRows = reportPayload.hideColumnHeader === true
    ? []
    : reportTemplateHeaderRows(columns);
  const headerStart = 4;
  const occupiedHeader = new Set<string>();
  headerRows.forEach((definition, headerOffset) => {
    let cursor = 0;
    definition.forEach((headerCell) => {
      while (occupiedHeader.has(`${headerOffset}:${cursor}`)) cursor += 1;
      const span = Math.min(headerCell.columnSpan, columns.length - cursor);
      const rowSpan = Math.min(headerCell.rowSpan, headerRows.length - headerOffset);
      if (span > 1 || rowSpan > 1) {
        sheet.mergeCells(
          headerStart + headerOffset,
          cursor + 1,
          headerStart + headerOffset + rowSpan - 1,
          cursor + span,
        );
      }
      const cell = sheet.getCell(headerStart + headerOffset, cursor + 1);
      cell.value = headerCell.label;
      cell.font = { bold: true, color: { argb: "FF114C41" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF8F0" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = reportTemplateBorder({ borderPreset: "DEFAULT" });
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < span; columnOffset += 1) {
          occupiedHeader.add(`${headerOffset + rowOffset}:${cursor + columnOffset}`);
        }
      }
      cursor += span;
    });
    sheet.getRow(headerStart + headerOffset).height = 28;
  });

  const formulaRows: ConfiguredTemplateFormula[] = [];
  const dataStart = headerStart + headerRows.length;
  const occupiedCells = new Set<string>();
  rows.forEach((row, rowIndex) => {
    const rowPayload = reportTemplatePayload(row.payload);
    const rowType = canonicalKey(rowPayload.rowType || "DATA");
    const cellConfigs = reportTemplatePayload(rowPayload.cells);
    const excelRow = dataStart + rowIndex;
    const rowHeight = Number(rowPayload.rowHeight || 0);
    if (rowHeight) sheet.getRow(excelRow).height = Math.max(18, Math.min(120, rowHeight));
    columns.forEach((column, columnIndex) => {
      if (occupiedCells.has(`${rowIndex}:${columnIndex}`)) return;
      const columnPayload = reportTemplatePayload(column.payload);
      const columnKey = cleanText(columnPayload.columnKey);
      const cellPayload = reportTemplatePayload(
        cellConfigs[columnKey] || cellConfigs[canonicalKey(columnKey)],
      );
      const style = reportTemplateStyle(rowPayload, cellPayload, columnPayload, styles);
      const rule = reportTemplateCellRule(rowPayload, cellPayload, rules);
      const columnType = canonicalKey(columnPayload.columnType || "CURRENT_PERIOD");
      const contentKind = canonicalKey(
        cellPayload.contentKind ||
          (["TITLE", "SECTION", "LABEL", "NOTE"].includes(rowType)
            ? "TEXT"
            : rowType === "SPACER"
              ? "SPACER"
              : ""),
      );
      const isLabel =
        ["LABEL", "ROW_CODE", "NOTE_REFERENCE"].includes(columnType) ||
        ["TEXT", "TITLE", "SPACER"].includes(contentKind) ||
        ["TITLE", "SPACER"].includes(rowType);
      const mergeColumnKey =
        rowType === "TITLE"
          ? cleanText(columns[0]?.payload.columnKey)
          : cleanText(rowPayload.mergeColumnKey);
      const isMergeOrigin = columnKey === mergeColumnKey;
      const columnSpan = Math.min(
        columns.length - columnIndex,
        Math.max(
          1,
          Number(
            cellPayload.mergeColumnSpan ||
              (rowType === "TITLE"
                ? columns.length
                : isMergeOrigin
                  ? rowPayload.mergeColumnSpan || 1
                  : 1),
          ),
        ),
      );
      const rowSpan = Math.min(
        rows.length - rowIndex,
        Math.max(
          1,
          Number(
            cellPayload.mergeRowSpan ||
              (isMergeOrigin ? rowPayload.mergeRowSpan || 1 : 1),
          ),
        ),
      );
      if (columnSpan > 1 || rowSpan > 1) {
        sheet.mergeCells(excelRow, columnIndex + 1, excelRow + rowSpan - 1, columnIndex + columnSpan);
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
            if (rowOffset || columnOffset) occupiedCells.add(`${rowIndex + rowOffset}:${columnIndex + columnOffset}`);
          }
        }
      }
      const textValue = cleanText(cellPayload.text || rowPayload.rowLabel || row.displayName);
      const formulaRequired = cellPayload.formulaRequired === true;
      const formula = reportTemplateFormulaText(
        rule,
        accountSets,
        accountMembers,
        columnPayload,
      );
      let value = "";
      if (columnType === "ROW_CODE") {
        value = cleanText(rowPayload.displayCode || rowPayload.rowCode || row.displayCode);
      } else if (columnType === "NOTE_REFERENCE") {
        value = cleanText(rowPayload.noteReference);
      } else if (isLabel) {
        value = rowType === "SPACER" ? "" : textValue;
      } else if (formulaRequired) {
        value = "Chưa thiết lập công thức";
      } else {
        value = formula || "Chưa thiết lập công thức";
      }
      if (style.uppercase && typeof value === "string") value = value.toUpperCase();
      const cell = sheet.getCell(excelRow, columnIndex + 1);
      cell.value = value;
      cell.font = {
        bold: Boolean(style.bold || ["TITLE", "SECTION", "SUBTOTAL", "TOTAL"].includes(rowType)),
        color: { argb: formulaRequired ? "FFB85B22" : reportTemplateColor(style.textColor, "FF183F37") },
        italic: Boolean(style.italic),
        size: style.fontSize ? Math.max(8, Math.min(32, Number(style.fontSize))) : undefined,
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: reportTemplateColor(style.fillColor, "FFFFFFFF") } };
      const align = canonicalKey(style.align || "LEFT").toLowerCase();
      cell.alignment = {
        horizontal: ["left", "center", "right"].includes(align) ? align as "left" | "center" | "right" : "left",
        indent: Math.max(0, Math.min(15, Number(style.indent || 0))),
        vertical: "middle",
        wrapText: true,
      };
      cell.border = reportTemplateBorder(style);
      if (!isLabel && !formulaRequired) {
        cell.numFmt = cleanText(style.numberFormat || columnPayload.numberFormat) || "#,##0;[Red](#,##0);-";
      }
      if (!isLabel) {
        const details = formulaRequired
          ? {
              accountMembers: "",
              accountSets: "",
              conditions: "",
              counterAccountMembers: "",
              counterAccountSets: "",
              evidenceComplete: false,
              evidenceDifference: 0,
              evidenceExplanation: "",
              evidenceStatus: "CHƯA THIẾT LẬP CÔNG THỨC",
              evidenceValue: null,
              evidenceWarning: "Ô này chưa có công thức để truy nguồn.",
              formula: "Chưa thiết lập công thức",
              shortFormula: "Chưa thiết lập công thức",
              numericExpression: "",
              periodBasis: "",
              side: "",
              sourceKeys: "",
            }
          : reportTemplateFormulaDetails(
              rule,
              accountSets,
              accountMembers,
              columnPayload,
            );
        const evidence = evidenceMode
          ? reportTemplateEvidenceDetails(
              evidenceIndex.get(
                `${canonicalKey(rowPayload.displayCode || rowPayload.rowCode || row.displayCode)}::${canonicalKey(columnKey)}`,
              ),
            )
          : {
              components: [],
              evidenceComplete: false,
              evidenceDifference: 0,
              evidenceExplanation: "",
              evidenceStatus: "",
              evidenceValue: null,
              evidenceWarning: "",
              numericExpression: "",
            };
        formulaRows.push({
          ...details,
          columnKey,
          columnLabel: cleanText(columnPayload.columnLabel || column.displayName),
          evidenceComponents: evidence.components,
          evidenceComplete: evidence.evidenceComplete,
          evidenceDifference: evidence.evidenceDifference,
          evidenceExplanation: evidence.evidenceExplanation,
          evidenceStatus: evidence.evidenceStatus,
          evidenceValue: evidence.evidenceValue,
          evidenceWarning: evidence.evidenceWarning,
          numericExpression: evidence.numericExpression,
          rowCode: cleanText(rowPayload.displayCode || rowPayload.rowCode || row.displayCode),
          rowLabel: cleanText(rowPayload.rowLabel || row.displayName),
        });
      }
    });
  });
  sheet.views = [{ state: "frozen", ySplit: Math.max(2, dataStart - 1), showGridLines: false }];

  buildReadableConfiguredTemplateSheet({
    columns,
    evidenceMode,
    evidenceOutput: input.evidenceOutput,
    formulaRows,
    reportPayload,
    rows,
    sheet: readableSheet,
    styles,
    title: displayTitle || reportName,
    versionName: input.versionName,
  });

  const formulaSheet = workbook.addWorksheet("Danh mục công thức", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  formulaSheet.state = "hidden";
  formulaSheet.views = [{ showGridLines: false }];
  const formulaLastColumn = evidenceMode ? "Q" : "M";
  formulaSheet.mergeCells(`A1:${formulaLastColumn}1`);
  formulaSheet.getCell("A1").value = evidenceMode
    ? "CÔNG THỨC VÀ SỐ LIỆU CHỨNG MINH"
    : "CÔNG THỨC MẪU ĐƯỢC THIẾT LẬP";
  formulaSheet.getCell("A1").font = { bold: true, color: { argb: "FF114C41" }, size: 15 };
  formulaSheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  formulaSheet.mergeCells(`A2:${formulaLastColumn}2`);
  formulaSheet.getCell("A2").value = `Mẫu: ${reportName}${input.versionName ? ` · Phiên cấu hình: ${input.versionName}` : ""}${evidenceMode && input.evidenceOutput ? ` · Kỳ chứng minh: ${cleanText(input.evidenceOutput.periodFrom)} → ${cleanText(input.evidenceOutput.periodTo)}` : ""}`;
  formulaSheet.getCell("A2").font = { italic: true, color: { argb: "FF60736F" } };
  formulaSheet.getCell("A2").alignment = { horizontal: "center" };
  const formulaHeaders = [
    "Mã dòng",
    "Nội dung dòng",
    "Cột",
    "Công thức đã thiết lập",
    "Nhóm tài khoản chính",
    "Tài khoản trong nhóm chính",
    "Nhóm tài khoản đối ứng",
    "Tài khoản trong nhóm đối ứng",
    "Nguồn dữ liệu",
    "Kỳ lấy số",
    "Bên lấy số",
    "Điều kiện / tham chiếu",
  ];
  if (evidenceMode) {
    formulaHeaders.push(
      "Phép tính bằng số",
      "Đường đi của từng số",
      "Trạng thái kiểm tra",
      "Chênh lệch / việc cần xử lý",
    );
  }
  formulaHeaders.push("Công thức ngắn gọn");
  formulaHeaders.forEach((label, index) => {
    const cell = formulaSheet.getCell(4, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: "FF114C41" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF8F0" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = reportTemplateBorder({ borderPreset: "DEFAULT" });
  });
  if (!formulaRows.length) {
    formulaSheet.mergeCells(`A5:${formulaLastColumn}5`);
    formulaSheet.getCell("A5").value = "Mẫu này chưa có ô số liệu hoặc công thức để liệt kê.";
    formulaSheet.getCell("A5").alignment = { horizontal: "center" };
  }
  formulaRows.forEach((item, rowIndex) => {
    const values = [
      item.rowCode,
      item.rowLabel,
      item.columnLabel,
      item.formula,
      item.accountSets,
      item.accountMembers,
      item.counterAccountSets,
      item.counterAccountMembers,
      item.sourceKeys,
      item.periodBasis,
      item.side,
      item.conditions,
    ];
    if (evidenceMode) {
      values.push(
        item.numericExpression,
        item.evidenceExplanation,
        item.evidenceStatus,
        item.evidenceComplete
          ? item.evidenceWarning || "Đã khớp hoàn toàn với kết quả báo cáo."
          : `${item.evidenceWarning}${item.evidenceDifference ? ` Chênh lệch chưa giải thích: ${item.evidenceDifference < 0 ? "−" : ""}${reportTemplateEvidenceNumber(item.evidenceDifference)}.` : ""}`,
      );
    }
    values.push(item.shortFormula);
    values.forEach((value, columnIndex) => {
      const cell = formulaSheet.getCell(rowIndex + 5, columnIndex + 1);
      cell.value = value === "" ? null : value;
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = reportTemplateBorder({ borderPreset: "DEFAULT" });
      if (columnIndex === 3 && value === "Chưa thiết lập công thức") {
        cell.font = { bold: true, color: { argb: "FFB85B22" } };
      }
      if (evidenceMode && columnIndex >= 14 && columnIndex <= 15) {
        cell.font = {
          bold: true,
          color: { argb: item.evidenceComplete ? "FF176B50" : "FFB42318" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: item.evidenceComplete ? "FFEAF7F0" : "FFFFE9E7" },
        };
      }
      if (columnIndex === values.length - 1) {
        cell.font = { bold: true, color: { argb: item.shortFormula === "Chưa thiết lập công thức" ? "FFB42318" : "FF114C41" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: item.shortFormula === "Chưa thiết lập công thức" ? "FFFFE9E7" : "FFEDF8F0" } };
      }
    });
    formulaSheet.getRow(rowIndex + 5).height = evidenceMode ? 72 : 54;
  });
  const formulaWidths = evidenceMode
    ? [14, 42, 20, 78, 30, 58, 30, 58, 24, 20, 20, 35, 58, 96, 24, 58, 38]
    : [14, 42, 20, 78, 30, 58, 30, 58, 24, 20, 20, 35, 38];
  formulaWidths.forEach((width, index) => {
    formulaSheet.getColumn(index + 1).width = width;
  });
  formulaSheet.getRow(1).height = 28;
  formulaSheet.getRow(4).height = 28;

  if (evidenceMode) {
    const detailSheet = workbook.addWorksheet("Nguồn số liệu đã dùng", {
      views: [{ state: "frozen", ySplit: 4 }],
    });
    detailSheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
    detailSheet.mergeCells("A1:Q1");
    detailSheet.getCell("A1").value = "Nguồn số liệu và nhánh công thức đã dùng";
    detailSheet.getCell("A1").font = { bold: true, color: { argb: "FF114C41" }, size: 15 };
    detailSheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    detailSheet.mergeCells("A2:Q2");
    detailSheet.getCell("A2").value = "Đọc từ trái sang phải để biết một số trên báo cáo đi qua dòng nào, lấy từ tài khoản nào và thuộc nguồn dữ liệu nào. Nhánh không phát sinh vẫn được giữ với số tiền bằng 0; dòng đỏ là phần chưa truy đủ nguồn và hệ thống không tự tạo số bù để làm khớp.";
    detailSheet.getCell("A2").font = { italic: true, color: { argb: "FF60736F" } };
    detailSheet.getCell("A2").alignment = { horizontal: "center", wrapText: true };
    const detailHeaders = [
      "Mã dòng",
      "Nội dung dòng",
      "Cột báo cáo",
      "Đường truy vết đầy đủ",
      "Phép tính",
      "Số tiền",
      "Tài khoản",
      "Tên tài khoản",
      "TK đối ứng",
      "Tên TK đối ứng",
      "Số bút toán",
      "Công ty",
      "Khối dữ liệu",
      "Nguồn dữ liệu",
      "Kỳ dữ liệu",
      "Trạng thái",
      "Mã kỹ thuật (ẩn)",
    ];
    detailHeaders.forEach((label, index) => {
      const cell = detailSheet.getCell(4, index + 1);
      cell.value = label;
      cell.font = { bold: true, color: { argb: "FF114C41" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF8F0" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = reportTemplateBorder({ borderPreset: "DEFAULT" });
    });
    let detailRow = 5;
    for (const formulaRow of formulaRows) {
      formulaRow.evidenceComponents.forEach((component) => {
        const periodLabel = [component.periodFrom, component.periodTo]
          .filter(Boolean)
          .join(" → ");
        const values: Array<string | number> = [
          formulaRow.rowCode,
          formulaRow.rowLabel,
          formulaRow.columnLabel,
          component.tracePath,
          reportTemplateEvidenceIsNegative(component) ? "Trừ" : "Cộng",
          component.signedValue,
          component.accountNumber,
          component.accountName,
          component.counterAccountNumber,
          component.counterAccountName,
          component.entryCount || "",
          component.companyKey,
          component.dataSpaceName,
          component.sourceName,
          periodLabel,
          formulaRow.evidenceStatus,
          component.sourceKey,
        ];
        values.forEach((value, columnIndex) => {
          const cell = detailSheet.getCell(detailRow, columnIndex + 1);
          cell.value = value === "" ? null : value;
          cell.alignment = { vertical: "top", wrapText: true };
          cell.border = reportTemplateBorder({ borderPreset: "DEFAULT" });
          if (columnIndex === 5) cell.numFmt = "#,##0.####;[Red](#,##0.####);-";
          if (columnIndex === 15) {
            cell.font = { bold: true, color: { argb: formulaRow.evidenceComplete ? "FF176B50" : "FF9A5B13" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: formulaRow.evidenceComplete ? "FFEAF7F0" : "FFFFF3D6" } };
          }
        });
        detailSheet.getRow(detailRow).height = Math.max(
          24,
          Math.min(90, 18 * Math.ceil(Math.max(1, component.tracePath.length) / 72)),
        );
        detailRow += 1;
      });
      if (!formulaRow.evidenceComplete) {
        const warningValues: Array<string | number> = [
          formulaRow.rowCode,
          formulaRow.rowLabel,
          formulaRow.columnLabel,
          `CẢNH BÁO: ${formulaRow.evidenceWarning || "Công thức chưa truy đủ dữ liệu nguồn."}`,
          "Không tự bù",
          formulaRow.evidenceDifference,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "Cấu hình mẫu báo cáo",
          input.evidenceOutput ? `${cleanText(input.evidenceOutput.periodFrom)} → ${cleanText(input.evidenceOutput.periodTo)}` : "",
          "CHƯA ĐỦ NGUỒN",
          "",
        ];
        warningValues.forEach((value, columnIndex) => {
          const cell = detailSheet.getCell(detailRow, columnIndex + 1);
          cell.value = value === "" ? null : value;
          cell.alignment = { vertical: "top", wrapText: true };
          cell.border = reportTemplateBorder({ borderPreset: "DEFAULT" });
          cell.font = { bold: true, color: { argb: "FFB42318" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE9E7" } };
          if (columnIndex === 5) cell.numFmt = "#,##0.####;[Red](#,##0.####);-";
        });
        detailSheet.getRow(detailRow).height = 48;
        detailRow += 1;
      }
    }
    if (detailRow === 5) {
      detailSheet.mergeCells("A5:Q5");
      detailSheet.getCell("A5").value = "Phiên dữ liệu không tạo ra thành phần số liệu cho các ô của mẫu này.";
      detailSheet.getCell("A5").alignment = { horizontal: "center" };
    }
    [13, 38, 20, 100, 14, 22, 16, 30, 16, 30, 14, 16, 30, 32, 26, 24, 22].forEach((width, index) => {
      detailSheet.getColumn(index + 1).width = width;
    });
    detailSheet.getColumn(17).hidden = true;
    detailSheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: detailHeaders.length } };
    detailSheet.getRow(1).height = 28;
    detailSheet.getRow(4).height = 30;
  }

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `${evidenceMode ? "Cong_thuc" : "Mau"}_${canonicalKey(reportName).slice(0, 80) || "BAO_CAO"}_${evidenceMode ? "kem_so_lieu_chung_minh" : "kem_cong_thuc"}.xlsx`;
  return {
    base64: bytes.toString("base64"),
    byteSize: bytes.length,
    fileName,
    formulaCellCount: formulaRows.length,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ok: true,
    reportName,
  };
}

export async function exportAccountingConfiguredReportTemplate(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const reportKey = canonicalKey(payload.reportKey);
  if (!versionId || !reportKey) {
    throw new AccountingRpcError("Hãy chọn mẫu báo cáo cần xuất.");
  }
  const data = await getAccountingConfigData({ versionId }, actorEmail);
  return buildConfiguredAccountingReportTemplate({
    actorEmail,
    evidenceOutput: isJsonObject(payload.evidenceOutput)
      ? payload.evidenceOutput
      : undefined,
    exportMode: cleanText(payload.exportMode),
    records: data.records,
    reportKey,
    versionName: data.selectedVersion?.displayName,
  });
}

export async function previewAccountingAccountsImport(
  payload: JsonObject,
  actorEmail: string,
) {
  void actorEmail;
  const versionId = cleanText(payload.versionId);
  if (!versionId) {
    throw new AccountingRpcError(
      "Vui lòng chọn phiên bản nháp trước khi phân tích tệp.",
    );
  }
  const input = payload.file || payload.filePayload || payload.workbook;
  if (!input) {
    throw new AccountingRpcError("Vui lòng chọn tệp Excel danh mục tài khoản.");
  }
  const { workbook, fileName } = await readWorkbook(input);
  await assertAccountingSchema();
  const client = await getAccountingPool().connect();
  try {
    await assertDraftVersion(client, versionId, false);
    const [currentRecords, companyKeys] = await Promise.all([
      selectVersionRecords(client, versionId),
      portalCompanyKeys(versionId, client),
    ]);
    const read = readAccounts(workbook, {
      companyKey: canonicalKey(payload.companyKey),
      validFrom: cleanText(payload.validFrom),
    });
    const items = expandAccounts(read.items, companyKeys);
    if (items.length > read.items.length) {
      read.warnings.push(
        `Danh mục đã được tự nhân cho ${companyKeys.length} công ty trong Module Cấu hình.`,
      );
    }
    const counts = accountCounts(items, currentRecords);
    return {
      counts,
      errors: read.errors.slice(0, 100),
      fileName,
      headerRowNumber: read.headerRowNumber,
      ok: read.errors.length === 0 && items.length > 0,
      records: items,
      sheetName: read.sheetName,
      versionId,
      warnings: read.warnings.slice(0, 100),
    };
  } finally {
    client.release();
  }
}

export async function applyAccountingAccountsImport(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const values = Array.isArray(payload.records) ? payload.records : [];
  if (!versionId || !values.length) {
    throw new AccountingRpcError("Không có dữ liệu xem trước để áp dụng.");
  }
  if (values.length > MAX_IMPORT_RECORDS) {
    throw new AccountingRpcError(
      `Một lần chỉ được nạp tối đa ${MAX_IMPORT_RECORDS.toLocaleString("vi-VN")} tài khoản cấu hình.`,
    );
  }
  const counts = await withAccountingTransaction(async (client) => {
    await assertDraftVersion(client, versionId);
    const currentRecords = await selectVersionRecords(client, versionId, true);
    const existing = new Map(
      currentRecords
        .filter((record) => record.recordType === "ACCOUNT")
        .map((record) => [
          `${record.companyKey}|${record.displayCode}|${record.validFrom || "OPEN"}`,
          record,
        ]),
    );
    const seen = new Set<string>();
    const result = { createdCount: 0, unchangedCount: 0, updatedCount: 0 };
    for (const value of values) {
      if (!isJsonObject(value)) {
        throw new AccountingRpcError("Một dòng tài khoản xem trước không hợp lệ.");
      }
      const normalized = normalizeRecordPayload("ACCOUNT", value);
      const key = `${canonicalKey(normalized.companyKey)}|${accountCode(normalized.accountCode)}|${cleanText(normalized.validFrom) || "OPEN"}`;
      if (seen.has(key)) {
        throw new AccountingRpcError(`Danh sách áp dụng bị trùng tài khoản ${key}.`);
      }
      seen.add(key);
      const current = existing.get(key) || null;
      if (
        current &&
        comparableAccount(current.payload) === comparableAccount(normalized)
      ) {
        result.unchangedCount += 1;
        continue;
      }
      const saved = await upsertRecord(client, {
        action: current ? "IMPORT_ACCOUNT_UPDATE" : "IMPORT_ACCOUNT_CREATE",
        actorEmail,
        existing: current,
        note: "Nạp danh mục tài khoản từ Excel.",
        payload: normalized,
        recordType: "ACCOUNT",
        versionId,
      });
      existing.set(key, saved);
      if (current) result.updatedCount += 1;
      else result.createdCount += 1;
    }
    await touchVersion(client, versionId, actorEmail);
    return result;
  });
  return {
    counts,
    data: await getAccountingConfigData({ versionId }, actorEmail),
    message: "Đã áp dụng danh mục tài khoản vào phiên bản nháp.",
    ok: true,
  };
}

export async function previewAccountingReportTemplateImport(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const input = payload.file || payload.filePayload || payload.workbook;
  if (!versionId || !input) {
    throw new AccountingRpcError(
      "Vui lòng chọn phiên bản nháp và tệp khuôn báo cáo.",
    );
  }
  const { workbook, fileName } = await readWorkbook(input);
  await assertAccountingSchema();
  const client = await getAccountingPool().connect();
  try {
    await assertDraftVersion(client, versionId, false);
    const current = await selectVersionRecords(client, versionId);
    const layout = readLayoutWorkbook(workbook, fileName);
    const imported = prepareLayoutKeys(
      layout.records,
      current,
      payload.importMode || "CREATE_NEW",
    );
    const prepared = prepareImport(current, imported, versionId, actorEmail);
    const validationErrors = prepared.validation.issues.filter(
      (issue) => issue.severity === "ERROR",
    );
    const validationWarnings = prepared.validation.issues.filter(
      (issue) => issue.severity === "WARNING",
    );
    const reportItems = imported.filter(
      (item) => item.recordType === "REPORT",
    );
    const reports = layout.reports.map((summary, index) => ({
      ...summary,
      displayTitle:
        cleanText(reportItems[index]?.payload.displayTitle) ||
        summary.displayTitle,
      reportKey:
        cleanText(reportItems[index]?.payload.reportKey) || summary.reportKey,
      reportName:
        cleanText(reportItems[index]?.payload.reportName) || summary.reportName,
    }));
    const errors = [
      ...layout.errors,
      ...prepared.errors,
      ...validationErrors.map(
        (issue) => `${issue.entityKey}: ${issue.message}`,
      ),
    ].slice(0, 150);
    const warnings = [
      ...layout.warnings,
      ...validationWarnings.map(
        (issue) => `${issue.entityKey}: ${issue.message}`,
      ),
    ].slice(0, 150);
    return {
      counts: prepared.counts,
      errors,
      fileName,
      importMode: canonicalKey(payload.importMode || "CREATE_NEW"),
      ok:
        errors.length === 0 &&
        prepared.counts.totalCount > 0,
      records: prepared.items.map((item) => ({
        payload: item.payload,
        recordType: item.recordType,
        sourceRow: item.sourceRow,
        sourceSheet: item.sourceSheet,
      })),
      reports,
      source: {
        sourceId: "",
        sourceName: fileName,
        sourceType: "EXCEL_UPLOAD",
        sourceUrl: "",
      },
      stats: layout.stats,
      templateVersion: TEMPLATE_VERSION,
      versionId,
      warnings,
    };
  } finally {
    client.release();
  }
}

export async function applyAccountingReportTemplateImport(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const rawRecords = Array.isArray(payload.records) ? payload.records : [];
  if (!versionId || !rawRecords.length) {
    throw new AccountingRpcError(
      "Không có dữ liệu mẫu đã xem trước để áp dụng.",
    );
  }
  if (rawRecords.length > MAX_IMPORT_RECORDS) {
    throw new AccountingRpcError(
      `Một lần chỉ được nạp tối đa ${MAX_IMPORT_RECORDS.toLocaleString("vi-VN")} bản ghi cấu hình.`,
    );
  }
  const imported: ImportedRecord[] = rawRecords.map((value, index) => {
    if (!isJsonObject(value) || !isJsonObject(value.payload)) {
      throw new AccountingRpcError(
        `Bản ghi xem trước thứ ${index + 1} không hợp lệ.`,
      );
    }
    const recordType = canonicalKey(value.recordType) as AccountingRecordType;
    if (!["REPORT", "REPORT_COLUMN", "REPORT_ROW"].includes(recordType)) {
      throw new AccountingRpcError(
        `Nạp khuôn không được ghi loại cấu hình ${recordType || "(trống)"}.`,
      );
    }
    return {
      payload: value.payload,
      recordType,
      sourceRow: Number(value.sourceRow || index + 1),
      sourceSheet: cleanText(value.sourceSheet) || "KHUON_BAO_CAO",
    };
  });
  const counts = await withAccountingTransaction(async (client) => {
    await assertDraftVersion(client, versionId);
    const current = await selectVersionRecords(client, versionId, true);
    const prepared = prepareImport(current, imported, versionId, actorEmail);
    const blocking = [
      ...prepared.errors,
      ...prepared.validation.issues
        .filter((issue) => issue.severity === "ERROR")
        .map((issue) => `${issue.entityKey}: ${issue.message}`),
    ];
    if (blocking.length) {
      throw new AccountingRpcError(
        `Cấu hình đã thay đổi hoặc còn lỗi:\n${blocking.slice(0, 20).join("\n")}`,
        409,
      );
    }
    for (const item of prepared.items) {
      if (item.unchanged) continue;
      await upsertRecord(client, {
        action: item.existing
          ? "IMPORT_CONFIG_UPDATE"
          : "IMPORT_CONFIG_CREATE",
        actorEmail,
        existing: item.existing,
        note: `${item.sourceSheet}!${item.sourceRow}`,
        payload: item.payload,
        recordId: item.nextRecord.recordId,
        recordType: item.recordType,
        versionId,
      });
    }
    await touchVersion(client, versionId, actorEmail);
    return prepared.counts;
  });
  return {
    counts,
    data: await getAccountingConfigData({ versionId }, actorEmail),
    message:
      "Đã nạp khuôn báo cáo vào phiên bản nháp. Công thức vẫn chờ thiết lập trên ứng dụng.",
    ok: true,
  };
}

export async function previewAccountingDisclosureTemplateImport(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const input = payload.file || payload.filePayload || payload.workbook;
  if (!versionId || !input) {
    throw new AccountingRpcError(
      "Vui lòng chọn phiên bản nháp và tệp Excel mẫu thuyết minh B09.",
    );
  }
  const { workbook, fileName } = await readWorkbook(input);
  await assertAccountingSchema();
  const client = await getAccountingPool().connect();
  try {
    await assertDraftVersion(client, versionId, false);
    const current = await selectVersionRecords(client, versionId);
    const parsed = parseAccountingDisclosureWorkbook(workbook, fileName);
    const semantic = buildAccountingDisclosureSemanticRecords(
      parsed.records,
      current,
    );
    const disclosureRecords = [...parsed.records, ...semantic.records];
    const formulaReport = buildAccountingDisclosureReportRecords(
      disclosureRecords,
      current,
    );
    const prepared = prepareImport(current, [
      ...disclosureRecords,
      ...formulaReport.records,
    ], versionId, actorEmail);
    const disclosureIssues = prepared.validation.issues.filter((issue) =>
      [
        "DISCLOSURE_TEMPLATE",
        "DISCLOSURE_SECTION",
        "DISCLOSURE_ITEM",
        "DISCLOSURE_LINK",
        "REPORT",
        "REPORT_COLUMN",
        "REPORT_ROW",
      ].includes(issue.recordType),
    );
    const validationErrors = disclosureIssues.filter(
      (issue) => issue.severity === "ERROR",
    );
    const validationWarnings = disclosureIssues.filter(
      (issue) => issue.severity === "WARNING",
    );
    const errors = [
      ...prepared.errors,
      ...validationErrors.map(
        (issue) => `${issue.entityKey}: ${issue.message}`,
      ),
    ].slice(0, 150);
    const warnings = [
      ...parsed.warnings,
      ...semantic.warnings,
      ...validationWarnings.map(
        (issue) => `${issue.entityKey}: ${issue.message}`,
      ),
    ].slice(0, 150);
    return {
      counts: prepared.counts,
      errors,
      fileName,
      ok: errors.length === 0 && prepared.counts.totalCount > 0,
      records: prepared.items.map((item) => ({
        payload: item.payload,
        recordType: item.recordType,
        sourceRow: item.sourceRow,
        sourceSheet: item.sourceSheet,
      })),
      sections: parsed.summaries.map((section) => ({
        ...section,
        semanticItemCount: semantic.records.filter(
          (record) =>
            record.recordType === "DISCLOSURE_ITEM" &&
            cleanText(record.payload.sectionKey) === cleanText(section.sectionKey),
        ).length,
      })),
      stats: { ...parsed.stats, ...semantic.stats, ...formulaReport.stats },
      template: parsed.template,
      versionId,
      warnings,
    };
  } finally {
    client.release();
  }
}

export async function applyAccountingDisclosureTemplateImport(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const rawRecords = Array.isArray(payload.records) ? payload.records : [];
  const sourceWorkbook = payload.sourceWorkbook;
  if (!versionId || !rawRecords.length || !sourceWorkbook) {
    throw new AccountingRpcError(
      "Không có file Excel gốc và mẫu thuyết minh B09 đã xem trước để áp dụng.",
    );
  }
  if (rawRecords.length > 250) {
    throw new AccountingRpcError(
      "Mẫu thuyết minh có quá nhiều bản ghi cấu trúc/nghiệp vụ; hãy xem trước lại tệp gốc.",
    );
  }
  const source = await workbookBuffer(sourceWorkbook);
  const { storeAccountingTemplateSource } = await import(
    "@/lib/accounting/export-storage"
  );
  const storedSource = await storeAccountingTemplateSource(source.buffer, {
    actorEmail,
    fileName: source.fileName,
  });
  const imported: ImportedRecord[] = rawRecords.map((value, index) => {
    if (!isJsonObject(value) || !isJsonObject(value.payload)) {
      throw new AccountingRpcError(
        `Phần xem trước thứ ${index + 1} không hợp lệ.`,
      );
    }
    const recordType = canonicalKey(value.recordType) as AccountingRecordType;
    if (
      ![
        "DISCLOSURE_TEMPLATE",
        "DISCLOSURE_SECTION",
        "DISCLOSURE_ITEM",
        "DISCLOSURE_LINK",
        "REPORT",
        "REPORT_COLUMN",
        "REPORT_ROW",
      ].includes(recordType)
    ) {
      throw new AccountingRpcError(
        `Nạp mẫu thuyết minh không được ghi loại cấu hình ${recordType || "(trống)"}.`,
      );
    }
    return {
      payload:
        recordType === "DISCLOSURE_TEMPLATE"
          ? {
              ...value.payload,
              sourceFileName: source.fileName,
              templateSourceFileId: storedSource.fileId,
              templateSourceSha256: storedSource.sha256,
              templateSourceSizeBytes: storedSource.sizeBytes,
            }
          : value.payload,
      recordType,
      sourceRow: Number(value.sourceRow || index + 1),
      sourceSheet: cleanText(value.sourceSheet) || "B09-DN",
    };
  });
  if (
    imported.filter((item) => item.recordType === "DISCLOSURE_TEMPLATE").length !==
    1
  ) {
    throw new AccountingRpcError(
      "Bản xem trước phải có đúng một bản ghi gốc của mẫu thuyết minh.",
    );
  }

  const counts = await withAccountingTransaction(async (client) => {
    await assertDraftVersion(client, versionId);
    const current = await selectVersionRecords(client, versionId, true);
    const prepared = prepareImport(current, imported, versionId, actorEmail);
    const blocking = [
      ...prepared.errors,
      ...prepared.validation.issues
        .filter(
          (issue) =>
            issue.severity === "ERROR" &&
            [
              "DISCLOSURE_TEMPLATE",
              "DISCLOSURE_SECTION",
              "DISCLOSURE_ITEM",
              "DISCLOSURE_LINK",
              "REPORT",
              "REPORT_COLUMN",
              "REPORT_ROW",
            ].includes(issue.recordType),
        )
        .map((issue) => `${issue.entityKey}: ${issue.message}`),
    ];
    if (blocking.length) {
      throw new AccountingRpcError(
        `Mẫu thuyết minh đã thay đổi hoặc còn lỗi:\n${blocking.slice(0, 20).join("\n")}`,
        409,
      );
    }
    for (const item of prepared.items) {
      if (item.unchanged) continue;
      await upsertRecord(client, {
        action: item.existing
          ? "IMPORT_DISCLOSURE_UPDATE"
          : "IMPORT_DISCLOSURE_CREATE",
        actorEmail,
        existing: item.existing,
        note: `Nạp mẫu thuyết minh từ ${item.sourceSheet}!${item.sourceRow}. Số trong tệp chỉ là số tham chiếu.`,
        payload: item.payload,
        recordId: item.nextRecord.recordId,
        recordType: item.recordType,
        versionId,
      });
    }
    await touchVersion(client, versionId, actorEmail);
    return prepared.counts;
  });

  return {
    counts,
    data: await getAccountingConfigData({ versionId }, actorEmail),
    templateSourceFileId: storedSource.fileId,
    message:
      "Đã lưu khuôn Excel B09 và đưa toàn bộ khoản mục vào bảng công thức chung. Số mẫu chỉ dùng đối chiếu.",
    ok: true,
  };
}

export async function attachAccountingDisclosureTemplateSource(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const sourceWorkbook = payload.sourceWorkbook || payload.file;
  if (!versionId || !sourceWorkbook) {
    throw new AccountingRpcError(
      "Vui lòng chọn phiên bản nháp và file Excel B09-DN gốc để làm khuôn xuất.",
    );
  }

  const source = await readWorkbook(sourceWorkbook);
  const parsed = parseAccountingDisclosureWorkbook(source.workbook, source.fileName);
  if (
    canonicalKey(parsed.template.templateKey) !== "B09_DN_TT99" ||
    Number(parsed.stats.rowCount || 0) < 100
  ) {
    throw new AccountingRpcError(
      "File đã chọn không phải khuôn B09-DN đầy đủ; hệ thống chưa thay khuôn xuất hiện tại.",
      409,
    );
  }

  await assertAccountingSchema();
  const client = await getAccountingPool().connect();
  try {
    await assertDraftVersion(client, versionId, false);
    const current = await selectVersionRecords(client, versionId);
    const template = current.find(
      (record) =>
        record.recordType === "DISCLOSURE_TEMPLATE" &&
        canonicalKey(record.entityKey) === "B09_DN_TT99",
    );
    if (!template) {
      throw new AccountingRpcError(
        "Phiên bản này chưa có nền B09-DN. Hãy dùng chức năng nạp mẫu B09 lần đầu trước.",
        409,
      );
    }
  } finally {
    client.release();
  }

  const { storeAccountingTemplateSource } = await import(
    "@/lib/accounting/export-storage"
  );
  const storedSource = await storeAccountingTemplateSource(source.buffer, {
    actorEmail,
    fileName: source.fileName,
  });

  await withAccountingTransaction(async (transaction) => {
    await assertDraftVersion(transaction, versionId);
    const current = await selectVersionRecords(transaction, versionId, true);
    const template = current.find(
      (record) =>
        record.recordType === "DISCLOSURE_TEMPLATE" &&
        canonicalKey(record.entityKey) === "B09_DN_TT99",
    );
    if (!template) {
      throw new AccountingRpcError(
        "Nền B09-DN đã thay đổi trong lúc lưu file; hãy tải lại cấu hình rồi thử lại.",
        409,
      );
    }
    await upsertRecord(transaction, {
      action: "UPLOAD_DISCLOSURE_TEMPLATE_SOURCE",
      actorEmail,
      existing: template,
      note:
        "Gắn nguyên file Excel B09-DN làm khuôn xuất; giữ nguyên toàn bộ khoản mục và đường đối chiếu đã thiết lập.",
      payload: {
        ...template.payload,
        sourceFileName: source.fileName,
        templateSourceFileId: storedSource.fileId,
        templateSourceSha256: storedSource.sha256,
        templateSourceSizeBytes: storedSource.sizeBytes,
      },
      recordId: template.recordId,
      recordType: "DISCLOSURE_TEMPLATE",
      versionId,
    });
    await touchVersion(transaction, versionId, actorEmail);
  });

  return {
    data: await getAccountingConfigData({ versionId }, actorEmail),
    fileName: storedSource.fileName,
    ok: true,
    templateSourceFileId: storedSource.fileId,
    message:
      "Đã gắn nguyên file B09-DN làm khuôn xuất và giữ nguyên các ánh xạ thuyết minh hiện có.",
  };
}

export const accountingImportExportTestUtils = {
  canonicalKey,
  deriveParentCodes,
  headerKey,
  normalizeIsoDate,
  previousIsoDate,
  resolveAccountColumns,
};
