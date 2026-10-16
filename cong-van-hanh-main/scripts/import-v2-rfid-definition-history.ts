import "dotenv/config";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

const SOURCE_KEY = "google-sheet-20-rfid-definition-history";
const DEFAULT_SPREADSHEET_ID =
  "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg";
const SHEET_NAME = "20_RFID Log";

type SourceRow = {
  barcode: string;
  deviceName: string;
  epc: string;
  expectedQty: number;
  itemMessage: string;
  operatorName: string;
  payload: Record<string, unknown>;
  processStatus: string;
  result: Record<string, unknown>;
  rowNumber: number;
  scanPowerMode: string;
  serverTime: Date;
  sessionKey: string;
  sku: string;
  tagTimestamp: Date;
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
  return String(value ?? "").trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number.parseInt(text(value).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function date(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
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

function json(value: unknown) {
  const normalized = text(value);
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function headerIndex(headers: string[], name: string) {
  return headers.findIndex((header) => text(header).toLocaleLowerCase("vi-VN") === name.toLocaleLowerCase("vi-VN"));
}

async function fetchSource(spreadsheetId: string) {
  const token = text(process.env.GOOGLE_ACCESS_TOKEN);
  if (!token) throw new Error("Thiếu GOOGLE_ACCESS_TOKEN chỉ đọc Google Sheets.");
  const range = encodeURIComponent(`'${SHEET_NAME}'!A:X`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Không đọc được ${SHEET_NAME}: HTTP ${response.status}.`);
  const payload = await response.json() as { values?: unknown[][] };
  const values = Array.isArray(payload.values) ? payload.values : [];
  if (values.length < 2) return [];
  const headers = values[0].map(text);
  const columns = {
    barcode: headerIndex(headers, "Barcode"),
    deviceName: headerIndex(headers, "DeviceName"),
    epc: headerIndex(headers, "EPC"),
    expectedQty: headerIndex(headers, "ExpectedQty"),
    itemMessage: headerIndex(headers, "ItemMessage"),
    mode: headerIndex(headers, "Mode"),
    operatorName: headerIndex(headers, "Operator"),
    payload: headerIndex(headers, "Payload JSON"),
    processStatus: headerIndex(headers, "ProcessStatus"),
    result: headerIndex(headers, "Result JSON"),
    scanPowerMode: headerIndex(headers, "ScanPowerMode"),
    serverTime: headerIndex(headers, "ServerTime"),
    sessionKey: headerIndex(headers, "SessionId"),
    sku: headerIndex(headers, "SKU"),
    tagTimestamp: headerIndex(headers, "TagTimestamp"),
  };
  return values.slice(1).flatMap((row, offset) => {
    const at = (column: number) => column >= 0 ? row[column] : "";
    if (text(at(columns.mode)).toLowerCase() !== "definition") return [];
    const sessionKey = text(at(columns.sessionKey));
    const epc = text(at(columns.epc)).toUpperCase();
    if (!sessionKey || !epc) return [];
    const serverTime = date(at(columns.serverTime));
    return [{
      barcode: text(at(columns.barcode)),
      deviceName: text(at(columns.deviceName)),
      epc,
      expectedQty: integer(at(columns.expectedQty)),
      itemMessage: text(at(columns.itemMessage)),
      operatorName: text(at(columns.operatorName)),
      payload: json(at(columns.payload)),
      processStatus: text(at(columns.processStatus)) || "PENDING",
      result: json(at(columns.result)),
      rowNumber: offset + 2,
      scanPowerMode: text(at(columns.scanPowerMode)),
      serverTime,
      sessionKey,
      sku: text(at(columns.sku)),
      tagTimestamp: text(at(columns.tagTimestamp)) ? date(at(columns.tagTimestamp)) : serverTime,
    } satisfies SourceRow];
  });
}

function grouped(rows: SourceRow[]) {
  const result = new Map<string, SourceRow[]>();
  for (const row of rows) {
    const group = result.get(row.sessionKey) || [];
    group.push(row);
    result.set(row.sessionKey, group);
  }
  return result;
}

function resultCount(row: SourceRow, key: string, fallback = 0) {
  return integer(row.result[key], fallback);
}

async function main() {
  const args = options();
  const mode = text(args.get("mode") || "preview").toLowerCase();
  if (!new Set(["preview", "apply"]).has(mode)) throw new Error("--mode chỉ nhận preview hoặc apply.");
  if (mode === "apply" && args.get("confirm-apply") !== "20_RFID_definition") {
    throw new Error("Lệnh ghi cần --confirm-apply=20_RFID_definition sau khi preview.");
  }
  const spreadsheetId = text(args.get("spreadsheet-id")) || DEFAULT_SPREADSHEET_ID;
  const rows = await fetchSource(spreadsheetId);
  const groups = grouped(rows);
  const db = getDb();
  try {
    const sessionKeys = [...groups.keys()];
    const currentSessions = await db.warehouseRfidDefinitionSession.findMany({
      select: { id: true, sessionKey: true },
      where: { sessionKey: { in: sessionKeys } },
    });
    const currentByKey = new Map(currentSessions.map((session) => [session.sessionKey, session.id]));
    const currentEvents = currentSessions.length
      ? await db.warehouseRfidIssuanceEvent.findMany({
        select: { epc: true, session: { select: { sessionKey: true } } },
        where: { sessionId: { in: currentSessions.map((session) => session.id) } },
      })
      : [];
    const currentEventKeys = new Set(currentEvents.map((event) => `${event.session.sessionKey}\u0000${event.epc}`));
    const uniqueEpcs = [...new Set(rows.map((row) => row.epc))];
    const linkedTags = await db.warehouseRfidTag.count({ where: { epc: { in: uniqueEpcs } } });
    const preview = {
      alreadyExistingEvents: rows.filter((row) => currentEventKeys.has(`${row.sessionKey}\u0000${row.epc}`)).length,
      definitionRows: rows.length,
      definitionSessions: groups.size,
      linkedExistingTags: linkedTags,
      missingEvents: rows.filter((row) => !currentEventKeys.has(`${row.sessionKey}\u0000${row.epc}`)).length,
      missingSessions: sessionKeys.filter((sessionKey) => !currentByKey.has(sessionKey)).length,
      uniqueEpcs: uniqueEpcs.length,
    };
    if (mode === "preview") return { mode, ...preview };

    const source = await db.migrationSource.upsert({
      create: {
        config: { filter: "Mode=definition", sheetName: SHEET_NAME, spreadsheetId },
        key: SOURCE_KEY,
        kind: "GOOGLE_SHEET",
        name: "V2 20_RFID Log - lịch sử Định nghĩa RFID",
      },
      update: {
        config: { filter: "Mode=definition", sheetName: SHEET_NAME, spreadsheetId },
        lastRunAt: new Date(),
        status: "ACTIVE",
      },
      where: { key: SOURCE_KEY },
    });
    const run = await db.migrationRun.create({
      data: {
        mode: "APPLY",
        phase: "IMPORT_RFID_DEFINITION_HISTORY",
        rowsRead: rows.length,
        rowsValid: rows.length,
        sourceConfigSnapshot: { filter: "Mode=definition", sheetName: SHEET_NAME, spreadsheetId },
        sourceId: source.id,
        status: "RUNNING",
      },
    });
    const counters = {
      eventsCreated: 0,
      eventsSkipped: 0,
      failed: 0,
      sessionsCreated: 0,
      sessionsSkipped: 0,
    };
    for (const [sessionKey, sessionRows] of groups) {
      const first = sessionRows[0];
      const sku = sessionRows.map((row) => row.sku).find(Boolean) || "";
      const product = sku
        ? await db.warehouseProduct.findUnique({ where: { sku } })
        : null;
      let session = await db.warehouseRfidDefinitionSession.findUnique({ where: { sessionKey } });
      if (session) {
        counters.sessionsSkipped += 1;
      } else {
        session = await db.warehouseRfidDefinitionSession.create({
          data: {
            barcode: first.barcode || product?.barcode || null,
            createdCount: resultCount(first, "createdCount", sessionRows.filter((row) => row.processStatus === "SUCCESS").length),
            deviceName: first.deviceName || null,
            errorCount: resultCount(first, "errorCount", sessionRows.filter((row) => row.processStatus === "ERROR").length),
            expectedQty: first.expectedQty,
            issuanceStatus: first.processStatus === "ERROR" ? "ERROR" : "ACTIVE",
            message: first.itemMessage || text(first.result.message) || null,
            occurredAt: first.serverTime,
            operatorName: first.operatorName || null,
            processStatus: first.processStatus,
            productName: product?.name || null,
            rawPayload: asJson({
              importedFrom: `${SHEET_NAME}:definition`,
              result: first.result,
              sourceRows: sessionRows.map((row) => row.rowNumber),
            }),
            requestedCount: resultCount(first, "requestedCount", sessionRows.length),
            scanRangeHint: first.scanPowerMode || null,
            sessionKey,
            skippedCount: resultCount(first, "skippedCount"),
            sku: sku || null,
            source: "V2 Google Sheet/Android RFID",
          },
        });
        counters.sessionsCreated += 1;
      }
      await db.externalIdMap.upsert({
        create: {
          entityType: "WarehouseRfidDefinitionSession",
          externalId: sessionKey,
          internalId: session.id,
          metadata: { sourceRows: sessionRows.map((row) => row.rowNumber) },
          sourceId: source.id,
        },
        update: {
          internalId: session.id,
          lastSeenAt: new Date(),
          metadata: { sourceRows: sessionRows.map((row) => row.rowNumber) },
        },
        where: {
          sourceId_entityType_externalId: {
            entityType: "WarehouseRfidDefinitionSession",
            externalId: sessionKey,
            sourceId: source.id,
          },
        },
      });

      for (const row of sessionRows) {
        const externalId = `${row.sessionKey}:${row.epc}`;
        let internalId: string | undefined;
        let recordStatus = "IMPORTED";
        let errorMessage = "";
        try {
          const existing = await db.warehouseRfidIssuanceEvent.findUnique({
            where: { sessionId_epc: { epc: row.epc, sessionId: session.id } },
          });
          if (existing) {
            internalId = existing.id;
            recordStatus = "SKIPPED";
            counters.eventsSkipped += 1;
          } else {
            const tag = await db.warehouseRfidTag.findUnique({ where: { epc: row.epc } });
            const created = await db.warehouseRfidIssuanceEvent.create({
              data: {
                barcode: row.barcode || product?.barcode || null,
                deviceName: row.deviceName || null,
                epc: row.epc,
                eventType: row.processStatus === "ERROR" ? "ERROR" : "ISSUED",
                issuanceStatus: row.processStatus === "ERROR" ? "ERROR" : "ACTIVE",
                message: row.itemMessage || text(row.result.message) || null,
                occurredAt: row.tagTimestamp,
                operatorName: row.operatorName || null,
                productName: product?.name || tag?.productName || null,
                rawPayload: asJson({
                  importedFrom: `${SHEET_NAME}:row-${row.rowNumber}`,
                  payload: row.payload,
                  result: row.result,
                }),
                rfidTagId: tag?.id || null,
                sessionId: session.id,
                sku: row.sku || tag?.productSku || null,
              },
            });
            internalId = created.id;
            counters.eventsCreated += 1;
          }
          await db.externalIdMap.upsert({
            create: {
              entityType: "WarehouseRfidIssuanceEvent",
              externalId,
              internalId: internalId!,
              metadata: { rowNumber: row.rowNumber },
              sourceId: source.id,
            },
            update: {
              internalId: internalId!,
              lastSeenAt: new Date(),
              metadata: { rowNumber: row.rowNumber },
            },
            where: {
              sourceId_entityType_externalId: {
                entityType: "WarehouseRfidIssuanceEvent",
                externalId,
                sourceId: source.id,
              },
            },
          });
        } catch (error) {
          counters.failed += 1;
          recordStatus = "FAILED";
          errorMessage = error instanceof Error ? error.message : String(error);
        }
        await db.migrationRecord.create({
          data: {
            entityType: "WarehouseRfidIssuanceEvent",
            externalId,
            internalId,
            issueCount: errorMessage ? 1 : 0,
            processedAt: new Date(),
            rawData: asJson(row),
            rowNumber: row.rowNumber,
            runId: run.id,
            status: recordStatus,
          },
        });
        if (errorMessage) {
          await db.migrationIssue.create({
            data: {
              code: "RFID_DEFINITION_HISTORY_IMPORT_FAILED",
              externalId,
              message: errorMessage,
              rawData: asJson(row),
              rowNumber: row.rowNumber,
              runId: run.id,
              severity: "ERROR",
            },
          });
        }
      }
    }
    const runStatus = counters.failed ? "PARTIAL" : "COMPLETED";
    await db.migrationRun.update({
      data: {
        completedAt: new Date(),
        phase: "IMPORT_RFID_DEFINITION_HISTORY_COMPLETED",
        rowsCreated: counters.eventsCreated + counters.sessionsCreated,
        rowsFailed: counters.failed,
        rowsSkipped: counters.eventsSkipped + counters.sessionsSkipped,
        status: runStatus,
        summary: `20_RFID Log/definition: ${counters.sessionsCreated} phiên và ${counters.eventsCreated} sự kiện được tạo; ${counters.failed} lỗi.`,
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
