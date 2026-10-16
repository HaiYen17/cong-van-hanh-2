import "dotenv/config";

import { randomUUID } from "node:crypto";

import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Thiếu DATABASE_URL.");

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("vi-VN");
}

const definitions = [
  {
    code: "UQ",
    condition: "Hồ sơ cần thời gian scan lưu trữ",
    name: "Giấy Ủy quyền",
    serialMask: "####",
  },
  {
    code: "GT",
    condition: "Hồ sơ cần thời gian scan lưu trữ",
    name: "Giấy Giới thiệu",
    serialMask: "####",
  },
];

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string; name: string }>(
      `SELECT "id", "name" FROM "DocumentType"`,
    );
    let created = 0;
    let kept = 0;
    for (const definition of definitions) {
      const match = existing.rows.find(
        (row) => normalize(row.name) === normalize(definition.name),
      );
      if (match) {
        await client.query(
          `
            UPDATE "DocumentType"
            SET "status" = 'ACTIVE', "takesNumber" = true, "updatedAt" = now()
            WHERE "id" = $1
          `,
          [match.id],
        );
        kept += 1;
        continue;
      }
      await client.query(
        `
          INSERT INTO "DocumentType"
            (
              "id", "name", "takesNumber", "condition", "declarationTypes",
              "cycle", "startIndex", "cycleLimit", "formatTokens", "status",
              "updatedAt"
            )
          VALUES
            ($1, $2, true, $3, $4::jsonb, 'Theo năm', 1, null, $5::jsonb, 'ACTIVE', now())
        `,
        [
          `document-type_${randomUUID()}`,
          definition.name,
          definition.condition,
          JSON.stringify(["partner", "period", "detail"]),
          JSON.stringify([
            { type: "COMPANY" },
            { type: "HYPHEN" },
            { type: "FIXED_TEXT", value: definition.code },
            { type: "SLASH" },
            { type: "YYYY" },
            { type: "SLASH" },
            { type: "SERIAL", value: definition.serialMask },
          ]),
        ],
      );
      created += 1;
    }
    await client.query(
      `
        INSERT INTO "AuditLog"
          ("id", "action", "targetType", "targetId", "summary", "metadata")
        VALUES
          ($1, 'SYNC', 'DocumentType', 'authorization-letter-types', $2, $3::jsonb)
      `,
      [
        `audit_${randomUUID()}`,
        "Đảm bảo đủ loại Giấy Ủy quyền/Giới thiệu cho module cấp giấy.",
        JSON.stringify({ created, kept }),
      ],
    );
    await client.query("COMMIT");
    console.log(
      `Đã kiểm tra loại giấy: giữ ${kept}, tạo mới ${created}.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
