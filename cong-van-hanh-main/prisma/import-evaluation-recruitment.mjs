import "dotenv/config";

import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

import ExcelJS from "exceljs";
import pg from "pg";

const { Pool } = pg;

const cliArgs = process.argv.slice(2);
const positionalFiles = cliArgs.filter((value) => !value.startsWith("--"));
const onlyArg = cliArgs.find((value) => value.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length).trim().toLowerCase() : "all";
const DRY_RUN = cliArgs.includes("--dry-run") || cliArgs.includes("--preview");
const INSERT_MISSING_ONLY = cliArgs.includes("--insert-missing-only");
const googleSheetArg = cliArgs.find((value) => value.startsWith("--google-sheet-id="));
const GOOGLE_SHEET_ID = googleSheetArg
  ? googleSheetArg.slice("--google-sheet-id=".length).trim()
  : "";
const MAIN_FILE =
  positionalFiles[0] || path.resolve("prisma/import-cache/main.xlsx");
const RECRUITMENT_FILE =
  positionalFiles[1] || path.resolve("prisma/import-cache/recruitment.xlsx");
const RESULTS_FILE =
  positionalFiles[2] || path.resolve("prisma/import-cache/results.xlsx");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function stableId(prefix, value) {
  return `${prefix}_${createHash("sha1").update(String(value)).digest("hex")}`;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(value) {
  const raw = normalizeText(value);
  if (!raw) return "";
  return raw.replace(/[^\d+]/g, "");
}

function cellValue(cell) {
  const value = cell.value;
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if ("result" in value && value.result != null) return value.result;
  if ("text" in value && value.text != null) return value.text;
  if ("hyperlink" in value && value.hyperlink != null) {
    return value.text || value.hyperlink;
  }
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || "").join("");
  }
  return normalizeText(cell.text);
}

function worksheetRows(worksheet) {
  const headers = Array.from(
    { length: worksheet.columnCount },
    (_, index) => normalizeText(cellValue(worksheet.getCell(1, index + 1))),
  );
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = {};
    let hasValue = false;
    for (let column = 1; column <= headers.length; column += 1) {
      const header = headers[column - 1];
      if (!header) continue;
      const value = cellValue(worksheet.getCell(rowNumber, column));
      if (normalizeText(value)) hasValue = true;
      if (row[header] === undefined) row[header] = value;
    }
    if (hasValue) rows.push({ row, rowNumber });
  }
  return rows;
}

function text(row, ...keys) {
  for (const key of keys) {
    const value = normalizeText(row[key]);
    if (value) return value;
  }
  return "";
}

function integer(row, ...keys) {
  const value = text(row, ...keys).replace(/[^\d-]/g, "");
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ["true", "1", "yes", "có", "x", "đúng"].includes(normalized);
}

function dateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const dayFirst = normalized.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dayFirst) {
    const parsed = new Date(
      Number(dayFirst[3]),
      Number(dayFirst[2]) - 1,
      Number(dayFirst[1]),
      Number(dayFirst[4] || 0),
      Number(dayFirst[5] || 0),
      Number(dayFirst[6] || 0),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jsonValue(value) {
  const normalized = normalizeText(value);
  if (!normalized) return {};
  try {
    return JSON.parse(normalized);
  } catch {
    return { legacyText: normalized };
  }
}

function jsonReady(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

function requiredWorksheet(workbook, predicate, label) {
  const worksheet = workbook.worksheets.find(predicate);
  if (!worksheet) throw new Error(`Không tìm thấy sheet ${label}.`);
  return worksheet;
}

async function loadWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook;
}

async function loadEvaluationWorkbookFromGoogle(spreadsheetId) {
  const token = requireEnv("GOOGLE_ACCESS_TOKEN");
  const authHeaders = { Authorization: `Bearer ${token}` };
  const metadataUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
  );
  metadataUrl.searchParams.set("fields", "sheets.properties(title,index)");
  const metadataResponse = await fetch(metadataUrl, { headers: authHeaders });
  if (!metadataResponse.ok) {
    throw new Error(
      `Không đọc được metadata Google Sheets (${metadataResponse.status}): ${await metadataResponse.text()}`,
    );
  }
  const metadata = await metadataResponse.json();
  const sheet = (metadata.sheets || [])
    .map((item) => item.properties)
    .find((item) => normalizeText(item?.title).startsWith("09_"));
  if (!sheet?.title) {
    throw new Error("Không tìm thấy sheet 09_Cấu hình nền trên nguồn Google Sheets.");
  }

  const range = `'${sheet.title.replaceAll("'", "''")}'`;
  const valuesUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  valuesUrl.searchParams.set("majorDimension", "ROWS");
  valuesUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  valuesUrl.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  const valuesResponse = await fetch(valuesUrl, { headers: authHeaders });
  if (!valuesResponse.ok) {
    throw new Error(
      `Không đọc được dữ liệu Google Sheets (${valuesResponse.status}): ${await valuesResponse.text()}`,
    );
  }
  const payload = await valuesResponse.json();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet.title);
  worksheet.addRows(Array.isArray(payload.values) ? payload.values : []);
  return workbook;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function batchUpsert(
  client,
  {
    table,
    columns,
    rows,
    conflictColumns,
    updateColumns,
    conflictMode = "update",
    batchSize = 250,
  },
) {
  if (rows.length === 0) return 0;
  let affectedRows = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(row[column] ?? null);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const updates = updateColumns
      .map(
        (column) =>
          `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`,
      )
      .join(", ");
    const conflictAction = conflictMode === "nothing"
      ? "DO NOTHING"
      : `DO UPDATE SET ${updates}`;
    const result = await client.query(
      `
        INSERT INTO ${quoteIdentifier(table)}
          (${columns.map(quoteIdentifier).join(", ")})
        VALUES ${tuples.join(", ")}
        ON CONFLICT (${conflictColumns.map(quoteIdentifier).join(", ")})
        ${conflictAction}
      `,
      values,
    );
    affectedRows += result.rowCount || 0;
  }
  return affectedRows;
}

async function importEvaluation(client, workbook, stats) {
  const worksheet = requiredWorksheet(
    workbook,
    (sheet) => sheet.name.startsWith("09_"),
    "09_Cấu hình nền",
  );

  const records = [];
  const seenLegacyIds = new Set();
  for (const { row, rowNumber } of worksheetRows(worksheet)) {
    const recordType = text(row, "Evaluation Record Type");
    if (!recordType) continue;
    const sourceLegacyId =
      text(row, "Evaluation ID") || `evaluation-row-${rowNumber}`;
    const legacyBase = `${recordType}:${sourceLegacyId}`;
    const legacyId = seenLegacyIds.has(legacyBase)
      ? `${legacyBase}:row-${rowNumber}`
      : legacyBase;
    seenLegacyIds.add(legacyId);
    const content = jsonValue(row["Evaluation Content JSON"]);
    const sourceFingerprint = createHash("sha256")
      .update(JSON.stringify(jsonReady(row)))
      .digest("hex");

    records.push({
      code: text(row, "Evaluation Code") || null,
      content: JSON.stringify(content),
      createdAt: dateValue(row["Evaluation Created At"]) || new Date(),
      createdByName: text(row, "Evaluation Created By") || null,
      id: stableId("eval", legacyId),
      legacyId,
      legacyRowNumber: rowNumber,
      legacySheetName: worksheet.name,
      name: text(row, "Evaluation Name") || null,
      note: text(row, "Evaluation Note") || null,
      parentId: text(row, "Evaluation Parent ID") || null,
      recordType,
      sourceFingerprint,
      status: text(row, "Evaluation Status") || "active",
      text: text(row, "Evaluation Text") || null,
      updatedAt: dateValue(row["Evaluation Updated At"]) || new Date(),
      updatedByName: text(row, "Evaluation Updated By") || null,
    });
    stats.evaluation += 1;
  }
  stats.evaluationImported = await batchUpsert(client, {
    columns: [
      "id",
      "recordType",
      "parentId",
      "code",
      "name",
      "status",
      "content",
      "text",
      "note",
      "legacyId",
      "legacySheetName",
      "legacyRowNumber",
      "sourceFingerprint",
      "createdByName",
      "updatedByName",
      "createdAt",
      "updatedAt",
    ],
    conflictColumns: ["legacyId"],
    conflictMode: INSERT_MISSING_ONLY ? "nothing" : "update",
    rows: records,
    table: "EvaluationRecord",
    updateColumns: [
      "recordType",
      "parentId",
      "code",
      "name",
      "status",
      "content",
      "text",
      "note",
      "legacySheetName",
      "legacyRowNumber",
      "sourceFingerprint",
      "updatedByName",
      "updatedAt",
    ],
  });
}

