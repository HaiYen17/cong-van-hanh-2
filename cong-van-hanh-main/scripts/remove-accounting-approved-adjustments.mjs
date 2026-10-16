import { randomUUID } from "node:crypto";

import pg from "pg";

const APPLY = process.argv.includes("--apply");
const ACTOR = process.env.ACTOR_EMAIL || "admin@nemthuanviet.vn";
const ADJUSTMENT_OPERATOR = "MANUAL_ADJUSTMENT";
const ADJUSTMENT_SOURCE_KEY = "BCTC_DIEU_CHINH";

if (!process.env.DATABASE_URL) {
  throw new Error("Thiếu DATABASE_URL.");
}

const configConnectionString = process.env.DATABASE_URL;
const runtimeConnectionString = process.env.ACCOUNTING_RUNTIME_DATABASE_URL
  || configConnectionString;
const client = new pg.Client({ connectionString: configConnectionString });
const runtimeClient = runtimeConnectionString === configConnectionString
  ? client
  : new pg.Client({ connectionString: runtimeConnectionString });
await client.connect();
if (runtimeClient !== client) await runtimeClient.connect();

const clone = (value) =>
  value === undefined ? undefined : structuredClone(value);
const upper = (value) => String(value || "").trim().toUpperCase();

function isAdjustmentTerm(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return upper(value.operator) === ADJUSTMENT_OPERATOR
    || (
      upper(value.datasetType) === ADJUSTMENT_OPERATOR
      && upper(value.sourceKey) === ADJUSTMENT_SOURCE_KEY
    );
}

function neutralRuleClass(value) {
  const ruleClass = upper(value);
  const replacements = {
    SOURCE_PLUS_ADJUSTMENT: "SOURCE_FORMULA",
    CROSS_STATEMENT_LINK_PLUS_ADJUSTMENT: "CROSS_STATEMENT_LINK",
    SOURCE_MINUS_CLASSIFIED_DETAIL_PLUS_ADJUSTMENT: "SOURCE_MINUS_CLASSIFIED_DETAIL",
    CLASSIFIED_DETAIL_PLUS_ADJUSTMENT: "CLASSIFIED_DETAIL",
    OPENING_BALANCE_PLUS_ADJUSTMENT: "OPENING_BALANCE",
  };
  return replacements[ruleClass] || value;
}

function stripAdjustmentTerms(value, stats) {
  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) {
      if (isAdjustmentTerm(item)) {
        stats.removedTerms += 1;
        continue;
      }
      next.push(stripAdjustmentTerms(item, stats));
    }
    return next;
  }
  if (!value || typeof value !== "object") return value;

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      key === "classificationPolicy"
      && upper(item) === "REQUIRE_CASH_FLOW_CODE_OR_APPROVED_ADJUSTMENT"
    ) {
      next[key] = "REQUIRE_CASH_FLOW_CODE";
    } else {
      next[key] = stripAdjustmentTerms(item, stats);
    }
  }
  if (Object.prototype.hasOwnProperty.call(next, "ruleClass")) {
    next.ruleClass = neutralRuleClass(next.ruleClass);
  }
  return next;
}

function isAdjustmentSource(record) {
  return record.record_type === "DATA_SOURCE"
    && (
      upper(record.entity_key) === ADJUSTMENT_SOURCE_KEY
      || upper(record.payload?.sourceKey) === ADJUSTMENT_SOURCE_KEY
      || upper(record.payload?.datasetType) === ADJUSTMENT_OPERATOR
    );
}

function isManualOnlyRule(record) {
  return record.record_type === "RULE"
    && upper(record.payload?.operator) === ADJUSTMENT_OPERATOR;
}

