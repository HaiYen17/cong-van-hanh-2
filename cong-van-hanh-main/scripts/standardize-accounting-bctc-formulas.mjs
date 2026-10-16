import { randomUUID } from "node:crypto";

import pg from "pg";

const APPLY = process.argv.includes("--apply");
const ACTOR = process.env.ACTOR_EMAIL || "admin@nemthuanviet.vn";
const TARGET_VERSION_ID =
  process.env.TARGET_VERSION_ID || "CFG-BCTC-STD-20260731-V1";
const TARGET_VERSION_NAME =
  process.env.TARGET_VERSION_NAME || "BCTC chuẩn hóa công thức dùng chung";
const FORMULA_SCHEMA_VERSION = "BCTC_DSL_V1";
const BS = "BAO_CAO_TINH_HINH_TAI_CHINH";
const PL = "BAO_CAO_KET_QUA_KINH_DOANH";
const CF_DIRECT = "LUU_CHUYEN_TIEN_TE_TRUC_TIEP";
const CF_INDIRECT = "LUU_CHUYEN_TIEN_TE_GIAN_TIEP";

if (!process.env.DATABASE_URL) {
  throw new Error("Thiếu DATABASE_URL.");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const clone = (value) =>
  value === undefined ? undefined : structuredClone(value);
const upper = (value) => String(value || "").trim().toUpperCase();
const formulaFields = [
  "operator",
  "sourceKey",
  "datasetType",
  "accountSetKey",
  "counterAccountSetKey",
  "periodBasis",
  "periodSelector",
  "side",
  "sign",
  "conditionKey",
  "targetReportKey",
  "targetRowCode",
  "targetColumnKey",
  "expression",
  "lineRefs",
  "filters",
  "intercompanyMode",
  "maturityClass",
  "excludeClosingEntries",
  "excludeReversals",
  "useColumnBasis",
  "manualValue",
];

function pickFormula(payload) {
  return Object.fromEntries(
    formulaFields
      .filter((key) => payload[key] !== undefined)
      .map((key) => [key, clone(payload[key])]),
  );
}

function dataTerms(payload) {
  return [pickFormula(payload)];
}

function reportRowCodeMap(records) {
  const result = new Map();
  for (const record of records) {
    if (record.record_type !== "REPORT_ROW") continue;
    const ruleKey = String(record.payload?.ruleKey || "").trim();
    const rowCode = String(
      record.payload?.rowCode || record.display_code || "",
    ).trim();
    if (ruleKey && rowCode) result.set(ruleKey, rowCode);
  }
  return result;
}

function isBalanceSheetDebitOnly(rowCode) {
  return new Set(["131", "132", "211", "212"]).has(upper(rowCode));
}

function isBalanceSheetCreditOnly(rowCode) {
  return new Set(["311", "312", "331", "332"]).has(upper(rowCode));
}

function balanceSheetSide(rowCode) {
  if (isBalanceSheetDebitOnly(rowCode)) return "DEBIT";
  if (isBalanceSheetCreditOnly(rowCode)) return "CREDIT";
  const number = Number.parseInt(String(rowCode || ""), 10);
  return Number.isFinite(number) && number >= 300
    ? "CREDIT_BALANCE"
    : "DEBIT_BALANCE";
}

function standardizeColumn(payload) {
  const next = clone(payload);
  const reportKey = upper(next.reportKey);
  const columnType = upper(next.columnType);
  const valueBasis = upper(next.valueBasis);
  next.formulaSchemaVersion = FORMULA_SCHEMA_VERSION;
  if (reportKey === BS && valueBasis === "OPENING") {
    next.periodSelector = "OPENING_OF_CURRENT_RANGE";
    next.periodOffset = 0;
  } else if (columnType === "PREVIOUS_PERIOD") {
    next.periodSelector = "SAME_RANGE_PRIOR_YEAR";
    next.periodOffset = -1;
  } else if (columnType === "CURRENT_PERIOD") {
    next.periodSelector = "CURRENT_RANGE";
    next.periodOffset = 0;
  }
  return next;
}

function standardizeRule(payload, rowCode) {
  const next = clone(payload);
  const reportKey = upper(next.reportKey);
  const code = String(rowCode || next.rowCode || "").trim();
  const codeUpper = upper(code);
  const operator = upper(next.operator);
  next.formulaSchemaVersion = FORMULA_SCHEMA_VERSION;
  next.rowCode = code;
  next.excludeClosingEntries = next.excludeClosingEntries !== false;
  next.excludeReversals = next.excludeReversals === true;

  if (operator === "LINE_EXPRESSION" || operator === "SUM_LINES" || operator === "SUBTRACT_LINES") {
    next.ruleClass = "PRESENTATION_FORMULA";
    delete next.terms;
    return next;
  }

  if (reportKey === BS && codeUpper === "420B") {
    Object.assign(next, {
      operator: "CROSS_REPORT",
      sourceKey: "",
      datasetType: "",
      accountSetKey: "",
      counterAccountSetKey: "",
      targetReportKey: PL,
      targetRowCode: "60",
      side: "",
      sign: 1,
      ruleClass: "CROSS_STATEMENT_LINK",
    });
    next.terms = dataTerms(next);
    return next;
  }

  if (reportKey === BS && next.accountSetKey) {
    next.side = balanceSheetSide(code);
    next.periodBasis = "ENDING";
    next.ruleClass = "SOURCE_FORMULA";
    if (["131", "132", "211", "212", "311", "312", "331", "332"].includes(codeUpper)) {
      next.requiresDimension = "COUNTERPARTY_BALANCE";
      next.maturityClass = ["131", "132", "311", "312"].includes(codeUpper)
        ? "CURRENT"
        : "NON_CURRENT";
    }
    next.terms = dataTerms(next);
    return next;
  }

  if (reportKey === PL && codeUpper === "11") {
    const base = pickFormula(next);
    base.operator = "MOVEMENT";
    base.sourceKey = "AMIS_CAN_DOI_THOI_GIAN_THUC";
    base.datasetType = "TRIAL_BALANCE";
    base.side = "DEBIT";
    base.sign = 1;
    base.excludeClosingEntries = true;
    const investmentPropertyCost = {
      operator: "MOVEMENT_DETAIL",
      sourceKey: "AMIS_SO_CHI_TIET",
      datasetType: "GENERAL_LEDGER",
      accountSetKey: "NTK_BDSDT_GIA_TRI_CON_LAI",
      periodBasis: next.periodBasis || "YTD",
      side: "DEBIT",
      sign: -1,
      excludeClosingEntries: true,
      intercompanyMode: "EXCLUDE_INTERCOMPANY",
      filters: { transaction_class: "INVESTMENT_PROPERTY_DISPOSAL" },
    };
    next.ruleClass = "SOURCE_MINUS_CLASSIFIED_DETAIL";
    next.terms = [base, investmentPropertyCost];
    return next;
  }

  if (reportKey === PL && codeUpper === "21") {
    next.operator = "MOVEMENT_DETAIL";
    next.sourceKey = "AMIS_SO_CHI_TIET";
    next.datasetType = "GENERAL_LEDGER";
    next.sign = 1;
    next.ruleClass = "CLASSIFIED_DETAIL";
    next.terms = [
      {
        operator: "MOVEMENT_DETAIL",
        sourceKey: "AMIS_SO_CHI_TIET",
        datasetType: "GENERAL_LEDGER",
        accountSetKey: "NTK_BDSDT_DOANH_THU",
        periodBasis: next.periodBasis || "YTD",
        side: "CREDIT",
        sign: 1,
        excludeClosingEntries: true,
        filters: { transaction_class: "INVESTMENT_PROPERTY_DISPOSAL" },
      },
      {
        operator: "MOVEMENT_DETAIL",
        sourceKey: "AMIS_SO_CHI_TIET",
        datasetType: "GENERAL_LEDGER",
        accountSetKey: "NTK_BDSDT_GIA_TRI_CON_LAI",
        periodBasis: next.periodBasis || "YTD",
        side: "DEBIT",
        sign: -1,
        excludeClosingEntries: true,
        filters: { transaction_class: "INVESTMENT_PROPERTY_DISPOSAL" },
      },
    ];
    return next;
  }

  if ((reportKey === CF_DIRECT || reportKey === CF_INDIRECT) && codeUpper === "60") {
    Object.assign(next, {
      operator: "BALANCE",
      sourceKey: "AMIS_CAN_DOI_THOI_GIAN_THUC",
      accountSetKey: "",
      targetReportKey: "",
      targetRowCode: "",
      periodBasis: "OPENING",
      side: "DEBIT_BALANCE",
      sign: 1,
      ruleClass: "OPENING_BALANCE",
    });
    next.terms = [
      {
        operator: "BALANCE",
        sourceKey: "AMIS_CAN_DOI_THOI_GIAN_THUC",
        accountSetKey: "NTK_BAO_CAO_TINH_HINH_TAI_CHINH_111",
        periodBasis: "OPENING",
        useColumnBasis: false,
        side: "DEBIT_BALANCE",
        sign: 1,
      },
      {
        operator: "BALANCE",
        sourceKey: "AMIS_CAN_DOI_THOI_GIAN_THUC",
        accountSetKey: "NTK_BAO_CAO_TINH_HINH_TAI_CHINH_112",
        periodBasis: "OPENING",
        useColumnBasis: false,
        side: "DEBIT_BALANCE",
        sign: 1,
      },
    ];
    return next;
  }

  if (reportKey === CF_INDIRECT && operator === "DELTA_BALANCE") {
    if (["09", "10", "12", "13"].includes(codeUpper)) {
      next.side = "DEBIT_BALANCE";
      next.sign = -1;
    } else if (["03", "11"].includes(codeUpper)) {
      next.side = "CREDIT_BALANCE";
      next.sign = 1;
    }
  }

  if (reportKey === CF_INDIRECT && codeUpper === "02") {
    next.side = "CREDIT";
    next.sign = 1;
  }
  if (reportKey === CF_INDIRECT && codeUpper === "05") {
    next.sign = -1;
  }

  if ((reportKey === CF_DIRECT || reportKey === CF_INDIRECT) && operator === "CASH_MOVEMENT") {
    next.sign = upper(next.side) === "CREDIT" ? -1 : 1;
  }

  if (operator === "MANUAL_ADJUSTMENT") {
    return null;
  }

  if (next.accountSetKey || operator === "CROSS_REPORT") {
    next.ruleClass = operator === "CROSS_REPORT"
      ? "CROSS_STATEMENT_LINK"
      : "SOURCE_FORMULA";
    next.terms = dataTerms(next);
  }
  return next;
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
      versionId,
      recordId,
      recordType,
      displayName,
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after),
      ACTOR,
      note,
    ],
  );
}

