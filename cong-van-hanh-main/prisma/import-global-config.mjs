import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const sourceKey = "legacy-global-config-sheet-97";
const sourceId = "migration-source-global-config-sheet-97";
const seed = JSON.parse(
  readFileSync(new URL("./global-config-seed.json", import.meta.url), "utf8"),
);

function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function fingerprint(value) {
  return createHash("sha256").update(json(value), "utf8").digest("hex");
}

async function findCompanyId(client, scope) {
  if (!Array.isArray(scope) || scope.length !== 1) return null;
  const result = await client.query(
    `
      SELECT "id"
      FROM "Company"
      WHERE "archivedAt" IS NULL
        AND (
          lower(trim("legalName")) = lower(trim($1))
          OR lower(trim(coalesce("shortName", ''))) = lower(trim($1))
          OR lower(trim("code")) = lower(trim($1))
        )
      LIMIT 1
    `,
    [scope[0]],
  );
  return result.rows[0]?.id ?? null;
}

async function insertSystemSetting(client, record) {
  const data = record.data;
  const inserted = await client.query(
    `
      INSERT INTO "SystemSetting"
        ("id", "key", "value", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
      ON CONFLICT ("key") DO NOTHING
      RETURNING "id"
    `,
    [
      record.externalId,
      data.key,
      data.value,
      data.createdAt,
      data.updatedAt,
    ],
  );

  if (inserted.rows[0]?.id) {
    return { created: true, internalId: inserted.rows[0].id };
  }

  const existing = await client.query(
    `SELECT "id" FROM "SystemSetting" WHERE "key" = $1 LIMIT 1`,
    [data.key],
  );
  return { created: false, internalId: existing.rows[0].id };
}

async function insertViettelPostAccount(client, record) {
  const data = record.data;
  const companyId = await findCompanyId(client, data.companyScope);
  const inserted = await client.query(
    `
      INSERT INTO "ViettelPostAccount"
        (
          "id", "name", "env", "username", "companyScope",
          "departmentScope", "note", "status", "companyId",
          "createdAt", "updatedAt"
        )
      VALUES
        ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::timestamptz, $11::timestamptz)
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"
    `,
    [
      record.externalId,
      data.name,
      data.env,
      data.username,
      json(data.companyScope),
      json(data.departmentScope),
      data.note,
      data.status,
      companyId,
      data.createdAt,
      data.updatedAt,
    ],
  );
  return {
    created: Boolean(inserted.rows[0]?.id),
    internalId: inserted.rows[0]?.id ?? record.externalId,
  };
}

async function insertEshopAccount(client, record) {
  const data = record.data;
  const companyId = await findCompanyId(client, data.companyScope);
  const inserted = await client.query(
    `
      INSERT INTO "EshopAccount"
        (
          "id", "name", "companyKey", "companyName", "companyScope",
          "departmentScope", "webBaseUrl", "webCompanyCode", "apiDomain",
          "apiAppId", "branchId", "language", "backendSpreadsheetId",
          "orderSheetName", "inventorySheetName", "note", "status",
          "companyId", "createdAt", "updatedAt"
        )
      VALUES
        (
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19::timestamptz,
          $20::timestamptz
        )
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"
    `,
    [
      record.externalId,
      data.name,
      data.companyKey,
      data.companyName,
      json(data.companyScope),
      json(data.departmentScope),
      data.webBaseUrl,
      data.webCompanyCode,
      data.apiDomain,
      data.apiAppId,
      data.branchId,
      data.language,
      data.backendSpreadsheetId,
      data.orderSheetName,
      data.inventorySheetName,
      data.note,
      data.status,
      companyId,
      data.createdAt,
      data.updatedAt,
    ],
  );
  return {
    created: Boolean(inserted.rows[0]?.id),
    internalId: inserted.rows[0]?.id ?? record.externalId,
  };
}

async function insertTarget(client, record) {
  if (record.entityType === "SystemSetting") {
    return insertSystemSetting(client, record);
  }
  if (record.entityType === "ViettelPostAccount") {
    return insertViettelPostAccount(client, record);
  }
  if (record.entityType === "EshopAccount") {
    return insertEshopAccount(client, record);
  }
  throw new Error(`Unsupported entity type: ${record.entityType}`);
}

