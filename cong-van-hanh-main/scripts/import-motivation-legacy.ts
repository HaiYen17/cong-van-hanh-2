import path from "node:path";

import ExcelJS, { type Row } from "exceljs";
import pg, { type PoolClient } from "pg";

const APPLY = process.argv.includes("--apply");
const INSERT_MISSING_ONLY = process.argv.includes("--insert-missing-only");
const GOOGLE_SHEET_ID = process.argv
  .find((value) => value.startsWith("--google-sheet-id="))
  ?.slice("--google-sheet-id=".length)
  .trim();
const SOURCE_PATH = path.resolve(
  process.cwd(),
  "prisma",
  "import-cache",
  "main.xlsx",
);

const EVENT_COLUMNS = {
  body: 8,
  bypassSnooze: 76,
  closePolicy: 68,
  createdAt: 6,
  displayChannel: 65,
  displayMode: 66,
  endAt: 14,
  id: 9,
  imageId: 1,
  imageIds: 19,
  imageUrl: 4,
  imageUrls: 20,
  kind: 10,
  level: 67,
  linkedTask: 79,
  location: 21,
  popupContentMode: 77,
  priority: 16,
  reactionSetId: 11,
  reminderTimes: 78,
  requireAck: 70,
  saveResponse: 15,
  startAt: 13,
  status: 5,
  targetCompanies: 73,
  targetDepartments: 74,
  targetEmployees: 75,
  targetScope: 72,
  targetUrl: 71,
  thumbnailId: 17,
  thumbnailUrl: 18,
  title: 2,
  updatedAt: 7,
  autoDismissMs: 69,
} as const;

type EventColumnName = keyof typeof EVENT_COLUMNS;

type LegacyReactionSet = {
  createdAt: Date;
  id: string;
  key: string;
  name: string;
  options: Array<{
    label: string;
    symbol: string;
    tone: string;
    value: string;
  }>;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  updatedAt: Date;
};

type LegacyEvent = {
  archivedAt: Date | null;
  autoDismissMs: number | null;
  body: string | null;
  bypassSnooze: boolean;
  closePolicy: string;
  createdAt: Date;
  displayChannel: string;
  displayMode: string;
  endAt: Date | null;
  id: string;
  imageId: string | null;
  imageIds: string[];
  imageUrl: string | null;
  imageUrls: string[];
  kind: "message" | "event" | "notice";
  level: string;
  linkedTask: unknown | null;
  location: string | null;
  popupContentMode: string;
  priority: number;
  reactionSetId: string | null;
  reminderTimes: string[];
  requireAck: boolean;
  saveResponse: boolean;
  startAt: Date | null;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  targetCompanies: string[];
  targetDepartments: string[];
  targetEmployees: string[];
  targetScope: string;
  targetUrl: string | null;
  thumbnailId: string | null;
  thumbnailUrl: string | null;
  title: string;
  updatedAt: Date;
};

function text(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const item = value as {
      hyperlink?: unknown;
      richText?: Array<{ text?: unknown }>;
      text?: unknown;
    };
    if (item.hyperlink) return String(item.hyperlink).trim();
    if (item.text) return String(item.text).trim();
    if (Array.isArray(item.richText)) {
      return item.richText.map((part) => String(part.text ?? "")).join("").trim();
    }
  }
  return String(value).trim();
}

function eventCell(row: Row, name: EventColumnName) {
  return row.getCell(EVENT_COLUMNS[name]).value;
}

function eventText(row: Row, name: EventColumnName) {
  return text(eventCell(row, name));
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value: string) {
  return normalize(value).replace(/\s+/g, "-") || "legacy";
}

function status(value: unknown): "ACTIVE" | "INACTIVE" | "ARCHIVED" {
  const normalized = normalize(value);
  if (normalized.includes("luu tru") || normalized.includes("archive")) {
    return "ARCHIVED";
  }
  if (
    normalized.includes("kich hoat") ||
    normalized === "active" ||
    normalized === "bat"
  ) {
    return "ACTIVE";
  }
  return "INACTIVE";
}

function bool(value: unknown) {
  const normalized = normalize(value);
  return ["co", "true", "1", "yes", "x", "bat"].includes(normalized);
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function date(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const parsed = new Date(excelEpoch + value * 86_400_000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jsonValue(value: unknown): unknown | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean);
  }
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(text).filter(Boolean);
    }
  } catch {
    // Nguồn V2 có cả JSON lẫn chuỗi phân cách bằng dấu phẩy / xuống dòng.
  }
  return raw
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function driveId(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match =
    raw.match(/\/d\/([A-Za-z0-9_-]+)/) ||
    raw.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(raw) ? raw : null;
}

