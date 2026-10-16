import { randomUUID } from "node:crypto";
import pg from "pg";

const VERSION_ID = process.env.TARGET_VERSION_ID || "CFG-BCTC-STD-20260801-V4";
const ACTOR = process.env.ACTOR_EMAIL || "Codex · chuẩn hóa LCTT theo cặp tài khoản 2026-08-28";
const APPLY = process.argv.includes("--apply");
const REPORT_KEYS = new Set([
  "LUU_CHUYEN_TIEN_TE_TRUC_TIEP",
  "LUU_CHUYEN_TIEN_TE_GIAN_TIEP",
]);
const ROW_CODE = "27";
const RECEIPT_SET = "NTK_LCTT_27_TIEN_NHAN_LAI";
const COUNTER_SET = "NTK_LCTT_27_DOI_UNG_LAI_DUOC_NHAN";

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

async function replaceGlobalSet(records, definition) {
  const { setKey, setName, members } = definition;
  const changes = [];
  const setRecord = records.find(
    (record) => record.record_type === "ACCOUNT_SET" && upper(record.entity_key) === setKey,
  );
  const setPayload = {
    accountSetKey: setKey,
    setName,
    status: "ACTIVE",
    formulaSchemaVersion: "BCTC_DSL_V7_ACCOUNT_PAIR",
    scope: "GLOBAL",
    sourceNote: "Nhóm dùng chung cho mọi công ty cùng hệ thống tài khoản; không chứa số tiền theo kỳ.",
  };
  if (!setRecord) {
    changes.push({ type: "ACCOUNT_SET", setKey, action: "CREATE" });
    if (APPLY) {
      const recordId = randomUUID();
      await client.query(
        `INSERT INTO accounting_portal.config_records(
           record_id,version_id,record_type,entity_key,parent_key,company_key,
           display_code,display_name,status_label,valid_from,valid_to,sort_order,
           payload,created_by,updated_by
         ) VALUES ($1,$2,'ACCOUNT_SET',$3,'','',$3,$4,'Đang dùng','','',9270,$5::jsonb,$6,$6)`,
        [recordId, VERSION_ID, setKey, setName, JSON.stringify(setPayload), ACTOR],
      );
      await audit({
        action: "CREATE_GLOBAL_ACCOUNT_SET",
        recordId,
        recordType: "ACCOUNT_SET",
        displayName: setName,
        before: null,
        after: setPayload,
        note: "Tạo nhóm tài khoản dùng chung cho công thức LCTT dòng 27.",
      });
    }
  } else {
    const after = { ...withoutHardcodedValues(setRecord.payload || {}), ...setPayload };
    if (stable(after) !== stable(setRecord.payload || {})) {
      changes.push({ type: "ACCOUNT_SET", setKey, action: "UPDATE" });
      if (APPLY) {
        await client.query(
          `UPDATE accounting_portal.config_records
              SET payload=$1::jsonb,company_key='',updated_at=now(),updated_by=$2
            WHERE version_id=$3 AND record_id=$4`,
          [JSON.stringify(after), ACTOR, VERSION_ID, setRecord.record_id],
        );
        await audit({
          action: "UPDATE_GLOBAL_ACCOUNT_SET",
          recordId: setRecord.record_id,
          recordType: "ACCOUNT_SET",
          displayName: setName,
          before: setRecord.payload,
          after,
          note: "Chuẩn hóa nhóm thành phạm vi dùng chung; không theo công ty hoặc kỳ.",
        });
      }
    }
  }

  const currentMembers = records.filter(
    (record) => record.record_type === "ACCOUNT_SET_MEMBER"
      && upper(record.payload?.accountSetKey || record.parent_key) === setKey,
  );
  const desired = members.map((member) => ({
    role: "INCLUDE",
    matchType: "PREFIX",
    matchValue: member.code,
  }));
  const currentNormalized = currentMembers.map((record) => ({
    role: upper(record.payload?.role || "INCLUDE"),
    matchType: upper(record.payload?.matchType || "PREFIX"),
    matchValue: String(record.payload?.matchValue || "").trim(),
    companyKey: upper(record.payload?.companyKey || record.company_key),
  }));
  const membersCorrect = currentNormalized.length === desired.length
    && currentNormalized.every((item) => !item.companyKey)
    && stable(currentNormalized.map(({ companyKey, ...item }) => item).sort((a, b) => stable(a).localeCompare(stable(b))))
      === stable([...desired].sort((a, b) => stable(a).localeCompare(stable(b))));
  if (membersCorrect) return changes;

  changes.push({ type: "ACCOUNT_SET_MEMBER", setKey, action: "REPLACE", before: currentNormalized, after: desired });
  if (!APPLY) return changes;
  for (const record of currentMembers) {
    await client.query(
      `UPDATE accounting_portal.config_records
          SET deleted_at=now(),updated_at=now(),updated_by=$1
        WHERE version_id=$2 AND record_id=$3`,
      [ACTOR, VERSION_ID, record.record_id],
    );
    await audit({
      action: "REPLACE_GLOBAL_ACCOUNT_SET_MEMBER",
      recordId: record.record_id,
      recordType: "ACCOUNT_SET_MEMBER",
      displayName: record.display_name,
      before: record.payload,
      after: null,
      note: "Loại định nghĩa cũ để thay bằng nhóm tài khoản dùng chung toàn hệ thống.",
    });
  }
  for (const [index, member] of members.entries()) {
    const recordId = randomUUID();
    const payload = {
      accountSetKey: setKey,
      companyKey: "",
      role: "INCLUDE",
      matchType: "PREFIX",
      matchValue: member.code,
      status: "ACTIVE",
      confidence: "VERIFIED",
      sourceRef: member.sourceRef,
      sourceNote: member.sourceNote,
    };
    await client.query(
      `INSERT INTO accounting_portal.config_records(
         record_id,version_id,record_type,entity_key,parent_key,company_key,
         display_code,display_name,status_label,valid_from,valid_to,sort_order,
         payload,created_by,updated_by
       ) VALUES ($1,$2,'ACCOUNT_SET_MEMBER',$3,$4,'',$5,$6,'Đang dùng','','',$7,$8::jsonb,$9,$9)`,
      [
        recordId, VERSION_ID, `${setKey}:ALL:INCLUDE:PREFIX:${member.code}`,
        setKey, member.code, `${setName} · TK ${member.code}*`, 9271 + index,
        JSON.stringify(payload), ACTOR,
      ],
    );
    await audit({
      action: "REPLACE_GLOBAL_ACCOUNT_SET_MEMBER",
      recordId,
      recordType: "ACCOUNT_SET_MEMBER",
      displayName: `${setName} · TK ${member.code}*`,
      before: null,
      after: payload,
      note: "Thành viên nhóm tài khoản áp dụng giống nhau cho mọi công ty.",
    });
  }
  return changes;
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
  changes.push(...await replaceGlobalSet(records, {
    setKey: RECEIPT_SET,
    setName: "LCTT dòng 27 · Tiền gửi có kỳ hạn nhận lãi",
    members: [{
      code: "12811",
      sourceRef: "Công thức kế toán: PhatsinhDU(12811/5152) + PhatsinhDU(12811/13881)",
      sourceNote: "Tài khoản nhận tiền của dòng 27; dùng tiền gửi có kỳ hạn/các tiểu khoản bắt đầu 12811.",
    }],
  }));
  changes.push(...await replaceGlobalSet(records, {
    setKey: COUNTER_SET,
    setName: "LCTT dòng 27 · Lãi cho vay, lãi tiền gửi, cổ tức được nhận",
    members: [
      {
        code: "5152",
        sourceRef: "Công thức kế toán: PhatsinhDU(12811/5152)",
        sourceNote: "Ghi nhận trực tiếp doanh thu lãi được nhận vào tài khoản 12811.",
      },
      {
        code: "13881",
        sourceRef: "Công thức kế toán: PhatsinhDU(12811/13881)",
        sourceNote: "Thu khoản lãi đã ghi nhận phải thu vào tài khoản 12811.",
      },
    ],
  }));

  const rowByRule = new Map(
    records
      .filter((record) => record.record_type === "REPORT_ROW")
      .map((record) => [upper(record.payload?.ruleKey), upper(record.payload?.rowCode)]),
  );
  let matchedRow27 = 0;
  for (const record of records) {
    if (!["RULE", "REPORT_ROW"].includes(record.record_type)) continue;
    const sanitized = withoutHardcodedValues(record.payload || {});
    let after = sanitized;
    let action = "REMOVE_HARDCODED_FORMULA_VALUE";
    let note = "Xóa manualValue khỏi cấu hình; số ghi cứng theo công ty/kỳ không được phép chạy.";
    if (record.record_type === "RULE") {
      const reportKey = upper(sanitized.reportKey);
      const rowCode = upper(sanitized.rowCode || rowByRule.get(upper(record.entity_key)));
      if (REPORT_KEYS.has(reportKey) && rowCode === ROW_CODE) {
        matchedRow27 += 1;
        const automaticTerm = {
          operator: "CASH_MOVEMENT",
          sign: 1,
          side: "DEBIT",
          periodBasis: "YTD",
          useColumnBasis: false,
          sourceKey: "AMIS_SO_CHI_TIET",
          datasetType: "GENERAL_LEDGER",
          accountSetKey: RECEIPT_SET,
          counterAccountSetKey: COUNTER_SET,
          excludeClosingEntries: true,
          excludeReversals: true,
        };
        after = {
          ...sanitized,
          reportKey,
          rowCode,
          operator: automaticTerm.operator,
          sign: automaticTerm.sign,
          side: automaticTerm.side,
          periodBasis: automaticTerm.periodBasis,
          useColumnBasis: automaticTerm.useColumnBasis,
          sourceKey: automaticTerm.sourceKey,
          datasetType: automaticTerm.datasetType,
          accountSetKey: automaticTerm.accountSetKey,
          counterAccountSetKey: automaticTerm.counterAccountSetKey,
          terms: [automaticTerm],
          ruleClass: "EXACT_ACCOUNT_PAIR",
          formulaSchemaVersion: "BCTC_DSL_V7_ACCOUNT_PAIR",
          reconciliationBasis: "ACCOUNTING_ACCOUNT_PAIR_12811_5152_13881",
          reconciliationPolicy: "STRUCTURAL_FORMULA_NOT_PERIOD_HARDCODE",
          sourceNote: "Tiền thu lãi cho vay, lãi tiền gửi, cổ tức và lợi nhuận được chia = phát sinh Nợ TK 12811 đối ứng Có TK 5152 + phát sinh Nợ TK 12811 đối ứng Có TK 13881. Áp dụng chung mọi công ty/kỳ; không cộng số bù hoặc điều chỉnh ngoài nguồn.",
        };
        for (const key of ["conditionKey", "conditionRequirement", "classificationPolicy", "filters"]) {
          delete after[key];
        }
        action = "RECONCILE_CASH_FLOW_INTEREST_RECEIPTS";
        note = "Chuẩn hóa dòng 27 theo cặp tài khoản kế toán dùng chung; không theo số TVG/tháng 01-2026 và không kèm nhánh điều chỉnh.";
      }
    }
    if (stable(after) === stable(record.payload || {})) continue;
    changes.push({ type: record.record_type, entityKey: record.entity_key, action });
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
      recordType: record.record_type,
      displayName: record.display_name,
      before: record.payload,
      after,
      note,
    });
  }
  if (matchedRow27 !== REPORT_KEYS.size) {
    throw new Error(`Phải tìm thấy ${REPORT_KEYS.size} công thức dòng 27, hiện chỉ thấy ${matchedRow27}.`);
  }

  if (APPLY) {
    await client.query(
      `UPDATE accounting_portal.config_versions
          SET note=CASE WHEN strpos(COALESCE(note,''),$1)>0 THEN note ELSE concat_ws(E'\n',note,$1) END,
              updated_at=now(),updated_by=$2
        WHERE version_id=$3`,
      [
        "2026-08-28: Dòng 27 LCTT dùng chung cặp 12811/5152 và 12811/13881; xóa manualValue khỏi toàn bộ công thức; không cộng số bù theo công ty/kỳ.",
        ACTOR,
        VERSION_ID,
      ],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }
  console.log(JSON.stringify({ ok: true, apply: APPLY, versionId: VERSION_ID, matchedRow27, changes }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