async function importConfigurationRecords(client, workbook, stats) {
  const definitions = [
    {
      code: ["Record ID"],
      name: ["Tên"],
      recordType: "asset-setup",
      sheet: (worksheet) => worksheet.name.startsWith("10_"),
      status: ["Trạng thái", "Trạng thái tác vụ"],
    },
    {
      code: ["Asset ID"],
      name: ["Tên tài sản"],
      recordType: "asset-catalog",
      sheet: (worksheet) => worksheet.name.startsWith("11_"),
      status: ["Trạng thái"],
    },
    {
      code: ["Stationery ID"],
      name: ["Tên VPP"],
      recordType: "stationery",
      sheet: (worksheet) => worksheet.name.startsWith("12_"),
      status: ["Trạng thái"],
    },
    {
      code: ["Uniform ID"],
      name: ["Tên đồng phục"],
      recordType: "uniform",
      sheet: (worksheet) => worksheet.name.startsWith("13_"),
      status: ["Trạng thái"],
    },
    {
      code: ["Mã biểu mẫu"],
      name: ["Tên biểu mẫu"],
      recordType: "template",
      sheet: (worksheet) => worksheet.name.startsWith("03_"),
      status: ["Trạng thái"],
    },
    {
      code: ["Mã lịch sử"],
      name: ["Tên biểu mẫu"],
      parentCode: ["Mã biểu mẫu"],
      recordType: "template-history",
      sheet: (worksheet) => worksheet.name.startsWith("05_"),
      status: [],
    },
    {
      code: ["ID", "Request ID", "Review Run ID"],
      name: ["Contract Name", "Rule Name"],
      parentCode: ["Parent ID"],
      recordType: "ai-review-record",
      sheet: (worksheet) => worksheet.name === "AI_ReviewHopDong",
      status: ["Review Status", "Queue Status", "Severity"],
    },
    {
      code: ["Tag ID", "Bộ tương tác ID"],
      name: ["Tên tag", "Tên bộ"],
      parentCode: ["Liên kết ID"],
      recordType: "shared-tag",
      sheet: (worksheet) => worksheet.name.startsWith("08_"),
      status: ["Trạng thái"],
    },
  ];
  const records = [];
  for (const definition of definitions) {
    const worksheet = workbook.worksheets.find(definition.sheet);
    if (!worksheet) continue;
    for (const { row, rowNumber } of worksheetRows(worksheet)) {
      const code = text(row, ...definition.code);
      const name = text(row, ...definition.name);
      if (!code && !name) continue;
      records.push({
        code: code || null,
        content: JSON.stringify(jsonReady(row)),
        id: stableId(
          "cfg_record",
          `${definition.recordType}|${worksheet.name}|${rowNumber}`,
        ),
        name: name || null,
        parentCode: definition.parentCode
          ? text(row, ...definition.parentCode) || null
          : null,
        recordType: definition.recordType,
        sourceRow: rowNumber,
        sourceSheet: worksheet.name,
        status: definition.status.length
          ? text(row, ...definition.status) || null
          : null,
        updatedAt: new Date(),
      });
      stats.configuration += 1;
    }
  }

  const platformSheet = workbook.worksheets.find((sheet) =>
    sheet.name.startsWith("09_"),
  );
  if (platformSheet) {
    for (const { row, rowNumber } of worksheetRows(platformSheet)) {
      const appId = text(row, "Ứng dụng ID");
      if (appId) {
        records.push({
          code: appId,
          content: JSON.stringify(jsonReady(row)),
          id: stableId(
            "cfg_record",
            `app-definition|${platformSheet.name}|${rowNumber}`,
          ),
          name: text(row, "Tên ứng dụng") || null,
          parentCode: null,
          recordType: "app-definition",
          sourceRow: rowNumber,
          sourceSheet: platformSheet.name,
          status: text(row, "Trạng thái") || null,
          updatedAt: new Date(),
        });
        stats.configuration += 1;
      }
      const reviewId = text(row, "Review ID");
      if (reviewId) {
        records.push({
          code: reviewId,
          content: JSON.stringify(jsonReady(row)),
          id: stableId(
            "cfg_record",
            `ai-review-rule|${platformSheet.name}|${rowNumber}`,
          ),
          name: text(row, "Review Name") || null,
          parentCode: text(row, "Review Parent ID") || null,
          recordType: "ai-review-rule",
          sourceRow: rowNumber,
          sourceSheet: platformSheet.name,
          status: text(row, "Review Status") || null,
          updatedAt: new Date(),
        });
        stats.configuration += 1;
      }
    }
  }

  await batchUpsert(client, {
    columns: [
      "id",
      "recordType",
      "sourceSheet",
      "sourceRow",
      "code",
      "parentCode",
      "name",
      "status",
      "content",
      "updatedAt",
    ],
    conflictColumns: ["recordType", "sourceSheet", "sourceRow"],
    rows: records,
    table: "ConfigurationRecord",
    updateColumns: [
      "code",
      "parentCode",
      "name",
      "status",
      "content",
      "updatedAt",
    ],
  });
}

async function importRecruitmentSources(client, workbook, stats) {
  const worksheet = requiredWorksheet(
    workbook,
    (sheet) => sheet.name === "Định nghĩa Nguồn",
    "Định nghĩa Nguồn",
  );
  const sourceByName = new Map();
  for (const { row, rowNumber } of worksheetRows(worksheet)) {
    const name = text(row, "Nguồn");
    if (!name) continue;
    sourceByName.set(name, {
      id: stableId("rec_source", name),
      legacyRowNumber: rowNumber,
      mapping: JSON.stringify(jsonReady(row)),
      name,
      status: "ACTIVE",
      updatedAt: new Date(),
    });
    stats.sources += 1;
  }
  await batchUpsert(client, {
    columns: [
      "id",
      "name",
      "mapping",
      "status",
      "legacyRowNumber",
      "updatedAt",
    ],
    conflictColumns: ["name"],
    rows: [...sourceByName.values()],
    table: "RecruitmentSourceDefinition",
    updateColumns: ["mapping", "status", "legacyRowNumber", "updatedAt"],
  });
}

