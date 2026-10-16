import "dotenv/config";

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import { buildAppSessionForUserId } from "../src/lib/auth/session-runtime";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";
import { getModuleConfigSecret } from "../src/lib/config/global-config";
import { getDb } from "../src/lib/db";
import { updateShelfSkuConfiguration } from "../src/lib/warehouse/shelf-config";

const baseUrl = (
  process.argv.find((argument) => argument.startsWith("--base-url="))
    ?.slice("--base-url=".length) || "https://thuanvietgroup.biz.vn"
).replace(/\/$/, "");
const playwrightPath =
  "C:/Users/minht/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const browserExecutable = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const { chromium } = createRequire(import.meta.url)(playwrightPath) as {
  chromium: { launch(options: { executablePath: string; headless: boolean }): Promise<any> };
};
const marker = randomBytes(8).toString("hex");
const shelfId = `qa-sku-config-${marker}`;
const operationId = `qa-sku-config-op-${marker}`;
const shelfName = `Kệ QA đổi nhóm ${marker.slice(0, 6)}`;
const epc = `C3${marker.toUpperCase()}`;
const db = getDb();
let tokenHash = "";
let browser: any = null;

async function main() {
  const user = await db.user.findFirst({
    select: { id: true },
    where: {
      activationStatus: "APPROVED",
      status: "ACTIVE",
      userRoles: { some: { role: { key: "super-admin", status: "ACTIVE" } } },
    },
  });
  assert(user, "Không tìm thấy tài khoản full quyền cho browser QA cấu hình Kệ.");
  const actor = await buildAppSessionForUserId(user.id);
  assert(actor?.fullAccess, "Phiên browser QA cấu hình Kệ phải có fullAccess.");
  assert(process.env.AUTH_SESSION_SECRET, "Thiếu AUTH_SESSION_SECRET.");
  const products = await db.$queryRawUnsafe<Array<{ family: string; sku: string }>>(
    `SELECT DISTINCT ON (family) family,sku FROM (
       SELECT substring(upper(trim(sku)) from '^[A-Z]+') AS family,sku
       FROM "WarehouseProduct"
       WHERE length(trim(sku)) > 0 AND upper(status) NOT IN ('INACTIVE','ARCHIVED')
     ) products
     WHERE family IS NOT NULL
     ORDER BY family,sku
     LIMIT 7`,
  );
  assert.equal(products.length, 7, "Cần bảy nhóm SKU để kiểm tra xóa/thay khi Kệ đã đủ sáu nhóm.");

  const token = randomBytes(32).toString("base64url");
  tokenHash = createHmac("sha256", process.env.AUTH_SESSION_SECRET).update(token).digest("hex");
  await db.authSession.create({
    data: {
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      tokenHash,
      userAgent: "shelf-config-browser-qa",
      userId: user.id,
    },
  });
  const appKey = await getModuleConfigSecret("warehouseKts.androidApiKey");
  assert(appKey, "Thiếu API key ứng dụng cho browser QA cấu hình Kệ.");
  const defineResponse = await fetch(`${baseUrl}/api/warehouse/rfid`, {
    body: JSON.stringify({
      action: "warehouseDefineShelf",
      code: `SKU-${marker}`,
      entityType: "SHELF",
      epc,
      floorCount: 3,
      name: shelfName,
      operationId,
      shelfId,
      version: 0,
      warehouse: "Kho tổng",
    }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-api-key": appKey,
    },
    method: "POST",
    signal: AbortSignal.timeout(30000),
  });
  const defineBody = await defineResponse.json();
  assert.equal(defineResponse.status, 200, JSON.stringify(defineBody));
  assert.equal(defineBody.ok, true);
  await updateShelfSkuConfiguration(actor, {
    shelfId,
    skuGroups: products.slice(0, 6).map((product) => product.family),
    skuFloors: Object.fromEntries(products.slice(0, 6).map((product) => [product.family, 3])),
    version: 0,
  });

  browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
  const context = await browser.newContext();
  await context.addCookies([{
    httpOnly: true,
    name: SESSION_COOKIE_NAME,
    sameSite: "Lax",
    secure: true,
    url: baseUrl,
    value: token,
  }]);
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", (error: Error) => browserErrors.push(error.message));
  const response = await page.goto(`${baseUrl}/kho-van/cau-hinh-ke`, {
    timeout: 60000,
    waitUntil: "networkidle",
  });
  assert.equal(response?.status(), 200, "Trang Cấu hình kệ không trả HTTP 200.");
  await page.getByText(shelfName, { exact: true }).click();
  await page.getByText("6/6 nhóm · chọn một bong bóng tầng cho từng nhóm", { exact: true }).waitFor();
  await page.getByRole("button", { exact: true, name: `Xóa nhóm ${products[0].family}` }).click();
  await page.getByText("5/6 nhóm · chọn một bong bóng tầng cho từng nhóm", { exact: true }).waitFor();
  await page.getByLabel("Tìm trong danh mục hàng hóa").fill(products[6].sku);
  await page.getByRole("button", { exact: true, name: `Thêm nhóm ${products[6].family}` }).click();
  await page.getByText("6/6 nhóm · chọn một bong bóng tầng cho từng nhóm", { exact: true }).waitFor();
  await page.getByRole("button", { exact: true, name: "Lưu SKU và tầng" }).click();
  await page.getByText("Đã lưu cấu hình nhóm SKU của kệ.", { exact: true }).waitFor();
  assert.equal(browserErrors.length, 0, `Lỗi trình duyệt: ${browserErrors.join(" | ")}`);

  const stored = await db.$queryRawUnsafe<Array<{ configuration_version: number; sku_floors: Record<string, number>; sku_groups: string[] }>>(
    "SELECT configuration_version,sku_groups,sku_floors FROM rfid_shelf_sku_configurations WHERE shelf_id=$1",
    shelfId,
  );
  assert.equal(stored[0]?.configuration_version, 2);
  assert.deepEqual(stored[0]?.sku_groups, [...products.slice(1, 6).map((product) => product.family), products[6].family]);
  assert(Object.values(stored[0]?.sku_floors ?? {}).every((floor) => floor === 3));
  console.log("Browser QA: Kệ đủ 6 nhóm xóa được một nhóm, thêm nhóm thứ 7 thay thế và lưu phiên bản mới thành công.");
  await context.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Browser QA cấu hình Kệ thất bại.");
  process.exitCode = 1;
}).finally(async () => {
  try {
    await browser?.close();
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_sku_configuration_audit WHERE shelf_id=$1", shelfId);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_sku_configurations WHERE shelf_id=$1", shelfId);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_operations WHERE operation_id=$1", operationId);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelves WHERE shelf_id=$1", shelfId);
    await db.$executeRawUnsafe("DELETE FROM rfid_entity_registry WHERE entity_id=$1", shelfId);
    if (tokenHash) await db.authSession.updateMany({
      data: { revokedAt: new Date() },
      where: { revokedAt: null, tokenHash },
    });
    const leftovers = await db.$queryRawUnsafe<Array<{ count: number }>>(`SELECT
      (SELECT count(*) FROM rfid_shelves WHERE shelf_id=$1) +
      (SELECT count(*) FROM rfid_shelf_sku_configurations WHERE shelf_id=$1) +
      (SELECT count(*) FROM rfid_shelf_sku_configuration_audit WHERE shelf_id=$1) AS count`, shelfId);
    assert.equal(Number(leftovers[0]?.count), 0, "Fixture browser QA cấu hình Kệ chưa được dọn hết.");
    console.log("Shelf configuration browser QA fixtures cleaned.");
  } finally {
    await db.$disconnect();
  }
});
