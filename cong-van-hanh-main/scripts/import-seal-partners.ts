import "dotenv/config";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

const SOURCE_KEY = "google-sheet-25-seal-partners";
const DEFAULT_SPREADSHEET_ID =
  "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg";

type PartnerSource = {
  address: string;
  issuedDate: string;
  issuedPlace: string;
  name: string;
  rowNumber: number;
  shortName: string;
  taxId: string;
};

function options() {
  return new Map(
    process.argv.slice(2).map((argument) => {
      const value = argument.replace(/^--/, "");
      const separator = value.indexOf("=");
      return separator < 0
        ? [value, "true"]
        : [value.slice(0, separator), value.slice(separator + 1)];
    }),
  );
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compareKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi-VN");
}

function normalizedIdentifier(value: unknown) {
  const raw = text(value).replace(/\s+/g, "");
  const digits = raw.replace(/\D+/g, "");
  if (/^\d+$/.test(raw) && (digits.length === 9 || digits.length === 12)) {
    return `0${digits}`;
  }
  return raw;
}

function findHeader(headers: string[], aliases: string[]) {
  const candidates = new Set(aliases.map(compareKey));
  return headers.findIndex((header) => candidates.has(compareKey(header)));
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 28);
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

async function fetchSource(spreadsheetId: string, sheetName: string) {
  const accessToken = text(process.env.GOOGLE_ACCESS_TOKEN);
  if (!accessToken) throw new Error("Thiếu GOOGLE_ACCESS_TOKEN chỉ đọc Google Sheets.");
  const range = encodeURIComponent(`'${sheetName.replaceAll("'", "''")}'!A:Z`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error(`Không đọc được sheet đối tác: HTTP ${response.status}.`);
  const payload = await response.json() as { values?: unknown[][] };
  const rows = Array.isArray(payload.values) ? payload.values : [];
  if (rows.length < 2) return [];
  const headers = rows[0].map(text);
  const columns = {
    address: findHeader(headers, ["Địa chỉ", "Dia chi"]),
    issuedDate: findHeader(headers, ["Ngày cấp", "Ngay cap", "Ngày cấp CCCD"]),
    issuedPlace: findHeader(headers, ["Nơi cấp", "Noi cap", "Nơi cấp CCCD"]),
    name: findHeader(headers, [
      "Tên NCC/ khách hàng",
      "Tên NCC/khách hàng",
      "Tên đối tác",
      "Tên khách hàng",
      "Tên công ty",
    ]),
    shortName: findHeader(headers, ["Tên viết tắt", "Ten viet tat", "Viết tắt"]),
    taxId: findHeader(headers, ["Mã số thuế (CCCD)", "MST/CCCD", "Mã số thuế", "CCCD"]),
  };
  if (columns.name < 0 || columns.taxId < 0) {
    throw new Error("Sheet đối tác thiếu cột Tên hoặc MST/CCCD.");
  }
  return rows.slice(1).flatMap((row, offset) => {
    const at = (column: number) => column >= 0 ? text(row[column]) : "";
    const name = at(columns.name).toLocaleUpperCase("vi-VN");
    if (!name) return [];
    return [{
      address: at(columns.address),
      issuedDate: at(columns.issuedDate),
      issuedPlace: at(columns.issuedPlace),
      name,
      rowNumber: offset + 2,
      shortName: at(columns.shortName).toLocaleUpperCase("vi-VN"),
      taxId: normalizedIdentifier(at(columns.taxId)),
    } satisfies PartnerSource];
  });
}

function identity(record: PartnerSource) {
  if (record.taxId) return `${record.issuedDate || record.issuedPlace ? "person" : "business"}:${compareKey(record.taxId)}`;
  return `name:${compareKey(record.name)}|short:${compareKey(record.shortName)}|address:${compareKey(record.address)}`;
}

function setting(record: PartnerSource) {
  const type = record.issuedDate || record.issuedPlace ? "person" : "business";
  const digest = hash(identity(record));
  const item = {
    address: record.address,
    employeeCode: "",
    id: `legacy:${digest}`,
    issuedDate: type === "person" ? record.issuedDate : "",
    issuedPlace: type === "person" ? record.issuedPlace : "",
    label: record.name,
    name: record.name,
    searchText: [record.name, record.taxId, type === "business" ? record.shortName : "", record.address, record.issuedPlace].join(" "),
    shortName: type === "business" ? record.shortName : "",
    sourceLabel: type === "person" ? "Đối tác - Cá nhân" : "Đối tác - Doanh nghiệp",
    sourceType: "customer",
    taxId: record.taxId,
    type,
  };
  return {
    externalId: digest,
    id: `seal_partner_${digest}`,
    item,
    key: `document-seal.partner.legacy.${digest}`,
  };
}

async function main() {
  const args = options();
  const mode = text(args.get("mode") || "preview").toLowerCase();
  if (!new Set(["preview", "apply"]).has(mode)) throw new Error("--mode chỉ nhận preview hoặc apply.");
  if (mode === "apply" && args.get("confirm-apply") !== "25_NCC_Khach_hang") {
    throw new Error("Lệnh ghi cần --confirm-apply=25_NCC_Khach_hang sau khi preview.");
  }
  const spreadsheetId = text(args.get("spreadsheet-id")) || DEFAULT_SPREADSHEET_ID;
  const sheetName = text(args.get("sheet-name")) || "25_NCC Khach hang";
  const records = await fetchSource(spreadsheetId, sheetName);
  const db = getDb();
  try {
    const prepared = records.map((record) => ({ record, target: setting(record) }));
    const existing = await db.systemSetting.findMany({
      select: { id: true, key: true },
      where: { key: { in: prepared.map(({ target }) => target.key) } },
    });
    const existingKeys = new Set(existing.map((row) => row.key));
    const missing = prepared.filter(({ target }) => !existingKeys.has(target.key));
    const preview = {
      alreadyInV3: prepared.length - missing.length,
      missingToCreate: missing.length,
      rowsRead: records.length,
      rowsWithoutTaxId: records.filter((record) => !record.taxId).length,
      sheetName,
    };
    if (mode === "preview") return { mode, ...preview };

    const source = await db.migrationSource.upsert({
      create: {
        config: { sheetName, spreadsheetId },
        key: SOURCE_KEY,
        kind: "GOOGLE_SHEET",
        name: "V2 25_NCC Khách hàng",
      },
      update: { config: { sheetName, spreadsheetId }, lastRunAt: new Date(), status: "ACTIVE" },
      where: { key: SOURCE_KEY },
    });
    const run = await db.migrationRun.create({
      data: {
        mode: "APPLY",
        phase: "IMPORT_SEAL_PARTNERS",
        rowsRead: records.length,
        rowsValid: records.length,
        sourceConfigSnapshot: { sheetName, spreadsheetId },
        sourceId: source.id,
        status: "RUNNING",
      },
    });
    const counters = { created: 0, failed: 0, skipped: 0 };
    for (const { record, target } of prepared) {
      let internalId: string | undefined;
      let status = "IMPORTED";
      let errorMessage = "";
      try {
        const current = await db.systemSetting.findUnique({ where: { key: target.key } });
        if (current) {
          internalId = current.id;
          status = "SKIPPED";
          counters.skipped += 1;
        } else {
          const created = await db.systemSetting.create({
            data: { id: target.id, key: target.key, value: JSON.stringify(target.item) },
          });
          internalId = created.id;
          counters.created += 1;
        }
        await db.externalIdMap.upsert({
          create: {
            entityType: "SystemSetting",
            externalId: target.externalId,
            internalId: internalId!,
            metadata: { rowNumber: record.rowNumber, sheetName },
            sourceId: source.id,
          },
          update: {
            internalId: internalId!,
            lastSeenAt: new Date(),
            metadata: { rowNumber: record.rowNumber, sheetName },
          },
          where: {
            sourceId_entityType_externalId: {
              entityType: "SystemSetting",
              externalId: target.externalId,
              sourceId: source.id,
            },
          },
        });
      } catch (error) {
        counters.failed += 1;
        status = "FAILED";
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      await db.migrationRecord.create({
        data: {
          entityType: "SystemSetting",
          externalId: target.externalId,
          internalId,
          issueCount: errorMessage ? 1 : 0,
          normalizedData: asJson(target.item),
          processedAt: new Date(),
          rawData: asJson(record),
          rowNumber: record.rowNumber,
          runId: run.id,
          status,
        },
      });
      if (errorMessage) {
        await db.migrationIssue.create({
          data: {
            code: "SEAL_PARTNER_IMPORT_FAILED",
            externalId: target.externalId,
            message: errorMessage,
            rawData: asJson(record),
            rowNumber: record.rowNumber,
            runId: run.id,
            severity: "ERROR",
          },
        });
      }
    }
    const runStatus = counters.failed ? "PARTIAL" : "COMPLETED";
    await db.migrationRun.update({
      data: {
        completedAt: new Date(),
        phase: "IMPORT_SEAL_PARTNERS_COMPLETED",
        rowsCreated: counters.created,
        rowsFailed: counters.failed,
        rowsSkipped: counters.skipped,
        status: runStatus,
        summary: `25_NCC Khách hàng: ${counters.created} tạo, ${counters.skipped} giữ nguyên, ${counters.failed} lỗi.`,
      },
      where: { id: run.id },
    });
    return { mode, runId: run.id, status: runStatus, ...counters };
  } finally {
    await db.$disconnect();
  }
}

main()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