async function insertAudit({ action, versionId, recordId, recordType, displayName, before, after, note }) {
  await client.query(
    `INSERT INTO accounting_portal.audit_events(
       audit_id,action,version_id,record_id,record_type,display_name,
       before_data,after_data,actor_email,note
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
    [
      randomUUID(),
      action,
      versionId || "",
      recordId || "",
      recordType || "",
      displayName || "",
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after),
      ACTOR,
      note || "",
    ],
  );
}

try {
  await client.query("BEGIN");
  if (runtimeClient !== client) await runtimeClient.query("BEGIN");

  const records = (await client.query(
    `SELECT record_id,version_id,record_type,entity_key,display_name,payload
       FROM accounting_portal.config_records
      WHERE deleted_at IS NULL
        AND (
          payload::text ILIKE '%MANUAL_ADJUSTMENT%'
          OR payload::text ILIKE '%BCTC_DIEU_CHINH%'
      OR payload::text ILIKE '%APPROVED_ADJUSTMENT%'
      OR upper(entity_key)=$1
        )
      ORDER BY version_id,record_type,entity_key`,
    [ADJUSTMENT_SOURCE_KEY],
  )).rows;

  const summary = {
    apply: APPLY,
    actor: ACTOR,
    scannedConfigRecords: records.length,
    updatedConfigRecords: 0,
    deletedAdjustmentSources: 0,
    deletedManualOnlyRules: 0,
    removedFormulaTerms: 0,
    affectedVersions: {},
    runtimeAdjustments: {
      tableExists: false,
      permissionDenied: false,
      byStatus: [],
      deletedRows: 0,
    },
    clearedReportCacheRows: 0,
  };

  const affectedVersionIds = new Set();
  for (const record of records) {
    const versionStats = summary.affectedVersions[record.version_id] || {
      updatedRecords: 0,
      deletedSources: 0,
      deletedManualOnlyRules: 0,
      removedTerms: 0,
    };
    summary.affectedVersions[record.version_id] = versionStats;
    affectedVersionIds.add(record.version_id);

    if (isAdjustmentSource(record) || isManualOnlyRule(record)) {
      const action = isAdjustmentSource(record)
        ? "DELETE_APPROVED_ADJUSTMENT_SOURCE"
        : "DELETE_MANUAL_ONLY_FORMULA_RULE";
      if (isAdjustmentSource(record)) {
        summary.deletedAdjustmentSources += 1;
        versionStats.deletedSources += 1;
      } else {
        summary.deletedManualOnlyRules += 1;
        versionStats.deletedManualOnlyRules += 1;
      }
      if (APPLY) {
        await insertAudit({
          action,
          versionId: record.version_id,
          recordId: record.record_id,
          recordType: record.record_type,
          displayName: record.display_name,
          before: record.payload,
          after: null,
          note: "Loại bỏ hoàn toàn lớp Điều chỉnh đã duyệt khỏi công thức BCTC theo yêu cầu người dùng.",
        });
        await client.query(
          `UPDATE accounting_portal.config_records
              SET deleted_at=now(),updated_at=now(),updated_by=$1
            WHERE record_id=$2 AND deleted_at IS NULL`,
          [ACTOR, record.record_id],
        );
      }
      continue;
    }

    const stats = { removedTerms: 0 };
    const after = stripAdjustmentTerms(clone(record.payload), stats);
    if (!stats.removedTerms && JSON.stringify(after) === JSON.stringify(record.payload)) continue;

    summary.updatedConfigRecords += 1;
    summary.removedFormulaTerms += stats.removedTerms;
    versionStats.updatedRecords += 1;
    versionStats.removedTerms += stats.removedTerms;
    if (APPLY) {
      await insertAudit({
        action: "REMOVE_APPROVED_ADJUSTMENT_FORMULA_TERM",
        versionId: record.version_id,
        recordId: record.record_id,
        recordType: record.record_type,
        displayName: record.display_name,
        before: record.payload,
        after,
        note: `Đã bỏ ${stats.removedTerms} thành phần MANUAL_ADJUSTMENT; giữ nguyên toàn bộ thành phần tài khoản và dòng báo cáo còn lại.`,
      });
      await client.query(
        `UPDATE accounting_portal.config_records
            SET payload=$1::jsonb,updated_at=now(),updated_by=$2
          WHERE record_id=$3 AND deleted_at IS NULL`,
        [JSON.stringify(after), ACTOR, record.record_id],
      );
    }
  }

  let runtimeTable = null;
  await runtimeClient.query("SAVEPOINT runtime_adjustment_probe");
  try {
    runtimeTable = (await runtimeClient.query(
      "SELECT to_regclass('accounting_runtime.accounting_report_adjustments') AS table_name",
    )).rows[0]?.table_name;
    await runtimeClient.query("RELEASE SAVEPOINT runtime_adjustment_probe");
  } catch (error) {
    if (error?.code !== "42501") throw error;
    await runtimeClient.query("ROLLBACK TO SAVEPOINT runtime_adjustment_probe");
    await runtimeClient.query("RELEASE SAVEPOINT runtime_adjustment_probe");
    summary.runtimeAdjustments.permissionDenied = true;
  }
  summary.runtimeAdjustments.tableExists = Boolean(runtimeTable);
  if (runtimeTable) {
    summary.runtimeAdjustments.byStatus = (await runtimeClient.query(
      `SELECT status,count(*)::int AS count,COALESCE(sum(amount),0)::text AS amount
         FROM accounting_runtime.accounting_report_adjustments
        GROUP BY status ORDER BY status`,
    )).rows;

    if (APPLY) {
      const adjustmentRows = (await runtimeClient.query(
        `SELECT to_jsonb(a.*) AS adjustment,
                COALESCE((
                  SELECT jsonb_agg(to_jsonb(e.*) ORDER BY e.event_id)
                    FROM accounting_runtime.accounting_report_adjustment_events e
                   WHERE e.adjustment_id=a.adjustment_id
                ),'[]'::jsonb) AS events
           FROM accounting_runtime.accounting_report_adjustments a`,
      )).rows;
      for (const row of adjustmentRows) {
        const adjustment = row.adjustment || {};
        await insertAudit({
          action: "DELETE_REPORT_ADJUSTMENT",
          versionId: adjustment.version_id,
          recordId: adjustment.adjustment_id,
          recordType: "ACCOUNTING_REPORT_ADJUSTMENT",
          displayName: `${adjustment.report_key || "BCTC"} ${adjustment.row_code || ""}`.trim(),
          before: { adjustment, events: row.events || [] },
          after: null,
          note: "Xóa dữ liệu điều chỉnh báo cáo khỏi SQL; bản gốc và toàn bộ lịch sử trạng thái đã được sao lưu tại audit_events.",
        });
      }
      const deleted = await runtimeClient.query(
        "DELETE FROM accounting_runtime.accounting_report_adjustments",
      );
      summary.runtimeAdjustments.deletedRows = deleted.rowCount || 0;

      if (affectedVersionIds.size) {
        const cacheDeleted = await runtimeClient.query(
          `DELETE FROM accounting_runtime.accounting_report_cache
            WHERE config_version=ANY($1::text[])`,
          [[...affectedVersionIds]],
        );
        summary.clearedReportCacheRows = cacheDeleted.rowCount || 0;
      }
    }
  }

  if (APPLY) {
    if (runtimeClient !== client) await runtimeClient.query("COMMIT");
    await client.query("COMMIT");
  } else {
    if (runtimeClient !== client) await runtimeClient.query("ROLLBACK");
    await client.query("ROLLBACK");
  }

  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (runtimeClient !== client) {
    await runtimeClient.query("ROLLBACK").catch(() => undefined);
  }
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  if (runtimeClient !== client) await runtimeClient.end();
  await client.end();
}
