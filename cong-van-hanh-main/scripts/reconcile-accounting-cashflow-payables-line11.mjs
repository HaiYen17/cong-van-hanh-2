import { randomUUID } from "node:crypto";
import pg from "pg";

const VERSION_ID = process.env.TARGET_VERSION_ID || "CFG-BCTC-STD-20260801-V4";
const ACTOR = process.env.ACTOR_EMAIL || "Codex · chuẩn hóa LCTT dòng 11/14 2026-08-29";
const APPLY = process.argv.includes("--apply");
const REPORT_KEY = "LUU_CHUYEN_TIEN_TE_GIAN_TIEP";
const ROW_11 = "11";
const ROW_14 = "14";
const CASH_SET = "NTK_TIEN_THANH_TOAN";
const INTEREST_COUNTER_SET = "NTK_DOI_UNG_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_14";

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

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function withoutHardcodedValues(value) {
  if (Array.isArray(value)) return value.map(withoutHardcodedValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "manualValue")
      .map(([key, item]) => [key, withoutHardcodedValues(item)]),
  );
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

const client = new pg.Client({ connectionString: connectionUrl.toString() });
await client.connect();

async function audit({ action, recordId, recordType, displayName, before, after, note }) {
  await client.query(
    `INSERT INTO accounting_portal.audit_events(
       audit_id,action,version_id,record_id,record_type,display_name,
       before_data,after_data,actor_email,note
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
    [
      randomUUID(), action, VERSION_ID, recordId, recordType, displayName,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      ACTOR, note,
    ],
  );
}

async function replaceInterestCounterSet(records, changes) {
  const setRecord = records.find(
    (record) => record.record_type === "ACCOUNT_SET"
      && upper(record.entity_key) === INTEREST_COUNTER_SET,
  );
  if (!setRecord) throw new Error(`Không tìm thấy nhóm ${INTEREST_COUNTER_SET}.`);

  const setPayload = {
    ...withoutHardcodedValues(setRecord.payload || {}),
    accountSetKey: INTEREST_COUNTER_SET,
    accountSetName: "Đối ứng chi phí đi vay đã trả",
    status: "ACTIVE",
    scope: "GLOBAL",
    formulaSchemaVersion: "BCTC_DSL_V8_CONFIGURABLE_CONDITIONS",
    sourceNote: "Đối ứng tiền trả lãi có thể ghi trực tiếp vào TK 635, qua TK 335 hoặc qua TK 331. Điều kiện nội dung chứng từ tiếp tục loại tiền hàng, phí ngân hàng và nợ gốc vay; không phụ thuộc tên đối tượng.",
  };
  if (stable(setPayload) !== stable(setRecord.payload || {})) {
    changes.push({ type: "ACCOUNT_SET", entityKey: INTEREST_COUNTER_SET, action: "UPDATE" });
    if (APPLY) {
      await client.query(
        `UPDATE accounting_portal.config_records
            SET payload=$1::jsonb,company_key='',updated_at=now(),updated_by=$2
          WHERE version_id=$3 AND record_id=$4`,
        [JSON.stringify(setPayload), ACTOR, VERSION_ID, setRecord.record_id],
      );
      await audit({
        action: "UPDATE_INTEREST_PAYMENT_COUNTER_SET",
        recordId: setRecord.record_id,
        recordType: "ACCOUNT_SET",
        displayName: setRecord.display_name,
        before: setRecord.payload,
        after: setPayload,
        note: "Chuẩn hóa nhóm đối ứng dòng 14 dùng chung mọi công ty; không lọc theo tên người/nhà cung cấp.",
      });
    }
  }

  const members = records.filter(
    (record) => record.record_type === "ACCOUNT_SET_MEMBER"
      && upper(record.payload?.accountSetKey || record.parent_key) === INTEREST_COUNTER_SET,
  );
  const desiredCodes = ["331", "335", "635"];
  const normalizedMembers = members.map((record) => ({
    companyKey: upper(record.payload?.companyKey || record.company_key),
    role: upper(record.payload?.role || "INCLUDE"),
    status: upper(record.payload?.status || "ACTIVE"),
    matchType: upper(record.payload?.matchType || "PREFIX"),
    matchValue: String(record.payload?.matchValue || "").trim(),
  }));
  const desiredMembers = desiredCodes.map((matchValue) => ({
    companyKey: "",
    role: "INCLUDE",
    status: "ACTIVE",
    matchType: "PREFIX",
    matchValue,
  }));
  const membersCorrect = stable([...normalizedMembers].sort((a, b) => stable(a).localeCompare(stable(b))))
    === stable([...desiredMembers].sort((a, b) => stable(a).localeCompare(stable(b))));
  if (membersCorrect) return;

  changes.push({
    type: "ACCOUNT_SET_MEMBER",
    entityKey: INTEREST_COUNTER_SET,
    action: "REPLACE_GLOBAL",
    beforeCount: members.length,
    after: desiredCodes,
  });
  if (!APPLY) return;

  for (const record of members) {
    await client.query(
      `UPDATE accounting_portal.config_records
          SET deleted_at=now(),updated_at=now(),updated_by=$1
        WHERE version_id=$2 AND record_id=$3`,
      [ACTOR, VERSION_ID, record.record_id],
    );
    await audit({
      action: "REPLACE_INTEREST_PAYMENT_COUNTER_MEMBER",
      recordId: record.record_id,
      recordType: "ACCOUNT_SET_MEMBER",
      displayName: record.display_name,
      before: record.payload,
      after: null,
      note: "Thay nhóm thành viên theo công ty bằng một nhóm dùng chung toàn hệ thống.",
    });
  }

  for (const [index, code] of desiredCodes.entries()) {
    const recordId = randomUUID();
    const payload = {
      accountSetKey: INTEREST_COUNTER_SET,
      companyKey: "",
      role: "INCLUDE",
      status: "ACTIVE",
      matchType: "PREFIX",
      matchValue: code,
      confidence: "VERIFIED",
      sourceRef: "Nghiệp vụ trả chi phí đi vay theo sổ Nhật ký chung",
      sourceNote: code === "635"
        ? "Trả trực tiếp chi phí đi vay đã ghi nhận trong kỳ."
        : code === "335"
          ? "Thanh toán chi phí đi vay đã trích trước."
          : "Thanh toán chi phí đi vay đang theo dõi qua phải trả người bán/đối tượng khác.",
    };
    await client.query(
      `INSERT INTO accounting_portal.config_records(
         record_id,version_id,record_type,entity_key,parent_key,company_key,
         display_code,display_name,status_label,valid_from,valid_to,sort_order,
         payload,created_by,updated_by
       ) VALUES ($1,$2,'ACCOUNT_SET_MEMBER',$3,$4,'',$5,$6,'Đang dùng','','',$7,$8::jsonb,$9,$9)`,
      [
        recordId,
        VERSION_ID,
        `${INTEREST_COUNTER_SET}:ALL:INCLUDE:PREFIX:${code}`,
        INTEREST_COUNTER_SET,
        code,
        `Đối ứng chi phí đi vay đã trả · TK ${code}*`,
        9140 + index,
        JSON.stringify(payload),
        ACTOR,
      ],
    );
    await audit({
      action: "REPLACE_INTEREST_PAYMENT_COUNTER_MEMBER",
      recordId,
      recordType: "ACCOUNT_SET_MEMBER",
      displayName: `Đối ứng chi phí đi vay đã trả · TK ${code}*`,
      before: null,
      after: payload,
      note: "Thành viên dùng chung, kết hợp điều kiện nghiệp vụ thay vì tên đối tượng.",
    });
  }
}

function rowCodeForRule(record, rowByRule) {
  return upper(record.payload?.rowCode || rowByRule.get(upper(record.entity_key)));
}

try {
  await client.query("BEGIN");
  const version = (await client.query(
    `SELECT version_id,status_code FROM accounting_portal.config_versions
      WHERE version_id=$1 FOR UPDATE`,
    [VERSION_ID],
  )).rows[0];
  if (!version) throw new Error(`Không tìm thấy phiên bản ${VERSION_ID}.`);
  if (version.status_code !== "DRAFT") throw new Error("Chỉ được sửa phiên bản đang soạn.");

  const records = (await client.query(
    `SELECT record_id,record_type,entity_key,parent_key,company_key,display_name,payload
       FROM accounting_portal.config_records
      WHERE version_id=$1 AND deleted_at IS NULL
        AND record_type IN ('ACCOUNT_SET','ACCOUNT_SET_MEMBER','RULE','REPORT_ROW')
      ORDER BY sort_order,record_id`,
    [VERSION_ID],
  )).rows;
  const changes = [];
  await replaceInterestCounterSet(records, changes);

  const rowByRule = new Map(
    records
      .filter((record) => record.record_type === "REPORT_ROW")
      .map((record) => [upper(record.payload?.ruleKey), upper(record.payload?.rowCode)]),
  );
  const rule14 = records.find(
    (record) => record.record_type === "RULE"
      && upper(record.payload?.reportKey) === REPORT_KEY
      && rowCodeForRule(record, rowByRule) === ROW_14,
  );
  const rule11 = records.find(
    (record) => record.record_type === "RULE"
      && upper(record.payload?.reportKey) === REPORT_KEY
      && rowCodeForRule(record, rowByRule) === ROW_11,
  );
  if (!rule14 || !rule11) throw new Error("Không tìm đủ công thức dòng 11 và dòng 14 của LCTT gián tiếp.");

  const filters = {
    logic: "ANY",
    conditions: [
      { field: "cash_flow_code", operator: "EQUALS_ANY", value: ["14"] },
      {
        field: "search_text",
        operator: "CONTAINS_ANY",
        value: ["lãi vay", "trả lãi", "thanh toán lãi", "loan interest", "interest paid"],
      },
    ],
  };
  const interestPaidTerm = {
    operator: "CASH_MOVEMENT",
    sign: -1,
    side: "CREDIT",
    periodBasis: "YTD",
    useColumnBasis: false,
    sourceKey: "AMIS_SO_CHI_TIET",
    datasetType: "GENERAL_LEDGER",
    accountSetKey: CASH_SET,
    counterAccountSetKey: INTEREST_COUNTER_SET,
    filters,
    intercompanyMode: "EXCLUDE_INTERCOMPANY",
    excludeClosingEntries: true,
    excludeReversals: true,
  };
  const rule14After = {
    ...withoutHardcodedValues(rule14.payload || {}),
    reportKey: REPORT_KEY,
    rowCode: ROW_14,
    operator: interestPaidTerm.operator,
    sign: interestPaidTerm.sign,
    side: interestPaidTerm.side,
    periodBasis: interestPaidTerm.periodBasis,
    sourceKey: interestPaidTerm.sourceKey,
    datasetType: interestPaidTerm.datasetType,
    accountSetKey: interestPaidTerm.accountSetKey,
    counterAccountSetKey: interestPaidTerm.counterAccountSetKey,
    filters,
    terms: [interestPaidTerm],
    ruleClass: "CONFIGURABLE_ACCOUNT_PAIR_WITH_BUSINESS_CONDITIONS",
    formulaSchemaVersion: "BCTC_DSL_V8_CONFIGURABLE_CONDITIONS",
    reconciliationBasis: "CASH_CREDIT_MATCHED_BY_ACCOUNT_PAIR_AND_BUSINESS_CONDITION",
    reconciliationPolicy: "STRUCTURAL_FORMULA_NOT_PERSON_OR_PERIOD_HARDCODE",
    confidence: "HIGH",
    sourceNote: "Chi phí đi vay đã trả = phát sinh Có các tài khoản tiền 111/112/113 đối ứng Nợ 331/335/635, đồng thời thỏa mãn mã dòng tiền MISA hoặc nội dung chứng từ về trả lãi. Không dùng tên cá nhân, tên ngân hàng hay số tiền cố định; nợ gốc vay và phí dịch vụ bị loại bởi nhóm đối ứng + điều kiện nghiệp vụ.",
  };
  for (const key of ["conditionKey", "conditionRequirement", "classificationPolicy", "manualValue"]) {
    delete rule14After[key];
  }

  const previousGrossTerm = (rule11.payload?.terms || []).find(
    (term) => upper(term?.operator) === "DELTA_BALANCE",
  ) || rule11.payload || {};
  const grossPayablesTerm = {
    ...withoutHardcodedValues(previousGrossTerm),
    operator: "DELTA_BALANCE",
    sign: 1,
    side: "CREDIT",
    periodBasis: "DELTA",
    sourceKey: "AMIS_CAN_DOI_THOI_GIAN_THUC",
    accountSetKey: "NTK_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_11",
    excludeClosingEntries: true,
  };
  delete grossPayablesTerm.conditionKey;
  delete grossPayablesTerm.filters;
  const rule11After = {
    ...withoutHardcodedValues(rule11.payload || {}),
    reportKey: REPORT_KEY,
    rowCode: ROW_11,
    operator: "DELTA_BALANCE",
    sign: 1,
    side: "CREDIT",
    periodBasis: "DELTA",
    sourceKey: "AMIS_CAN_DOI_THOI_GIAN_THUC",
    accountSetKey: "NTK_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_11",
    terms: [
      grossPayablesTerm,
      { operator: "LINE_REFERENCE", targetRowCode: "06", sign: -1 },
      { operator: "LINE_REFERENCE", targetRowCode: "14", sign: -1 },
    ],
    ruleClass: "GROSS_PAYABLE_CHANGE_EXCLUDING_INTEREST_PAYABLE",
    formulaSchemaVersion: "BCTC_DSL_V8_CONFIGURABLE_CONDITIONS",
    reconciliationBasis: "GROSS_PAYABLE_DELTA_MINUS_INTEREST_EXPENSE_MINUS_INTEREST_PAID",
    reconciliationPolicy: "STRUCTURAL_FORMULA_NOT_PERSON_OR_PERIOD_HARDCODE",
    confidence: "HIGH",
    sourceNote: "Tăng/giảm các khoản phải trả không kể lãi vay phải trả = biến động Có gộp của nhóm phải trả − dòng 06 Chi phí đi vay − dòng 14 Chi phí đi vay đã trả. Vì dòng 14 mang dấu âm trên LCTT, phép trừ dòng 14 tự cộng lại phần tiền lãi đã thanh toán; kết quả loại đúng biến động lãi vay phải trả mà không gắn số cố định.",
  };
  for (const key of ["conditionKey", "conditionRequirement", "classificationPolicy", "manualValue"]) {
    delete rule11After[key];
  }

  for (const [record, after, action, note] of [
    [rule14, rule14After, "RECONCILE_INTEREST_PAID_WITH_CONFIGURABLE_CONDITIONS", "Dòng 14 tự nhận nghiệp vụ trả lãi theo tài khoản + điều kiện cấu hình, không theo tên đối tượng."],
    [rule11, rule11After, "RECONCILE_PAYABLE_CHANGE_EXCLUDING_INTEREST", "Dòng 11 loại biến động lãi vay phải trả bằng liên kết động đến dòng 06 và 14."],
  ]) {
    if (stable(after) === stable(record.payload || {})) continue;
    changes.push({ type: "RULE", entityKey: record.entity_key, action });
    if (!APPLY) continue;
    await client.query(
      `UPDATE accounting_portal.config_records
          SET payload=$1::jsonb,updated_at=now(),updated_by=$2
        WHERE version_id=$3 AND record_id=$4`,
      [JSON.stringify(after), ACTOR, VERSION_ID, record.record_id],
    );
    await audit({
      action,
      recordId: record.record_id,
      recordType: "RULE",
      displayName: record.display_name,
      before: record.payload,
      after,
      note,
    });
  }

  if (APPLY) {
    const versionNote = "2026-08-29: Dòng 14 tự nhận chi phí đi vay đã trả bằng cặp tài khoản + Điều kiện áp dụng; dòng 11 = biến động phải trả gộp - dòng 06 - dòng 14. Không tên đối tượng, không số cố định.";
    await client.query(
      `UPDATE accounting_portal.config_versions
          SET note=CASE WHEN strpos(COALESCE(note,''),$1)>0 THEN note ELSE concat_ws(E'\\n',note,$1) END,
              updated_at=now(),updated_by=$2
        WHERE version_id=$3`,
      [versionNote, ACTOR, VERSION_ID],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, versionId: VERSION_ID, changes }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
