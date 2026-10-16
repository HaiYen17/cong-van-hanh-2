import "dotenv/config";

import { getDb } from "../src/lib/db";

async function main() {
  const db = getDb();
  const [setting, modules, productCount, mappedBarcodeCount, tagCount, sessionCount] =
    await Promise.all([
    db.systemSetting.findUnique({
      select: { value: true },
      where: { key: "warehouseKts.androidApiKey" },
    }),
    db.appModule.findMany({
      select: {
        group: { select: { key: true } },
        isActive: true,
        key: true,
      },
      where: { key: { in: ["warehouse-config", "warehouse-inventory"] } },
    }),
    db.warehouseProduct.count(),
    db.warehouseProduct.count({ where: { barcode: { not: null } } }),
    db.warehouseRfidTag.count(),
    db.warehouseInventorySession.count(),
    ]);

  console.log(
    JSON.stringify(
      {
        modules,
        mappedBarcodeCount,
        missingBarcodeCount: productCount - mappedBarcodeCount,
        productCount,
        rfidApiKeyConfigured: Boolean(setting?.value),
        sessionCount,
        tagCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
