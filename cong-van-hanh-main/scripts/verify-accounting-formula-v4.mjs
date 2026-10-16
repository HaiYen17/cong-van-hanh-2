import pg from "pg";

const VERSION_ID = process.env.TARGET_VERSION_ID || "CFG-BCTC-STD-20260801-V4";
const INDIRECT = "LUU_CHUYEN_TIEN_TE_GIAN_TIEP";
const DIRECT = "LUU_CHUYEN_TIEN_TE_TRUC_TIEP";
const REQUIRED_POLICY = "REQUIRE_CASH_FLOW_CODE";
const INVENTORY_PATTERN = "151*, 152*, 1531*, 1541*, 1542*, 1543*, 155*, 156*, 157*, 158*";
const ROW27_RECEIPT_SET = "NTK_LCTT_27_TIEN_NHAN_LAI";
const ROW27_COUNTER_SET = "NTK_LCTT_27_DOI_UNG_LAI_DUOC_NHAN";
const FORBIDDEN_SEEDED_ADJUSTMENTS = [
  "TVG-2026-01-CF-INDIRECT-05-OD0-F19",
  "TVG-2026-01-CF-INDIRECT-11-OD0-F26",
  "TVG-2026-01-CF-INDIRECT-14-OD0-F29",
  "TVG-2026-01-CF-INDIRECT-16-OD0-F31-REVIEWED-ZERO",
  "TVG-2026-01-CF-INDIRECT-17-OD0-F32-REVIEWED-ZERO",
  "TVG-2026-01-CF-INDIRECT-27-OD0-F46",
];

const configRawUrl = process.env.ACCOUNTING_CONFIG_DATABASE_URL
  || process.env.DATABASE_URL
  || process.env.ACCOUNTING_DATABASE_URL;
const runtimeRawUrl = process.env.ACCOUNTING_RUNTIME_DATABASE_URL
  || process.env.ACCOUNTING_DATABASE_URL
  || configRawUrl;
if (!configRawUrl || !runtimeRawUrl) {
  throw new Error("Thiếu URL PostgreSQL cho schema cấu hình hoặc dữ liệu vận hành.");
}

function proxyConnectionUrl(rawUrl) {
  const connectionUrl = new URL(rawUrl);
  if (process.env.DB_PROXY_HOST) {
    connectionUrl.hostname = process.env.DB_PROXY_HOST;
    connectionUrl.port = process.env.DB_PROXY_PORT || "5432";
    for (const key of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "host", "sslmode"]) {
      connectionUrl.searchParams.delete(key);
    }
    connectionUrl.searchParams.set("sslmode", "disable");
  }
  return connectionUrl.toString();
}

const configConnectionUrl = proxyConnectionUrl(configRawUrl);
const runtimeConnectionUrl = proxyConnectionUrl(runtimeRawUrl);
const client = new pg.Client({ connectionString: configConnectionUrl });
const runtimeClient = runtimeConnectionUrl === configConnectionUrl
  ? client
  : new pg.Client({ connectionString: runtimeConnectionUrl });
await client.connect();
if (runtimeClient !== client) await runtimeClient.connect();

function upper(value) {
  return String(value || "").toUpperCase();
}

function automaticTerm(payload) {
  return (payload.terms || []).find(
    (term) => upper(term?.operator) !== "MANUAL_ADJUSTMENT",
  ) || {};
}

function assertRule(condition, message, failures) {
  if (!condition) failures.push(message);
}

function containsManualValue(value) {
  if (Array.isArray(value)) return value.some(containsManualValue);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) => key === "manualValue" || containsManualValue(item),
  );
}

