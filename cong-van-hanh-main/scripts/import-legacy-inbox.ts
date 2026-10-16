import "dotenv/config";

import { readFile } from "node:fs/promises";

import { getDb } from "@/lib/db";
import {
  applyLegacyInboxMigration,
  copyLinkedDriveFilesToGcs,
  getLegacyInboxMigrationRun,
  previewLegacyInboxMigration,
  resumeLegacyInboxMigration,
  type InboxMigrationPhase,
  type LegacyInboxSourceRow,
} from "@/lib/migration/inbox98";

function args() {
  return new Map(
    process.argv.slice(2).map((argument) => {
      const normalized = argument.replace(/^--/, "");
      const separator = normalized.indexOf("=");
      return separator === -1
        ? [normalized, "true"]
        : [
            normalized.slice(0, separator),
            normalized.slice(separator + 1),
          ];
    }),
  );
}

function int(value: string | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : undefined;
}

function phase(value: string | undefined): InboxMigrationPhase {
  const normalized = String(value || "ALL").toUpperCase();
  if (normalized === "REQUESTS" || normalized === "FILES") {
    return normalized;
  }
  return "ALL";
}

async function sourceRows(path: string | undefined) {
  if (!path) return undefined;
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(payload)) {
    throw new Error("--input phải là file JSON chứa mảng LegacyInboxSourceRow.");
  }
  return payload as LegacyInboxSourceRow[];
}

function assertApplyConfirmation(options: Map<string, string>) {
  if (options.get("confirm-apply") !== "98_Inbox") {
    throw new Error(
      "Lệnh ghi dữ liệu cần --confirm-apply=98_Inbox. Hãy chạy preview trước và kiểm tra MigrationIssue.",
    );
  }
}

async function main() {
  const options = args();
  const mode = String(options.get("mode") || "preview").toLowerCase();
  const db = getDb();
  try {
    if (mode === "preview" || mode === "dry-run") {
      return await previewLegacyInboxMigration(db, {
        batchSize: int(options.get("batch-size")),
        maxRows: int(options.get("max-rows")),
        sheetName: options.get("sheet-name"),
        sourceRows: await sourceRows(options.get("input")),
        spreadsheetId: options.get("spreadsheet-id"),
        startRow: int(options.get("start-row")),
        triggeredById: options.get("triggered-by"),
      });
    }
    if (mode === "apply") {
      assertApplyConfirmation(options);
      return await applyLegacyInboxMigration(db, {
        batchSize: int(options.get("batch-size")),
        maxRows: int(options.get("max-rows")),
        phase: phase(options.get("phase")),
        previewToken: options.get("preview-token"),
        sheetName: options.get("sheet-name"),
        sourceRows: await sourceRows(options.get("input")),
        spreadsheetId: options.get("spreadsheet-id"),
        startRow: int(options.get("start-row")),
        triggeredById: options.get("triggered-by"),
      });
    }
    if (mode === "resume") {
      assertApplyConfirmation(options);
      const runId = options.get("run-id");
      if (!runId) throw new Error("Thiếu --run-id cho mode resume.");
      return await resumeLegacyInboxMigration(db, {
        phase: phase(options.get("phase")),
        retryFailed: options.get("retry-failed") === "true",
        runId,
      });
    }
    if (mode === "status") {
      const runId = options.get("run-id");
      if (!runId) throw new Error("Thiếu --run-id cho mode status.");
      return await getLegacyInboxMigrationRun(db, runId);
    }
    if (mode === "copy-files") {
      assertApplyConfirmation(options);
      return await copyLinkedDriveFilesToGcs(db, {
        bucket: options.get("bucket"),
        concurrency: int(options.get("concurrency")),
        limit: int(options.get("limit")),
      });
    }
    throw new Error(
      "Mode hợp lệ: preview | apply | resume | status | copy-files.",
    );
  } finally {
    await db.$disconnect();
  }
}

async function run() {
  try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

void run();