async function insertSimpleRecord({ recordType, entityKey, parentKey = "", displayCode, displayName, sortOrder = 0, payload }) {
  const recordId = randomUUID();
  await client.query(
    `INSERT INTO accounting_portal.config_records(
       record_id,version_id,record_type,entity_key,parent_key,company_key,
       display_code,display_name,status_label,valid_from,valid_to,sort_order,
       payload,created_by,updated_by
     ) VALUES ($1,$2,$3,$4,$5,'',$6,$7,'Đang dùng','','',$8,$9::jsonb,$10,$10)`,
    [recordId, TARGET_VERSION_ID, recordType, entityKey, parentKey, displayCode, displayName, sortOrder, JSON.stringify(payload), ACTOR],
  );
  return recordId;
}

try {
  await client.query("BEGIN");
  const existingTarget = await client.query(
    "SELECT version_id FROM accounting_portal.config_versions WHERE version_id=$1",
    [TARGET_VERSION_ID],
  );
  if (existingTarget.rowCount) {
    throw new Error(`Phiên bản ${TARGET_VERSION_ID} đã tồn tại; không ghi đè.`);
  }
  const sourceResult = await client.query(
    `SELECT * FROM accounting_portal.config_versions
     WHERE version_id=COALESCE(NULLIF($1,''),(
       SELECT version_id FROM accounting_portal.config_versions
       ORDER BY updated_at DESC NULLS LAST,created_at DESC LIMIT 1
     ))`,
    [process.env.SOURCE_VERSION_ID || ""],
  );
  const sourceVersion = sourceResult.rows[0];
  if (!sourceVersion) throw new Error("Không tìm thấy phiên bản cấu hình nguồn.");

  const note =
    "Chuẩn hóa BCTC_DSL_V1 từ đối chiếu file kế toán 4 BCTC_Global.xlsx tháng 01/2026. " +
    "Tháng 01 chỉ là bộ kiểm thử; công thức dùng chung cho mọi kỳ, công ty và khối dữ liệu.";
  await client.query(
    `INSERT INTO accounting_portal.config_versions(
       version_id,version_name,status_code,source_version_id,note,created_by,updated_by
     ) VALUES ($1,$2,'DRAFT',$3,$4,$5,$5)`,
    [TARGET_VERSION_ID, TARGET_VERSION_NAME, sourceVersion.version_id, note, ACTOR],
  );
  const cloneResult = await client.query(
    `INSERT INTO accounting_portal.config_records(
       record_id,version_id,record_type,entity_key,parent_key,company_key,
       display_code,display_name,status_label,valid_from,valid_to,sort_order,
       payload,created_by,updated_by
     )
     SELECT gen_random_uuid()::text,$1,record_type,entity_key,parent_key,company_key,
            display_code,display_name,status_label,valid_from,valid_to,sort_order,
            payload,$2,$2
     FROM accounting_portal.config_records
     WHERE version_id=$3 AND record_type<>'CONFIG_VERSION' AND deleted_at IS NULL`,
    [TARGET_VERSION_ID, ACTOR, sourceVersion.version_id],
  );

  const clonedRecords = (await client.query(
    `SELECT record_id,record_type,entity_key,parent_key,display_code,display_name,sort_order,payload
     FROM accounting_portal.config_records
     WHERE version_id=$1 AND deleted_at IS NULL
     ORDER BY sort_order,record_id`,
    [TARGET_VERSION_ID],
  )).rows;
  const rowCodes = reportRowCodeMap(clonedRecords);
  let updatedColumns = 0;
  let updatedRules = 0;

  for (const record of clonedRecords) {
    let after;
    if (record.record_type === "REPORT_COLUMN") {
      after = standardizeColumn(record.payload);
      updatedColumns += 1;
    } else if (record.record_type === "RULE") {
      after = standardizeRule(
        record.payload,
        rowCodes.get(record.entity_key) || record.payload?.rowCode || "",
      );
      updatedRules += 1;
    } else if (record.record_type === "DATA_SOURCE" && upper(record.entity_key) === "AMIS_SO_CHI_TIET") {
      after = { ...clone(record.payload), autoIncludeInReports: true, formulaSchemaVersion: FORMULA_SCHEMA_VERSION };
    } else {
      continue;
    }
    if (after === null) {
      await client.query(
        `UPDATE accounting_portal.config_records
         SET deleted_at=now(),updated_at=now(),updated_by=$1
         WHERE record_id=$2 AND version_id=$3`,
        [ACTOR, record.record_id, TARGET_VERSION_ID],
      );
      await insertAudit({
        action: "REMOVE_MANUAL_ADJUSTMENT_RULE",
        versionId: TARGET_VERSION_ID,
        recordId: record.record_id,
        recordType: record.record_type,
        displayName: record.display_name,
        before: record.payload,
        after: null,
        note: "Không mang công thức điều chỉnh bằng tay sang phiên bản chuẩn hóa.",
      });
      continue;
    }
    await client.query(
      `UPDATE accounting_portal.config_records
       SET payload=$1::jsonb,updated_at=now(),updated_by=$2
       WHERE record_id=$3 AND version_id=$4`,
      [JSON.stringify(after), ACTOR, record.record_id, TARGET_VERSION_ID],
    );
    await insertAudit({
      action: "STANDARDIZE_BCTC_FORMULA",
      versionId: TARGET_VERSION_ID,
      recordId: record.record_id,
      recordType: record.record_type,
      displayName: record.display_name,
      before: record.payload,
      after,
      note: "Chuẩn hóa BCTC_DSL_V1; không chứa số chốt riêng của tháng 01/2026.",
    });
  }

  const extraSets = [
    ["NTK_BDSDT_DOANH_THU", "BĐS đầu tư · Doanh thu thanh lý/nhượng bán", "5117"],
    ["NTK_BDSDT_GIA_TRI_CON_LAI", "BĐS đầu tư · Giá trị còn lại và chi phí thanh lý", "632"],
  ];
  for (const [setKey, setName, accountPrefix] of extraSets) {
    await insertSimpleRecord({
      recordType: "ACCOUNT_SET",
      entityKey: setKey,
      displayCode: setKey,
      displayName: setName,
      sortOrder: 9991,
      payload: { accountSetKey: setKey, setName, status: "ACTIVE", formulaSchemaVersion: FORMULA_SCHEMA_VERSION },
    });
    await insertSimpleRecord({
      recordType: "ACCOUNT_SET_MEMBER",
      entityKey: `${setKey}:ALL:INCLUDE:PREFIX:${accountPrefix}`,
      parentKey: setKey,
      displayCode: accountPrefix,
      displayName: `${setName} · ${accountPrefix}`,
      sortOrder: 9992,
      payload: {
        accountSetKey: setKey,
        companyKey: "",
        role: "INCLUDE",
        matchType: "PREFIX",
        matchValue: accountPrefix,
        status: "ACTIVE",
        confidence: "REVIEW",
        sourceNote: "Phân loại đúng bằng transaction_class khi đã có Sổ chi tiết.",
      },
    });
  }

  await insertAudit({
    action: "CREATE_VERSION",
    versionId: TARGET_VERSION_ID,
    recordId: TARGET_VERSION_ID,
    recordType: "CONFIG_VERSION",
    displayName: TARGET_VERSION_NAME,
    before: null,
    after: {
      versionId: TARGET_VERSION_ID,
      versionName: TARGET_VERSION_NAME,
      sourceVersionId: sourceVersion.version_id,
      statusCode: "DRAFT",
      formulaSchemaVersion: FORMULA_SCHEMA_VERSION,
    },
    note,
  });

  const verification = (await client.query(
    `SELECT record_type,count(*)::int AS count
     FROM accounting_portal.config_records
     WHERE version_id=$1 AND deleted_at IS NULL
     GROUP BY record_type ORDER BY record_type`,
    [TARGET_VERSION_ID],
  )).rows;
  const criticalRules = (await client.query(
    `SELECT payload->>'reportKey' AS report_key,
            payload->>'rowCode' AS row_code,
            payload->>'operator' AS operator,
            payload->>'side' AS side,
            COALESCE((payload->>'sign')::numeric,1) AS sign,
            payload->>'targetReportKey' AS target_report_key,
            payload->>'targetRowCode' AS target_row_code,
            payload->'terms' AS terms
     FROM accounting_portal.config_records
     WHERE version_id=$1 AND record_type='RULE' AND deleted_at IS NULL
       AND (
         (payload->>'reportKey'=$2 AND upper(payload->>'rowCode') IN ('111','311','420B')) OR
         (payload->>'reportKey'=$3 AND upper(payload->>'rowCode') IN ('11','21','60')) OR
         (payload->>'reportKey'=$4 AND upper(payload->>'rowCode') IN ('02','60')) OR
         (payload->>'reportKey'=$5 AND upper(payload->>'rowCode') IN ('09','11','60'))
       )
     ORDER BY report_key,row_code`,
    [TARGET_VERSION_ID, BS, PL, CF_DIRECT, CF_INDIRECT],
  )).rows;
  const formulaCoverage = (await client.query(
    `SELECT count(*) FILTER (WHERE payload->>'formulaSchemaVersion'=$2)::int AS standardized,
            count(*)::int AS total,
            count(*) FILTER (
              WHERE jsonb_path_exists(payload,'$.terms[*] ? (@.operator == "MANUAL_ADJUSTMENT")')
            )::int AS manual_adjustment_terms,
            count(*) FILTER (
              WHERE COALESCE(payload->>'manualValue','') NOT IN ('','0','0.0')
            )::int AS hard_coded_manual_values
     FROM accounting_portal.config_records
     WHERE version_id=$1 AND record_type='RULE' AND deleted_at IS NULL`,
    [TARGET_VERSION_ID, FORMULA_SCHEMA_VERSION],
  )).rows[0];
  const summary = {
    apply: APPLY,
    sourceVersionId: sourceVersion.version_id,
    targetVersionId: TARGET_VERSION_ID,
    clonedRecords: cloneResult.rowCount || 0,
    updatedColumns,
    updatedRules,
    formulaSchemaVersion: FORMULA_SCHEMA_VERSION,
    verification,
    formulaCoverage,
    criticalRules,
  };

  if (APPLY) {
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
