import { randomUUID } from "node:crypto";
import pg from "pg";

const VERSION_ID = process.env.TARGET_VERSION_ID || "CFG-BCTC-STD-20260801-V4";
const ACTOR = process.env.ACTOR_EMAIL || "Codex · sửa LCTT dòng 05 theo TT99 2026-08-28";
const APPLY = process.argv.includes("--apply");
const INDIRECT = "LUU_CHUYEN_TIEN_TE_GIAN_TIEP";
const DIRECT = "LUU_CHUYEN_TIEN_TE_TRUC_TIEP";
const INVESTMENT_RESULT_SET = "NTK_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_05";
const DIVIDEND_COUNTER_SETS = [
  "NTK_DOI_UNG_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_36",
  "NTK_DOI_UNG_LUU_CHUYEN_TIEN_TE_TRUC_TIEP_36",
];

if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
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
      after == null ? null : JSON.stringify(after), ACTOR, note,
    ],
  );
}

async function replaceCompanyMembers(records, setKey, matchValue, note) {
  const current = records.filter(
    (item) => item.record_type === "ACCOUNT_SET_MEMBER"
      && String(item.payload?.accountSetKey || "").toUpperCase() === setKey,
  );
  const companies = Array.from(
    new Set(current.map((item) => String(item.payload?.companyKey || item.company_key || "").toUpperCase()).filter(Boolean)),
  );
  const alreadyCorrect = companies.length > 0 && current.length === companies.length
    && current.every((item) =>
      String(item.payload?.role || "INCLUDE").toUpperCase() === "INCLUDE"
      && String(item.payload?.matchType || "").toUpperCase() === "PREFIX"
      && String(item.payload?.matchValue || "") === matchValue,
    );
  if (alreadyCorrect) return { setKey, changed: false, companies };
  if (!APPLY) return { setKey, changed: true, companies, matchValue };

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
      note,
    });
  }
  for (const [index, companyKey] of companies.entries()) {
    const recordId = randomUUID();
    const payload = {
      accountSetKey: setKey,
      companyKey,
      role: "INCLUDE",
      matchType: "PREFIX",
      matchValue,
      status: "ACTIVE",
      confidence: "HIGH",
      sourceRef: "Báo cáo kế toán.pdf và đối chiếu 4 BCTC_Global.xlsx",
      sourceNote: note,
    };
    await client.query(
      `INSERT INTO accounting_portal.config_records(
         record_id,version_id,record_type,entity_key,parent_key,company_key,
         display_code,display_name,status_label,valid_from,valid_to,sort_order,
         payload,created_by,updated_by
       ) VALUES ($1,$2,'ACCOUNT_SET_MEMBER',$3,$4,$5,$6,$7,'Đang dùng','','',$8,$9::jsonb,$10,$10)`,
      [
        recordId, VERSION_ID, `${setKey}:${companyKey}:INCLUDE:PREFIX:${matchValue}`,
        setKey, companyKey, matchValue, `${setKey} · ${companyKey} · ${matchValue}`,
        1000 + index, JSON.stringify(payload), ACTOR,
      ],
    );
    await audit({
      action: "REPLACE_ACCOUNT_SET_MEMBER",
      recordId,
      recordType: "ACCOUNT_SET_MEMBER",
      displayName: `${setKey} · ${companyKey} · ${matchValue}`,
      before: null,
      after: payload,
      note,
    });
  }
  return { setKey, changed: true, companies, matchValue };
}