async function importCampaigns(client, workbook, stats) {
  const worksheet = requiredWorksheet(
    workbook,
    (sheet) => sheet.name === "MasterSheet",
    "MasterSheet",
  );
  const campaignByKey = new Map();
  const campaignByCode = new Map();
  const campaignRecords = new Map();

  for (const { row, rowNumber } of worksheetRows(worksheet)) {
    const code = text(row, "Mã Tuyển dụng");
    const position = text(row, "Chức vụ");
    if (!code || !position) continue;
    const source = text(row, "Nguồn tuyển dụng") || "Không xác định";
    const id = stableId("rec_campaign", `${code}|${source}`);
    const endAt = dateValue(row["Ngày kết thúc tuyển"]);
    const status = endAt && endAt.getTime() < Date.now() ? "CLOSED" : "OPEN";
    campaignRecords.set(`${code}|${source}`, {
      availableOrder: text(row, "Số thứ tự khả dụng") || null,
      block: text(row, "Khối") || null,
      campaignName: text(row, "Campaign") || null,
      code,
      company: text(row, "Công ty") || null,
      cvType: text(row, "Loại hình thức thu nhập CV") || null,
      department: text(row, "Phòng ban") || null,
      division: text(row, "Bộ phận") || null,
      endDate: endAt,
      groupName: text(row, "Tổ") || null,
      id,
      legacyRowNumber: rowNumber,
      location: text(row, "Địa điểm") || null,
      orgPath: text(row, "Org Path") || null,
      position,
      raw: JSON.stringify(jsonReady(row)),
      source,
      startDate: dateValue(row["Ngày bắt đầu tuyển"]),
      status,
      team: text(row, "Team") || null,
      updatedAt: new Date(),
    });
    campaignByKey.set(`${code}|${source}`, id);
    if (!campaignByCode.has(code)) campaignByCode.set(code, id);
    stats.campaigns += 1;
  }
  await batchUpsert(client, {
    columns: [
      "id",
      "code",
      "source",
      "company",
      "location",
      "block",
      "department",
      "division",
      "team",
      "groupName",
      "orgPath",
      "position",
      "cvType",
      "campaignName",
      "startDate",
      "endDate",
      "availableOrder",
      "status",
      "legacyRowNumber",
      "raw",
      "updatedAt",
    ],
    conflictColumns: ["code", "source"],
    rows: [...campaignRecords.values()],
    table: "RecruitmentCampaign",
    updateColumns: [
      "company",
      "location",
      "block",
      "department",
      "division",
      "team",
      "groupName",
      "orgPath",
      "position",
      "cvType",
      "campaignName",
      "startDate",
      "endDate",
      "availableOrder",
      "status",
      "legacyRowNumber",
      "raw",
      "updatedAt",
    ],
  });
  return { campaignByCode, campaignByKey };
}

async function importRequisitions(client, workbook, stats) {
  const worksheet = requiredWorksheet(
    workbook,
    (sheet) => sheet.name === "ORDER TD",
    "ORDER TD",
  );
  const requisitions = new Map();
  for (const { row, rowNumber } of worksheetRows(worksheet)) {
    const requisitionCode = text(row, "Mã order");
    const position = text(row, "Tên vị trí");
    if (!requisitionCode || !position) continue;
    requisitions.set(requisitionCode, {
      cancellationStage: text(row, "Giai đoạn hủy") || null,
      company: text(row, "Công ty") || null,
      department: text(row, "Phòng ban") || null,
      id: stableId("rec_req", requisitionCode),
      intakeStatus: text(row, "Trạng thái tiếp nhận") || null,
      jobCode: text(row, "Mã Job") || null,
      legacyRowNumber: rowNumber,
      level: text(row, "Cấp bậc") || null,
      note: text(row, "Note") || null,
      onboardDueAt: dateValue(row["Thời gian YC OB"]),
      position,
      quarter: text(row, "Quý") || null,
      raw: JSON.stringify(jsonReady(row)),
      reason: text(row, "Lý do tuyển") || null,
      receivedAt: dateValue(row["Ngày nhận Order"]),
      recruiter: text(row, "Recruiter") || null,
      recruitmentStatus: text(row, "Trạng thái tuyển") || null,
      requestedQuantity: integer(row, "Tổng SL Order"),
      requisitionCode,
      updatedAt: new Date(),
      year: integer(row, "Năm"),
    });
    stats.requisitions += 1;
  }
  await batchUpsert(client, {
    columns: [
      "id",
      "requisitionCode",
      "jobCode",
      "department",
      "position",
      "level",
      "company",
      "intakeStatus",
      "recruitmentStatus",
      "recruiter",
      "reason",
      "requestedQuantity",
      "cancellationStage",
      "receivedAt",
      "onboardDueAt",
      "quarter",
      "year",
      "note",
      "legacyRowNumber",
      "raw",
      "updatedAt",
    ],
    conflictColumns: ["requisitionCode"],
    rows: [...requisitions.values()],
    table: "RecruitmentRequisition",
    updateColumns: [
      "jobCode",
      "department",
      "position",
      "level",
      "company",
      "intakeStatus",
      "recruitmentStatus",
      "recruiter",
      "reason",
      "requestedQuantity",
      "cancellationStage",
      "receivedAt",
      "onboardDueAt",
      "quarter",
      "year",
      "note",
      "legacyRowNumber",
      "raw",
      "updatedAt",
    ],
  });
}

async function importConfigRecords(client, workbook, stats) {
  const sources = [
    ["Base", "base"],
    ["Chi phí", "cost"],
    ["CFG_OrgUnits", "org-unit"],
    ["CFG_OrgAliases", "org-alias"],
    ["REF_STATUS", "status-definition"],
    ["Audit_Available_Order", "audit-available-order"],
    ["Audit_OrgChange", "audit-org-change"],
    ["Audit_CandidateAction", "audit-candidate-action"],
  ];

  for (const [sheetName, recordType] of sources) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;
    const records = worksheetRows(worksheet);
    const configRows = [];
    for (const { row, rowNumber } of records) {
      const content = jsonReady(row);
      const populated = Object.values(content).some((value) => normalizeText(value));
      if (!populated) continue;
      const code = text(
        row,
        "OrgUnitId",
        "Mã order",
        "Mã Job",
        "Mã Gói/HĐ",
        "ChangeId",
        "Run ID",
        "Trạng thái",
      );
      const name = text(
        row,
        "Name",
        "Vị Trí",
        "Chức danh",
        "Nguồn",
        "Summary",
        "Trạng thái",
      );
      configRows.push({
        code: code || null,
        content: JSON.stringify(content),
        id: stableId("rec_cfg", `${sheetName}|${rowNumber}`),
        name: name || null,
        recordType,
        sourceRow: rowNumber,
        sourceSheet: sheetName,
        status: text(row, "Status", "Trạng thái") || null,
        updatedAt: new Date(),
      });
      stats.configRecords += 1;
    }
    await batchUpsert(client, {
      batchSize: 150,
      columns: [
        "id",
        "recordType",
        "code",
        "name",
        "status",
        "sourceSheet",
        "sourceRow",
        "content",
        "updatedAt",
      ],
      conflictColumns: ["sourceSheet", "sourceRow"],
      rows: configRows,
      table: "RecruitmentConfigRecord",
      updateColumns: [
        "recordType",
        "code",
        "name",
        "status",
        "content",
        "updatedAt",
      ],
    });
  }
}

