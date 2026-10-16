import { randomUUID } from "node:crypto";
import pg from "pg";

const VERSION_ID = process.env.TARGET_VERSION_ID || "CFG-BCTC-STD-20260801-V4";
const ACTOR = process.env.ACTOR_EMAIL || "Codex · đối chiếu PDF và file kế toán 2026-08-09";
const COMPANY_KEY = process.env.COMPANY_KEY || "NTV";
const APPLY = process.argv.includes("--apply");
const MIXED_INVENTORY = "151*, 152*, 1531*, 1541*, 1542*, 1543*, 155*, 156*, 157*, 158*";
const INVENTORY_SET_KEYS = [
  "NTK_BAO_CAO_TINH_HINH_TAI_CHINH_141",
  "NTK_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_10",
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

try {
  await client.query("BEGIN");
  const version = (await client.query(
    `SELECT version_id,status_code FROM accounting_portal.config_versions
      WHERE version_id=$1 FOR UPDATE`,
    [VERSION_ID],
  )).rows[0];
  if (!version) throw new Error(`Không tìm thấy phiên bản ${VERSION_ID}.`);
  if (version.status_code !== "DRAFT") {
    throw new Error("Chỉ được hiệu chỉnh phiên bản đang soạn.");
  }

  const currentMembers = (await client.query(
    `SELECT record_id,record_type,entity_key,display_name,payload
       FROM accounting_portal.config_records
      WHERE version_id=$1 AND record_type='ACCOUNT_SET_MEMBER'
        AND deleted_at IS NULL
        AND upper(COALESCE(payload->>'companyKey',company_key,''))=$2
        AND upper(COALESCE(payload->>'accountSetKey',parent_key,''))=ANY($3::text[])
      ORDER BY sort_order,record_id`,
    [VERSION_ID, COMPANY_KEY, INVENTORY_SET_KEYS],
  )).rows;

  const changes = [];
  for (const setKey of INVENTORY_SET_KEYS) {
    const current = currentMembers.filter(
      (item) => String(item.payload?.accountSetKey || "").toUpperCase() === setKey,
    );
    const alreadyCorrect = current.length === 1
      && String(current[0].payload?.role || "INCLUDE").toUpperCase() === "INCLUDE"
      && String(current[0].payload?.matchType || "").toUpperCase() === "MIXED"
      && String(current[0].payload?.matchValue || "") === MIXED_INVENTORY;
    if (alreadyCorrect) continue;
    changes.push({ setKey, replaced: current.length, matchValue: MIXED_INVENTORY });
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
        note: `Thay thành viên cũ của ${setKey} bằng nhóm hỗn hợp đã đối chiếu.`,
      });
    }

    const recordId = randomUUID();
    const payload = {
      accountSetKey: setKey,
      companyKey: COMPANY_KEY,
      role: "INCLUDE",
      matchType: "MIXED",
      matchValue: MIXED_INVENTORY,
      status: "ACTIVE",
      confidence: "VERIFIED",
      sourceRef: "Báo cáo kế toán.pdf dòng 141; 4 BCTC_Global.xlsx BS!F38 và CF!F30",
      sourceNote:
        "Nhóm hỗn hợp theo hệ thống tài khoản thực tế NTV: lấy toàn bộ 151, 152, 155-158; riêng 153 chỉ lấy 1531 và 154 chỉ lấy 1541-1543.",
    };
    await client.query(
      `INSERT INTO accounting_portal.config_records(
         record_id,version_id,record_type,entity_key,parent_key,company_key,
         display_code,display_name,status_label,valid_from,valid_to,sort_order,
         payload,created_by,updated_by
       ) VALUES ($1,$2,'ACCOUNT_SET_MEMBER',$3,$4,$5,$6,$7,'Đang dùng','','',1000,$8::jsonb,$9,$9)`,
      [
        recordId,
        VERSION_ID,
        `${setKey}:${COMPANY_KEY}:INCLUDE:MIXED:INVENTORY`,
        setKey,
        COMPANY_KEY,
        "HỖN HỢP",
        `${setKey} · Nhóm hỗn hợp hàng tồn kho`,
        JSON.stringify(payload),
        ACTOR,
      ],
    );
    await audit({
      action: "REPLACE_ACCOUNT_SET_MEMBER",
      recordId,
      recordType: "ACCOUNT_SET_MEMBER",
      displayName: `${setKey} · Nhóm hỗn hợp hàng tồn kho`,
      before: null,
      after: payload,
      note: "Áp dụng cùng một định nghĩa tồn kho cho Bảng cân đối kế toán và biến động tồn kho trên LCTT gián tiếp.",
    });
  }

  const ruleRows = (await client.query(
    `SELECT record_id,display_name,payload
       FROM accounting_portal.config_records
      WHERE version_id=$1 AND record_type='RULE' AND deleted_at IS NULL
        AND upper(COALESCE(payload->>'accountSetKey',''))=ANY($2::text[])`,
    [VERSION_ID, INVENTORY_SET_KEYS],
  )).rows;
  for (const rule of ruleRows) {
    const after = structuredClone(rule.payload || {});
    after.confidence = "HIGH";
    after.formulaSchemaVersion = "BCTC_DSL_V5_MIXED_ACCOUNT_GROUP";
    after.reconciliationBasis = "PDF_AND_ACCOUNTANT_GOLDEN_2026_01";
    after.reconciliationPolicy = "STRUCTURAL_FORMULA_NOT_PERIOD_HARDCODE";
    after.sourceNote = after.rowCode === "10"
      ? "Đảo dấu chênh lệch số dư Nợ cuối kỳ và đầu kỳ của nhóm tồn kho hỗn hợp; điều chỉnh hàng dùng cho đầu tư/XDCB phải ghi ở lớp điều chỉnh có lịch sử."
      : "Số dư Nợ cuối kỳ của nhóm tồn kho hỗn hợp theo hệ thống tài khoản thực tế NTV.";
    if (JSON.stringify(after) === JSON.stringify(rule.payload)) continue;
    changes.push({ rule: after.ruleKey || rule.record_id, metadata: true });
    if (!APPLY) continue;
    await client.query(
      `UPDATE accounting_portal.config_records
          SET payload=$1::jsonb,updated_at=now(),updated_by=$2
        WHERE version_id=$3 AND record_id=$4`,
      [JSON.stringify(after), ACTOR, VERSION_ID, rule.record_id],
    );
    await audit({
      action: "RECONCILE_BCTC_FORMULA",
      recordId: rule.record_id,
      recordType: "RULE",
      displayName: rule.display_name,
      before: rule.payload,
      after,
      note: "Gắn căn cứ đối chiếu và chính sách không ghi cứng số theo kỳ cho công thức tồn kho.",
    });
  }

  if (APPLY) {
    await client.query(
      `UPDATE accounting_portal.config_versions
          SET note=concat_ws(E'\n',note,$1::text),updated_at=now(),updated_by=$2
        WHERE version_id=$3`,
      [
        "2026-08-09: Chuẩn hóa nhóm hỗn hợp hàng tồn kho NTV cho dòng 141 và LCTT gián tiếp dòng 10; lưu đầy đủ lịch sử thay đổi.",
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