async function replaceGlobalMember(records, setKey, matchValue, note) {
  const current = records.filter(
    (item) => item.record_type === "ACCOUNT_SET_MEMBER"
      && String(item.payload?.accountSetKey || "").toUpperCase() === setKey,
  );
  const alreadyCorrect = current.length === 1
    && !String(current[0].payload?.companyKey || current[0].company_key || "").trim()
    && String(current[0].payload?.role || "INCLUDE").toUpperCase() === "INCLUDE"
    && String(current[0].payload?.matchType || "").toUpperCase() === "PREFIX"
    && String(current[0].payload?.matchValue || "") === matchValue;
  if (alreadyCorrect) return { setKey, changed: false, scope: "GLOBAL", matchValue };
  if (!APPLY) {
    return {
      setKey,
      changed: true,
      scope: "GLOBAL",
      matchValue,
      before: current.map((item) => ({
        companyKey: item.payload?.companyKey || item.company_key || "",
        matchValue: item.payload?.matchValue || "",
      })),
    };
  }

  for (const item of current) {
    await client.query(
      `UPDATE accounting_portal.config_records
          SET deleted_at=now(),updated_at=now(),updated_by=$1
        WHERE version_id=$2 AND record_id=$3`,
      [ACTOR, VERSION_ID, item.record_id],
    );
    await audit({
      action: "REPLACE_GLOBAL_ACCOUNT_SET_MEMBER",
      recordId: item.record_id,
      recordType: item.record_type,
      displayName: item.display_name,
      before: item.payload,
      after: null,
      note,
    });
  }

  const recordId = randomUUID();
  const payload = {
    accountSetKey: setKey,
    companyKey: "",
    role: "INCLUDE",
    matchType: "PREFIX",
    matchValue,
    status: "ACTIVE",
    confidence: "VERIFIED",
    sourceRef: "TT99/2025/TT-BTC dòng 05 và dòng 27; đối chiếu 4 BCTC_Global.xlsx",
    sourceNote: note,
  };
  await client.query(
    `INSERT INTO accounting_portal.config_records(
       record_id,version_id,record_type,entity_key,parent_key,company_key,
       display_code,display_name,status_label,valid_from,valid_to,sort_order,
       payload,created_by,updated_by
     ) VALUES ($1,$2,'ACCOUNT_SET_MEMBER',$3,$4,'',$5,$6,'Đang dùng','','',1000,$7::jsonb,$8,$8)`,
    [
      recordId,
      VERSION_ID,
      `${setKey}:ALL:INCLUDE:PREFIX:${matchValue}`,
      setKey,
      matchValue,
      `${setKey} · Dùng chung · ${matchValue}`,
      JSON.stringify(payload),
      ACTOR,
    ],
  );
  await audit({
    action: "REPLACE_GLOBAL_ACCOUNT_SET_MEMBER",
    recordId,
    recordType: "ACCOUNT_SET_MEMBER",
    displayName: `${setKey} · Dùng chung · ${matchValue}`,
    before: null,
    after: payload,
    note,
  });
  return { setKey, changed: true, scope: "GLOBAL", matchValue };
}

