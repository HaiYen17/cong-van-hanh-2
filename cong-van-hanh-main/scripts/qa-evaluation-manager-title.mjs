import { getDb } from "../src/lib/db.ts";

const SPREADSHEET_ID = "1vlFuJnoaY8OPMXLEMNYZGkDN_YOPtW7b0joZMcpULmM";
const SHEET_GID = "1845182427";

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addToDirectory(directory, value, employee) {
  const key = normalize(value);
  if (!key) return;
  const matches = directory.get(key) || [];
  matches.push(employee);
  directory.set(key, matches);
}

function matchesFor(value, directory) {
  return String(value || "")
    .split(/[;,|\n]+/)
    .map(normalize)
    .filter(Boolean)
    .flatMap((key) => directory.get(key) || []);
}

const token = String(process.env.EVAL_SHEET_TOKEN || "").trim();
if (!token) throw new Error("Thiếu EVAL_SHEET_TOKEN cho bài test đọc Google Sheet.");

const authorization = { Authorization: `Bearer ${token}` };
const metadataResponse = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(sheetId,title))`,
  { headers: authorization },
);
if (!metadataResponse.ok) {
  throw new Error(`Không đọc được metadata Google Sheet: ${metadataResponse.status}`);
}
const metadata = await metadataResponse.json();
const sheetName = (metadata.sheets || []).find(
  (sheet) => String(sheet.properties?.sheetId) === SHEET_GID,
)?.properties?.title;
if (!sheetName) throw new Error("Không tìm thấy sheet theo gid đã cấu hình.");

const escapedSheetName = sheetName.replace(/'/g, "''");
const valuesResponse = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${escapedSheetName}'!A:ZZ`)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
  { headers: authorization },
);
if (!valuesResponse.ok) {
  throw new Error(`Không đọc được dữ liệu Google Sheet: ${valuesResponse.status}`);
}
const values = (await valuesResponse.json()).values || [];
const headers = values[0] || [];
const managerIndex = headers.indexOf("Quản lý trực tiếp");
if (managerIndex === -1) throw new Error("Sheet không có header Quản lý trực tiếp.");

const prisma = getDb();
try {
  const employees = await prisma.employee.findMany({
    select: {
      employeeCode: true,
      email: true,
      fullName: true,
      title: true,
    },
    where: { archivedAt: null, status: "ACTIVE" },
  });
  const identityDirectory = new Map();
  const titleDirectory = new Map();
  employees.forEach((employee) => {
    addToDirectory(identityDirectory, employee.employeeCode, employee);
    addToDirectory(identityDirectory, employee.email, employee);
    addToDirectory(identityDirectory, employee.fullName, employee);
    addToDirectory(titleDirectory, employee.title, employee);
  });

  const managerCells = values
    .slice(1)
    .map((row) => String(row[managerIndex] || "").trim())
    .filter(Boolean);
  let beforeResolved = 0;
  let afterResolved = 0;
  let ambiguous = 0;
  let unresolved = 0;
  managerCells.forEach((value) => {
    const identityMatches = matchesFor(value, identityDirectory);
    const titleMatches = matchesFor(value, titleDirectory);
    if (identityMatches.length === 1) beforeResolved += 1;
    const resolvedMatches = identityMatches.length ? identityMatches : titleMatches;
    if (resolvedMatches.length === 1) afterResolved += 1;
    else if (resolvedMatches.length > 1) ambiguous += 1;
    else unresolved += 1;
  });

  console.log(
    JSON.stringify(
      {
        afterResolved,
        ambiguous,
        beforeResolved,
        managerCells: managerCells.length,
        rows: Math.max(0, values.length - 1),
        sheetName,
        unresolved,
        warehouseManagerTitleMatches:
          titleDirectory.get(normalize("Trưởng phòng Kho vận"))?.length || 0,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