function imageUrl(value: unknown, size = "w1600"): string | null {
  const raw = text(value);
  if (!raw) return null;
  const id = driveId(raw);
  if (id) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=${size}`;
  }
  return /^https?:\/\//i.test(raw) ? raw : null;
}

function imageList(value: unknown) {
  return stringList(value)
    .map((item) => imageUrl(item))
    .filter((item): item is string => Boolean(item));
}

function idList(value: unknown) {
  return stringList(value)
    .map((item) => driveId(item) ?? item)
    .filter(Boolean);
}

function kind(value: unknown): LegacyEvent["kind"] | null {
  const normalized = normalize(value);
  if (normalized === "message" || normalized.includes("thong diep")) {
    return "message";
  }
  if (normalized === "event" || normalized.includes("su kien")) {
    return "event";
  }
  if (normalized === "notice" || normalized.includes("thong bao")) {
    return "notice";
  }
  return null;
}

function timeList(value: unknown) {
  const direct = stringList(value);
  const result = direct
    .map((item) => {
      const timeMatch = item.match(/^(\d{1,2}):(\d{2})$/);
      if (timeMatch) {
        return `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
      }
      const parsed = date(item);
      if (!parsed) return null;
      return new Intl.DateTimeFormat("vi-VN", {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        timeZone: "Asia/Bangkok",
      }).format(parsed);
    })
    .filter((item): item is string => Boolean(item));
  return [...new Set(result)].sort();
}

function safeString(value: unknown, fallback: string) {
  return text(value) || fallback;
}

function parseReactionOptions(value: unknown): LegacyReactionSet["options"] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) return [];
  const tones = ["emerald", "amber", "teal", "coral", "plum", "sky"];
  return parsed
    .map((raw) => {
      const option = raw as Record<string, unknown>;
      const label = text(option.label);
      const optionValue = text(option.value) || label;
      const rawTone = normalize(option.tone);
      return {
        label,
        symbol: text(option.symbol),
        tone:
          tones.find((tone) => rawTone.includes(tone)) ??
          tones[0],
        value: optionValue,
      };
    })
    .filter((option) => option.label && option.value);
}

async function readLegacyData() {
  const workbook = await loadLegacyWorkbook();

  const reactionSheet = workbook.worksheets.find((sheet) =>
    sheet.name.startsWith("08_"),
  );
  const eventSheet = workbook.worksheets.find((sheet) =>
    sheet.name.startsWith("09_"),
  );
  if (!reactionSheet || !eventSheet) {
    throw new Error("Không tìm thấy sheet 08_Bộ Tag hoặc 09_Cấu hình nền.");
  }

  const now = new Date();
  const reactionSets: LegacyReactionSet[] = [];
  for (let rowNumber = 2; rowNumber <= reactionSheet.rowCount; rowNumber += 1) {
    const row = reactionSheet.getRow(rowNumber);
    const id = text(row.getCell(1).value);
    const name = text(row.getCell(2).value);
    const options = parseReactionOptions(row.getCell(3).value);
    const recordType = normalize(row.getCell(8).value);
    if (!id || !name || !options.length || recordType === "support tool tag") {
      continue;
    }
    reactionSets.push({
      createdAt: date(row.getCell(5).value) ?? now,
      id,
      key: `legacy-${slug(name)}-${id.slice(0, 8)}`,
      name,
      options,
      status: status(row.getCell(4).value),
      updatedAt: date(row.getCell(6).value) ?? now,
    });
  }

  const events: LegacyEvent[] = [];
  for (let rowNumber = 2; rowNumber <= eventSheet.rowCount; rowNumber += 1) {
    const row = eventSheet.getRow(rowNumber);
    const eventKind = kind(eventCell(row, "kind"));
    const id = eventText(row, "id");
    const title = eventText(row, "title");
    if (!eventKind || !id || !title) continue;

    const eventStatus = status(eventCell(row, "status"));
    const mainImageUrl = imageUrl(eventCell(row, "imageUrl"));
    const imageUrls = imageList(eventCell(row, "imageUrls"));
    if (mainImageUrl && !imageUrls.includes(mainImageUrl)) {
      imageUrls.unshift(mainImageUrl);
    }
    const mainImageId =
      driveId(eventCell(row, "imageId")) ??
      driveId(eventCell(row, "imageUrl"));
    const imageIds = idList(eventCell(row, "imageIds"));
    if (mainImageId && !imageIds.includes(mainImageId)) {
      imageIds.unshift(mainImageId);
    }

    events.push({
      archivedAt: eventStatus === "ARCHIVED" ? now : null,
      autoDismissMs:
        eventText(row, "autoDismissMs") === ""
          ? null
          : integer(eventCell(row, "autoDismissMs"), 10_000),
      body: eventText(row, "body") || null,
      bypassSnooze: bool(eventCell(row, "bypassSnooze")),
      closePolicy: safeString(eventCell(row, "closePolicy"), "auto"),
      createdAt: date(eventCell(row, "createdAt")) ?? now,
      displayChannel: safeString(eventCell(row, "displayChannel"), "both"),
      displayMode: safeString(eventCell(row, "displayMode"), "toast"),
      endAt: date(eventCell(row, "endAt")),
      id,
      imageId: mainImageId,
      imageIds,
      imageUrl: mainImageUrl,
      imageUrls,
      kind: eventKind,
      level: safeString(eventCell(row, "level"), "normal"),
      linkedTask: jsonValue(eventCell(row, "linkedTask")),
      location: eventText(row, "location") || null,
      popupContentMode: safeString(
        eventCell(row, "popupContentMode"),
        "full",
      ),
      priority: integer(eventCell(row, "priority"), 1),
      reactionSetId: eventText(row, "reactionSetId") || null,
      reminderTimes: timeList(eventCell(row, "reminderTimes")),
      requireAck: bool(eventCell(row, "requireAck")),
      saveResponse: bool(eventCell(row, "saveResponse")),
      startAt: date(eventCell(row, "startAt")),
      status: eventStatus,
      targetCompanies: stringList(eventCell(row, "targetCompanies")),
      targetDepartments: stringList(eventCell(row, "targetDepartments")),
      targetEmployees: stringList(eventCell(row, "targetEmployees")),
      targetScope: safeString(eventCell(row, "targetScope"), "all"),
      targetUrl: eventText(row, "targetUrl") || null,
      thumbnailId:
        driveId(eventCell(row, "thumbnailId")) ??
        driveId(eventCell(row, "thumbnailUrl")),
      thumbnailUrl: imageUrl(eventCell(row, "thumbnailUrl"), "w1200"),
      title,
      updatedAt: date(eventCell(row, "updatedAt")) ?? now,
    });
  }

  return { events, reactionSets };
}