function firstAutomaticTerm(payload) {
  return (payload.terms || []).findIndex(
    (term) => String(term?.operator || "").toUpperCase() !== "MANUAL_ADJUSTMENT",
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
    `SELECT record_id,record_type,entity_key,company_key,display_name,payload,deleted_at
       FROM accounting_portal.config_records
      WHERE version_id=$1
        AND (deleted_at IS NULL OR entity_key='CT_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_05')
        AND record_type IN ('RULE','ACCOUNT_SET_MEMBER')
      ORDER BY sort_order,record_id`,
    [VERSION_ID],
  )).rows;
  const changes = [];
  changes.push(await replaceGlobalMember(
    records,
    INVESTMENT_RESULT_SET,
    "5152",
    "Dòng 05 chỉ tự động loại khỏi lợi nhuận trước thuế khoản lãi tiền gửi có kỳ hạn/lãi đầu tư ghi nhận ở TK 5152. Lãi tiền gửi không kỳ hạn TK 5151 thuộc luồng tiền kinh doanh nên không đưa vào dòng 05. Các lãi/lỗ đầu tư khác cần ngữ cảnh chứng từ đi qua điều chỉnh có lịch sử.",
  ));
  for (const setKey of DIVIDEND_COUNTER_SETS) {
    changes.push(await replaceCompanyMembers(
      records,
      setKey,
      "421",
      "Không coi toàn bộ TK 3388 là cổ tức/lợi nhuận phải trả. Chỉ tự phân loại TK 421; khoản treo 3388 phải có mã dòng tiền hoặc điều chỉnh có lịch sử.",
    ));
  }

  for (const record of records.filter((item) => item.record_type === "RULE")) {
    const reportKey = String(record.payload?.reportKey || "").toUpperCase();
    const rowCode = String(record.payload?.rowCode || "").toUpperCase();
    const after = structuredClone(record.payload || {});
    const index = firstAutomaticTerm(after);
    if (index < 0) continue;
    let changed = false;
    if (reportKey === INDIRECT && rowCode === "05") {
      after.operator = "PROFIT_LOSS_ACTIVITY";
      after.side = "CREDIT";
      after.sign = -1;
      after.sourceKey = "AMIS_SO_CHI_TIET";
      after.datasetType = "GENERAL_LEDGER";
      after.periodBasis = "PERIOD";
      after.accountSetKey = INVESTMENT_RESULT_SET;
      after.ruleClass = "JOURNAL_ACTIVITY";
      after.sourceNote = "Trừ lãi tiền gửi có kỳ hạn/lãi đầu tư đã ghi nhận ở TK 5152 theo Nhật ký chung, ưu tiên bút toán kết chuyển. Không lấy lãi tiền gửi không kỳ hạn TK 5151.";
      after.terms[index] = {
        ...after.terms[index],
        operator: "PROFIT_LOSS_ACTIVITY",
        side: "CREDIT",
        sign: -1,
        sourceKey: "AMIS_SO_CHI_TIET",
        datasetType: "GENERAL_LEDGER",
        periodBasis: "PERIOD",
        accountSetKey: INVESTMENT_RESULT_SET,
        useColumnBasis: false,
      };
      changed = true;
    }
    if ([DIRECT, INDIRECT].includes(reportKey) && rowCode === "22") {
      after.side = "DEBIT";
      after.sign = 1;
      after.conditionRequirement = "REQUIRED";
      after.classificationPolicy = "REQUIRE_CASH_FLOW_CODE";
      after.sourceNote = "Tiền thu thanh lý/nhượng bán là phát sinh Nợ tài khoản tiền. Chỉ tự động nhận khi bút toán có đúng mã dòng tiền 22; không lấy thuần hai chiều và không suy đoán chỉ từ tài khoản đối ứng.";
      after.terms[index] = {
        ...after.terms[index],
        side: "DEBIT",
        sign: 1,
        conditionRequirement: "REQUIRED",
        classificationPolicy: "REQUIRE_CASH_FLOW_CODE",
      };
      changed = true;
    }
    if ([DIRECT, INDIRECT].includes(reportKey) && rowCode === "36") {
      after.conditionRequirement = "REQUIRED";
      after.classificationPolicy = "REQUIRE_CASH_FLOW_CODE";
      after.sourceNote = "Tiền trả cổ tức/lợi nhuận là phát sinh Có tài khoản tiền, đối ứng 421 và phải có đúng mã dòng tiền 36. TK 3388 hoặc khoản thiếu mã phải được bổ sung điều kiện nghiệp vụ rõ ràng trước khi tính.";
      after.terms[index] = {
        ...after.terms[index],
        side: "CREDIT",
        sign: -1,
        conditionRequirement: "REQUIRED",
        classificationPolicy: "REQUIRE_CASH_FLOW_CODE",
      };
      changed = true;
    }
    if (!changed) continue;
    after.formulaSchemaVersion = "BCTC_DSL_V5_CASHFLOW_CODE_AWARE";
    after.reconciliationBasis = "PDF_AND_ACCOUNTANT_GOLDEN_2026_01";
    after.reconciliationPolicy = "STRUCTURAL_FORMULA_NOT_PERIOD_HARDCODE";
    const needsRestore = Boolean(record.deleted_at);
    const hasDifference = needsRestore || JSON.stringify(after) !== JSON.stringify(record.payload);
    if (!hasDifference) continue;
    changes.push({ rule: after.ruleKey || record.entity_key, reportKey, rowCode });
    if (!APPLY) continue;
    await client.query(
      `UPDATE accounting_portal.config_records
          SET payload=$1::jsonb,deleted_at=NULL,updated_at=now(),updated_by=$2
        WHERE version_id=$3 AND record_id=$4`,
      [JSON.stringify(after), ACTOR, VERSION_ID, record.record_id],
    );
    await audit({
      action: needsRestore
        ? "RESTORE_CASH_FLOW_RULE"
        : "RECONCILE_CASH_FLOW_CLASSIFICATION",
      recordId: record.record_id,
      recordType: "RULE",
      displayName: record.display_name,
      before: record.payload,
      after,
      note: needsRestore
        ? "Phục hồi dòng công thức bị script thay thành viên nhóm đánh dấu nhầm; giữ nguyên công thức đã chuẩn hóa."
        : "Thu hẹp tự động phân loại theo bằng chứng tài khoản; không ép số tháng 01/2026.",
    });
  }

  if (APPLY) {
    await client.query(
      `UPDATE accounting_portal.config_versions
          SET note=CASE
                WHEN strpos(COALESCE(note,''),$1::text)>0 THEN note
                ELSE concat_ws(E'\n',note,$1::text)
              END,
              updated_at=now(),updated_by=$2
        WHERE version_id=$3`,
      [
        "2026-08-28: Sửa dòng 05 LCTT gián tiếp theo TT99: lấy lãi tiền gửi có kỳ hạn/lãi đầu tư TK 5152 dùng chung toàn hệ thống, loại lãi tiền gửi không kỳ hạn TK 5151; không gắn số theo công ty hoặc kỳ.",
        ACTOR,
        VERSION_ID,
      ],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, versionId: VERSION_ID, changes }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
