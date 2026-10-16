import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";

const { Pool } = pg;
const seed = JSON.parse(
  await readFile(new URL("./document-type-seed.json", import.meta.url), "utf8"),
);

const SOURCE_KEY = "legacy-document-types-sheet-02";
const SOURCE_ID = "migration-source-document-types-sheet-02";
const id = (prefix) => `${prefix}_${randomUUID()}`;
const json = (value) => JSON.stringify(value ?? null);
const fingerprint = (value) =>
  createHash("sha256").update(json(value), "utf8").digest("hex");

const literalTokenKeys = new Map([
  [".", "DOT"],
  ["/", "SLASH"],
  ["_", "UNDERSCORE"],
  ["-", "HYPHEN"],
  ["[", "LEFT_BRACKET"],
  ["]", "RIGHT_BRACKET"],
  ["Công ty", "COMPANY"],
  ["Cụm tự định nghĩa", "CUSTOM_TEXT"],
  ["DD", "DD"],
  ["MM", "MM"],
  ["YY", "YY"],
  ["YYYY", "YYYY"],
]);

function decodeLegacy(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePattern(pattern) {
  if (!pattern) return [];
  return String(pattern)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("SERIAL:")) {
        return { type: "SERIAL", value: part.slice("SERIAL:".length) || "#" };
      }
      if (part.startsWith("FIXED:")) {
        return {
          type: "FIXED_TEXT",
          value: decodeLegacy(part.slice("FIXED:".length)),
        };
      }
      const type = literalTokenKeys.get(part);
      if (!type) {
        throw new Error(`Token quy cách chưa hỗ trợ: ${part}`);
      }
      return { type };
    });
}

async function ensureSource(client) {
  await client.query(
    `
      INSERT INTO "MigrationSource"
        ("id", "key", "name", "kind", "config", "updatedAt")
      VALUES ($1, $2, $3, 'GOOGLE_SHEET', $4::jsonb, now())
      ON CONFLICT ("key") DO UPDATE SET
        "name" = EXCLUDED."name",
        "status" = 'ACTIVE',
        "config" = EXCLUDED."config",
        "updatedAt" = now(),
        "archivedAt" = NULL
    `,
    [
      SOURCE_ID,
      SOURCE_KEY,
      "Google Sheet - 02_Thông tin chức năng / Loại văn bản",
      json(seed.source),
    ],
  );
  const result = await client.query(
    `SELECT "id" FROM "MigrationSource" WHERE "key" = $1 LIMIT 1`,
    [SOURCE_KEY],
  );
  return result.rows[0].id;
}

async function createRun(client, sourceId, checksum) {
  const runId = id("migration-run");
  await client.query(
    `
      INSERT INTO "MigrationRun"
        (
          "id", "sourceId", "mode", "status", "phase", "checksum",
          "sourceConfigSnapshot", "metadata", "startedAt"
        )
      VALUES
        ($1, $2, 'BACKFILL', 'RUNNING', 'DOCUMENT_TYPES', $3, $4::jsonb, $5::jsonb, now())
    `,
    [
      runId,
      sourceId,
      checksum,
      json(seed.source),
      json({ sourceRowsSanitized: true }),
    ],
  );
  return runId;
}