async function importTracking(
  client,
  workbook,
  campaignMaps,
  stats,
  applicationByCandidateCode,
) {
  const worksheet = requiredWorksheet(
    workbook,
    (sheet) => sheet.name === "Theo dõi Tuyển dụng",
    "Theo dõi Tuyển dụng",
  );
  const candidateRows = new Map();
  const applicationRows = [];
  for (const { row, rowNumber } of worksheetRows(worksheet)) {
    const candidateCode = text(row, "Mã ứng viên");
    const candidateName = text(row, "Họ và tên ứng viên");
    const phone = normalizePhone(text(row, "Số Điện Thoại"));
    if (!candidateCode && !candidateName && !phone) continue;
    const email = text(row, "Email").toLowerCase();
    const fullName =
      candidateName || `Ứng viên ${candidateCode || rowNumber}`;
    const candidateIdentity =
      candidateCode ||
      phone ||
      email ||
      `${fullName}|${text(row, "Ngày tháng năm sinh")}|${rowNumber}`;
    const candidateId = stableId("rec_candidate", candidateIdentity);
    candidateRows.set(candidateId, {
      address: text(row, "Địa chỉ") || null,
      birthDate: text(row, "Ngày tháng năm sinh") || null,
      email: email || null,
      fullName,
      id: candidateId,
      phone: phone || null,
      updatedAt: new Date(),
    });
    const requisitionCode = text(row, "Mã yêu cầu tuyển dụng");
    const source = text(row, "Nguồn tuyển dụng") || "Không xác định";
    const campaignId =
      campaignMaps.campaignByKey.get(`${requisitionCode}|${source}`) ||
      campaignMaps.campaignByCode.get(requisitionCode) ||
      null;
    const applicationId = stableId("rec_application", `tracking|${rowNumber}`);

    applicationRows.push({
      applicationCode: `legacy-tracking:${rowNumber}`,
      campaignId,
      candidateCode: candidateCode || null,
      candidateId,
      company: text(row, "Công ty") || null,
      cvUrl: text(row, "Link CV Ứng Viên (Link Base Workflow)") || null,
      department: text(row, "Phòng ban") || null,
      id: applicationId,
      legacyRowNumber: rowNumber,
      level: text(row, "Cấp bậc") || null,
      note: text(row, "Ghi chú") || null,
      position: text(row, "Vị trí tuyển dụng", "Vị trí") || null,
      raw: JSON.stringify(jsonReady(row)),
      receivedAt: dateValue(row["Ngày nộp"]),
      recruiter: text(row, "Người tuyển dụng") || null,
      requisitionCode: requisitionCode || null,
      source,
      status: text(row, "Trạng thái ứng viên") || null,
      updatedAt: new Date(),
    });
    if (candidateCode && !applicationByCandidateCode.has(candidateCode)) {
      applicationByCandidateCode.set(candidateCode, {
        applicationId,
        candidateId,
        candidateName: fullName,
      });
    }
    stats.applications += 1;
  }
  await batchUpsert(client, {
    columns: [
      "id",
      "fullName",
      "phone",
      "email",
      "birthDate",
      "address",
      "updatedAt",
    ],
    conflictColumns: ["id"],
    rows: [...candidateRows.values()],
    table: "RecruitmentCandidate",
    updateColumns: [
      "fullName",
      "phone",
      "email",
      "birthDate",
      "address",
      "updatedAt",
    ],
  });
  await batchUpsert(client, {
    columns: [
      "id",
      "applicationCode",
      "candidateCode",
      "candidateId",
      "campaignId",
      "requisitionCode",
      "company",
      "department",
      "position",
      "level",
      "source",
      "receivedAt",
      "cvUrl",
      "recruiter",
      "status",
      "note",
      "legacyRowNumber",
      "raw",
      "updatedAt",
    ],
    conflictColumns: ["applicationCode"],
    rows: applicationRows,
    table: "RecruitmentApplication",
    updateColumns: [
      "candidateCode",
      "candidateId",
      "campaignId",
      "requisitionCode",
      "company",
      "department",
      "position",
      "level",
      "source",
      "receivedAt",
      "cvUrl",
      "recruiter",
      "status",
      "note",
      "legacyRowNumber",
      "raw",
      "updatedAt",
    ],
  });
}

async function importIntake(client, workbook, stats) {
  const worksheet = requiredWorksheet(
    workbook,
    (sheet) => sheet.name === "Work Flow",
    "Work Flow",
  );
  const intakeRows = [];
  for (const { row, rowNumber } of worksheetRows(worksheet)) {
    const fullName = text(row, "Họ và tên");
    const phone = normalizePhone(text(row, "Số Điện Thoại"));
    const email = text(row, "Email").toLowerCase();
    if (!fullName && !phone && !email) continue;
    intakeRows.push({
      cvUrl: text(row, "File CV", "Link Profile/ Portfolio") || null,
      email: email || null,
      fullName: fullName || null,
      id: stableId("rec_intake", rowNumber),
      legacyRowNumber: rowNumber,
      phone: phone || null,
      position: text(row, "Vị Trí") || null,
      raw: JSON.stringify(jsonReady(row)),
      requisitionCode: text(row, "ID") || null,
      source: text(row, "Nguồn") || null,
      status: text(row, "Trạng thái") || "PENDING",
      updatedAt: new Date(),
    });
    stats.intake += 1;
  }
  await batchUpsert(client, {
    columns: [
      "id",
      "fullName",
      "phone",
      "email",
      "position",
      "source",
      "requisitionCode",
      "cvUrl",
      "status",
      "legacyRowNumber",
      "raw",
      "updatedAt",
    ],
    conflictColumns: ["legacyRowNumber"],
    rows: intakeRows,
    table: "RecruitmentIntake",
    updateColumns: [
      "fullName",
      "phone",
      "email",
      "position",
      "source",
      "requisitionCode",
      "cvUrl",
      "status",
      "raw",
      "updatedAt",
    ],
  });
}

async function ensureApplication(
  client,
  applicationByCandidateCode,
  candidateCode,
  candidateName,
  position,
) {
  const code = normalizeText(candidateCode);
  if (code && applicationByCandidateCode.has(code)) {
    return applicationByCandidateCode.get(code);
  }
  const identity = code || `${candidateName}|${position}`;
  const candidateId = stableId("rec_candidate", `portal|${identity}`);
  const applicationId = stableId("rec_application", `portal|${identity}`);
  const safeName = normalizeText(candidateName) || `Ứng viên ${code || "chưa mã"}`;
  await client.query(
    `
      INSERT INTO "RecruitmentCandidate" ("id", "fullName", "updatedAt")
      VALUES ($1, $2, NOW())
      ON CONFLICT ("id") DO UPDATE SET
        "fullName" = EXCLUDED."fullName",
        "updatedAt" = NOW()
    `,
    [candidateId, safeName],
  );
  await client.query(
    `
      INSERT INTO "RecruitmentApplication" (
        "id", "applicationCode", "candidateCode", "candidateId",
        "position", "status", "raw", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'IMPORTED', '{}'::jsonb, NOW())
      ON CONFLICT ("applicationCode") DO UPDATE SET
        "candidateCode" = EXCLUDED."candidateCode",
        "candidateId" = EXCLUDED."candidateId",
        "position" = COALESCE(EXCLUDED."position", "RecruitmentApplication"."position"),
        "updatedAt" = NOW()
    `,
    [
      applicationId,
      `legacy-portal:${identity}`,
      code || null,
      candidateId,
      normalizeText(position) || null,
    ],
  );
  const result = { applicationId, candidateId, candidateName: safeName };
  if (code) applicationByCandidateCode.set(code, result);
  return result;
}

