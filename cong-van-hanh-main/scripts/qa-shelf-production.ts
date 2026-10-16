import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDb } from "../src/lib/db";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";
import { getModuleConfigSecret } from "../src/lib/config/global-config";
import { SHELF_ACTIONS } from "../src/lib/warehouse/shelves";

const base = (process.argv.find(value => value.startsWith("--base-url="))?.slice(11) || "https://thuanvietgroup.biz.vn").replace(/\/$/, "");
const db = getDb();
const beforeDeploy = process.argv.includes("--before-deploy");
async function main() {
  const user = await db.user.findFirst({ where: { status: "ACTIVE", activationStatus: "APPROVED", userRoles: { some: { role: { key: "super-admin", status: "ACTIVE" } } } }, select: { id: true } });
  assert(user, "Cần tài khoản full quyền đang hoạt động cho smoke test.");
  assert(process.env.AUTH_SESSION_SECRET, "Thiếu khóa phiên QA.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", process.env.AUTH_SESSION_SECRET).update(token).digest("hex");
  await db.authSession.create({ data: { userId: user.id, tokenHash,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), userAgent: "shelf-deploy-qa" } });
  const sessionClock = await db.$queryRaw<Array<{ seconds_remaining: number }>>`SELECT EXTRACT(EPOCH FROM ("expiresAt" - now()))::integer AS seconds_remaining FROM "AuthSession" WHERE "tokenHash"=${tokenHash}`;
  console.log(JSON.stringify({ qaSessionSecondsRemaining: sessionClock[0]?.seconds_remaining }));
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}`, "user-agent": "shelf-deploy-qa" };
  try {
    const diagnosticKey = await getModuleConfigSecret("warehouseKts.androidApiKey")
      .catch(() => process.env.ANDROID_RFID_API_KEY || null);
    if (diagnosticKey) {
      const profileResponse = await fetch(base + "/api/mobile/auth/me", { headers: { "x-api-key": diagnosticKey, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      const profileResult = await profileResponse.json();
      console.log(JSON.stringify({ mobileSessionStatus: profileResponse.status, code: profileResult.code, ok: profileResult.ok }));
    }
    const baseline = JSON.parse(await readFile("docs/deploy-module-baseline.json", "utf8")) as Array<{ key: string; href: string }>;
    const services = await fetch(base + "/", { headers, redirect: "manual" });
    const html = await services.text();
    assert.equal(services.status, 200);
    assert(!html.includes("NEXT_REDIRECT"), `Services chưa xác thực được phiên QA: ${JSON.stringify({ title: html.match(/<title>(.*?)<\/title>/)?.[1], redirect: html.match(/NEXT_REDIRECT[^"<\\]*/)?.[0], length: html.length })}`);
    for (const item of baseline) assert(html.includes(item.href), `Thiếu card Services: ${item.key}`);
    console.log(`Services: ${baseline.length} module links present with full-access session.`);
    const critical = ["/cau-hinh", "/nguoi-thuan-viet/dieu-khien-may-lanh", "/kho-van/cau-hinh", "/kho-van/cau-hinh-ke", "/kho-van/kiem-ke", "/danh-gia", "/tuyen-dung/ung-vien"];
    for (const route of critical) {
      const response = await fetch(base + route, { headers, redirect: "manual" });
      const body = await response.text();
      assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
      assert(!body.includes("NEXT_REDIRECT") && !body.includes("Không có quyền truy cập"), `${route}: quyền hoặc redirect`);
      assert(!body.includes('"digest":"') && !body.includes('\\"digest\\":'), `${route}: lỗi render server`);
      if (route === "/cau-hinh") assert(body.includes("Hunonic"), "Thiếu tab Hunonic");
      if (route === "/kho-van/kiem-ke" && !beforeDeploy) {
        assert(body.includes("Kiểm kê Kệ/Xe"), "Thiếu thẻ kiểm kê Kệ/Xe");
      }
      if (route === "/kho-van/cau-hinh-ke" && !beforeDeploy) {
        assert(body.includes("Cấu hình kệ"), "Thiếu màn cấu hình nhóm SKU theo kệ");
      }
      console.log(`${route}: OK`);
    }
    const evaluation = await fetch(base + "/legacy/evaluation.html", { headers });
    const evaluationHtml = await evaluation.text();
    assert.equal(evaluation.status, 200);
    assert(evaluationHtml.includes("CnB"), "Thiếu quy trình CnB trong Đánh giá nhân sự");
    if (!beforeDeploy) {
      const digest = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
      assert.equal(digest(evaluationHtml), digest(await readFile("public/legacy/evaluation.html", "utf8")), "Asset Đánh giá/CnB không khớp source hiện hành");
    }
    console.log("Đánh giá/CnB: asset and workflow present.");
    if (beforeDeploy) return;
    const contract = await (await fetch(base + "/api/warehouse/openapi")).json();
    for (const action of Object.values(SHELF_ACTIONS)) assert(JSON.stringify(contract).includes(action), `OpenAPI thiếu ${action}`);
    const definitionSchema = contract.components?.schemas?.ShelfDefinitionRequest;
    const submissionSchema = contract.components?.schemas?.ShelfInventorySubmitRequest;
    assert.deepEqual(definitionSchema?.properties?.entityType?.enum, ["SHELF", "VEHICLE"]);
    assert.equal(definitionSchema?.properties?.floorCount?.maximum, 20);
    assert.equal(definitionSchema?.properties?.skuGroups?.maxItems, 6);
    assert.equal(definitionSchema?.properties?.skuFloors?.type, "object");
    assert.equal(definitionSchema?.properties?.skuConfigurationVersion?.type, "integer");
    assert.equal(definitionSchema?.properties?.barcode?.type, "string");
    assert(!definitionSchema?.required?.includes("epc"), "API vẫn bắt buộc RFID khi định nghĩa Kệ/Xe.");
    assert.equal(submissionSchema?.properties?.schemaVersion?.const, 2);
    assert.equal(submissionSchema?.properties?.reviewedSkus?.uniqueItems, true);
    assert.equal(submissionSchema?.properties?.excludedOutOfScopeCount?.minimum, 0);
    const apiKey = await getModuleConfigSecret("warehouseKts.androidApiKey")
      .catch(() => process.env.ANDROID_RFID_API_KEY || null);
    assert(apiKey, "Chưa có API key ứng dụng");
    const post = (payload: unknown, authenticated = true) => fetch(base + "/api/warehouse/rfid", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, ...(authenticated ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload),
    });
    for (const action of [SHELF_ACTIONS.list, SHELF_ACTIONS.sessions]) {
      const response = await post({ action });
      assert.equal(response.status, 200, `${action} HTTP ${response.status}`);
      const result = await response.json();
      assert.equal(result.ok, true);
      if (action === SHELF_ACTIONS.list) {
        assert(result.shelves.every((item: { barcode?: string }) => Boolean(item.barcode)), "Có Kệ/Xe chưa trả Barcode cho máy quét.");
      }
      console.log(`${action}: OK`);
    }
    assert.equal((await post({ action: SHELF_ACTIONS.list }, false)).status, 401);
    // Read and validation only: no shelves, product tags or inventory sessions are created.
    const invalid = await post({ action: SHELF_ACTIONS.define });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "INVALID_FIELD");
    console.log("Shelf API: authentication and invalid-write rejection OK; no business data written.");
    const reportStorage = await db.$queryRawUnsafe<Array<{
      links: number;
      reports: number;
      runtime_can_insert: boolean;
      runtime_can_select: boolean;
    }>>(`SELECT
      (SELECT count(*)::int FROM rfid_shelf_inventory_reports) AS reports,
      (SELECT count(*)::int FROM rfid_shelf_inventory_report_sessions) AS links,
      has_table_privilege(current_user,'rfid_shelf_inventory_reports','SELECT')
        AND has_table_privilege(current_user,'rfid_shelf_inventory_report_sessions','SELECT') AS runtime_can_select,
      has_table_privilege(current_user,'rfid_shelf_inventory_reports','INSERT')
        AND has_table_privilege(current_user,'rfid_shelf_inventory_report_sessions','INSERT') AS runtime_can_insert`);
    assert.equal(reportStorage[0]?.runtime_can_select, true, "Runtime thiếu quyền đọc báo cáo kệ.");
    assert.equal(reportStorage[0]?.runtime_can_insert, true, "Runtime thiếu quyền ghép báo cáo kệ.");
    console.log(JSON.stringify({ shelfReportStorage: reportStorage[0] }));
    const vehicleStorage = await db.$queryRawUnsafe<Array<{ columns: number; old_shelves_valid: boolean }>>(`SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_name IN ('rfid_shelves','rfid_shelf_inventory_sessions')
          AND column_name IN ('entity_type','floor_count')) AS columns,
      NOT EXISTS(SELECT 1 FROM rfid_shelves WHERE entity_type='SHELF' AND floor_count NOT BETWEEN 1 AND 20) AS old_shelves_valid`);
    assert.equal(vehicleStorage[0]?.columns, 4, "Thiếu cột loại hoặc số tầng Kệ/Xe.");
    assert.equal(vehicleStorage[0]?.old_shelves_valid, true, "Có Kệ hiện hữu không được backfill số tầng hợp lệ.");
    console.log(JSON.stringify({ shelfVehicleStorage: vehicleStorage[0] }));
    const skuConfigurationStorage = await db.$queryRawUnsafe<Array<{
      audit_table: boolean;
      config_table: boolean;
      runtime_can_insert: boolean;
      runtime_can_select: boolean;
      session_column: boolean;
      floor_column: boolean;
      audit_floor_columns: number;
      config_rows_valid: boolean;
    }>>(`SELECT
      to_regclass('rfid_shelf_sku_configurations') IS NOT NULL AS config_table,
      to_regclass('rfid_shelf_sku_configuration_audit') IS NOT NULL AS audit_table,
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_name='rfid_shelf_inventory_sessions' AND column_name='configuration_version') AS session_column,
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_name='rfid_shelf_sku_configurations' AND column_name='sku_floors') AS floor_column,
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_name='rfid_shelf_sku_configuration_audit'
          AND column_name IN ('previous_sku_floors','next_sku_floors')) AS audit_floor_columns,
      NOT EXISTS(
        SELECT 1 FROM rfid_shelf_sku_configurations c
        JOIN rfid_shelves s ON s.shelf_id=c.shelf_id
        WHERE (SELECT count(*) FROM jsonb_object_keys(c.sku_floors)) <> cardinality(c.sku_groups)
          OR EXISTS(SELECT 1 FROM unnest(c.sku_groups) AS configured(group_code)
            WHERE NOT c.sku_floors ? configured.group_code)
          OR EXISTS(SELECT 1 FROM jsonb_each(c.sku_floors) AS floor(group_code, floor_value)
            WHERE floor.group_code <> ALL(c.sku_groups)
              OR CASE WHEN jsonb_typeof(floor.floor_value)='number'
                THEN (floor.floor_value #>> '{}')::int NOT BETWEEN 1 AND s.floor_count
                ELSE true END)
      ) AS config_rows_valid,
      has_table_privilege(current_user,'rfid_shelf_sku_configurations','SELECT')
        AND has_table_privilege(current_user,'rfid_shelf_sku_configuration_audit','SELECT') AS runtime_can_select,
      has_table_privilege(current_user,'rfid_shelf_sku_configurations','INSERT')
        AND has_table_privilege(current_user,'rfid_shelf_sku_configuration_audit','INSERT') AS runtime_can_insert`);
    assert.equal(skuConfigurationStorage[0]?.config_table, true, "Thiếu bảng cấu hình nhóm SKU theo Kệ.");
    assert.equal(skuConfigurationStorage[0]?.audit_table, true, "Thiếu bảng audit cấu hình nhóm SKU theo Kệ.");
    assert.equal(skuConfigurationStorage[0]?.session_column, true, "Thiếu snapshot phiên bản cấu hình trong phiên kiểm kê.");
    assert.equal(skuConfigurationStorage[0]?.floor_column, true, "Thiếu cấu hình tầng mặc định theo nhóm SKU.");
    assert.equal(skuConfigurationStorage[0]?.audit_floor_columns, 2, "Thiếu snapshot tầng SKU trong audit.");
    assert.equal(skuConfigurationStorage[0]?.config_rows_valid, true, "Có cấu hình nhóm SKU thiếu tầng hoặc vượt số tầng của Kệ.");
    assert.equal(skuConfigurationStorage[0]?.runtime_can_select, true, "Runtime thiếu quyền đọc cấu hình nhóm SKU.");
    assert.equal(skuConfigurationStorage[0]?.runtime_can_insert, true, "Runtime thiếu quyền ghi cấu hình nhóm SKU.");
    console.log(JSON.stringify({ shelfSkuConfigurationStorage: skuConfigurationStorage[0] }));
  } finally { await db.authSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Smoke test failed"); process.exitCode = 1; }).finally(() => db.$disconnect());
