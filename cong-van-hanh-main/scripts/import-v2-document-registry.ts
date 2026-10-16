import "dotenv/config";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

const SOURCE_KEY = "google-sheet-07-document-registry";
const DEFAULT_SPREADSHEET_ID =
  "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg";

type SourceRecord = {
  companyName: string;
  companyShort: string;
  condition: string;
  createdAt: Date;
  creatorEmployeeCode: string;
  creatorName: string;
  cycleKey: string;
  documentNumber: string;
  documentTypeName: string;
  documentTypeRow: number | null;
  legacyRegistryId: string;
  note: string;
  numberStatus: string;
  partnerAbbr: string;
  poolKey: string;
  rowNumber: number;
  serial: number;
  updatedAt: Date;
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
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return String(value ?? "").trim();
}

function integer(value: unknown) {
  const normalized = text(value).replace(/[^\d-]/g, "");
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const parsed = new Date(excelEpoch + value * 86_400_000);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  const normalized = text(value);
  const dayFirst = normalized.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (dayFirst) {
    const year = Number(dayFirst[3]) < 100 ? 2000 + Number(dayFirst[3]) : Number(dayFirst[3]);
    return new Date(
      year,
      Number(dayFirst[2]) - 1,
      Number(dayFirst[1]),
      Number(dayFirst[4] || 0),
      Number(dayFirst[5] || 0),
      Number(dayFirst[6] || 0),
    );
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

async function fetchSource(spreadsheetId: string) {
  const token = text(process.env.GOOGLE_ACCESS_TOKEN);
  if (!token) throw new Error("Thiếu GOOGLE_ACCESS_TOKEN chỉ đọc Google Sheets.");
  const headers = { Authorization: `Bearer ${token}` };
  const metadataResponse = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers },
  );
  if (!metadataResponse.ok) throw new Error(`Không đọc được metadata (${metadataResponse.status}).`);
  const metadata = await metadataResponse.json();
  const sheetName = (metadata.sheets || [])
    .map((item: { properties?: { title?: string } }) => item.properties?.title)
    .find((title: string | undefined) => title?.startsWith("07_"));
  if (!sheetName) throw new Error("Không tìm thấy sheet 07_Sổ văn bản.");
  const range = `'${sheetName.replaceAll("'", "''")}'!A:AI`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Không đọc được ${sheetName} (${response.status}).`);
  const payload = await response.json();
  const values: unknown[][] = Array.isArray(payload.values) ? payload.values : [];
  const records = values.slice(1).flatMap((row: unknown[], offset: number) => {
    const documentNumber = text(row[18]);
    const serial = integer(row[17]);
    if (!documentNumber || !serial) return [];
    return [{
      companyName: text(row[5]),
      companyShort: text(row[6]),
      condition: text(row[10]),
      createdAt: date(row[30]),
      creatorEmployeeCode: text(row[28]),
      creatorName: text(row[27]),
      cycleKey: text(row[15]) || String(date(row[30]).getFullYear()),
      documentNumber,
      documentTypeName: text(row[7]) || "Văn bản khác",
      documentTypeRow: integer(row[8]),
      legacyRegistryId: text(row[0]) || `row-${offset + 2}`,
      note: text(row[34]),
      numberStatus: text(row[26]),
      partnerAbbr: text(row[19]),
      poolKey: text(row[16]) || `legacy07-row-${offset + 2}`,
      rowNumber: offset + 2,
      serial,
      updatedAt: date(row[31] || row[30]),
    } satisfies SourceRecord];
  });
  return { records, sheetName };
}

async function main() {
  const args = options();
  const mode = text(args.get("mode") || "preview").toLowerCase();
  if (!new Set(["preview", "apply"]).has(mode)) {
    throw new Error("--mode chỉ nhận preview hoặc apply.");
  }
  if (mode === "apply" && args.get("confirm-apply") !== "07_So_van_ban") {
    throw new Error("Lệnh ghi cần --confirm-apply=07_So_van_ban sau khi preview.");
  }
  const spreadsheetId = text(args.get("spreadsheet-id")) || DEFAULT_SPREADSHEET_ID;
  const { records, sheetName } = await fetchSource(spreadsheetId);
  const db = getDb();
  try {
    const source = await db.migrationSource.upsert({
      create: {
        config: { sheetName, spreadsheetId },
        key: SOURCE_KEY,
        kind: "GOOGLE_SHEET",
        name: "V2 07_Sổ văn bản",
      },
      update: { config: { sheetName, spreadsheetId }, lastRunAt: new Date(), status: "ACTIVE" },
      where: { key: SOURCE_KEY },
    });
    const numbers = records.map((record) => record.documentNumber);
    const existingNumbers = await db.documentRegistry.findMany({
      select: { documentNumber: true, id: true, poolKey: true, serial: true },
      where: { documentNumber: { in: numbers } },
    });
    const existingNumberSet = new Set(existingNumbers.map((row) => row.documentNumber));
    const missing = records.filter((record) => !existingNumberSet.has(record.documentNumber));
    const poolRows = await db.documentRegistry.findMany({
      select: { documentNumber: true, poolKey: true, serial: true },
      where: {
        OR: missing.map((record) => ({ poolKey: record.poolKey, serial: record.serial })),
      },
    });
    const poolCollisions = new Map(
      poolRows.map((row) => [`${row.poolKey}\u0000${row.serial}`, row.documentNumber]),
    );
    const collisionCount = missing.filter((record) => {
      const occupied = poolCollisions.get(`${record.poolKey}\u0000${record.serial}`);
      return occupied && occupied !== record.documentNumber;
    }).length;
    const preview = {
      alreadyInV3: records.length - missing.length,
      missingToCreate: missing.length,
      poolSerialCollisions: collisionCount,
      rowsRead: records.length,
      sheetName,
    };
    if (mode === "preview") return { mode, ...preview };

    const run = await db.migrationRun.create({
      data: {
        mode: "APPLY",
        phase: "IMPORT_DOCUMENT_REGISTRY",
        rowsRead: records.length,
        rowsValid: records.length,
        sourceConfigSnapshot: { sheetName, spreadsheetId },
        sourceId: source.id,
        status: "RUNNING",
      },
    });
    const counters = { collisionsArchived: 0, created: 0, failed: 0, skipped: 0 };
    for (const record of records) {
      const externalId = `07_Sổ văn bản:${record.legacyRegistryId}`;
      let internalId: string | undefined;
      let recordStatus = "IMPORTED";
      let errorMessage = "";
      try {
        const currentMap = await db.externalIdMap.findUnique({
          where: { sourceId_entityType_externalId: { entityType: "DocumentRegistry", externalId, sourceId: source.id } },
        });
        const existing = currentMap
          ? await db.documentRegistry.findUnique({ where: { id: currentMap.internalId } })
          : await db.documentRegistry.findFirst({ where: { documentNumber: record.documentNumber } });
        if (existing) {
          internalId = existing.id;
          recordStatus = "SKIPPED";
          counters.skipped += 1;
        } else {
          const company = await db.company.findFirst({
            where: { OR: [{ code: record.companyShort }, { shortName: record.companyShort }, { legalName: record.companyName }] },
          });
          const documentType = await db.documentType.findFirst({
            where: {
              OR: [
                ...(record.documentTypeRow ? [{ legacySheetRow: record.documentTypeRow }] : []),
                { name: record.documentTypeName },
              ],
            },
          });
          const creator = record.creatorEmployeeCode
            ? await db.employee.findUnique({ include: { user: true }, where: { employeeCode: record.creatorEmployeeCode } })
            : null;
          const occupied = await db.documentRegistry.findUnique({
            where: { poolKey_serial: { poolKey: record.poolKey, serial: record.serial } },
          });
          const effectivePoolKey = occupied && occupied.documentNumber !== record.documentNumber
            ? `legacy07:${record.poolKey}:${record.legacyRegistryId}`
            : record.poolKey;
          if (effectivePoolKey !== record.poolKey) counters.collisionsArchived += 1;
          const created = await db.documentRegistry.create({
            data: {
              companyId: company?.id || null,
              companyShort: company?.shortName || record.companyShort || "LEGACY",
              condition: record.condition || documentType?.condition || null,
              createdAt: record.createdAt,
              createdById: creator?.user?.id || null,
              createdByName: record.creatorName || null,
              cycleKey: record.cycleKey,
              documentNumber: record.documentNumber,
              documentTypeId: documentType?.id || null,
              documentTypeName: documentType?.name || record.documentTypeName,
              note: record.note || null,
              partnerAbbr: record.partnerAbbr || null,
              poolKey: effectivePoolKey,
              quantity: 1,
              sealTypes: [],
              serial: record.serial,
              signDate: record.createdAt,
              status: record.numberStatus.toLocaleLowerCase("vi-VN").includes("hủy") ? "CANCELLED" : "ISSUED",
              updatedAt: record.updatedAt,
            },
          });
          internalId = created.id;
          counters.created += 1;
          const dossier = await db.legalDossier.findUnique({
            where: { legacyRegistryId: record.legacyRegistryId },
          });
          if (dossier && !dossier.documentRegistryId) {
            await db.legalDossier.update({
              data: { documentRegistryId: created.id },
              where: { id: dossier.id },
            });
          }
        }
        await db.externalIdMap.upsert({
          create: {
            entityType: "DocumentRegistry",
            externalId,
            internalId: internalId!,
            metadata: { documentNumber: record.documentNumber, sourceRow: record.rowNumber },
            sourceId: source.id,
          },
          update: {
            internalId: internalId!,
            lastSeenAt: new Date(),
            metadata: { documentNumber: record.documentNumber, sourceRow: record.rowNumber },
          },
          where: { sourceId_entityType_externalId: { entityType: "DocumentRegistry", externalId, sourceId: source.id } },
        });
      } catch (error) {
        counters.failed += 1;
        recordStatus = "FAILED";
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      await db.migrationRecord.create({
        data: {
          entityType: "DocumentRegistry",
          externalId,
          internalId,
          issueCount: errorMessage ? 1 : 0,
          processedAt: new Date(),
          rawData: asJson(record),
          rowNumber: record.rowNumber,
          runId: run.id,
          status: recordStatus,
        },
      });
      if (errorMessage) {
        await db.migrationIssue.create({
          data: {
            code: "DOCUMENT_REGISTRY_IMPORT_FAILED",
            externalId,
            message: errorMessage,
            rawData: asJson({ documentNumber: record.documentNumber, legacyRegistryId: record.legacyRegistryId }),
            rowNumber: record.rowNumber,
            runId: run.id,
            severity: "ERROR",
          },
        });
      }
    }
    const status = counters.failed ? "PARTIAL" : "COMPLETED";
    await db.migrationRun.update({
      data: {
        completedAt: new Date(),
        phase: "IMPORT_DOCUMENT_REGISTRY_COMPLETED",
        rowsCreated: counters.created,
        rowsFailed: counters.failed,
        rowsSkipped: counters.skipped,
        status,
        summary: `07_Sổ văn bản: ${counters.created} tạo, ${counters.skipped} giữ nguyên, ${counters.collisionsArchived} pool xung đột được lưu archival, ${counters.failed} lỗi.`,
      },
      where: { id: run.id },
    });
    return { mode, runId: run.id, status, ...counters };
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