async function importOffers(
  client,
  workbook,
  stats,
  applicationByCandidateCode,
) {
  for (const sheetName of ["OFFER", "OFFER chuyển"]) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;
    const offerRows = [];
    for (const { row, rowNumber } of worksheetRows(worksheet)) {
      const candidateCode = text(row, "Mã ứng viên");
      const candidateName = text(row, "Họ và tên");
      if (!candidateCode && !candidateName) continue;
      const linked = candidateCode
        ? applicationByCandidateCode.get(candidateCode)
        : null;
      const compensation = {
        baseSalary: row["Lương CB"] ?? null,
        effectivenessBonus: row["Thưởng hiệu quả công việc"] ?? null,
        lunchAllowance: row["PC ăn trưa"] ?? null,
        phoneAllowance: row["PC điện thoại"] ?? null,
        total: row["Tổng"] ?? null,
        travelAllowance: row["PC xăng xe"] ?? null,
      };
      const employmentRecord = {
        citizenId: text(row, "CCCD") || null,
        companion: text(row, "Người đồng hành") || null,
        directManager: text(row, "Quản lý trực tiếp") || null,
        documentStatus: text(row, "Hồ sơ") || null,
        employeeCode: text(row, "Mã TTTN TS") || null,
        issueDate: text(row, "Ngày cấp") || null,
        issuePlace: text(row, "Nơi cấp") || null,
        jobTitle: text(row, "Chức danh") || null,
        permanentAddress: text(row, "Địa chỉ thường trú") || null,
        workLocation: text(row, "Địa điểm làm việc") || null,
        workSchedule: text(row, "Giờ làm việc") || null,
      };
      offerRows.push({
        applicationId: linked?.applicationId || null,
        candidateCode: candidateCode || null,
        candidateName: candidateName || `Ứng viên ${candidateCode}`,
        company: text(row, "Cty") || null,
        compensation: JSON.stringify(compensation),
        department: text(row, "Phòng ban") || null,
        email: text(row, "Email").toLowerCase() || null,
        employmentRecord: JSON.stringify(employmentRecord),
        id: stableId("rec_offer", `${sheetName}|${rowNumber}`),
        legacyRowNumber: rowNumber,
        legacySource: sheetName,
        level: text(row, "Cấp bậc") || null,
        note: text(row, "Ghi chú") || null,
        onboardAt: dateValue(row["Ngày nhận việc"]),
        ownerName: text(row, "Phụ trách") || null,
        phone: normalizePhone(text(row, "SĐT")) || null,
        position: text(row, "Vị trí") || null,
        probationEndAt: dateValue(row["Ngày kết thúc thử việc"]),
        profileUrl: text(row, "Link Hồ Sơ") || null,
        raw: JSON.stringify(jsonReady(row)),
        requisitionCode: text(row, "Mã yêu cầu TD") || null,
        source: text(row, "Nguồn") || null,
        status: text(row, "Trạng thái") || null,
        updatedAt: new Date(),
      });
      stats.offers += 1;
    }
    await batchUpsert(client, {
      columns: [
        "id",
        "applicationId",
        "candidateCode",
        "candidateName",
        "phone",
        "email",
        "department",
        "position",
        "level",
        "requisitionCode",
        "source",
        "status",
        "ownerName",
        "onboardAt",
        "probationEndAt",
        "company",
        "compensation",
        "employmentRecord",
        "note",
        "profileUrl",
        "legacySource",
        "legacyRowNumber",
        "raw",
        "updatedAt",
      ],
      conflictColumns: ["legacySource", "legacyRowNumber"],
      rows: offerRows,
      table: "RecruitmentOffer",
      updateColumns: [
        "applicationId",
        "candidateCode",
        "candidateName",
        "phone",
        "email",
        "department",
        "position",
        "level",
        "requisitionCode",
        "source",
        "status",
        "ownerName",
        "onboardAt",
        "probationEndAt",
        "company",
        "compensation",
        "employmentRecord",
        "note",
        "profileUrl",
        "raw",
        "updatedAt",
      ],
    });
  }
}

