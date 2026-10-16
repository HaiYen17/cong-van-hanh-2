import pg from "pg";

const APPLY = process.argv.includes("--apply");
const ACTOR = process.env.ACTOR_EMAIL || "Codex · loại số bù ghi cứng 2026-08-28";
const SCHEMA = "accounting_runtime";
const knownExternalKeys = [
  "TVG-2026-01-CF-INDIRECT-05-OD0-F19",
  "TVG-2026-01-CF-INDIRECT-11-OD0-F26",
  "TVG-2026-01-CF-INDIRECT-14-OD0-F29",
  "TVG-2026-01-CF-INDIRECT-16-OD0-F31-REVIEWED-ZERO",
  "TVG-2026-01-CF-INDIRECT-17-OD0-F32-REVIEWED-ZERO",
  "TVG-2026-01-CF-INDIRECT-27-OD0-F46",
];

const rawUrl = process.env.ACCOUNTING_DATABASE_URL || process.env.DATABASE_URL;
if (!rawUrl) throw new Error("Thiếu ACCOUNTING_DATABASE_URL hoặc DATABASE_URL.");
const connectionUrl = new URL(rawUrl);
if (process.env.DB_PROXY_HOST) {
  connectionUrl.hostname = process.env.DB_PROXY_HOST;
  connectionUrl.port = process.env.DB_PROXY_PORT || "5432";
  for (const key of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "host", "sslmode"]) {
    connectionUrl.searchParams.delete(key);
  }
  connectionUrl.searchParams.set("sslmode", "disable");
}

const client = new pg.Client({ connectionString: connectionUrl.toString() });
await client.connect();
try {
  await client.query("BEGIN");
  const table = (await client.query(
    "SELECT to_regclass($1) AS table_name",
    [`${SCHEMA}.accounting_report_adjustments`],
  )).rows[0]?.table_name;
  if (!table) throw new Error("Chưa có bảng lịch sử điều chỉnh kế toán.");

  const known = (await client.query(
    `SELECT adjustment_id,external_key,version_id,report_key,row_code,column_key,
            company_key,data_space_key,data_space_name,period_from,period_to,
            amount,status,reason,source_reference,supporting_data
       FROM ${SCHEMA}.accounting_report_adjustments
      WHERE external_key = ANY($1::text[])
      ORDER BY external_key`,
    [knownExternalKeys],
  )).rows;
  const unexpectedApproved = (await client.query(
    `SELECT external_key,version_id,report_key,row_code,column_key,company_key,
            data_space_name,period_from,period_to,amount,reason,source_reference,
            supporting_data->>'sourceWorkbook' AS source_workbook
       FROM ${SCHEMA}.accounting_report_adjustments
      WHERE status='APPROVED' AND NOT (external_key = ANY($1::text[]))
      ORDER BY period_to DESC,external_key`,
    [knownExternalKeys],
  )).rows;

  const changes = [];
  for (const row of known) {
    if (row.status === "VOIDED") {
      changes.push({ externalKey: row.external_key, action: "ALREADY_VOIDED", amount: Number(row.amount) });
      continue;
    }
    changes.push({ externalKey: row.external_key, action: APPLY ? "VOIDED" : "WOULD_VOID", amount: Number(row.amount), beforeStatus: row.status });
    if (!APPLY) continue;
    await client.query(
      `UPDATE ${SCHEMA}.accounting_report_adjustments
          SET status='VOIDED',voided_by=$1,voided_at=now(),updated_at=now()
        WHERE adjustment_id=$2 AND status<>'VOIDED'`,
      [ACTOR, row.adjustment_id],
    );
    await client.query(
      `INSERT INTO ${SCHEMA}.accounting_report_adjustment_events(
         adjustment_id,action,before_status,after_status,note,actor
       ) VALUES ($1,'VOID_HARDCODED_PERIOD_PLUG',$2,'VOIDED',$3,$4)`,
      [
        row.adjustment_id,
        row.status,
        "Loại khoản bù được tạo từ chênh lệch với file tay. Từ nay số liệu phải đến từ công thức nguồn hoặc điều chỉnh nghiệp vụ do kế toán lập và phê duyệt.",
        ACTOR,
      ],
    );
  }

  if (APPLY) await client.query("COMMIT");
  else await client.query("ROLLBACK");
  console.log(JSON.stringify({
    ok: true,
    apply: APPLY,
    expectedSeededAdjustmentCount: knownExternalKeys.length,
    foundSeededAdjustmentCount: known.length,
    changes,
    approvedAdjustmentsNeedingHumanClassification: unexpectedApproved,
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
