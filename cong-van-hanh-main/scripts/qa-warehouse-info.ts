import { randomBytes } from "node:crypto";

import "dotenv/config";

import { getModuleConfigSecret } from "@/lib/config/global-config";
import { getDb } from "@/lib/db";

async function main() {
  const db = getDb();
  const endpoint =
    process.env.WAREHOUSE_QA_ENDPOINT ||
    "https://thuanvietgroup.biz.vn/api/warehouse/rfid";
  const product = await db.warehouseProduct.findFirst({
  orderBy: { updatedAt: "desc" },
  where: { sku: { not: "" } },
  });
  if (!product) throw new Error("Không có SKU để chạy QA Định nghĩa RFID.");
  const apiKey = await getModuleConfigSecret("warehouseKts.androidApiKey");
  if (!apiKey) throw new Error("Chưa có warehouseKts.androidApiKey.");
  const epc = `E280${randomBytes(12).toString("hex").toUpperCase()}`;
  const definitionSession = `qa-definition-${Date.now()}`;
  const inventorySession = `qa-inventory-${Date.now()}`;

try {
  const health = await fetch(endpoint).then((response) => response.json());
  const definitionResponse = await fetch(endpoint, {
    body: JSON.stringify({
      action: "warehouseDefineRfidBatch",
      apiKey,
      barcode: product.barcode || "",
      createdAt: new Date().toISOString(),
      deviceName: "QA-CHAINWAY-C72",
      issuanceStatus: "ACTIVE",
      operator: "Codex QA",
      rfids: [epc],
      sessionId: definitionSession,
      sku: product.sku,
      source: "Codex/QA",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const definitionJson = await definitionResponse.json();
  const [savedTag, savedDefinition, savedEventCount] = await Promise.all([
    db.warehouseRfidTag.findUnique({ where: { epc } }),
    db.warehouseRfidDefinitionSession.findUnique({
      where: { sessionKey: definitionSession },
    }),
    db.warehouseRfidIssuanceEvent.count({
      where: { session: { sessionKey: definitionSession } },
    }),
  ]);
  if (
    !definitionResponse.ok ||
    !definitionJson.ok ||
    !savedTag ||
    !savedDefinition ||
    savedEventCount !== 1
  ) {
    throw new Error(
      `QA definition failed: HTTP ${definitionResponse.status} ${JSON.stringify(definitionJson)}`,
    );
  }

  const inventoryResponse = await fetch(endpoint, {
    body: JSON.stringify({
      action: "warehouseInventoryScan",
      apiKey,
      deviceName: "QA-CHAINWAY-C72",
      operator: "Codex QA",
      rfids: [epc],
      sessionId: inventorySession,
      source: "Codex/QA",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const inventoryJson = await inventoryResponse.json();
  const savedInventory = await db.warehouseInventorySession.findUnique({
    where: { sessionKey: inventorySession },
  });
  if (!inventoryResponse.ok || !inventoryJson.ok || !savedInventory) {
    throw new Error(
      `QA inventory failed: HTTP ${inventoryResponse.status} ${JSON.stringify(inventoryJson)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        definition: {
          action: definitionJson.action,
          createdCount: definitionJson.createdCount,
          eventCount: savedEventCount,
          status: savedTag.issuanceStatus,
        },
        healthActions: health.actions,
        inventory: {
          action: inventoryJson.action,
          knownRfidCount: inventoryJson.summary?.knownRfidCount,
          sessionSaved: Boolean(savedInventory),
        },
        moduleRegistered: Boolean(
          await db.appModule.findUnique({ where: { key: "warehouse-info" } }),
        ),
        productResolved: { hasName: Boolean(product.name), sku: product.sku },
      },
      null,
      2,
    ),
  );
} finally {
  await db.warehouseInventorySession.deleteMany({
    where: { sessionKey: inventorySession },
  });
  await db.warehouseRfidDefinitionSession.deleteMany({
    where: { sessionKey: definitionSession },
  });
  await db.warehouseRfidTag.deleteMany({
    where: {
      epc,
      issuanceSessionKey: definitionSession,
      issuedByName: "Codex QA",
    },
  });
}

  await db.$disconnect();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
