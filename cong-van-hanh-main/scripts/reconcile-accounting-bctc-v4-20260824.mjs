import { randomUUID } from "node:crypto";
import pg from "pg";

const VERSION_ID = process.env.TARGET_VERSION_ID || "CFG-BCTC-STD-20260801-V4";
const COMPANY_KEY = String(process.env.COMPANY_KEY || "TVG").trim().toUpperCase();
const ACTOR = process.env.ACTOR_EMAIL || "Codex · đối chiếu BCTC 2026-08-24";
const APPLY = process.argv.includes("--apply");
const BALANCE_SHEET = "BAO_CAO_TINH_HINH_TAI_CHINH";
const CASH_FLOW_REPORTS = new Set([
  "LUU_CHUYEN_TIEN_TE_TRUC_TIEP",
  "LUU_CHUYEN_TIEN_TE_GIAN_TIEP",
]);
const REQUIRED_CASH_FLOW_ROWS = new Map([
  ["LUU_CHUYEN_TIEN_TE_TRUC_TIEP", new Set(["22", "36"])],
  ["LUU_CHUYEN_TIEN_TE_GIAN_TIEP", new Set(["14", "16", "17", "22", "36"])],
]);
const REQUIRED_CASH_FLOW_POLICY = "REQUIRE_CASH_FLOW_CODE";

if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL.");
const connectionUrl = new URL(process.env.DATABASE_URL);
connectionUrl.hostname = process.env.DB_PROXY_HOST || connectionUrl.hostname;
connectionUrl.port = process.env.DB_PROXY_PORT || connectionUrl.port;
if (process.env.DB_PROXY_HOST) {
  for (const key of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "host", "sslmode"]) {
    connectionUrl.searchParams.delete(key);
  }
  connectionUrl.searchParams.set("sslmode", "disable");
}
const client = new pg.Client({ connectionString: connectionUrl.toString() });
await client.connect();