async function importPortalData(
  client,
  workbook,
  stats,
  applicationByCandidateCode,
) {
  const knownSnapshotSheets = [
    "Portal_DanhGia",
    "SoVan_Logs",
    "HEXACO_Logs",
    "Kết quả Ứng viên",
  ];
  await client.query(
    `DELETE FROM "RecruitmentLegacySnapshot" WHERE "sourceSheet" = ANY($1::text[])`,
    [knownSnapshotSheets],
  );

  const portalCandidateSources = [
    ["Portal_HanhTrinh", "Candidate Code", "Candidate Name", "Position"],
    ["Portal_PhongVan", "Candidate Code", "Candidate Name", "Position"],
    ["Portal_PhanCong", "Candidate Code", "", ""],
    ["Portal_PhieuCham", "Candidate Code", "Candidate Name", "Position"],
    ["Portal_NhatKy", "Candidate Code", "Candidate Name", ""],
    ["Portal_CongBo", "Candidate Code", "Candidate Name", "Position"],
    ["Portal_DanhGia", "Candidate Code", "Candidate Name", "Position"],
    ["SoVan_Logs", "Mã phỏng vấn", "", ""],
    ["HEXACO_Logs", "Mã phỏng vấn", "", ""],
    ["Kết quả Ứng viên", "Mã Phỏng vấn", "", ""],
  ];
  const placeholderCandidates = new Map();
  const placeholderApplications = new Map();
  for (const [sheetName, codeHeader, nameHeader, positionHeader] of portalCandidateSources) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;
    for (const { row } of worksheetRows(worksheet)) {
      const candidateCode = text(row, codeHeader);
      if (!candidateCode || applicationByCandidateCode.has(candidateCode)) continue;
      const candidateName =
        (nameHeader ? text(row, nameHeader) : "") ||
        `Ứng viên ${candidateCode}`;
      const position = positionHeader ? text(row, positionHeader) : "";
      const candidateId = stableId("rec_candidate", `portal|${candidateCode}`);
      const applicationId = stableId(
        "rec_application",
        `portal|${candidateCode}`,
      );
      placeholderCandidates.set(candidateId, {
        address: null,
        birthDate: null,
        email: null,
        fullName: candidateName,
        id: candidateId,
        phone: null,
        updatedAt: new Date(),
      });
      placeholderApplications.set(applicationId, {
        applicationCode: `legacy-portal:${candidateCode}`,
        candidateCode,
        candidateId,
        id: applicationId,
        position: position || null,
        raw: JSON.stringify({ importedFrom: "candidate-evaluation-portal" }),
        status: "IMPORTED",
        updatedAt: new Date(),
      });
      applicationByCandidateCode.set(candidateCode, {
        applicationId,
        candidateId,
        candidateName,
      });
    }
  }
  await batchUpsert(client, {
    columns: [
      "id",
      "fullName",
      "phone",
      "email",
      "birthDate",
      "address",
      "updatedAt",
    ],
    conflictColumns: ["id"],
    rows: [...placeholderCandidates.values()],
    table: "RecruitmentCandidate",
    updateColumns: ["fullName", "updatedAt"],
  });
  await batchUpsert(client, {
    columns: [
      "id",
      "applicationCode",
      "candidateCode",
      "candidateId",
      "position",
      "status",
      "raw",
      "updatedAt",
    ],
    conflictColumns: ["applicationCode"],
    rows: [...placeholderApplications.values()],
    table: "RecruitmentApplication",
    updateColumns: [
      "candidateCode",
      "candidateId",
      "position",
      "status",
      "raw",
      "updatedAt",
    ],
  });

  const journeySheet = workbook.getWorksheet("Portal_HanhTrinh");
  if (journeySheet) {
    for (const { row } of worksheetRows(journeySheet)) {
      const linked = await ensureApplication(
        client,
        applicationByCandidateCode,
        text(row, "Candidate Code"),
        text(row, "Candidate Name"),
        text(row, "Position"),
      );
      await client.query(
        `
          INSERT INTO "RecruitmentJourney" (
            "id", "applicationId", "stageKey", "progressKey", "outcomeKey",
            "nextAction", "ownerEmployeeId", "ownerName", "dueAt",
            "testStatus", "offerStatus", "lastContactAt", "contactAttempts",
            "updatedByName", "updatedAt"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
          )
          ON CONFLICT ("applicationId") DO UPDATE SET
            "stageKey" = EXCLUDED."stageKey",
            "progressKey" = EXCLUDED."progressKey",
            "outcomeKey" = EXCLUDED."outcomeKey",
            "nextAction" = EXCLUDED."nextAction",
            "ownerEmployeeId" = EXCLUDED."ownerEmployeeId",
            "ownerName" = EXCLUDED."ownerName",
            "dueAt" = EXCLUDED."dueAt",
            "testStatus" = EXCLUDED."testStatus",
            "offerStatus" = EXCLUDED."offerStatus",
            "lastContactAt" = EXCLUDED."lastContactAt",
            "contactAttempts" = EXCLUDED."contactAttempts",
            "updatedByName" = EXCLUDED."updatedByName",
            "updatedAt" = NOW()
        `,
        [
          stableId("rec_journey", linked.applicationId),
          linked.applicationId,
          text(row, "Stage Key") || "cv_screening",
          text(row, "Progress Key") || "pending",
          text(row, "Outcome Key") || null,
          text(row, "Next Action") || null,
          text(row, "Owner Employee ID") || null,
          text(row, "Owner Name") || null,
          dateValue(row["Due At"]),
          text(row, "Test Status") || null,
          text(row, "Offer Status") || null,
          dateValue(row["Last Contact At"]),
          integer(row, "Contact Attempts") || 0,
          text(row, "Updated By") || null,
        ],
      );
      stats.journeys += 1;
    }
  }

  const interviewBySession = new Map();
  const interviewSheet = workbook.getWorksheet("Portal_PhongVan");
  if (interviewSheet) {
    for (const { row, rowNumber } of worksheetRows(interviewSheet)) {
      const sessionId = text(row, "Session ID") || `session-row-${rowNumber}`;
      const linked = await ensureApplication(
        client,
        applicationByCandidateCode,
        text(row, "Candidate Code"),
        text(row, "Candidate Name"),
        text(row, "Position"),
      );
      const id = stableId("rec_interview", sessionId);
      await client.query(
        `
          INSERT INTO "RecruitmentInterview" (
            "id", "applicationId", "roundKey", "roundLabel", "startAt",
            "location", "meetingLink", "status", "note", "createdByName",
            "updatedByName", "createdAt", "updatedAt"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            COALESCE($12, NOW()), COALESCE($13, NOW())
          )
          ON CONFLICT ("id") DO UPDATE SET
            "applicationId" = EXCLUDED."applicationId",
            "roundKey" = EXCLUDED."roundKey",
            "roundLabel" = EXCLUDED."roundLabel",
            "startAt" = EXCLUDED."startAt",
            "location" = EXCLUDED."location",
            "meetingLink" = EXCLUDED."meetingLink",
            "status" = EXCLUDED."status",
            "note" = EXCLUDED."note",
            "updatedByName" = EXCLUDED."updatedByName",
            "updatedAt" = EXCLUDED."updatedAt"
        `,
        [
          id,
          linked.applicationId,
          text(row, "Round Key") || "round-1",
          text(row, "Round Label") || "Vòng phỏng vấn",
          dateValue(row["Start At"]),
          text(row, "Location") || null,
          text(row, "Meeting Link") || null,
          text(row, "Status") || "scheduled",
          text(row, "Note") || null,
          text(row, "Created By") || null,
          text(row, "Updated By") || null,
          dateValue(row["Created At"]),
          dateValue(row["Updated At"]),
        ],
      );
      interviewBySession.set(sessionId, {
        applicationId: linked.applicationId,
        interviewId: id,
      });
      stats.interviews += 1;
    }
  }

  const assignmentByLegacyId = new Map();
  const assignmentSheet = workbook.getWorksheet("Portal_PhanCong");
  if (assignmentSheet) {
    for (const { row, rowNumber } of worksheetRows(assignmentSheet)) {
      const assignmentLegacyId =
        text(row, "Assignment ID") || `assignment-row-${rowNumber}`;
      const sessionId = text(row, "Session ID");
      let linkedSession = interviewBySession.get(sessionId);
      if (!linkedSession) {
        const linked = await ensureApplication(
          client,
          applicationByCandidateCode,
          text(row, "Candidate Code"),
          "",
          "",
        );
        const interviewId = stableId(
          "rec_interview",
          sessionId || `assignment-${rowNumber}`,
        );
        await client.query(
          `
            INSERT INTO "RecruitmentInterview" (
              "id", "applicationId", "roundKey", "roundLabel", "status", "updatedAt"
            )
            VALUES ($1, $2, $3, $4, 'imported', NOW())
            ON CONFLICT ("id") DO NOTHING
          `,
          [
            interviewId,
            linked.applicationId,
            text(row, "Round Key") || "round-1",
            text(row, "Round Key") || "Vòng phỏng vấn",
          ],
        );
        linkedSession = {
          applicationId: linked.applicationId,
          interviewId,
        };
      }
      const id = stableId("rec_assignment", assignmentLegacyId);
      await client.query(
        `
          INSERT INTO "RecruitmentAssignment" (
            "id", "interviewId", "applicationId", "roundKey",
            "reviewerEmployeeId", "reviewerName", "roleKey", "roleLabel",
            "status", "createdAt", "updatedAt"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            COALESCE($10, NOW()), COALESCE($11, NOW())
          )
          ON CONFLICT ("id") DO UPDATE SET
            "interviewId" = EXCLUDED."interviewId",
            "applicationId" = EXCLUDED."applicationId",
            "roundKey" = EXCLUDED."roundKey",
            "reviewerEmployeeId" = EXCLUDED."reviewerEmployeeId",
            "reviewerName" = EXCLUDED."reviewerName",
            "roleKey" = EXCLUDED."roleKey",
            "roleLabel" = EXCLUDED."roleLabel",
            "status" = EXCLUDED."status",
            "updatedAt" = EXCLUDED."updatedAt"
        `,
        [
          id,
          linkedSession.interviewId,
          linkedSession.applicationId,
          text(row, "Round Key") || "round-1",
          text(row, "Reviewer Employee ID") || null,
          text(row, "Reviewer Name") || "Chưa xác định",
          text(row, "Role Key") || "reviewer",
          text(row, "Role Label") || "Người đánh giá",
          text(row, "Status") || "assigned",
          dateValue(row["Created At"]),
          dateValue(row["Updated At"]),
        ],
      );
      assignmentByLegacyId.set(assignmentLegacyId, {
        applicationId: linkedSession.applicationId,
        assignmentId: id,
        interviewId: linkedSession.interviewId,
      });
      stats.assignments += 1;
    }
  }

  const scorecardByLegacyId = new Map();
  const scorecardSheet = workbook.getWorksheet("Portal_PhieuCham");
  if (scorecardSheet) {
    for (const { row, rowNumber } of worksheetRows(scorecardSheet)) {
      const legacyId = text(row, "Scorecard ID") || `scorecard-row-${rowNumber}`;
      const assignmentLegacyId = text(row, "Assignment ID");
      let linked = assignmentByLegacyId.get(assignmentLegacyId);
      if (!linked) {
        const application = await ensureApplication(
          client,
          applicationByCandidateCode,
          text(row, "Candidate Code"),
          text(row, "Candidate Name"),
          text(row, "Position"),
        );
        linked = {
          applicationId: application.applicationId,
          assignmentId: null,
          interviewId: interviewBySession.get(text(row, "Session ID"))
            ?.interviewId,
        };
      }
      const id = stableId("rec_scorecard", legacyId);
      await client.query(
        `
          INSERT INTO "RecruitmentScorecard" (
            "id", "interviewId", "assignmentId", "applicationId",
            "roundKey", "roundLabel", "reviewerEmployeeId", "reviewerName",
            "roleKey", "roleLabel", "scoringMode", "status", "finalScore",
            "decision", "overallComment", "criteriaSetId", "criteriaSetName",
            "jdPosition", "version", "editRevision", "submittedAt",
            "createdAt", "updatedAt"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20, $21,
            COALESCE($22, NOW()), COALESCE($23, NOW())
          )
          ON CONFLICT ("id") DO UPDATE SET
            "interviewId" = EXCLUDED."interviewId",
            "assignmentId" = EXCLUDED."assignmentId",
            "applicationId" = EXCLUDED."applicationId",
            "roundKey" = EXCLUDED."roundKey",
            "roundLabel" = EXCLUDED."roundLabel",
            "reviewerEmployeeId" = EXCLUDED."reviewerEmployeeId",
            "reviewerName" = EXCLUDED."reviewerName",
            "roleKey" = EXCLUDED."roleKey",
            "roleLabel" = EXCLUDED."roleLabel",
            "scoringMode" = EXCLUDED."scoringMode",
            "status" = EXCLUDED."status",
            "finalScore" = EXCLUDED."finalScore",
            "decision" = EXCLUDED."decision",
            "overallComment" = EXCLUDED."overallComment",
            "criteriaSetId" = EXCLUDED."criteriaSetId",
            "criteriaSetName" = EXCLUDED."criteriaSetName",
            "jdPosition" = EXCLUDED."jdPosition",
            "version" = EXCLUDED."version",
            "editRevision" = EXCLUDED."editRevision",
            "submittedAt" = EXCLUDED."submittedAt",
            "updatedAt" = EXCLUDED."updatedAt"
        `,
        [
          id,
          linked.interviewId || null,
          linked.assignmentId || null,
          linked.applicationId,
          text(row, "Round Key") || "round-1",
          text(row, "Round Label") || "Vòng phỏng vấn",
          text(row, "Reviewer Employee ID") || null,
          text(row, "Reviewer Name") || null,
          text(row, "Role Key") || null,
          text(row, "Role Label") || null,
          text(row, "Scoring Mode") || null,
          text(row, "Status") || "draft",
          Number.parseFloat(text(row, "Final Score")) || null,
          text(row, "Decision") || null,
          text(row, "Overall Comment") || null,
          text(row, "Criteria Set ID") || null,
          text(row, "Criteria Set Name") || null,
          text(row, "JD Position") || null,
          integer(row, "Version") || 1,
          integer(row, "Edit Revision") || 0,
          dateValue(row["Submitted At"]),
          dateValue(row["Created At"]),
          dateValue(row["Updated At"]),
        ],
      );
      scorecardByLegacyId.set(legacyId, id);
      stats.scorecards += 1;
    }
  }

  const itemSheet = workbook.getWorksheet("Portal_DiemCham");
  if (itemSheet) {
    for (const { row, rowNumber } of worksheetRows(itemSheet)) {
      const legacyScorecardId = text(row, "Scorecard ID");
      const scorecardId = scorecardByLegacyId.get(legacyScorecardId);
      if (!scorecardId) continue;
      const id = stableId(
        "rec_scoreitem",
        `${legacyScorecardId}|${text(row, "Item Key")}|${rowNumber}`,
      );
      await client.query(
        `
          INSERT INTO "RecruitmentScoreItem" (
            "id", "scorecardId", "sectionKey", "groupKey", "groupName",
            "itemKey", "itemName", "criterionId", "criterionName", "weight",
            "score", "note", "evidence", "level", "bonusTechnical",
            "bonusLearning", "meta", "updatedAt"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17::jsonb, NOW()
          )
          ON CONFLICT ("id") DO UPDATE SET
            "sectionKey" = EXCLUDED."sectionKey",
            "groupKey" = EXCLUDED."groupKey",
            "groupName" = EXCLUDED."groupName",
            "itemKey" = EXCLUDED."itemKey",
            "itemName" = EXCLUDED."itemName",
            "criterionId" = EXCLUDED."criterionId",
            "criterionName" = EXCLUDED."criterionName",
            "weight" = EXCLUDED."weight",
            "score" = EXCLUDED."score",
            "note" = EXCLUDED."note",
            "evidence" = EXCLUDED."evidence",
            "level" = EXCLUDED."level",
            "bonusTechnical" = EXCLUDED."bonusTechnical",
            "bonusLearning" = EXCLUDED."bonusLearning",
            "meta" = EXCLUDED."meta",
            "updatedAt" = NOW()
        `,
        [
          id,
          scorecardId,
          text(row, "Section Key") || null,
          text(row, "Group Key") || null,
          text(row, "Group Name") || null,
          text(row, "Item Key") || null,
          text(row, "Item Name") || null,
          text(row, "Criterion ID") || null,
          text(row, "Criterion Name") || null,
          Number.parseFloat(text(row, "Weight")) || null,
          Number.parseFloat(text(row, "Score")) || null,
          text(row, "Note") || null,
          text(row, "Evidence") || null,
          integer(row, "Level"),
          booleanValue(row["Bonus Technical"]),
          booleanValue(row["Bonus Learning"]),
          JSON.stringify(jsonValue(row["Meta JSON"])),
        ],
      );
      stats.scoreItems += 1;
    }
  }

  const timelineSheet = workbook.getWorksheet("Portal_NhatKy");
  if (timelineSheet) {
    for (const { row, rowNumber } of worksheetRows(timelineSheet)) {
      const linked = await ensureApplication(
        client,
        applicationByCandidateCode,
        text(row, "Candidate Code"),
        text(row, "Candidate Name"),
        "",
      );
      const eventId = text(row, "Event ID") || `timeline-row-${rowNumber}`;
      await client.query(
        `
          INSERT INTO "RecruitmentTimeline" (
            "id", "applicationId", "eventType", "fromValue", "toValue",
            "title", "detail", "actorEmployeeId", "actorName", "createdAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()))
          ON CONFLICT ("id") DO UPDATE SET
            "eventType" = EXCLUDED."eventType",
            "fromValue" = EXCLUDED."fromValue",
            "toValue" = EXCLUDED."toValue",
            "title" = EXCLUDED."title",
            "detail" = EXCLUDED."detail",
            "actorEmployeeId" = EXCLUDED."actorEmployeeId",
            "actorName" = EXCLUDED."actorName",
            "createdAt" = EXCLUDED."createdAt"
        `,
        [
          stableId("rec_timeline", eventId),
          linked.applicationId,
          text(row, "Event Type") || "legacy",
          text(row, "From Value") || null,
          text(row, "To Value") || null,
          text(row, "Title") || "Cập nhật tuyển dụng",
          text(row, "Detail") || null,
          text(row, "Actor Employee ID") || null,
          text(row, "Actor Name") || null,
          dateValue(row["Created At"]),
        ],
      );
      stats.timeline += 1;
    }
  }

  const publicationSheet = workbook.getWorksheet("Portal_CongBo");
  if (publicationSheet) {
    for (const { row, rowNumber } of worksheetRows(publicationSheet)) {
      const linked = await ensureApplication(
        client,
        applicationByCandidateCode,
        text(row, "Candidate Code"),
        text(row, "Candidate Name"),
        text(row, "Position"),
      );
      const publicationId =
        text(row, "Publication ID") || `publication-row-${rowNumber}`;
      const accessToken =
        text(row, "Access Token") || stableId("published", publicationId);
      await client.query(
        `
          INSERT INTO "RecruitmentPublication" (
            "id", "applicationId", "accessToken", "status", "publicStatus",
            "summary", "strengths", "development", "publishedScore",
            "roundVersions", "publishedAt", "publishedByName", "expiresAt",
            "updatedAt"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, NOW()
          )
          ON CONFLICT ("applicationId") DO UPDATE SET
            "accessToken" = EXCLUDED."accessToken",
            "status" = EXCLUDED."status",
            "publicStatus" = EXCLUDED."publicStatus",
            "summary" = EXCLUDED."summary",
            "strengths" = EXCLUDED."strengths",
            "development" = EXCLUDED."development",
            "publishedScore" = EXCLUDED."publishedScore",
            "roundVersions" = EXCLUDED."roundVersions",
            "publishedAt" = EXCLUDED."publishedAt",
            "publishedByName" = EXCLUDED."publishedByName",
            "expiresAt" = EXCLUDED."expiresAt",
            "updatedAt" = NOW()
        `,
        [
          stableId("rec_publication", publicationId),
          linked.applicationId,
          accessToken,
          text(row, "Status") || "draft",
          text(row, "Public Status") || null,
          text(row, "Summary") || null,
          text(row, "Strengths") || null,
          text(row, "Development") || null,
          Number.parseFloat(text(row, "Published Score")) || null,
          JSON.stringify(jsonValue(row["Round Versions JSON"])),
          dateValue(row["Published At"]),
          text(row, "Published By") || null,
          dateValue(row["Expires At"]),
        ],
      );
      stats.publications += 1;
    }
  }

  const snapshotSources = [
    ["Portal_DanhGia", "assessment", "Candidate Code", "Candidate Name", "Position"],
    ["SoVan_Logs", "so-van", "Mã phỏng vấn", "", ""],
    ["HEXACO_Logs", "hexaco", "Mã phỏng vấn", "", ""],
    ["Kết quả Ứng viên", "candidate-result", "Mã Phỏng vấn", "", ""],
  ];
  for (const [
    sheetName,
    kind,
    codeHeader,
    nameHeader,
    positionHeader,
  ] of snapshotSources) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;
    for (const { row, rowNumber } of worksheetRows(worksheet)) {
      const candidateCode = text(row, codeHeader);
      if (!candidateCode) continue;
      const linked = await ensureApplication(
        client,
        applicationByCandidateCode,
        candidateCode,
        nameHeader ? text(row, nameHeader) : "",
        positionHeader ? text(row, positionHeader) : "",
      );
      await client.query(
        `
          INSERT INTO "RecruitmentLegacySnapshot" (
            "id", "applicationId", "kind", "sourceSheet", "sourceRow",
            "payload", "sourceUpdatedAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          stableId("rec_snapshot", `${sheetName}|${rowNumber}`),
          linked.applicationId,
          kind,
          sheetName,
          rowNumber,
          JSON.stringify(jsonReady(row)),
          dateValue(
            row["Updated At"] ||
              row["SV_Updated_At"] ||
              row["Dấu thời gian"],
          ),
        ],
      );
      stats.snapshots += 1;
    }
  }
}

async function main() {
  if (!["all", "evaluation", "configuration", "recruitment"].includes(ONLY)) {
    throw new Error("--only hợp lệ: evaluation | configuration | recruitment | all.");
  }
  if (INSERT_MISSING_ONLY && ONLY !== "evaluation") {
    throw new Error("--insert-missing-only chỉ dùng cùng --only=evaluation.");
  }
  if (GOOGLE_SHEET_ID && ONLY !== "evaluation") {
    throw new Error("--google-sheet-id hiện chỉ dùng cùng --only=evaluation.");
  }
  const needsMain = ONLY === "all" || ONLY === "evaluation" || ONLY === "configuration";
  const needsRecruitment = ONLY === "all" || ONLY === "recruitment";
  const [mainWorkbook, recruitmentWorkbook, resultsWorkbook] = await Promise.all([
    needsMain
      ? (GOOGLE_SHEET_ID
        ? loadEvaluationWorkbookFromGoogle(GOOGLE_SHEET_ID)
        : loadWorkbook(MAIN_FILE))
      : Promise.resolve(null),
    needsRecruitment ? loadWorkbook(RECRUITMENT_FILE) : Promise.resolve(null),
    needsRecruitment ? loadWorkbook(RESULTS_FILE) : Promise.resolve(null),
  ]);

  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 2 });
  const client = await pool.connect();
  const stats = {
    applications: 0,
    assignments: 0,
    campaigns: 0,
    configRecords: 0,
    configuration: 0,
    evaluation: 0,
    evaluationImported: 0,
    intake: 0,
    interviews: 0,
    journeys: 0,
    offers: 0,
    publications: 0,
    requisitions: 0,
    scoreItems: 0,
    scorecards: 0,
    snapshots: 0,
    sources: 0,
    timeline: 0,
  };

  try {
    await client.query("BEGIN");
    if (ONLY === "all" || ONLY === "evaluation") {
      await importEvaluation(client, mainWorkbook, stats);
    }
    if (ONLY === "all" || ONLY === "configuration") {
      await importConfigurationRecords(client, mainWorkbook, stats);
    }
    if (ONLY === "evaluation" || ONLY === "configuration") {
      await client.query(DRY_RUN ? "ROLLBACK" : "COMMIT");
      console.log(
        `${DRY_RUN ? "Preview" : "Import"} ${ONLY} completed.`,
      );
      console.table(stats);
      return;
    }
    await importRecruitmentSources(client, recruitmentWorkbook, stats);
    const campaignMaps = await importCampaigns(
      client,
      recruitmentWorkbook,
      stats,
    );
    await importRequisitions(client, recruitmentWorkbook, stats);
    await importConfigRecords(client, recruitmentWorkbook, stats);
    const applicationByCandidateCode = new Map();
    const existingApplications = await client.query(
      `
        SELECT "id" AS "applicationId", "candidateId", "candidateCode"
        FROM "RecruitmentApplication"
        WHERE "candidateCode" IS NOT NULL
        ORDER BY "createdAt" ASC
      `,
    );
    for (const row of existingApplications.rows) {
      if (!applicationByCandidateCode.has(row.candidateCode)) {
        applicationByCandidateCode.set(row.candidateCode, row);
      }
    }
    await importTracking(
      client,
      recruitmentWorkbook,
      campaignMaps,
      stats,
      applicationByCandidateCode,
    );
    await importIntake(client, recruitmentWorkbook, stats);
    if (process.env.IMPORT_RECRUITMENT_OFFERS === "true") {
      await importOffers(
        client,
        recruitmentWorkbook,
        stats,
        applicationByCandidateCode,
      );
    }
    await importPortalData(
      client,
      resultsWorkbook,
      stats,
      applicationByCandidateCode,
    );
    await client.query(DRY_RUN ? "ROLLBACK" : "COMMIT");
    console.log(
      `${DRY_RUN ? "Preview" : "Import"} evaluation/recruitment completed.`,
    );
    console.table(stats);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
