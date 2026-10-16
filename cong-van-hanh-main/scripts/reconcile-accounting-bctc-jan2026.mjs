import { randomUUID } from "node:crypto";
import pg from "pg";

const VERSION_ID = process.env.TARGET_VERSION_ID || "CFG-BCTC-STD-20260731-V1";
const ACTOR = process.env.ACTOR_EMAIL || "admin@nemthuanviet.vn";
const COMPANY_KEY = process.env.COMPANY_KEY || "NTV";
const APPLY = process.argv.includes("--apply");
const BS = "BAO_CAO_TINH_HINH_TAI_CHINH";
const PL = "BAO_CAO_KET_QUA_KINH_DOANH";

if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL.");
const connectionUrl = new URL(process.env.DATABASE_URL);
connectionUrl.port = process.env.DB_PROXY_PORT || connectionUrl.port;
const client = new pg.Client({ connectionString: connectionUrl.toString() });
await client.connect();

const desiredMembers = new Map([
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_112", ["12811"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_123", ["12812", "1282", "1283", "1288"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_135", ["13881", "141", "2441"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_141", ["151", "152", "1531", "1541", "1542", "1543", "155", "156", "157", "158"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_161", ["2421"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_163", ["133", "333"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_211", ["1312"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_212", ["3312"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_215", ["13882", "2442"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_251", ["1548"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_265", ["1282", "1283", "1288"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_271", ["2422"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_273", ["1538"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_320", ["338", "344"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_321", ["34111", "3431"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_331", ["3312"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_332", ["1312"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_333", ["3338"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_334", ["3352"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_338", ["3389", "344"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_339", ["34112", "3432"]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_420A", ["421"]],
]);

const rulePatches = new Map([
  [`${PL}:11`, { side: "CREDIT" }],
  [`${PL}:23`, { side: "CREDIT" }],
  [`${PL}:24`, { side: "CREDIT" }],
  [`${PL}:25`, { side: "CREDIT" }],
  [`${PL}:26`, { side: "CREDIT" }],
  [`${PL}:32`, { side: "CREDIT" }],
  [`${BS}:135`, { side: "DEBIT" }],
  [`${BS}:163`, { side: "DEBIT" }],
  [`${BS}:215`, { side: "DEBIT" }],
  [`${BS}:320`, { side: "CREDIT" }],
  [`${BS}:420A`, {
    operator: "BALANCE",
    side: "CREDIT_BALANCE",
    periodBasis: "OPENING",
    periodSelector: "OPENING_OF_CURRENT_RANGE",
    useColumnBasis: false,
    ruleClass: "OPENING_RETAINED_EARNINGS_PLUS_ADJUSTMENT",
  }],
]);

function stable(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

async function audit({ action, recordId, recordType, displayName, before, after, note }) {
  await client.query(
    `INSERT INTO accounting_portal.audit_events(
       audit_id,action,version_id,record_id,record_type,display_name,
       before_data,after_data,actor_email,note
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
    [
      randomUUID(), action, VERSION_ID, recordId, recordType, displayName,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after), ACTOR, note,
    ],
  );
}

function patchTerms(payload, patch) {
  const next = structuredClone(payload);
  Object.assign(next, patch, {
    reconciliationBasis: "ACCOUNTANT_GOLDEN_2026_01",
    reconciliationPolicy: "STRUCTURAL_FORMULA_NOT_PERIOD_HARDCODE",
  });
  if (Array.isArray(next.terms) && next.terms.length) {
    next.terms = next.terms.map((term, index) => {
      if (index !== 0 || String(term?.operator || "").toUpperCase() === "MANUAL_ADJUSTMENT") return term;
      return { ...term, ...patch };
    });
  }
  return next;
}

try {
  await client.query("BEGIN");
  const version = (await client.query(
    `SELECT version_id,status_code FROM accounting_portal.config_versions WHERE version_id=$1 FOR UPDATE`,
    [VERSION_ID],
  )).rows[0];
  if (!version) throw new Error(`Không tìm thấy phiên bản ${VERSION_ID}.`);
  if (version.status_code !== "DRAFT") throw new Error("Chỉ được hiệu chỉnh phiên bản đang soạn.");

  const records = (await client.query(
    `SELECT record_id,record_type,entity_key,display_code,display_name,payload
       FROM accounting_portal.config_records
      WHERE version_id=$1 AND deleted_at IS NULL
        AND record_type IN ('RULE','ACCOUNT_SET_MEMBER')
      ORDER BY sort_order,record_id`,
    [VERSION_ID],
  )).rows;
  const rowCodeByRule = new Map((await client.query(
    `SELECT payload->>'ruleKey' AS rule_key,
            COALESCE(payload->>'rowCode',display_code) AS row_code
       FROM accounting_portal.config_records
      WHERE version_id=$1 AND record_type='REPORT_ROW' AND deleted_at IS NULL`,
    [VERSION_ID],
  )).rows.map((row) => [row.rule_key, row.row_code]));

  let changedRules = 0;
  for (const record of records.filter((item) => item.record_type === "RULE")) {
    const reportKey = String(record.payload?.reportKey || "").toUpperCase();
    const rowCode = String(rowCodeByRule.get(record.entity_key) || record.payload?.rowCode || "").toUpperCase();
    const patch = rulePatches.get(`${reportKey}:${rowCode}`);
    if (!patch) continue;
    const after = patchTerms(record.payload, patch);
    if (JSON.stringify(after) === JSON.stringify(record.payload)) continue;
    changedRules += 1;
    if (APPLY) {
      await client.query(
        `UPDATE accounting_portal.config_records
            SET payload=$1::jsonb,updated_at=now(),updated_by=$2
          WHERE record_id=$3 AND version_id=$4`,
        [JSON.stringify(after), ACTOR, record.record_id, VERSION_ID],
      );
      await audit({
        action: "RECONCILE_BCTC_FORMULA",
        recordId: record.record_id,
        recordType: record.record_type,
        displayName: record.display_name,
        before: record.payload,
        after,
        note: "Sửa phía lấy số/kỳ lấy số theo nguyên tắc BCTC; không ghi cứng số tháng 01/2026.",
      });
    }
  }

  let changedSets = 0;
  for (const [setKey, desiredCodes] of desiredMembers) {
    const current = records.filter((item) =>
      item.record_type === "ACCOUNT_SET_MEMBER"
      && String(item.payload?.accountSetKey || "").toUpperCase() === setKey
      && String(item.payload?.companyKey || "").toUpperCase() === COMPANY_KEY,
    );
    const currentCodes = current
      .filter((item) => String(item.payload?.role || "INCLUDE").toUpperCase() === "INCLUDE")
      .map((item) => String(item.payload?.matchValue || ""))
      .sort();
    const desiredSorted = [...desiredCodes].sort();
    const hasExclude = current.some((item) => String(item.payload?.role || "").toUpperCase() === "EXCLUDE");
    if (!hasExclude && stable(currentCodes) === stable(desiredSorted)) continue;
    changedSets += 1;
    if (!APPLY) continue;

    for (const item of current) {
      await client.query(
        `UPDATE accounting_portal.config_records
            SET deleted_at=now(),updated_at=now(),updated_by=$1
          WHERE record_id=$2 AND version_id=$3`,
        [ACTOR, item.record_id, VERSION_ID],
      );
      await audit({
        action: "REPLACE_ACCOUNT_SET_MEMBER",
        recordId: item.record_id,
        recordType: item.record_type,
        displayName: item.display_name,
        before: item.payload,
        after: null,
        note: `Thay danh mục ${setKey} để không tính trùng ngắn hạn/dài hạn.`,
      });
    }
    for (const [index, accountCode] of desiredCodes.entries()) {
      const recordId = randomUUID();
      const payload = {
        accountSetKey: setKey,
        companyKey: COMPANY_KEY,
        role: "INCLUDE",
        matchType: "PREFIX",
        matchValue: accountCode,
        status: "ACTIVE",
        confidence: "VERIFIED",
        sourceNote: "Đối chiếu cấu trúc tài khoản và BCTC kế toán tháng 01/2026; áp dụng theo mã tài khoản, không theo số tiền.",
      };
      await client.query(
        `INSERT INTO accounting_portal.config_records(
           record_id,version_id,record_type,entity_key,parent_key,company_key,
           display_code,display_name,status_label,valid_from,valid_to,sort_order,
           payload,created_by,updated_by
         ) VALUES ($1,$2,'ACCOUNT_SET_MEMBER',$3,$4,$5,$6,$7,'Đang dùng','','',$8,$9::jsonb,$10,$10)`,
        [
          recordId, VERSION_ID, `${setKey}:${COMPANY_KEY}:INCLUDE:PREFIX:${accountCode}`,
          setKey, COMPANY_KEY, accountCode, `${setKey} · ${accountCode}`,
          1000 + index, JSON.stringify(payload), ACTOR,
        ],
      );
      await audit({
        action: "REPLACE_ACCOUNT_SET_MEMBER",
        recordId,
        recordType: "ACCOUNT_SET_MEMBER",
        displayName: `${setKey} · ${accountCode}`,
        before: null,
        after: payload,
        note: `Thành viên chuẩn hóa của ${setKey}.`,
      });
    }
  }

  if (APPLY) {
    await client.query(
      `UPDATE accounting_portal.config_versions
          SET note=concat_ws(E'\n',note,$1::text),updated_at=now(),updated_by=$2
        WHERE version_id=$3`,
      [
        "Đã đối chiếu công thức với 4 BCTC_Global.xlsx: tách tài khoản ngắn/dài hạn, sửa phía phát sinh chi phí và lợi nhuận giữ lại. Chênh số liệu nguồn được để ở lớp điều chỉnh có lịch sử.",
        ACTOR,
        VERSION_ID,
      ],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, versionId: VERSION_ID, changedRules, changedSets }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