try {
  const records = (await client.query(
    `SELECT record_type,entity_key,parent_key,company_key,payload
       FROM accounting_portal.config_records
      WHERE version_id=$1 AND deleted_at IS NULL
        AND record_type IN ('RULE','REPORT_ROW','ACCOUNT_SET_MEMBER')`,
    [VERSION_ID],
  )).rows;
  const rules = records.filter((record) => record.record_type === "RULE");
  const reportRows = records.filter((record) => record.record_type === "REPORT_ROW");
  const members = records.filter((record) => record.record_type === "ACCOUNT_SET_MEMBER");
  const failures = [];

  const findRule = (reportKey, rowCode) => rules.find(
    (record) => upper(record.payload?.reportKey) === reportKey
      && upper(record.payload?.rowCode) === rowCode,
  )?.payload;
  const activeValues = (setKey) => members
    .filter((record) => upper(record.payload?.accountSetKey || record.parent_key) === setKey)
    .map((record) => ({
      companyKey: upper(record.payload?.companyKey || record.company_key),
      role: upper(record.payload?.role || "INCLUDE"),
      matchType: upper(record.payload?.matchType),
      matchValue: String(record.payload?.matchValue || ""),
    }));

  const row05 = findRule(INDIRECT, "05");
  const row05Term = automaticTerm(row05 || {});
  assertRule(Boolean(row05), "Thiếu công thức LCTT gián tiếp dòng 05.", failures);
  assertRule(upper(row05Term.operator) === "PROFIT_LOSS_ACTIVITY", "Dòng 05 phải lấy hoạt động lãi/lỗ, không lấy số dư.", failures);
  assertRule(upper(row05Term.side) === "CREDIT" && Number(row05Term.sign) === -1, "Dòng 05 phải lấy bên Có và đảo dấu.", failures);
  assertRule(upper(row05Term.sourceKey) === "AMIS_SO_CHI_TIET" && upper(row05Term.datasetType) === "GENERAL_LEDGER", "Dòng 05 phải lấy Nhật ký chung.", failures);
  assertRule(upper(row05Term.accountSetKey) === "NTK_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_05", "Dòng 05 đang trỏ sai nhóm tài khoản.", failures);
  const row05Members = activeValues("NTK_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_05");
  assertRule(
    row05Members.length === 1
      && row05Members[0].companyKey === ""
      && row05Members[0].role === "INCLUDE"
      && row05Members[0].matchType === "PREFIX"
      && row05Members[0].matchValue === "5152",
    "Nhóm dòng 05 phải dùng chung toàn hệ thống và chỉ tự động nhận TK 5152; không nhận lãi không kỳ hạn TK 5151.",
    failures,
  );

  for (const reportKey of [DIRECT, INDIRECT]) {
    const row22 = findRule(reportKey, "22");
    const term22 = automaticTerm(row22 || {});
    assertRule(Boolean(row22), `${reportKey} thiếu dòng 22.`, failures);
    assertRule(upper(term22.operator) === "CASH_MOVEMENT", `${reportKey} dòng 22 phải dùng bút toán tiền.`, failures);
    assertRule(upper(term22.side) === "DEBIT" && Number(term22.sign) === 1, `${reportKey} dòng 22 phải lấy tiền vào bên Nợ.`, failures);
    assertRule(upper(term22.conditionRequirement) === "REQUIRED" && upper(term22.classificationPolicy) === REQUIRED_POLICY, `${reportKey} dòng 22 phải bắt buộc mã dòng tiền.`, failures);

    const row36 = findRule(reportKey, "36");
    const term36 = automaticTerm(row36 || {});
    assertRule(Boolean(row36), `${reportKey} thiếu dòng 36.`, failures);
    assertRule(upper(term36.operator) === "CASH_MOVEMENT", `${reportKey} dòng 36 phải dùng bút toán tiền.`, failures);
    assertRule(upper(term36.side) === "CREDIT" && Number(term36.sign) === -1, `${reportKey} dòng 36 phải lấy tiền ra bên Có và trình bày âm.`, failures);
    assertRule(upper(term36.conditionRequirement) === "REQUIRED" && upper(term36.classificationPolicy) === REQUIRED_POLICY, `${reportKey} dòng 36 phải bắt buộc mã dòng tiền.`, failures);
    const counterMembers = activeValues(upper(term36.counterAccountSetKey));
    assertRule(counterMembers.length > 0 && counterMembers.every((item) => item.role === "INCLUDE" && item.matchType === "PREFIX" && item.matchValue === "421"), `${reportKey} dòng 36 chỉ được tự động nhận đối ứng TK 421.`, failures);

    const row27 = findRule(reportKey, "27");
    const term27 = automaticTerm(row27 || {});
    assertRule(Boolean(row27), `${reportKey} thiếu dòng 27.`, failures);
    assertRule(upper(term27.operator) === "CASH_MOVEMENT", `${reportKey} dòng 27 phải dùng bút toán tiền theo cặp tài khoản.`, failures);
    assertRule(upper(term27.side) === "DEBIT" && Number(term27.sign) === 1, `${reportKey} dòng 27 phải lấy phát sinh Nợ TK nhận tiền.`, failures);
    assertRule(upper(term27.sourceKey) === "AMIS_SO_CHI_TIET" && upper(term27.datasetType) === "GENERAL_LEDGER", `${reportKey} dòng 27 phải lấy Nhật ký chung.`, failures);
    assertRule(upper(term27.accountSetKey) === ROW27_RECEIPT_SET, `${reportKey} dòng 27 đang trỏ sai nhóm TK nhận tiền.`, failures);
    assertRule(upper(term27.counterAccountSetKey) === ROW27_COUNTER_SET, `${reportKey} dòng 27 đang trỏ sai nhóm TK đối ứng.`, failures);
    assertRule(!term27.conditionKey && !term27.conditionRequirement && !term27.classificationPolicy, `${reportKey} dòng 27 không được phụ thuộc mã dòng tiền khi cặp tài khoản đã xác định chính xác.`, failures);
  }

  const row27ReceiptMembers = activeValues(ROW27_RECEIPT_SET);
  assertRule(
    row27ReceiptMembers.length === 1
      && row27ReceiptMembers[0].companyKey === ""
      && row27ReceiptMembers[0].role === "INCLUDE"
      && row27ReceiptMembers[0].matchType === "PREFIX"
      && row27ReceiptMembers[0].matchValue === "12811",
    "Nhóm nhận tiền dòng 27 phải dùng chung toàn hệ thống và chỉ gồm TK 12811*.",
    failures,
  );
  const row27CounterMembers = activeValues(ROW27_COUNTER_SET);
  assertRule(
    row27CounterMembers.length === 2
      && row27CounterMembers.every((item) => item.companyKey === "" && item.role === "INCLUDE" && item.matchType === "PREFIX")
      && row27CounterMembers.map((item) => item.matchValue).sort().join(",") === "13881,5152",
    "Nhóm đối ứng dòng 27 phải dùng chung toàn hệ thống và chỉ gồm TK 5152*, 13881*.",
    failures,
  );

  for (const setKey of [
    "NTK_BAO_CAO_TINH_HINH_TAI_CHINH_141",
    "NTK_LUU_CHUYEN_TIEN_TE_GIAN_TIEP_10",
  ]) {
    const inventory = activeValues(setKey).filter((item) => item.companyKey === "NTV");
    assertRule(
      inventory.length === 1
        && inventory[0].role === "INCLUDE"
        && inventory[0].matchType === "MIXED"
        && inventory[0].matchValue === INVENTORY_PATTERN,
      `${setKey} của NTV chưa dùng đúng nhóm tồn kho hỗn hợp đã duyệt.`,
      failures,
    );
  }

  for (const record of [...rules, ...reportRows]) {
    const payload = record.payload || {};
    assertRule(
      !JSON.stringify(payload).includes("MANUAL_ADJUSTMENT"),
      `${payload.reportKey || record.entity_key} dòng ${payload.rowCode || record.entity_key} còn nhánh Điều chỉnh đã duyệt.`,
      failures,
    );
    assertRule(
      !containsManualValue(payload),
      `${payload.reportKey || record.entity_key} dòng ${payload.rowCode || record.entity_key} còn trường manualValue ghi cứng.`,
      failures,
    );
  }

  const runtimeTable = (await runtimeClient.query(
    "SELECT to_regclass('accounting_runtime.accounting_report_adjustments') AS table_name",
  )).rows[0]?.table_name;
  let activeForbiddenAdjustments = [];
  if (runtimeTable) {
    activeForbiddenAdjustments = (await runtimeClient.query(
      `SELECT external_key,status,amount FROM accounting_runtime.accounting_report_adjustments
        WHERE external_key=ANY($1::text[]) AND status<>'VOIDED' ORDER BY external_key`,
      [FORBIDDEN_SEEDED_ADJUSTMENTS],
    )).rows;
    assertRule(
      activeForbiddenAdjustments.length === 0,
      `Còn ${activeForbiddenAdjustments.length} khoản số bù TVG/tháng 01-2026 chưa được vô hiệu.`,
      failures,
    );
  }

  const result = {
    ok: failures.length === 0,
    versionId: VERSION_ID,
    checkedAt: new Date().toISOString(),
    checks: {
      inventoryMixedGroup: 2,
      cashFlowBusinessRules: 7,
      automaticAccountSets: 5,
      hardcodedPeriodValues: 0,
      activeForbiddenAdjustments,
    },
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await client.end();
  if (runtimeClient !== client) await runtimeClient.end();
}
