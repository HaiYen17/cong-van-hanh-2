import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import {
  ACCOUNTING_RECORD_TYPES,
  ACCOUNTING_SCHEMA,
  COLUMN_TYPES,
  MAPPING_ROLES,
  MATCH_TYPES,
  OPERATORS,
  RECORD_GROUPS,
  ROW_TYPES,
  SOURCE_TYPES,
  VERSION_STATUS_LABELS,
} from "@/lib/accounting/constants";
import {
  assertAccountingSchema,
  firstRow,
  getAccountingPool,
  withAccountingTransaction,
} from "@/lib/accounting/database";
import {
  cleanText,
  isJsonObject,
  normalizeKey,
  normalizeRecordPayload,
  parseRecordInput,
  recordMeta,
} from "@/lib/accounting/normalize";
import {
  buildAccountingDisclosureReportRecords,
  DISCLOSURE_REPORT_KEY,
} from "@/lib/accounting/disclosure-report";
import type {
  AccountingGroups,
  AccountingRecord,
  AccountingRecordType,
  AccountingVersion,
  JsonObject,
} from "@/lib/accounting/types";
import { AccountingRpcError } from "@/lib/accounting/types";

type VersionRow = {
  created_at: Date | string;
  created_by: string;
  note: string;
  source_version_id: string | null;
  status_code: string;
  updated_at: Date | string;
  updated_by: string;
  version_id: string;
  version_name: string;
};

