import "dotenv/config";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

const SOURCE_KEY = "google-sheet-16-chat-history";
const DEFAULT_SPREADSHEET_ID =
  "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg";
const SHEET_NAME = "16_Chat Thu ky Meo";

type SourceMessage = {
  body: string;
  createdAt: string;
  direction: string;
  messageId: string;
  rowNumber: number;
  senderCode: string;
  senderName: string;
  threadEmployeeCode: string;
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

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

async function fetchSource(spreadsheetId: string) {
  const token = text(process.env.GOOGLE_ACCESS_TOKEN);
  if (!token) throw new Error("Thiếu GOOGLE_ACCESS_TOKEN chỉ đọc Google Sheets.");
  const range = encodeURIComponent(`'${SHEET_NAME}'!A:G`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Không đọc được ${SHEET_NAME}: HTTP ${response.status}.`);
  const payload = await response.json() as { values?: unknown[][] };
  const values = Array.isArray(payload.values) ? payload.values : [];
  if (values.length < 2) return [];
  const headers = values[0].map(text);
  const atHeader = (name: string) => headers.findIndex((header) => normalize(header) === normalize(name));
  const columns = {
    body: atHeader("Body"),
    createdAt: atHeader("Created At"),
    direction: atHeader("Direction"),
    messageId: atHeader("Message ID"),
    senderCode: atHeader("Sender MNV"),
    senderName: atHeader("Sender Name"),
    threadEmployeeCode: atHeader("Thread MNV"),
  };
  return values.slice(1).flatMap((row, offset) => {
    const at = (column: number) => column >= 0 ? text(row[column]) : "";
    const messageId = at(columns.messageId);
    if (!messageId) return [];
    return [{
      body: at(columns.body),
      createdAt: at(columns.createdAt),
      direction: at(columns.direction),
      messageId,
      rowNumber: offset + 2,
      senderCode: at(columns.senderCode),
      senderName: at(columns.senderName),
      threadEmployeeCode: at(columns.threadEmployeeCode),
    } satisfies SourceMessage];
  });
}

async function main() {
  const args = options();
  const mode = text(args.get("mode") || "preview").toLowerCase();
  if (!new Set(["preview", "apply"]).has(mode)) throw new Error("--mode chỉ nhận preview hoặc apply.");
  if (mode === "apply" && args.get("confirm-apply") !== "16_Chat_history") {
    throw new Error("Lệnh ghi cần --confirm-apply=16_Chat_history sau khi preview.");
  }
  const spreadsheetId = text(args.get("spreadsheet-id")) || DEFAULT_SPREADSHEET_ID;
  const messages = await fetchSource(spreadsheetId);
  const db = getDb();
  try {
    const existing = await db.configurationRecord.findMany({
      select: { code: true },
      where: { code: { in: messages.map((message) => message.messageId) }, recordType: "chat-history" },
    });
    const existingCodes = new Set(existing.map((row) => row.code));
    const preview = {
      alreadyInV3: messages.filter((message) => existingCodes.has(message.messageId)).length,
      missingToCreate: messages.filter((message) => !existingCodes.has(message.messageId)).length,
      rowsRead: messages.length,
    };
    if (mode === "preview") return { mode, ...preview };

    const source = await db.migrationSource.upsert({
      create: {
        config: { archiveOnly: true, sheetName: SHEET_NAME, spreadsheetId },
        key: SOURCE_KEY,
        kind: "GOOGLE_SHEET",
        name: "V2 16_Chat Thư ký Mèo - lưu trữ",
      },
      update: {
        config: { archiveOnly: true, sheetName: SHEET_NAME, spreadsheetId },
        lastRunAt: new Date(),
        status: "ACTIVE",
      },
      where: { key: SOURCE_KEY },
    });
    const run = await db.migrationRun.create({
      data: {
        mode: "APPLY",
        phase: "ARCHIVE_CHAT_HISTORY",
        rowsRead: messages.length,
        rowsValid: messages.length,
        sourceConfigSnapshot: { archiveOnly: true, sheetName: SHEET_NAME, spreadsheetId },
        sourceId: source.id,
        status: "RUNNING",
      },
    });
    const counters = { created: 0, failed: 0, skipped: 0 };
    for (const message of messages) {
      let internalId: string | undefined;
      let recordStatus = "IMPORTED";
      let errorMessage = "";
      try {
        let current = await db.configurationRecord.findFirst({
          where: { code: message.messageId, recordType: "chat-history" },
        });
        if (current) {
          counters.skipped += 1;
          recordStatus = "SKIPPED";
        } else {
          current = await db.configurationRecord.create({
            data: {
              code: message.messageId,
              content: asJson(message),
              name: message.senderName || message.senderCode || null,
              parentCode: message.threadEmployeeCode || null,
              recordType: "chat-history",
              sourceRow: message.rowNumber,
              sourceSheet: SHEET_NAME,
              status: message.direction || null,
            },
          });
          counters.created += 1;
        }
        internalId = current.id;
        await db.externalIdMap.upsert({
          create: {
            entityType: "ConfigurationRecord",
            externalId: message.messageId,
            internalId,
            metadata: { archiveOnly: true, rowNumber: message.rowNumber },
            sourceId: source.id,
          },
          update: {
            internalId,
            lastSeenAt: new Date(),
            metadata: { archiveOnly: true, rowNumber: message.rowNumber },
          },
          where: {
            sourceId_entityType_externalId: {
              entityType: "ConfigurationRecord",
              externalId: message.messageId,
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
          entityType: "ConfigurationRecord",
          externalId: message.messageId,
          internalId,
          issueCount: errorMessage ? 1 : 0,
          processedAt: new Date(),
          rawData: asJson(message),
          rowNumber: message.rowNumber,
          runId: run.id,
          status: recordStatus,
        },
      });
      if (errorMessage) {
        await db.migrationIssue.create({
          data: {
            code: "CHAT_HISTORY_ARCHIVE_FAILED",
            externalId: message.messageId,
            message: errorMessage,
            rawData: asJson(message),
            rowNumber: message.rowNumber,
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
        phase: "ARCHIVE_CHAT_HISTORY_COMPLETED",
        rowsCreated: counters.created,
        rowsFailed: counters.failed,
        rowsSkipped: counters.skipped,
        status: runStatus,
        summary: `16_Chat Thư ký Mèo: ${counters.created} tin nhắn lưu trữ, ${counters.skipped} giữ nguyên, ${counters.failed} lỗi.`,
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