async function importRecord(client, runId, sourceId, record) {
  const normalized = {
    condition: record.takesNumber ? record.condition : null,
    cycle: record.takesNumber ? record.cycle : null,
    cycleLimit:
      record.takesNumber && record.cycle === "Theo giới hạn"
        ? record.cycleLimit
        : null,
    declarationTypes: record.declarations,
    formatTokens: record.takesNumber ? parsePattern(record.pattern) : [],
    legacySheetRow: record.rowNumber,
    name: record.name,
    startIndex: record.takesNumber ? record.startIndex || 1 : 1,
    status: "ACTIVE",
    takesNumber: record.takesNumber,
  };
  const rowFingerprint = fingerprint(normalized);
  const existing = await client.query(
    `SELECT "id" FROM "DocumentType" WHERE "name" = $1 LIMIT 1`,
    [record.name],
  );
  const internalId = existing.rows[0]?.id ?? id("document-type");
  const result = await client.query(
    `
      INSERT INTO "DocumentType"
        (
          "id", "name", "takesNumber", "condition", "declarationTypes",
          "cycle", "startIndex", "cycleLimit", "formatTokens", "status",
          "legacySheetRow", "updatedAt"
        )
      VALUES
        (
          $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb,
          'ACTIVE', $10, now()
        )
      ON CONFLICT ("name") DO UPDATE SET
        "takesNumber" = EXCLUDED."takesNumber",
        "condition" = EXCLUDED."condition",
        "declarationTypes" = EXCLUDED."declarationTypes",
        "cycle" = EXCLUDED."cycle",
        "startIndex" = EXCLUDED."startIndex",
        "cycleLimit" = EXCLUDED."cycleLimit",
        "formatTokens" = EXCLUDED."formatTokens",
        "status" = 'ACTIVE',
        "legacySheetRow" = EXCLUDED."legacySheetRow",
        "updatedAt" = now()
      RETURNING "id"
    `,
    [
      internalId,
      normalized.name,
      normalized.takesNumber,
      normalized.condition,
      json(normalized.declarationTypes),
      normalized.cycle,
      normalized.startIndex,
      normalized.cycleLimit,
      json(normalized.formatTokens),
      normalized.legacySheetRow,
    ],
  );
  const actualId = result.rows[0].id;
  await client.query(
    `
      INSERT INTO "MigrationRecord"
        (
          "id", "runId", "rowNumber", "entityType", "externalId",
          "internalId", "fingerprint", "status", "rawData",
          "normalizedData", "processedAt", "updatedAt"
        )
      VALUES
        (
          $1, $2, $3, 'DocumentType', $4, $5, $6, 'IMPORTED',
          $7::jsonb, $8::jsonb, now(), now()
        )
    `,
    [
      id("migration-record"),
      runId,
      record.rowNumber,
      record.name,
      actualId,
      rowFingerprint,
      json(record),
      json(normalized),
    ],
  );
  await client.query(
    `
      INSERT INTO "ExternalIdMap"
        (
          "id", "sourceId", "entityType", "externalId", "internalId",
          "fingerprint", "metadata", "lastSeenAt", "updatedAt"
        )
      VALUES
        ($1, $2, 'DocumentType', $3, $4, $5, $6::jsonb, now(), now())
      ON CONFLICT ("sourceId", "entityType", "externalId") DO UPDATE SET
        "internalId" = EXCLUDED."internalId",
        "fingerprint" = EXCLUDED."fingerprint",
        "metadata" = EXCLUDED."metadata",
        "lastSeenAt" = now(),
        "updatedAt" = now()
    `,
    [
      id("external-map"),
      sourceId,
      String(record.rowNumber),
      actualId,
      rowFingerprint,
      json({ documentName: record.name, sheetRow: record.rowNumber }),
    ],
  );
  return existing.rowCount ? "updated" : "created";
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const checksum = fingerprint(seed.records);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let runId = "";
  try {
    await client.query("BEGIN");
    const sourceId = await ensureSource(client);
    runId = await createRun(client, sourceId, checksum);
    let rowsCreated = 0;
    let rowsUpdated = 0;
    for (const record of seed.records) {
      const outcome = await importRecord(client, runId, sourceId, record);
      if (outcome === "created") rowsCreated += 1;
      else rowsUpdated += 1;
    }

    const removedDemo = await client.query(
      `
        DELETE FROM "DocumentType" d
        WHERE d."legacySheetRow" IS NULL
          AND d."name" IN ('Hợp đồng', 'Công văn đi')
          AND NOT EXISTS (
            SELECT 1 FROM "DocumentRegistry" r WHERE r."documentTypeId" = d."id"
          )
      `,
    );
    await client.query(
      `
        UPDATE "MigrationRun"
        SET
          "status" = 'COMPLETED',
          "phase" = 'COMPLETED',
          "rowsRead" = $2,
          "rowsValid" = $2,
          "rowsCreated" = $3,
          "rowsUpdated" = $4,
          "rowsFailed" = 0,
          "summary" = $5,
          "metadata" = $6::jsonb,
          "completedAt" = now()
        WHERE "id" = $1
      `,
      [
        runId,
        seed.records.length,
        rowsCreated,
        rowsUpdated,
        `Đã nhập ${seed.records.length} loại văn bản từ sheet 02; 0 lỗi.`,
        json({ removedDemoRows: removedDemo.rowCount }),
      ],
    );
    await client.query(
      `UPDATE "MigrationSource" SET "lastRunAt" = now(), "updatedAt" = now() WHERE "id" = $1`,
      [sourceId],
    );
    await client.query(
      `
        INSERT INTO "AuditLog"
          ("id", "action", "targetType", "targetId", "summary", "metadata")
        VALUES
          ($1, 'SYNC', 'MigrationRun', $2, $3, $4::jsonb)
      `,
      [
        id("audit"),
        runId,
        "Nhập cấu hình loại văn bản từ Google Sheet 02 vào PostgreSQL.",
        json({
          checksum,
          removedDemoRows: removedDemo.rowCount,
          rowsCreated,
          rowsUpdated,
        }),
      ],
    );
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        checksum,
        removedDemoRows: removedDemo.rowCount,
        rowsCreated,
        rowsFailed: 0,
        rowsRead: seed.records.length,
        rowsUpdated,
        runId,
        status: "COMPLETED",
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