type RecordRow = {
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

const RECORD_SELECT = `
  record_id, version_id, record_type, entity_key, parent_key, company_key,
  display_code, display_name, status_label, valid_from, valid_to, sort_order,
  payload, created_at, created_by, updated_at, updated_by, deleted_at
`;

const REPORT_BUILDER_TYPES = new Set<AccountingRecordType>([
  "REPORT",
  "REPORT_COLUMN",
  "REPORT_ROW",
  "RULE",
  "STYLE",
]);

function iso(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowPayload(value: RecordRow["payload"]): JsonObject {
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

export function recordView(row: RecordRow): AccountingRecord {
  return {
    companyKey: row.company_key || "",
    createdAt: iso(row.created_at),
    createdBy: row.created_by || "",
    displayCode: row.display_code || "",
    displayName: row.display_name || "",
    entityKey: row.entity_key,
    isDeleted: false,
    parentKey: row.parent_key || "",
    payload: rowPayload(row.payload),
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

export function versionView(row: VersionRow): AccountingVersion {
  return {
    createdAt: iso(row.created_at),
    createdBy: row.created_by || "",
    displayName: row.version_name,
    entityKey: row.version_id,
    payload: {
      note: row.note || "",
      statusCode: row.status_code,
      versionName: row.version_name,
    },
    recordId: row.version_id,
    recordType: "CONFIG_VERSION",
    sourceVersionId: row.source_version_id || "",
    status: VERSION_STATUS_LABELS[row.status_code] || row.status_code,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by || "",
    versionId: row.version_id,
  };
}

function emptyGroups(): AccountingGroups {
  return {
    companies: [],
    accounts: [],
    accountSets: [],
    accountSetMembers: [],
    dataSources: [],
    sourceFieldMappings: [],
    reports: [],
    reportColumns: [],
    reportRows: [],
    rules: [],
    styles: [],
    disclosureTemplates: [],
    disclosureSections: [],
    disclosureItems: [],
    disclosureLinks: [],
    ownerships: [],
    eliminationRules: [],
  };
}

function groupRecords(records: AccountingRecord[]) {
  const groups = emptyGroups();
  for (const record of records) {
    groups[RECORD_GROUPS[record.recordType]].push(record);
  }
  for (const values of Object.values(groups)) {
    values.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        (left.displayCode || left.entityKey).localeCompare(
          right.displayCode || right.entityKey,
          "vi",
          { numeric: true, sensitivity: "base" },
        ),
    );
  }
  return groups;
}

async function selectPortalCompanies(
  fallback: AccountingRecord[],
) {
  try {
    const result = await getAccountingPool().query<{
      code: string;
      legalName: string;
      shortName: string | null;
      status: string;
    }>(
      `SELECT code, "legalName", "shortName", status
       FROM public."Company"
       WHERE "archivedAt" IS NULL
       ORDER BY "legalName", code`,
    );
    if (result.rows.length) {
      return result.rows.map((row) => ({
        companyKey: row.code,
        companyName: row.legalName,
        isActive: row.status === "ACTIVE",
        shortName: row.shortName || row.legalName,
      }));
    }
  } catch {
    // Cấu hình kế toán vẫn dùng được nếu bảng danh mục công ty đang được migrate.
  }
  return fallback
    .map((record) => ({
      companyKey: cleanText(record.payload.companyKey || record.companyKey),
      companyName: cleanText(record.payload.companyName || record.displayName),
      isActive: cleanText(record.payload.status || "ACTIVE") !== "INACTIVE",
      shortName: cleanText(
        record.payload.shortName ||
          record.payload.companyName ||
          record.displayName,
      ),
    }))
    .filter((company) => company.companyKey && company.companyName);
}

async function selectVersionForUpdate(
  client: PoolClient,
  versionId: string,
) {
  const result = await client.query<VersionRow>(
    `SELECT *
     FROM ${ACCOUNTING_SCHEMA}.config_versions
     WHERE version_id = $1
     FOR UPDATE`,
    [versionId],
  );
  const version = firstRow(
    result.rows,
    "Không tìm thấy phiên bản cấu hình.",
  );
  if (version.status_code !== "DRAFT") {
    throw new AccountingRpcError(
      "Chỉ được chỉnh sửa phiên bản đang soạn.",
      409,
    );
  }
  return version;
}

async function audit(
  client: PoolClient,
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

async function saveOne(
  client: PoolClient,
  versionId: string,
  rawInput: unknown,
  actorEmail: string,
  note = "",
  auditAction = "",
) {
  const input = parseRecordInput(rawInput);
  let existing: RecordRow | undefined;
  if (input.recordId) {
    const result = await client.query<RecordRow>(
      `SELECT ${RECORD_SELECT}
       FROM ${ACCOUNTING_SCHEMA}.config_records
       WHERE record_id = $1
       FOR UPDATE`,
      [input.recordId],
    );
    existing = result.rows[0];
    if (existing && existing.version_id !== versionId) {
      throw new AccountingRpcError(
        "Bản ghi thuộc một phiên bản cấu hình khác; hãy tải lại dữ liệu trước khi lưu.",
        409,
      );
    }
    if (existing?.deleted_at) {
      throw new AccountingRpcError(
        "Bản ghi đã được xóa khỏi phiên bản nháp; hãy tải lại dữ liệu.",
        409,
      );
    }
    if (existing && existing.record_type !== input.recordType) {
      throw new AccountingRpcError(
        "Không được thay đổi loại của bản ghi cấu hình đã tồn tại.",
        409,
      );
    }
  }

  const merged: JsonObject = {
    ...(existing ? rowPayload(existing.payload) : {}),
    ...input.payload,
  };
  const payload = normalizeRecordPayload(input.recordType, merged);
  const meta = recordMeta(input.recordType, payload);
  const recordId = existing?.record_id || input.recordId || randomUUID();

  const values = [
    recordId,
    versionId,
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
    JSON.stringify(payload),
    actorEmail,
  ];
  const result = existing
    ? await client.query<RecordRow>(
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
    : await client.query<RecordRow>(
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
  const saved = recordView(
    firstRow(result.rows, "Không đọc lại được bản ghi vừa lưu."),
  );
  await audit(client, {
    action: auditAction || (existing ? "UPDATE" : "CREATE"),
    actorEmail,
    after: saved,
    before: existing ? recordView(existing) : null,
    displayName: saved.displayName,
    note: note || "Lưu từ web Cấu hình Báo cáo Kế toán.",
    recordId,
    recordType: input.recordType,
    versionId,
  });
  return saved;
}

export async function assertDraftAccountingVersion(
  client: PoolClient,
  versionId: string,
) {
  return selectVersionForUpdate(client, versionId);
}

export async function saveAccountingRecordInTransaction(
  client: PoolClient,
  input: {
    actorEmail: string;
    auditAction?: string;
    note?: string;
    record: unknown;
    versionId: string;
  },
) {
  return saveOne(
    client,
    input.versionId,
    input.record,
    input.actorEmail,
    input.note || "",
    input.auditAction || "",
  );
}

export async function touchAccountingVersion(
  client: PoolClient,
  versionId: string,
  actorEmail: string,
) {
  return touchVersion(client, versionId, actorEmail);
}

export async function readAccountingVersionRecordsForUpdate(
  client: PoolClient,
  versionId: string,
) {
  const result = await client.query<RecordRow>(
    `SELECT ${RECORD_SELECT}
     FROM ${ACCOUNTING_SCHEMA}.config_records
     WHERE version_id = $1
       AND record_type <> 'CONFIG_VERSION'
       AND deleted_at IS NULL
     ORDER BY sort_order, display_code, entity_key
     FOR UPDATE`,
    [versionId],
  );
  return result.rows.map(recordView);
}

async function touchVersion(
  client: PoolClient,
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

export async function getAccountingConfigData(
  payload: JsonObject,
  actorEmail: string,
) {
  void actorEmail;
  await assertAccountingSchema();
  const versionsResult = await getAccountingPool().query<VersionRow>(
    `SELECT version_id, version_name, status_code, source_version_id, note,
            created_at, created_by, updated_at, updated_by
     FROM ${ACCOUNTING_SCHEMA}.config_versions
     ORDER BY updated_at DESC, created_at DESC`,
  );
  if (!versionsResult.rows.length) {
    throw new AccountingRpcError(
      "Kho cấu hình chưa có phiên bản. Hãy chạy migration dữ liệu trước.",
      503,
    );
  }
  const requestedVersionId = cleanText(payload.versionId);
  const selected =
    versionsResult.rows.find((row) => row.version_id === requestedVersionId) ||
    versionsResult.rows.find((row) => row.status_code === "DRAFT") ||
    versionsResult.rows[0];

  const selectedRecordsResult = await getAccountingPool().query<RecordRow>(
    `SELECT ${RECORD_SELECT}
     FROM ${ACCOUNTING_SCHEMA}.config_records
     WHERE version_id = $1
       AND record_type <> 'CONFIG_VERSION'
       AND deleted_at IS NULL
     ORDER BY sort_order, display_code, entity_key`,
    [selected.version_id],
  );
  const records = selectedRecordsResult.rows.map(recordView);
  const groups = groupRecords(records);
  const versions = versionsResult.rows.map(versionView);
  const selectedVersion = versions.find(
    (version) => version.versionId === selected.version_id,
  );
  const portalCompanies = await selectPortalCompanies(groups.companies);

  return {
    schemaVersion: "accounting-config.v2",
    sheetName: "PostgreSQL · accounting_portal.config_records",
    auditSheetName: "PostgreSQL · accounting_portal.audit_events",
    selectedVersionId: selected.version_id,
    selectedVersion,
    versions,
    records,
    groups,
    summary: Object.fromEntries(
      Object.entries(groups).map(([key, values]) => [key, values.length]),
    ),
    portalCompanies,
    dictionaries: {
      recordTypes: ACCOUNTING_RECORD_TYPES,
      rowTypes: [...ROW_TYPES],
      columnTypes: [...COLUMN_TYPES],
      operators: [...OPERATORS],
      sourceTypes: [...SOURCE_TYPES],
      matchTypes: [...MATCH_TYPES],
      mappingRoles: [...MAPPING_ROLES],
    },
  };
}

export async function saveAccountingConfigRecord(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  if (!versionId) {
    throw new AccountingRpcError("Vui lòng chọn phiên bản nháp.");
  }
  const recordInput = payload.record ?? payload.item;
  const note = cleanText(payload.note);
  const record = await withAccountingTransaction(async (client) => {
    await selectVersionForUpdate(client, versionId);
    const saved = await saveOne(
      client,
      versionId,
      recordInput,
      actorEmail,
      note,
    );
    await touchVersion(client, versionId, actorEmail);
    return saved;
  });
  return {
    ok: true,
    record,
    data: await getAccountingConfigData({ versionId }, actorEmail),
    message: "Đã lưu cấu hình vào bản nháp.",
  };
}

export async function saveAccountingReportBuilderRecords(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  if (!versionId) {
    throw new AccountingRpcError("Vui lòng chọn phiên bản nháp.");
  }
  if (!Array.isArray(payload.records) || !payload.records.length) {
    throw new AccountingRpcError("Chưa có thay đổi nào từ trình dựng báo cáo.");
  }
  if (payload.records.length > 250) {
    throw new AccountingRpcError(
      "Mỗi lần chỉ được lưu tối đa 250 bản ghi từ trình dựng báo cáo.",
    );
  }
  const note = cleanText(payload.note);
  const inputs = payload.records.map((value) => parseRecordInput(value));
  for (const input of inputs) {
    if (!REPORT_BUILDER_TYPES.has(input.recordType)) {
      throw new AccountingRpcError(
        `Trình dựng báo cáo không được lưu loại ${input.recordType}.`,
      );
    }
  }
  const records = await withAccountingTransaction(async (client) => {
    await selectVersionForUpdate(client, versionId);
    const saved: AccountingRecord[] = [];
    for (const input of inputs) {
      saved.push(
        await saveOne(client, versionId, input, actorEmail, note),
      );
    }
    await touchVersion(client, versionId, actorEmail);
    return saved;
  });
  return {
    ok: true,
    records,
    message: "Đã lưu thay đổi từ trình dựng báo cáo.",
  };
}

export async function ensureAccountingDisclosureFormulaReport(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  if (!versionId) {
    throw new AccountingRpcError("Vui lòng chọn phiên bản nháp.");
  }
  const result = await withAccountingTransaction(async (client) => {
    await selectVersionForUpdate(client, versionId);
    const currentRecords = await readAccountingVersionRecordsForUpdate(
      client,
      versionId,
    );
    const hasDisclosureTemplate = currentRecords.some(
      (record) =>
        record.recordType === "DISCLOSURE_TEMPLATE" &&
        normalizeKey(record.payload.templateKey || record.entityKey) ===
          DISCLOSURE_REPORT_KEY,
    );
    if (!hasDisclosureTemplate) {
      throw new AccountingRpcError(
        "Chưa có khuôn Excel B09-DN. Hãy nạp khuôn B09 trước khi thiết lập công thức.",
      );
    }
    const projection = buildAccountingDisclosureReportRecords(
      currentRecords,
      currentRecords,
    );
    const existingByKey = new Map(
      currentRecords.map((record) => [
        `${record.recordType}:${record.entityKey}`,
        record,
      ]),
    );
    const expected = projection.records.map((record) => {
      const normalizedPayload = normalizeRecordPayload(
        record.recordType,
        record.payload,
      );
      const meta = recordMeta(record.recordType, normalizedPayload);
      return { meta, record };
    });
    const isComplete = expected.every(({ meta, record }) =>
      existingByKey.has(`${record.recordType}:${meta.entityKey}`),
    );
    if (isComplete) {
      return { created: false, records: [], stats: projection.stats };
    }
    const saved: AccountingRecord[] = [];
    for (const item of expected) {
      const existing = existingByKey.get(
        `${item.record.recordType}:${item.meta.entityKey}`,
      );
      saved.push(
        await saveOne(
          client,
          versionId,
          {
            payload: item.record.payload,
            recordId: existing?.recordId,
            recordType: item.record.recordType,
          },
          actorEmail,
          "Đưa B09-DN vào trình dựng công thức chung.",
          existing ? "UPDATE" : "CREATE",
        ),
      );
    }
    await touchVersion(client, versionId, actorEmail);
    return { created: true, records: saved, stats: projection.stats };
  });
  return {
    ok: true,
    ...result,
    data: await getAccountingConfigData({ versionId }, actorEmail),
    message: result.created
      ? `Đã đưa ${result.stats.formulaRowCount} khoản mục B09 vào bảng công thức chung.`
      : "B09 đã có đầy đủ trong bảng công thức chung.",
  };
}

export async function deleteAccountingConfigRecord(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const recordId = cleanText(payload.recordId);
  if (!versionId || !recordId) {
    throw new AccountingRpcError(
      "Thiếu phiên bản hoặc bản ghi cấu hình cần xóa.",
    );
  }
  await withAccountingTransaction(async (client) => {
    await selectVersionForUpdate(client, versionId);
    const beforeResult = await client.query<RecordRow>(
      `SELECT ${RECORD_SELECT}
       FROM ${ACCOUNTING_SCHEMA}.config_records
       WHERE record_id = $1 AND version_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [recordId, versionId],
    );
    const before = recordView(
      firstRow(beforeResult.rows, "Bản ghi cần xóa không còn tồn tại."),
    );
    const deletedResult = await client.query<RecordRow>(
      `UPDATE ${ACCOUNTING_SCHEMA}.config_records
       SET deleted_at = now(), updated_at = now(), updated_by = $1
       WHERE record_id = $2 AND version_id = $3 AND deleted_at IS NULL
       RETURNING ${RECORD_SELECT}`,
      [actorEmail, recordId, versionId],
    );
    const deleted = firstRow(
      deletedResult.rows,
      "Bản ghi cần xóa không còn tồn tại.",
    );
    await audit(client, {
      action: "DELETE",
      actorEmail,
      after: {
        ...before,
        isDeleted: true,
        updatedAt: iso(deleted.updated_at),
        updatedBy: actorEmail,
      },
      before,
      displayName: before.displayName,
      note: "Đưa bản ghi ra khỏi phiên bản nháp.",
      recordId,
      recordType: before.recordType,
      versionId,
    });
    await touchVersion(client, versionId, actorEmail);
  });
  return {
    ok: true,
    data: await getAccountingConfigData({ versionId }, actorEmail),
    message: "Đã đưa bản ghi ra khỏi phiên bản nháp.",
  };
}

function versionIdNow() {
  const compact = new Date()
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14);
  return `CFG-WEB-${compact}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

export async function createAccountingConfigVersion(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionName = cleanText(payload.versionName || payload.name);
  if (!versionName) {
    throw new AccountingRpcError("Vui lòng nhập tên phiên bản nháp mới.");
  }
  const sourceVersionId = cleanText(
    payload.cloneFromVersionId || payload.versionId,
  );
  const note = cleanText(payload.note);
  const versionId = versionIdNow();

  await withAccountingTransaction(async (client) => {
    if (sourceVersionId) {
      const sourceResult = await client.query<VersionRow>(
        `SELECT *
         FROM ${ACCOUNTING_SCHEMA}.config_versions
         WHERE version_id = $1`,
        [sourceVersionId],
      );
      firstRow(sourceResult.rows, "Không tìm thấy phiên bản nguồn để sao chép.");
    }
    const versionResult = await client.query<VersionRow>(
      `INSERT INTO ${ACCOUNTING_SCHEMA}.config_versions(
         version_id, version_name, status_code, source_version_id, note,
         created_by, updated_by
       ) VALUES ($1,$2,'DRAFT',$3,$4,$5,$5)
       RETURNING *`,
      [
        versionId,
        versionName,
        sourceVersionId || null,
        note,
        actorEmail,
      ],
    );
    const version = versionView(
      firstRow(versionResult.rows, "Không tạo được phiên bản mới."),
    );
    let cloneCount = 0;
    if (sourceVersionId) {
      const cloneResult = await client.query(
        `INSERT INTO ${ACCOUNTING_SCHEMA}.config_records(
           record_id, version_id, record_type, entity_key, parent_key,
           company_key, display_code, display_name, status_label, valid_from,
           valid_to, sort_order, payload, created_by, updated_by
         )
         SELECT gen_random_uuid()::text, $1, record_type, entity_key, parent_key,
                company_key, display_code, display_name, status_label, valid_from,
                valid_to, sort_order, payload, $2, $2
         FROM ${ACCOUNTING_SCHEMA}.config_records
         WHERE version_id = $3
           AND record_type <> 'CONFIG_VERSION'
           AND deleted_at IS NULL`,
        [versionId, actorEmail, sourceVersionId],
      );
      cloneCount = cloneResult.rowCount || 0;
    }
    await audit(client, {
      action: "CREATE_VERSION",
      actorEmail,
      after: version,
      before: null,
      displayName: versionName,
      note:
        note ||
        `Sao chép ${cloneCount} bản ghi từ ${
          sourceVersionId || "bản trắng"
        }.`,
      recordId: versionId,
      recordType: "CONFIG_VERSION",
      versionId,
    });
  });

  return {
    ok: true,
    versionId,
    data: await getAccountingConfigData({ versionId }, actorEmail),
    message: "Đã tạo phiên bản nháp mới.",
  };
}

export async function readVersionRecords(versionId: string) {
  await assertAccountingSchema();
  const [versionResult, recordsResult] = await Promise.all([
    getAccountingPool().query<VersionRow>(
      `SELECT * FROM ${ACCOUNTING_SCHEMA}.config_versions WHERE version_id = $1`,
      [versionId],
    ),
    getAccountingPool().query<RecordRow>(
      `SELECT ${RECORD_SELECT}
       FROM ${ACCOUNTING_SCHEMA}.config_records
       WHERE version_id = $1
         AND record_type <> 'CONFIG_VERSION'
         AND deleted_at IS NULL`,
      [versionId],
    ),
  ]);
  firstRow(versionResult.rows, "Không tìm thấy phiên bản cần kiểm tra.");
  return recordsResult.rows.map(recordView);
}
