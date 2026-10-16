import { getDb } from "../src/lib/db.ts";
import { getFieldByKey } from "../src/lib/personnel.ts";
import { readSheet } from "../src/lib/personnel-sheet.ts";
import { readFileSync } from "node:fs";

function cell(row, headers, column) {
  const index = headers.indexOf(column);
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function resolve(row, headers, mappings, key) {
  const definition = getFieldByKey(key);
  const mapping = mappings[key];
  if (definition?.allowMultiple) {
    const columns = Array.isArray(mapping) ? mapping : mapping ? [mapping] : [];
    return columns
      .map((column) => cell(row, headers, column))
      .filter(Boolean)
      .join(definition.joinSeparator || " ")
      .trim();
  }
  const column = Array.isArray(mapping) ? mapping[0] : mapping;
  return column ? cell(row, headers, column) : "";
}

const db = getDb();

const legacySources = [
  {
    company: "Nệm Thành Công",
    headerRow: 7,
    mappings: {
      employeeId: "Mã số NV",
      terminationDate: "Ngày nghỉ việc",
      title: "Vị trí công việc",
    },
    sheetName: "Data nhân viên",
    spreadsheetId: "1IRsdZHChTEaIuxxXN7syRUNWgyNahajALU1c3ZQaVhU",
  },
  {
    company: "Thuần Việt Global",
    headerRow: 1,
    mappings: {
      employeeId: "Mã nhân viên",
      terminationDate: "Ngày nghỉ việc",
      title: "Chức danh",
    },
    sheetName: "Data update HRM",
    spreadsheetId: "1knzrSE1fL9TCOfm0PjoyVLQMVRb10sw2qskPdFq3Zco",
  },
];

async function readGoogleSheetWithAccessToken(source, accessToken) {
  const sheetRange = `'${source.sheetName.replaceAll("'", "''")}'!A:ZZ`;
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${source.spreadsheetId}/values/${encodeURIComponent(sheetRange)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Không đọc được nguồn ${source.company}: HTTP ${response.status}.`,
    );
  }
  const payload = await response.json();
  const values = payload.values || [];
  return {
    headerRowIndex: source.headerRow,
    headers: (values[source.headerRow - 1] || []).map((value) => String(value).trim()),
    rows: values.slice(source.headerRow),
  };
}

async function auditLegacySources(inputBySpreadsheetId = new Map()) {
  const accessToken = String(process.env.GOOGLE_SHEETS_ACCESS_TOKEN || "").trim();
  if (!accessToken && !inputBySpreadsheetId.size) return [];
  const employees = await db.employee.findMany({
    select: { employeeCode: true, fullName: true, title: true },
    where: { archivedAt: null },
  });
  const employeeByCode = new Map(employees.map((employee) => [employee.employeeCode, employee]));
  const reports = [];

  for (const source of legacySources) {
    const inputValues = inputBySpreadsheetId.get(source.spreadsheetId);
    const read = inputValues
      ? {
          headerRowIndex: source.headerRow,
          headers: (inputValues[source.headerRow - 1] || []).map((value) =>
            String(value).trim(),
          ),
          rows: inputValues.slice(source.headerRow),
        }
      : await readGoogleSheetWithAccessToken(source, accessToken);
    const employeeCodeIndex = read.headers.indexOf(source.mappings.employeeId);
    const titleIndex = read.headers.indexOf(source.mappings.title);
    const terminationIndex = read.headers.indexOf(source.mappings.terminationDate);
    const latestActiveRowByCode = new Map();
    const duplicateCodes = new Set();

    for (const row of read.rows) {
      const employeeCode = String(row[employeeCodeIndex] || "").trim();
      const terminationDate = String(row[terminationIndex] || "").trim();
      if (!employeeCode || terminationDate) continue;
      if (latestActiveRowByCode.has(employeeCode)) duplicateCodes.add(employeeCode);
      latestActiveRowByCode.set(employeeCode, row);
    }

    const mismatches = [];
    let missingEmployees = 0;
    for (const [employeeCode, row] of latestActiveRowByCode) {
      const employee = employeeByCode.get(employeeCode);
      if (!employee) {
        missingEmployees += 1;
        continue;
      }
      const sourceTitle = String(row[titleIndex] || "").trim();
      if ((employee.title || "") !== sourceTitle) {
        mismatches.push({
          databaseTitle: employee.title || "",
          employeeCode,
          fullName: employee.fullName,
          sourceTitle,
        });
      }
    }

    reports.push({
      activeSourceEmployees: latestActiveRowByCode.size,
      company: source.company,
      duplicateCodes: [...duplicateCodes],
      mappingsFound: {
        employeeId: employeeCodeIndex >= 0,
        terminationDate: terminationIndex >= 0,
        title: titleIndex >= 0,
      },
      mismatchCount: mismatches.length,
      mismatchSamples: mismatches.slice(0, 50),
      missingEmployees,
      sourceRows: read.rows.length,
    });
  }

  return reports;
}

function readLegacyPayloadFromStdin() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    return new Map(
      (Array.isArray(parsed) ? parsed : []).map((item) => [
        String(item.spreadsheetId || ""),
        Array.isArray(item.values) ? item.values : [],
      ]),
    );
  } catch {
    return new Map();
  }
}

try {
  const sources = await db.personnelSource.findMany({
    include: { company: { select: { code: true, legalName: true } } },
    orderBy: { company: { code: "asc" } },
  });
  const reports = [];

  for (const source of sources) {
    const mappings = source.mappings || {};
    const read = await readSheet(source.apiLink, source.sheetName, source.headerRow);
    const employees = await db.employee.findMany({
      select: { employeeCode: true, title: true },
      where: { companyId: source.companyId, archivedAt: null },
    });
    const employeeByCode = new Map(employees.map((employee) => [employee.employeeCode, employee]));
    const sourceCodes = new Set();
    const duplicateCodes = new Set();
    const mismatches = [];
    let blankSourceTitles = 0;
    let missingEmployees = 0;

    for (const row of read.rows) {
      const employeeCode = resolve(row, read.headers, mappings, "employeeId");
      if (!employeeCode) continue;
      if (sourceCodes.has(employeeCode)) duplicateCodes.add(employeeCode);
      sourceCodes.add(employeeCode);
      const sourceTitle = resolve(row, read.headers, mappings, "title");
      if (!sourceTitle) blankSourceTitles += 1;
      const employee = employeeByCode.get(employeeCode);
      if (!employee) {
        missingEmployees += 1;
        continue;
      }
      if ((employee.title || "") !== sourceTitle) {
        mismatches.push({
          databaseTitle: employee.title || "",
          employeeCode,
          sourceTitle,
        });
      }
    }

    const recentRuns = await db.migrationRun.findMany({
      orderBy: { startedAt: "desc" },
      select: {
        issues: {
          select: { code: true, externalId: true, message: true },
          take: 5,
        },
        rowsCreated: true,
        rowsFailed: true,
        rowsRead: true,
        rowsSkipped: true,
        rowsUpdated: true,
        startedAt: true,
        status: true,
        summary: true,
      },
      take: 3,
      where: { source: { key: `personnel:${source.id}` } },
    });

    reports.push({
      blankSourceTitles,
      company: `${source.company.code} · ${source.company.legalName}`,
      databaseEmployees: employees.length,
      duplicateCodes: [...duplicateCodes].slice(0, 20),
      headerRow: source.headerRow,
      lastSyncCount: source.lastSyncCount,
      lastSyncMessage: source.lastSyncMessage,
      lastSyncedAt: source.lastSyncedAt,
      mappings: {
        employeeId: mappings.employeeId || null,
        title: mappings.title || null,
      },
      mismatchCount: mismatches.length,
      mismatchSamples: mismatches.slice(0, 20),
      missingEmployees,
      recentRuns,
      sheetName: source.sheetName,
      sourceRows: read.rows.length,
      status: source.status,
      syncMode: source.syncMode,
    });
  }

  const legacyReports = sources.length
    ? []
    : await auditLegacySources(readLegacyPayloadFromStdin());
  console.log(JSON.stringify({ legacyReports, reports }, null, 2));
} finally {
  await db.$disconnect();
}
