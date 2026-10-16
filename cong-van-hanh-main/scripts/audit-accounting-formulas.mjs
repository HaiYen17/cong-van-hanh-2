import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL.");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const versions = (await client.query(
    `SELECT version_id,version_name,status_code,source_version_id,note,updated_at,updated_by
       FROM accounting_portal.config_versions
      ORDER BY updated_at DESC NULLS LAST,created_at DESC
      LIMIT 20`,
  )).rows;
  const targetVersionId = process.env.TARGET_VERSION_ID || versions[0]?.version_id || "";
  const records = (await client.query(
    `SELECT record_id,record_type,entity_key,parent_key,company_key,display_code,display_name,
            sort_order,payload,updated_at,updated_by
       FROM accounting_portal.config_records
      WHERE version_id=$1 AND deleted_at IS NULL
        AND record_type IN ('REPORT','REPORT_ROW','RULE','ACCOUNT_SET','ACCOUNT_SET_MEMBER','DATA_SOURCE')
      ORDER BY record_type,sort_order,display_code,record_id`,
    [targetVersionId],
  )).rows;

  const ruleRowCodes = new Map(
    records
      .filter((record) => record.record_type === "REPORT_ROW")
      .map((record) => [record.payload?.ruleKey, record.payload?.rowCode || record.display_code]),
  );
  const rules = records
    .filter((record) => record.record_type === "RULE")
    .map((record) => ({
      entityKey: record.entity_key,
      reportKey: record.payload?.reportKey,
      rowCode: ruleRowCodes.get(record.entity_key) || record.payload?.rowCode || record.display_code,
      displayName: record.display_name,
      payload: record.payload,
    }))
    .filter((record) =>
      [
        "BAO_CAO_TINH_HINH_TAI_CHINH",
        "BAO_CAO_KET_QUA_KINH_DOANH",
        "LUU_CHUYEN_TIEN_TE_TRUC_TIEP",
        "LUU_CHUYEN_TIEN_TE_GIAN_TIEP",
      ].includes(String(record.reportKey || "").toUpperCase()),
    );
  const sets = records
    .filter((record) => record.record_type === "ACCOUNT_SET")
    .map((record) => ({
      key: record.entity_key,
      name: record.display_name,
      members: records
        .filter(
          (member) =>
            member.record_type === "ACCOUNT_SET_MEMBER" &&
            String(member.payload?.accountSetKey || "").toUpperCase() === String(record.entity_key || "").toUpperCase(),
        )
        .map((member) => ({
          companyKey: member.payload?.companyKey || member.company_key || "",
          role: member.payload?.role || "INCLUDE",
          matchType: member.payload?.matchType || "PREFIX",
          matchValue: member.payload?.matchValue || member.display_code,
        })),
    }));
  const audit = (await client.query(
    `SELECT action,version_id,record_id,record_type,display_name,actor_email,note,created_at
       FROM accounting_portal.audit_events
      WHERE version_id=$1
      ORDER BY created_at DESC
      LIMIT 50`,
    [targetVersionId],
  )).rows;

  console.log(JSON.stringify({ targetVersionId, versions, rules, sets, audit }, null, 2));
} finally {
  await client.end();
}