async function loadLegacyWorkbook() {
  const workbook = new ExcelJS.Workbook();
  if (!GOOGLE_SHEET_ID) {
    await workbook.xlsx.readFile(SOURCE_PATH);
    return workbook;
  }
  const token = text(process.env.GOOGLE_ACCESS_TOKEN);
  if (!token) throw new Error("Thiếu GOOGLE_ACCESS_TOKEN chỉ đọc Google Sheets.");
  const headers = { Authorization: `Bearer ${token}` };
  const metadataResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(GOOGLE_SHEET_ID)}?fields=sheets.properties(title,index)`,
    { headers },
  );
  if (!metadataResponse.ok) {
    throw new Error(`Không đọc được metadata Google Sheets (${metadataResponse.status}).`);
  }
  const metadata = await metadataResponse.json() as {
    sheets?: Array<{ properties?: { index?: number; title?: string } }>;
  };
  const selected = (metadata.sheets || [])
    .map((item) => item.properties)
    .filter(
      (item): item is { index?: number; title: string } =>
        Boolean(item?.title?.startsWith("08_") || item?.title?.startsWith("09_")),
    )
    .sort((left, right) => (left.index || 0) - (right.index || 0));
  if (selected.length !== 2) {
    throw new Error("Không tìm đủ sheet 08_Bộ Tag và 09_Cấu hình nền.");
  }
  for (const sheet of selected) {
    const range = `'${sheet.title.replaceAll("'", "''")}'`;
    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(GOOGLE_SHEET_ID)}/values/${encodeURIComponent(range)}`,
    );
    url.searchParams.set("majorDimension", "ROWS");
    url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    url.searchParams.set("dateTimeRenderOption", "SERIAL_NUMBER");
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Không đọc được ${sheet.title} (${response.status}).`);
    }
    const payload = await response.json() as { values?: unknown[][] };
    const worksheet = workbook.addWorksheet(sheet.title);
    worksheet.addRows(Array.isArray(payload.values) ? payload.values : []);
  }
  return workbook;
}

