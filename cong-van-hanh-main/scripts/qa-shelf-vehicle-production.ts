import "dotenv/config";

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { buildAppSessionForUserId } from "../src/lib/auth/session-runtime";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";
import { getModuleConfigSecret } from "../src/lib/config/global-config";
import { getDb } from "../src/lib/db";
import { updateShelfSkuConfiguration } from "../src/lib/warehouse/shelf-config";

const baseUrl = (process.argv.find((value) => value.startsWith("--base-url="))?.slice(11)
  || "https://thuanvietgroup.biz.vn").replace(/\/$/, "");
const marker = randomBytes(8).toString("hex");
const unitIds = [`qa-shelf-${marker}`, `qa-vehicle-${marker}`];
const operationIds = [`qa-shelf-op-${marker}`, `qa-vehicle-op-${marker}`];
const sessionIds = [`qa-shelf-session-${marker}`, `qa-vehicle-session-${marker}`];
const epcs = [`A1${marker.toUpperCase()}`, `B2${marker.toUpperCase()}`];
const db = getDb();
let tokenHash = "";

async function main() {
  const user = await db.user.findFirst({
    select: { id: true },
    where: { activationStatus: "APPROVED", status: "ACTIVE", userRoles: { some: { role: { key: "super-admin", status: "ACTIVE" } } } },
  });
  assert(user, "Không tìm thấy tài khoản full quyền cho QA Kệ/Xe.");
  const actor = await buildAppSessionForUserId(user.id);
  assert(actor?.fullAccess, "Phiên QA Kệ/Xe phải có fullAccess.");
  const products = await db.$queryRawUnsafe<Array<{ family: string; name: string; sku: string }>>(
    `SELECT DISTINCT ON (family) family,name,sku FROM (
       SELECT substring(upper(trim(sku)) from '^[A-Z]+') AS family,name,sku
       FROM "WarehouseProduct"
       WHERE length(trim(sku)) > 0 AND upper(status) NOT IN ('INACTIVE','ARCHIVED')
     ) products
     WHERE family IS NOT NULL
     ORDER BY family,sku
     LIMIT 2`,
  );
  assert.equal(products.length, 2, "Cần hai nhóm SKU khác nhau để kiểm tra thay cấu hình Kệ.");
  const appKey = await getModuleConfigSecret("warehouseKts.androidApiKey");
  assert(appKey && process.env.AUTH_SESSION_SECRET, "Thiếu bí mật cho QA Kệ/Xe.");
  const token = randomBytes(32).toString("base64url");
  tokenHash = createHmac("sha256", process.env.AUTH_SESSION_SECRET).update(token).digest("hex");
  await db.authSession.create({ data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000), tokenHash, userAgent: "shelf-vehicle-production-qa", userId: user.id } });
  const postRaw = async (payload: unknown) => {
    const response = await fetch(`${baseUrl}/api/warehouse/rfid`, {
      body: JSON.stringify(payload),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", cookie: `${SESSION_COOKIE_NAME}=${token}`, "x-api-key": appKey },
      method: "POST",
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    return { body, response };
  };
  const post = async (payload: unknown) => {
    const { body, response } = await postRaw(payload);
    assert.equal(response.status, 200, `${JSON.stringify(payload)} -> HTTP ${response.status}: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    return body;
  };
  const definitions = [
    { code: `KS-${marker}`, entityType: "SHELF", floorCount: 5, name: "Kệ QA 5 tầng" },
    { code: `XV-${marker}`, entityType: "VEHICLE", floorCount: 0, name: "Xe QA không tầng" },
  ] as const;
  for (let index = 0; index < definitions.length; index++) {
    await post({ action: "warehouseDefineShelf", ...definitions[index], epc: epcs[index], operationId: operationIds[index], shelfId: unitIds[index], version: 0, warehouse: "Kho tổng" });
    const floor = definitions[index].entityType === "VEHICLE" ? 0 : 5;
    const product = definitions[index].entityType === "SHELF" ? products[1] : products[0];
    let configurationVersion: number | null = null;
    if (definitions[index].entityType === "SHELF") {
      await updateShelfSkuConfiguration(actor, { shelfId: unitIds[index], skuGroups: [products[0].family], skuFloors: { [products[0].family]: 5 }, version: 0 });
      await updateShelfSkuConfiguration(actor, { shelfId: unitIds[index], skuGroups: [products[1].family], skuFloors: { [products[1].family]: 5 }, version: 1 });
      configurationVersion = 2;
      const stale = await postRaw({
        action: "warehouseShelfInventorySubmit",
        skuConfigurationVersion: 1,
        createdAt: new Date().toISOString(),
        deviceName: "CODEX_QA",
        excludedOutOfScopeCount: 0,
        excludedReadCount: 0,
        floorCount: definitions[index].floorCount,
        lines: [{ floor, name: products[0].name, quantity: 1, sku: products[0].sku }],
        operatorId: actor.userId,
        reviewedSkus: [products[0].sku],
        scanned: [{ name: products[0].name, quantity: 1, sku: products[0].sku }],
        schemaVersion: 2,
        sessionId: `${sessionIds[index]}-stale`,
        shelfCode: definitions[index].code,
        shelfId: unitIds[index],
        shelfName: definitions[index].name,
        submittedAt: new Date().toISOString(),
        type: definitions[index].entityType,
        warehouse: "Kho tổng",
      });
      assert.equal(stale.response.status, 409, `Cấu hình Kệ cũ vẫn nộp được: ${JSON.stringify(stale.body)}`);
      assert.equal(stale.body.code, "SHELF_SKU_CONFIG_CHANGED");
    }
    await post({
      action: "warehouseShelfInventorySubmit",
      skuConfigurationVersion: configurationVersion ?? 0,
      createdAt: new Date().toISOString(),
      deviceName: "CODEX_QA",
      excludedOutOfScopeCount: definitions[index].entityType === "SHELF" ? 3 : 0,
      excludedReadCount: 0,
      floorCount: definitions[index].floorCount,
      lines: [{ floor, name: product.name, quantity: index + 2, sku: product.sku }],
      operatorId: actor.userId,
      reviewedSkus: [product.sku],
      scanned: [{ name: product.name, quantity: index + 2, sku: product.sku }],
      schemaVersion: 2,
      sessionId: sessionIds[index],
      shelfCode: definitions[index].code,
      shelfId: unitIds[index],
      shelfName: definitions[index].name,
      submittedAt: new Date().toISOString(),
      type: definitions[index].entityType,
      warehouse: "Kho tổng",
    });
  }
  const shelf = await post({ action: "warehouseShelfInventoryGet", sessionId: sessionIds[0] });
  const vehicle = await post({ action: "warehouseShelfInventoryGet", sessionId: sessionIds[1] });
  assert.equal(shelf.session.floorCount, 5);
  assert.equal(shelf.session.lines[0].floor, 5);
  assert.equal(shelf.session.configurationVersion, 2);
  assert.deepEqual(shelf.session.skuGroups, [products[1].family]);
  assert.deepEqual(shelf.session.reviewedSkus, [products[1].sku]);
  assert.equal(shelf.session.excludedOutOfScopeCount, 3);
  assert.equal(vehicle.session.entityType, "VEHICLE");
  assert.equal(vehicle.session.floorCount, 0);
  assert.equal(vehicle.session.lines[0].floor, 0);
  console.log("Shelf/vehicle HTTP QA: replacing an SKU group, stale-config rejection, filtered 5-floor shelf and floorless vehicle passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Shelf/vehicle HTTP QA failed.");
  process.exitCode = 1;
}).finally(async () => {
  try {
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_inventory_lines WHERE session_id=ANY($1::text[])", sessionIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_inventory_sessions WHERE session_id=ANY($1::text[])", sessionIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_operations WHERE operation_id=ANY($1::text[])", operationIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_sku_configuration_audit WHERE shelf_id=ANY($1::text[])", unitIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_sku_configurations WHERE shelf_id=ANY($1::text[])", unitIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelves WHERE shelf_id=ANY($1::text[])", unitIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_entity_registry WHERE entity_id=ANY($1::text[])", unitIds);
    if (tokenHash) await db.authSession.updateMany({ data: { revokedAt: new Date() }, where: { revokedAt: null, tokenHash } });
    const leftovers = await db.$queryRawUnsafe<Array<{ count: number }>>(`SELECT
      (SELECT count(*) FROM rfid_shelf_inventory_sessions WHERE session_id=ANY($1::text[])) +
      (SELECT count(*) FROM rfid_shelves WHERE shelf_id=ANY($2::text[])) +
      (SELECT count(*) FROM rfid_entity_registry WHERE entity_id=ANY($2::text[])) AS count`, sessionIds, unitIds);
    assert.equal(Number(leftovers[0]?.count), 0, "Fixture QA Kệ/Xe chưa được dọn hết.");
    console.log("Shelf/vehicle HTTP QA fixtures cleaned.");
  } finally {
    await db.$disconnect();
  }
});