const desiredMembers = new Map([
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_112", [{ matchType: "PREFIX", matchValue: "12811" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_123", [{ matchType: "PREFIX", matchValue: "12812" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_131", [{ matchType: "PREFIX", matchValue: "1311" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_132", [{ matchType: "PREFIX", matchValue: "3311" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_135", [
    { matchType: "PREFIX", matchValue: "13881" },
    { matchType: "PREFIX", matchValue: "141" },
    { matchType: "PREFIX", matchValue: "2441" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_141", [{
    matchType: "MIXED",
    matchValue: "151*, 152*, 1531*, 1541*, 1542*, 1543*, 155*, 156*, 157*, 158*",
  }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_161", [{ matchType: "PREFIX", matchValue: "2421" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_211", [{ matchType: "PREFIX", matchValue: "1312" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_212", [{ matchType: "PREFIX", matchValue: "3312" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_215", [
    { matchType: "PREFIX", matchValue: "13882" },
    { matchType: "PREFIX", matchValue: "2442" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_251", [{ matchType: "PREFIX", matchValue: "1548" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_265", [
    { matchType: "PREFIX", matchValue: "1282" },
    { matchType: "PREFIX", matchValue: "1283" },
    { matchType: "PREFIX", matchValue: "1288" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_271", [{ matchType: "PREFIX", matchValue: "2422" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_273", [{ matchType: "PREFIX", matchValue: "1538" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_311", [
    { role: "INCLUDE", matchType: "PREFIX", matchValue: "331" },
    { role: "EXCLUDE", matchType: "PREFIX", matchValue: "3312" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_312", [{ matchType: "PREFIX", matchValue: "1311" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_314", [
    { matchType: "PREFIX", matchValue: "3331" },
    { matchType: "PREFIX", matchValue: "3332" },
    { matchType: "PREFIX", matchValue: "3333" },
    { matchType: "PREFIX", matchValue: "3334" },
    { matchType: "PREFIX", matchValue: "3335" },
    { matchType: "PREFIX", matchValue: "3336" },
    { matchType: "PREFIX", matchValue: "3337" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_316", [
    { role: "INCLUDE", matchType: "PREFIX", matchValue: "335" },
    { role: "EXCLUDE", matchType: "PREFIX", matchValue: "3352" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_320", [
    { matchType: "PREFIX", matchValue: "138" },
    { matchType: "PREFIX", matchValue: "3381" },
    { matchType: "PREFIX", matchValue: "3382" },
    { matchType: "PREFIX", matchValue: "3383" },
    { matchType: "PREFIX", matchValue: "3384" },
    { matchType: "PREFIX", matchValue: "3385" },
    { matchType: "PREFIX", matchValue: "3386" },
    { matchType: "PREFIX", matchValue: "3388" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_321", [
    { matchType: "PREFIX", matchValue: "34111" },
    { matchType: "PREFIX", matchValue: "3431" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_331", [{ matchType: "PREFIX", matchValue: "3312" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_332", [{ matchType: "PREFIX", matchValue: "1312" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_333", [{ matchType: "PREFIX", matchValue: "3338" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_334", [{ matchType: "PREFIX", matchValue: "3352" }]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_338", [
    { matchType: "PREFIX", matchValue: "3389" },
    { matchType: "PREFIX", matchValue: "344" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_339", [
    { matchType: "PREFIX", matchValue: "34112" },
    { matchType: "PREFIX", matchValue: "3432" },
  ]],
  ["NTK_BAO_CAO_TINH_HINH_TAI_CHINH_420A", [{ matchType: "PREFIX", matchValue: "421" }]],
]);

function normalizedMembers(items) {
  return items
    .map((item) => ({
      role: String(item.payload?.role || "INCLUDE").toUpperCase(),
      matchType: String(item.payload?.matchType || "PREFIX").toUpperCase(),
      matchValue: String(item.payload?.matchValue || "").trim(),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function desiredNormalized(items) {
  return items
    .map((item) => ({
      role: String(item.role || "INCLUDE").toUpperCase(),
      matchType: String(item.matchType || "PREFIX").toUpperCase(),
      matchValue: String(item.matchValue || "").trim(),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
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
    `SELECT record_id,record_type,entity_key,parent_key,company_key,
            display_code,display_name,sort_order,payload
       FROM accounting_portal.config_records
      WHERE version_id=$1 AND deleted_at IS NULL
        AND record_type IN ('RULE','ACCOUNT_SET_MEMBER')
      ORDER BY sort_order,record_id`,
    [VERSION_ID],
  )).rows;
  const changes = [];

  for (const [setKey, desired] of desiredMembers) {
    const current = records.filter((item) =>
      item.record_type === "ACCOUNT_SET_MEMBER"
      && String(item.payload?.accountSetKey || item.parent_key || "").toUpperCase() === setKey
      && String(item.payload?.companyKey || item.company_key || "").toUpperCase() === COMPANY_KEY,
    );
    if (JSON.stringify(normalizedMembers(current)) === JSON.stringify(desiredNormalized(desired))) continue;
    changes.push({ type: "ACCOUNT_SET_MEMBER", setKey, before: normalizedMembers(current), after: desiredNormalized(desired) });
    if (!APPLY) continue;

    for (const item of current) {
      await client.query(
        `UPDATE accounting_portal.config_records
            SET deleted_at=now(),updated_at=now(),updated_by=$1
          WHERE version_id=$2 AND record_id=$3`,
        [ACTOR, VERSION_ID, item.record_id],
      );
      await audit({
        action: "REPLACE_ACCOUNT_SET_MEMBER",
        recordId: item.record_id,
        recordType: item.record_type,
        displayName: item.display_name,
        before: item.payload,
        after: null,
        note: `${COMPANY_KEY}: bỏ phân loại chồng lấn ngắn hạn/dài hạn của ${setKey}.`,
      });
    }
    for (const [index, definition] of desired.entries()) {
      const recordId = randomUUID();
      const payload = {
        accountSetKey: setKey,
        companyKey: COMPANY_KEY,
        role: String(definition.role || "INCLUDE").toUpperCase(),
        matchType: definition.matchType,
        matchValue: definition.matchValue,
        status: "ACTIVE",
        confidence: "VERIFIED",
        sourceRef: "Đối chiếu BCTC và sổ tài khoản TVG tháng 01/2026",
        sourceNote: "Phân loại theo mã tài khoản, không theo số tiền; mỗi số dư chỉ thuộc một dòng cùng phía Nợ/Có.",
      };
      await client.query(
        `INSERT INTO accounting_portal.config_records(
           record_id,version_id,record_type,entity_key,parent_key,company_key,
           display_code,display_name,status_label,valid_from,valid_to,sort_order,
           payload,created_by,updated_by
         ) VALUES ($1,$2,'ACCOUNT_SET_MEMBER',$3,$4,$5,$6,$7,'Đang dùng','','',$8,$9::jsonb,$10,$10)`,
        [
          recordId,
          VERSION_ID,
          `${setKey}:${COMPANY_KEY}:${String(definition.role || "INCLUDE").toUpperCase()}:${definition.matchType}:${index + 1}`,
          setKey,
          COMPANY_KEY,
          definition.matchValue,
          `${setKey} · ${COMPANY_KEY} · ${definition.matchValue}`,
          1000 + index,
          JSON.stringify(payload),
          ACTOR,
        ],
      );
      await audit({
        action: "REPLACE_ACCOUNT_SET_MEMBER",
        recordId,
        recordType: "ACCOUNT_SET_MEMBER",
        displayName: `${setKey} · ${COMPANY_KEY} · ${definition.matchValue}`,
        before: null,
        after: payload,
        note: `${COMPANY_KEY}: thành viên chuẩn hóa không chồng lấn của ${setKey}.`,
      });
    }
  }

  for (const record of records.filter((item) => item.record_type === "RULE")) {
    const reportKey = String(record.payload?.reportKey || "").toUpperCase();
    if (!CASH_FLOW_REPORTS.has(reportKey)) continue;
    const after = structuredClone(record.payload || {});
    const rowCode = String(after.rowCode || "").toUpperCase();
    if (!REQUIRED_CASH_FLOW_ROWS.get(reportKey)?.has(rowCode)) continue;
    const terms = Array.isArray(after.terms) && after.terms.length ? after.terms : [after];
    let changed = false;
    const patchedTerms = terms.map((term) => {
      if (String(term?.operator || "").toUpperCase() !== "CASH_MOVEMENT" || !term.conditionKey) return term;
      if (
        String(term.conditionRequirement || "").toUpperCase() === "REQUIRED"
        && String(term.classificationPolicy || "").toUpperCase() === REQUIRED_CASH_FLOW_POLICY
      ) return term;
      changed = true;
      return {
        ...term,
        conditionRequirement: "REQUIRED",
        classificationPolicy: REQUIRED_CASH_FLOW_POLICY,
      };
    });
    if (!changed) continue;
    if (Array.isArray(after.terms) && after.terms.length) after.terms = patchedTerms;
    else Object.assign(after, patchedTerms[0]);
    after.conditionRequirement = "REQUIRED";
    after.classificationPolicy = REQUIRED_CASH_FLOW_POLICY;
    after.formulaSchemaVersion = "BCTC_DSL_V6_NO_GUESS_CASH_FLOW";
    after.reconciliationPolicy = "STRUCTURAL_FORMULA_NOT_PERIOD_HARDCODE";
    after.sourceNote = [
      String(after.sourceNote || "").trim(),
      "Chỉ tự động nhận bút toán có mã dòng tiền MISA đúng; khoản thiếu mã phải được bổ sung điều kiện nghiệp vụ rõ ràng trước khi tính.",
    ].filter(Boolean).join(" ");
    changes.push({ type: "RULE", reportKey, rowCode: after.rowCode, recordId: record.record_id });
    if (!APPLY) continue;
    await client.query(
      `UPDATE accounting_portal.config_records
          SET payload=$1::jsonb,updated_at=now(),updated_by=$2
        WHERE version_id=$3 AND record_id=$4`,
      [JSON.stringify(after), ACTOR, VERSION_ID, record.record_id],
    );
    await audit({
      action: "REQUIRE_CASH_FLOW_CLASSIFICATION",
      recordId: record.record_id,
      recordType: "RULE",
      displayName: record.display_name,
      before: record.payload,
      after,
      note: "Không suy đoán dòng tiền chỉ từ tài khoản đối ứng; bắt buộc mã MISA hoặc điều chỉnh đã duyệt.",
    });
  }

  if (APPLY) {
    const note =
      "2026-08-24: Tách dứt điểm nhóm tài khoản TVG ngắn hạn/dài hạn, sửa nhóm 421 để giữ dấu lỗ lũy kế; mọi dòng tiền tự động bắt buộc có mã MISA hoặc điều chỉnh đã duyệt. Không ghi cứng số theo kỳ.";
    await client.query(
      `UPDATE accounting_portal.config_versions
          SET note=CASE WHEN strpos(COALESCE(note,''),$1)>0 THEN note ELSE concat_ws(E'\n',note,$1) END,
              updated_at=now(),updated_by=$2
        WHERE version_id=$3`,
      [note, ACTOR, VERSION_ID],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, versionId: VERSION_ID, companyKey: COMPANY_KEY, changes }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