async function ensureCommonAiModel(client) {
  const legacy = await client.query(
    `
      SELECT "value"
      FROM "SystemSetting"
      WHERE "key" IN ('ai.assetGeminiModel', 'ai.reviewGeminiModel')
        AND coalesce("value", '') <> ''
      ORDER BY CASE WHEN "key" = 'ai.assetGeminiModel' THEN 0 ELSE 1 END
      LIMIT 1
    `,
  );
  if (!legacy.rows[0]?.value) return false;

  const inserted = await client.query(
    `
      INSERT INTO "SystemSetting" ("id", "key", "value", "updatedAt")
      VALUES ($1, 'ai.geminiModel', $2, now())
      ON CONFLICT ("key") DO NOTHING
      RETURNING "id"
    `,
    [id("cfg"), legacy.rows[0].value],
  );
  return Boolean(inserted.rows[0]?.id);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!Array.isArray(seed.records) || seed.records.length === 0) {
    throw new Error("Global config seed is empty.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const runId = id("migration-run");
  const checksum = fingerprint(seed.records);
  const sourceConfig = {
    range: seed.source.range,
    sheetId: seed.source.sheetId,
    sheetName: seed.source.sheetName,
    spreadsheetId: seed.source.spreadsheetId,
  };

  try {
    await client.query(
      `
        INSERT INTO "MigrationSource"
          ("id", "key", "name", "kind", "config", "updatedAt")
        VALUES ($1, $2, $3, 'GOOGLE_SHEET', $4::jsonb, now())
        ON CONFLICT ("key") DO UPDATE SET
          "name" = EXCLUDED."name",
          "kind" = EXCLUDED."kind",
          "config" = EXCLUDED."config",
          "updatedAt" = now()
      `,
      [
        sourceId,
        sourceKey,
        "Google Sheet - 97_Cấu hình tổng",
        json(sourceConfig),
      ],
    );
    const actualSource = await client.query(
      `SELECT "id" FROM "MigrationSource" WHERE "key" = $1 LIMIT 1`,
      [sourceKey],
    );
    const actualSourceId = actualSource.rows[0].id;

    await client.query(
      `
        INSERT INTO "MigrationRun"
          (
            "id", "sourceId", "mode", "status", "phase", "checksum",
            "sourceConfigSnapshot", "metadata", "startedAt", "createdAt"
          )
        VALUES
          ($1, $2, 'BACKFILL', 'RUNNING', 'IMPORT_GLOBAL_CONFIG', $3, $4::jsonb, $5::jsonb, now(), now())
      `,
      [
        runId,
        actualSourceId,
        checksum,
        json(sourceConfig),
        json({ secretsImported: false, sourceRowsSanitized: true }),
      ],
    );

    await client.query("BEGIN");
    let rowsCreated = 0;
    let rowsSkipped = 0;
    let rowsFailed = 0;
    let warningCount = 0;

    for (const record of seed.records) {
      const recordId = id("migration-record");
      const rowFingerprint = fingerprint(record.data);
      const normalized = {
        ...record.data,
        missingSecrets: record.missingSecrets,
      };

      await client.query(
        `
          INSERT INTO "MigrationRecord"
            (
              "id", "runId", "rowNumber", "entityType", "externalId",
              "fingerprint", "status", "rawData", "normalizedData",
              "issueCount", "createdAt", "updatedAt"
            )
          VALUES
            ($1, $2, $3, $4, $5, $6, 'VALID', $7::jsonb, $8::jsonb, $9, now(), now())
        `,
        [
          recordId,
          runId,
          record.rowNumber,
          record.entityType,
          record.externalId,
          rowFingerprint,
          json({
            externalId: record.externalId,
            entityType: record.entityType,
            rowNumber: record.rowNumber,
          }),
          json(normalized),
          record.missingSecrets.length,
        ],
      );

      await client.query(`SAVEPOINT import_row`);
      try {
        const imported = await insertTarget(client, record);
        const status = imported.created ? "IMPORTED" : "SKIPPED";
        if (imported.created) rowsCreated += 1;
        else rowsSkipped += 1;

        await client.query(
          `
            INSERT INTO "ExternalIdMap"
              (
                "id", "sourceId", "entityType", "externalId", "internalId",
                "fingerprint", "metadata", "lastSeenAt", "createdAt", "updatedAt"
              )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now(), now())
            ON CONFLICT ("sourceId", "entityType", "externalId") DO UPDATE SET
              "internalId" = EXCLUDED."internalId",
              "fingerprint" = EXCLUDED."fingerprint",
              "metadata" = EXCLUDED."metadata",
              "lastSeenAt" = now(),
              "updatedAt" = now()
          `,
          [
            id("external-map"),
            actualSourceId,
            record.entityType,
            record.externalId,
            imported.internalId,
            rowFingerprint,
            json({ rowNumber: record.rowNumber }),
          ],
        );

        for (const field of record.missingSecrets) {
          warningCount += 1;
          await client.query(
            `
              INSERT INTO "MigrationIssue"
                (
                  "id", "runId", "severity", "rowNumber", "externalId",
                  "field", "code", "message", "rawData", "createdAt"
                )
              VALUES
                ($1, $2, 'WARNING', $3, $4, $5, 'LEGACY_SECRET_REENTRY_REQUIRED', $6, $7::jsonb, now())
            `,
            [
              id("migration-issue"),
              runId,
              record.rowNumber,
              record.externalId,
              field,
              `Secret "${field}" chỉ có preview trong Sheet và phải nhập lại tại Cấu hình Tổng.`,
              json({ entityType: record.entityType }),
            ],
          );
        }

        await client.query(
          `
            UPDATE "MigrationRecord"
            SET
              "internalId" = $2,
              "status" = $3,
              "processedAt" = now(),
              "updatedAt" = now()
            WHERE "id" = $1
          `,
          [recordId, imported.internalId, status],
        );
        await client.query(`RELEASE SAVEPOINT import_row`);
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT import_row`);
        await client.query(`RELEASE SAVEPOINT import_row`);
        rowsFailed += 1;
        await client.query(
          `
            UPDATE "MigrationRecord"
            SET "status" = 'FAILED', "processedAt" = now(), "updatedAt" = now()
            WHERE "id" = $1
          `,
          [recordId],
        );
        await client.query(
          `
            INSERT INTO "MigrationIssue"
              (
                "id", "runId", "severity", "rowNumber", "externalId",
                "code", "message", "rawData", "createdAt"
              )
            VALUES
              ($1, $2, 'ERROR', $3, $4, 'IMPORT_ROW_FAILED', $5, $6::jsonb, now())
          `,
          [
            id("migration-issue"),
            runId,
            record.rowNumber,
            record.externalId,
            error instanceof Error ? error.message : String(error),
            json({ entityType: record.entityType }),
          ],
        );
      }
    }

    const commonModelCreated = await ensureCommonAiModel(client);
    if (commonModelCreated) rowsCreated += 1;

    await client.query(
      `
        INSERT INTO "AuditLog"
          (
            "id", "action", "targetType", "targetId", "summary",
            "metadata", "createdAt"
          )
        VALUES
          ($1, 'SYNC'::"AuditAction", 'MigrationRun', $2, $3, $4::jsonb, now())
      `,
      [
        id("audit"),
        runId,
        `Nạp Cấu hình Tổng từ Google Sheet: ${rowsCreated} tạo mới, ${rowsSkipped} bỏ qua, ${rowsFailed} lỗi.`,
        json({
          checksum,
          rowsCreated,
          rowsFailed,
          rowsRead: seed.records.length,
          rowsSkipped,
          secretsRequiringReentry: warningCount,
        }),
      ],
    );

    const runStatus = rowsFailed > 0 || warningCount > 0 ? "PARTIAL" : "COMPLETED";
    const summary =
      `${seed.records.length} dòng; ${rowsCreated} tạo mới; ${rowsSkipped} bỏ qua; ` +
      `${rowsFailed} lỗi; ${warningCount} secret cần nhập lại.`;
    await client.query(
      `
        UPDATE "MigrationRun"
        SET
          "status" = $2,
          "phase" = 'COMPLETED',
          "rowsRead" = $3,
          "rowsValid" = $4,
          "rowsCreated" = $5,
          "rowsSkipped" = $6,
          "rowsFailed" = $7,
          "summary" = $8,
          "metadata" = $9::jsonb,
          "completedAt" = now()
        WHERE "id" = $1
      `,
      [
        runId,
        runStatus,
        seed.records.length,
        seed.records.length - rowsFailed,
        rowsCreated,
        rowsSkipped,
        rowsFailed,
        summary,
        json({
          commonAiModelCreated: commonModelCreated,
          secretsImported: false,
          secretsRequiringReentry: warningCount,
          sourceRowsSanitized: true,
        }),
      ],
    );
    await client.query(
      `
        UPDATE "MigrationSource"
        SET "lastRunAt" = now(), "updatedAt" = now()
        WHERE "id" = $1
      `,
      [actualSourceId],
    );
    await client.query("COMMIT");

    console.log(
      JSON.stringify({
        checksum,
        runId,
        rowsCreated,
        rowsFailed,
        rowsRead: seed.records.length,
        rowsSkipped,
        secretsRequiringReentry: warningCount,
        status: runStatus,
      }),
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
      await client.query(
        `
          UPDATE "MigrationRun"
          SET
            "status" = 'FAILED',
            "phase" = 'FAILED',
            "summary" = $2,
            "completedAt" = now()
          WHERE "id" = $1
        `,
        [runId, error instanceof Error ? error.message : String(error)],
      );
    } catch {
      // Preserve the original error if recording the failed run also fails.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