function quote(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function findReactionSet(
  client: PoolClient,
  source: LegacyReactionSet,
) {
  const result = await client.query<{ id: string; key: string }>(
    `select id, key
       from "ReactionSet"
      where id = $1 or lower(name) = lower($2)
      order by (id = $1) desc
      limit 1`,
    [source.id, source.name],
  );
  return result.rows[0] ?? null;
}

async function findEvent(client: PoolClient, source: LegacyEvent) {
  const result = await client.query<{ id: string }>(
    `select id
       from "MotivationEvent"
      where id = $1 or (lower(title) = lower($2) and kind = $3)
      order by (id = $1) desc
      limit 1`,
    [source.id, source.title, source.kind],
  );
  return result.rows[0]?.id ?? null;
}

async function writeRecord(
  client: PoolClient,
  table: string,
  id: string | null,
  data: Record<string, unknown>,
) {
  const entries = Object.entries(data);
  if (id) {
    const assignments = entries
      .map(([column], index) => `${quote(column)} = $${index + 1}`)
      .join(", ");
    await client.query(
      `update ${quote(table)} set ${assignments} where id = $${entries.length + 1}`,
      [...entries.map(([, value]) => value), id],
    );
    return id;
  }

  const columns = entries.map(([column]) => quote(column)).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(
    `insert into ${quote(table)} (${columns}) values (${placeholders})`,
    entries.map(([, value]) => value),
  );
  return String(data.id);
}

async function run() {
  if (APPLY && !process.argv.includes("--confirm-apply=motivation")) {
    throw new Error("Lệnh ghi cần --confirm-apply=motivation sau khi preview.");
  }
  const source = await readLegacyData();
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
  });
  const client = await pool.connect();
  const stats = {
    eventCreated: 0,
    eventSkipped: 0,
    eventUpdated: 0,
    reactionCreated: 0,
    reactionSkipped: 0,
    reactionUpdated: 0,
  };

  try {
    if (APPLY) await client.query("begin");

    const reactionIdMap = new Map<string, string>();
    for (const reactionSet of source.reactionSets) {
      const existing = await findReactionSet(client, reactionSet);
      const destinationId = existing?.id ?? reactionSet.id;
      reactionIdMap.set(reactionSet.id, destinationId);
      if (existing && INSERT_MISSING_ONLY) stats.reactionSkipped += 1;
      else stats[existing ? "reactionUpdated" : "reactionCreated"] += 1;
      if (!APPLY) continue;
      if (existing && INSERT_MISSING_ONLY) continue;
      await writeRecord(client, "ReactionSet", existing?.id ?? null, {
        createdAt: reactionSet.createdAt,
        id: destinationId,
        key: existing?.key ?? reactionSet.key,
        name: reactionSet.name,
        options: JSON.stringify(reactionSet.options),
        status: reactionSet.status,
        updatedAt: reactionSet.updatedAt,
      });
    }

    for (const event of source.events) {
      const existingId = await findEvent(client, event);
      if (existingId && INSERT_MISSING_ONLY) stats.eventSkipped += 1;
      else stats[existingId ? "eventUpdated" : "eventCreated"] += 1;
      if (!APPLY) continue;
      if (existingId && INSERT_MISSING_ONLY) continue;
      const destinationId = existingId ?? event.id;
      await writeRecord(client, "MotivationEvent", existingId, {
        archivedAt: event.archivedAt,
        autoDismissMs: event.autoDismissMs,
        body: event.body,
        bypassSnooze: event.bypassSnooze,
        closePolicy: event.closePolicy,
        createdAt: event.createdAt,
        createdById: null,
        displayChannel: event.displayChannel,
        displayMode: event.displayMode,
        endAt: event.endAt,
        id: destinationId,
        imageId: event.imageId,
        imageIds: JSON.stringify(event.imageIds),
        imageUrl: event.imageUrl,
        imageUrls: JSON.stringify(event.imageUrls),
        kind: event.kind,
        level: event.level,
        linkedTask: event.linkedTask
          ? JSON.stringify(event.linkedTask)
          : null,
        location: event.location,
        popupContentMode: event.popupContentMode,
        priority: event.priority,
        reactionSetId: event.reactionSetId
          ? reactionIdMap.get(event.reactionSetId) ?? null
          : null,
        reminderTimes: JSON.stringify(event.reminderTimes),
        requireAck: event.requireAck,
        saveResponse: event.saveResponse,
        startAt: event.startAt,
        status: event.status,
        targetCompanies: JSON.stringify(event.targetCompanies),
        targetDepartments: JSON.stringify(event.targetDepartments),
        targetEmployees: JSON.stringify(event.targetEmployees),
        targetScope: event.targetScope,
        targetUrl: event.targetUrl,
        thumbnailId: event.thumbnailId,
        thumbnailUrl: event.thumbnailUrl,
        title: event.title,
        updatedAt: event.updatedAt,
      });
    }

    if (APPLY) await client.query("commit");
    console.log(
      JSON.stringify(
        {
          applied: APPLY,
          source: {
            events: source.events.length,
            reactionSets: source.reactionSets.length,
          },
          stats,
        },
        null,
        2,
      ),
    );
    if (!APPLY) {
      console.log(
        "Đây là bản xem trước. Thêm --apply để ghi dữ liệu vào PostgreSQL.",
      );
    }
  } catch (error) {
    if (APPLY) await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
