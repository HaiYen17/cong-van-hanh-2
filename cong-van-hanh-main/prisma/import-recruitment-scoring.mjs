import "dotenv/config";

import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

import ExcelJS from "exceljs";
import pg from "pg";

const { Pool } = pg;
const SOURCE_FILE =
  process.argv[2] || path.resolve("prisma/import-cache/scoring.xlsx");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function stableId(value) {
  return `rec_cfg_${createHash("sha1").update(String(value)).digest("hex")}`;
}

function valueOf(cell) {
  const value = cell.value;
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if ("result" in value && value.result != null) return value.result;
  if ("text" in value && value.text != null) return value.text;
  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || "").join("");
  }
  return cell.text || null;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rowByHeaders(worksheet, rowNumber, headerRow = 1) {
  const row = {};
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const header = clean(valueOf(worksheet.getCell(headerRow, column)));
    if (!header || row[header] !== undefined) continue;
    row[header] = valueOf(worksheet.getCell(rowNumber, column));
  }
  return row;
}

function rowByColumn(worksheet, rowNumber) {
  const row = {};
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const value = valueOf(worksheet.getCell(rowNumber, column));
    if (clean(value)) row[`column_${column}`] = value;
  }
  return row;
}

function hasContent(row) {
  return Object.values(row).some((value) => clean(value));
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function batchUpsert(client, records) {
  const columns = [
    "id",
    "recordType",
    "code",
    "name",
    "status",
    "sourceSheet",
    "sourceRow",
    "content",
    "updatedAt",
  ];
  const updateColumns = [
    "recordType",
    "code",
    "name",
    "status",
    "content",
    "updatedAt",
  ];
  for (let offset = 0; offset < records.length; offset += 200) {
    const batch = records.slice(offset, offset + 200);
    const values = [];
    const tuples = batch.map((record) => {
      const placeholders = columns.map((column) => {
        values.push(record[column] ?? null);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `
        INSERT INTO "RecruitmentConfigRecord"
          (${columns.map(quoteIdentifier).join(", ")})
        VALUES ${tuples.join(", ")}
        ON CONFLICT ("sourceSheet", "sourceRow") DO UPDATE SET
          ${updateColumns
            .map(
              (column) =>
                `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`,
            )
            .join(", ")}
      `,
      values,
    );
  }
}

function makeRecord({
  code = null,
  content,
  name = null,
  recordType,
  sourceRow,
  sourceSheet,
  status = "ACTIVE",
}) {
  return {
    code,
    content: JSON.stringify(content),
    id: stableId(`${sourceSheet}|${sourceRow}`),
    name,
    recordType,
    sourceRow,
    sourceSheet,
    status,
    updatedAt: new Date(),
  };
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(SOURCE_FILE);
  const records = [];
  const stats = {};

  const configSheet = workbook.getWorksheet("Config");
  if (configSheet) {
    for (let rowNumber = 2; rowNumber <= configSheet.rowCount; rowNumber += 1) {
      const row = rowByHeaders(configSheet, rowNumber);
      const code = clean(row.Key);
      if (!code) continue;
      records.push(
        makeRecord({
          code,
          content: row,
          name: code,
          recordType: "scoring-config",
          sourceRow: rowNumber,
          sourceSheet: configSheet.name,
        }),
      );
      stats.config = (stats.config || 0) + 1;
    }
  }

  const jdFilesSheet = workbook.getWorksheet("JD_Files");
  if (jdFilesSheet) {
    for (
      let rowNumber = 2;
      rowNumber <= jdFilesSheet.rowCount;
      rowNumber += 1
    ) {
      const row = rowByHeaders(jdFilesSheet, rowNumber);
      const fileId = clean(row.FileId);
      const position = clean(row.Position);
      if (!fileId && !position) continue;
      records.push(
        makeRecord({
          code: fileId || clean(row.PositionKey) || `row-${rowNumber}`,
          content: row,
          name: position || clean(row.FileName),
          recordType: "scoring-jd-file",
          sourceRow: rowNumber,
          sourceSheet: jdFilesSheet.name,
        }),
      );
      stats.jdFiles = (stats.jdFiles || 0) + 1;
    }
  }

  const jdOutputSheet = workbook.getWorksheet("JD_Output");
  if (jdOutputSheet) {
    for (
      let rowNumber = 2;
      rowNumber <= jdOutputSheet.rowCount;
      rowNumber += 1
    ) {
      const row = rowByHeaders(jdOutputSheet, rowNumber);
      const output = clean(row.Output);
      if (!output) continue;
      records.push(
        makeRecord({
          code: `${clean(row.PositionKey) || "position"}:${rowNumber}`,
          content: row,
          name: clean(row.Group) || clean(row.Position),
          recordType: "scoring-jd-output",
          sourceRow: rowNumber,
          sourceSheet: jdOutputSheet.name,
        }),
      );
      stats.jdOutputs = (stats.jdOutputs || 0) + 1;
    }
  }

  const cultureSheet = workbook.getWorksheet("GT_UnderLine");
  if (cultureSheet) {
    const cultureValues = new Map();
    for (
      let rowNumber = 2;
      rowNumber <= cultureSheet.rowCount;
      rowNumber += 1
    ) {
      const row = rowByHeaders(cultureSheet, rowNumber);
      const gtKey = clean(row.GT_Code);
      const chipCode = clean(row.Chip_Code);
      const chipLabel = clean(row.Chip_Label);
      if (!gtKey || !chipCode || !chipLabel) continue;
      const value = cultureValues.get(gtKey) || {
        chips: [],
        gtKey,
        gtName: clean(row.GT_Name) || gtKey,
        order: Number(row.Order) || cultureValues.size + 1,
        sourceRow: rowNumber,
      };
      value.chips.push({
        code: chipCode,
        label: chipLabel,
        order: Number(row.Order) || value.chips.length + 1,
      });
      cultureValues.set(gtKey, value);
    }
    for (const value of cultureValues.values()) {
      value.chips.sort((left, right) => left.order - right.order);
      records.push(
        makeRecord({
          code: value.gtKey,
          content: value,
          name: value.gtName,
          recordType: "recruitment-culture-value",
          sourceRow: value.sourceRow,
          sourceSheet: cultureSheet.name,
        }),
      );
      stats.cultureValues = (stats.cultureValues || 0) + 1;
    }
  }

  const personalityBaseSheet =
    workbook.getWorksheet("Cơ sở Test tính cách") || workbook.worksheets.at(-2);
  if (personalityBaseSheet) {
    for (
      let rowNumber = 2;
      rowNumber <= personalityBaseSheet.rowCount;
      rowNumber += 1
    ) {
      const row = rowByColumn(personalityBaseSheet, rowNumber);
      if (!hasContent(row)) continue;
      const name =
        clean(row.column_2) || clean(row.column_3) || `Dòng ${rowNumber}`;
      records.push(
        makeRecord({
          code: `personality-row-${rowNumber}`,
          content: row,
          name,
          recordType: "scoring-personality-base",
          sourceRow: rowNumber,
          sourceSheet: personalityBaseSheet.name,
        }),
      );
      stats.personalityBase = (stats.personalityBase || 0) + 1;
    }
  }

  const personalityProfileSheet =
    workbook.getWorksheet("Màu tính cách") || workbook.worksheets.at(-1);
  if (personalityProfileSheet) {
    for (
      let rowNumber = 3;
      rowNumber <= personalityProfileSheet.rowCount;
      rowNumber += 1
    ) {
      const row = rowByHeaders(personalityProfileSheet, rowNumber, 2);
      const name = clean(row["Tên nhóm"]);
      const code = clean(row["Code dò"]);
      if (!name && !code) continue;
      records.push(
        makeRecord({
          code: code || `profile-row-${rowNumber}`,
          content: row,
          name: name || code,
          recordType: "scoring-personality-profile",
          sourceRow: rowNumber,
          sourceSheet: personalityProfileSheet.name,
        }),
      );
      stats.personalityProfiles = (stats.personalityProfiles || 0) + 1;
    }
  }

  for (const sheetName of ["JD_Skipped", "JD_Errors"]) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) continue;
    records.push(
      makeRecord({
        code: sheetName,
        content: {
          columnCount: worksheet.columnCount,
          detailImported: false,
          note:
            "Chỉ lưu thống kê. Log lỗi khối lượng lớn không được đưa vào bảng nghiệp vụ lõi.",
          rowCount: Math.max(worksheet.rowCount - 1, 0),
        },
        name: `Thống kê ${sheetName}`,
        recordType: "scoring-log-summary",
        sourceRow: 0,
        sourceSheet: sheetName,
      }),
    );
    stats.logSummaries = (stats.logSummaries || 0) + 1;
  }

  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: 2,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await batchUpsert(client, records);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log("Recruitment scoring import completed.");
  console.table({ ...stats, total: records.length });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
