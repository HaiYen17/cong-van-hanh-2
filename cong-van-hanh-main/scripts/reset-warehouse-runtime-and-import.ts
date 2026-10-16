import fs from "node:fs/promises";
import path from "node:path";

import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { importWarehouseCatalogFile } from "@/lib/warehouse/catalog";

const CONFIRM_VALUE = "RESET_WAREHOUSE_RUNTIME_AND_IMPORT";
const AUDIT_TARGETS = [
  "WarehouseBarcodeLabelPrint",
  "WarehouseInventorySession",
  "WarehouseRfidTag",
] as const;

function argValue(name: string) {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((item) => item.startsWith(prefix))
      ?.slice(prefix.length) ?? ""
  );
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function snapshot() {
  const db = getDb();
  const [
    products,
    printHistory,
    inventorySessions,
    inventoryItems,
    rfidTags,
    definitionSessions,
    issuanceEvents,
    relatedAuditLogs,
  ] = await Promise.all([
    db.warehouseProduct.findMany({ orderBy: { sku: "asc" } }),
    db.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      where: { targetType: "WarehouseBarcodeLabelPrint" },
    }),
    db.warehouseInventorySession.findMany({ orderBy: { createdAt: "asc" } }),
    db.warehouseInventoryScanItem.findMany({ orderBy: { createdAt: "asc" } }),
    db.warehouseRfidTag.findMany({ orderBy: { createdAt: "asc" } }),
    db.warehouseRfidDefinitionSession.findMany({
      orderBy: { createdAt: "asc" },
    }),
    db.warehouseRfidIssuanceEvent.findMany({ orderBy: { createdAt: "asc" } }),
    db.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      where: { targetType: { in: [...AUDIT_TARGETS] } },
    }),
  ]);
  return {
    counts: {
      definitionSessions: definitionSessions.length,
      inventoryItems: inventoryItems.length,
      inventorySessions: inventorySessions.length,
      issuanceEvents: issuanceEvents.length,
      printHistory: printHistory.length,
      products: products.length,
      relatedAuditLogs: relatedAuditLogs.length,
      rfidTags: rfidTags.length,
    },
    data: {
      definitionSessions,
      inventoryItems,
      inventorySessions,
      issuanceEvents,
      printHistory,
      products,
      relatedAuditLogs,
      rfidTags,
    },
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const confirm = argValue("confirm-apply");
  const actorName = argValue("actor") || "Nguyễn Minh Thông";
  const sourceFile = path.resolve(
    argValue("file") ||
      "C:/Users/minht/Downloads/Danh_sach_hang_hoa_dich_vu.xlsx",
  );
  const projectRoot = path.resolve(process.cwd());
  const outputRoot = path.resolve(
    projectRoot,
    "outputs",
    "warehouse-runtime-reset",
  );
  const backupDir = path.resolve(outputRoot, timestamp());
  if (!backupDir.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error("Đường dẫn backup không nằm trong outputs của dự án.");
  }
  await fs.access(sourceFile);

  const before = await snapshot();
  if (!apply) {
    console.log(
      JSON.stringify(
        {
          apply: false,
          before: before.counts,
          confirmWith: `--apply --confirm-apply=${CONFIRM_VALUE}`,
          sourceFile,
        },
        null,
        2,
      ),
    );
    await getDb().$disconnect();
    return;
  }
  if (confirm !== CONFIRM_VALUE) {
    throw new Error(`Thiếu --confirm-apply=${CONFIRM_VALUE}.`);
  }

  await fs.mkdir(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, "warehouse-before-reset.json");
  await fs.writeFile(
    backupFile,
    JSON.stringify(
      {
        backedUpAt: new Date().toISOString(),
        sourceFile,
        ...before,
      },
      null,
      2,
    ),
    "utf8",
  );

  const db = getDb();
  const actor = await db.user.findFirst({
    select: { displayName: true, id: true },
    where: { displayName: actorName },
  });
  if (!actor) throw new Error(`Không tìm thấy tài khoản ${actorName}.`);

  const deleted = await db.$transaction(async (tx) => {
    const inventoryItems = await tx.warehouseInventoryScanItem.deleteMany();
    const inventorySessions = await tx.warehouseInventorySession.deleteMany();
    const issuanceEvents = await tx.warehouseRfidIssuanceEvent.deleteMany();
    const definitionSessions =
      await tx.warehouseRfidDefinitionSession.deleteMany();
    const rfidTags = await tx.warehouseRfidTag.deleteMany();
    const auditLogs = await tx.auditLog.deleteMany({
      where: { targetType: { in: [...AUDIT_TARGETS] } },
    });
    await tx.auditLog.create({
      data: {
        action: "DELETE",
        actorId: actor.id,
        metadata: {
          backupFile,
          definitionSessions: definitionSessions.count,
          inventoryItems: inventoryItems.count,
          inventorySessions: inventorySessions.count,
          issuanceEvents: issuanceEvents.count,
          printAndRuntimeAuditLogs: auditLogs.count,
          rfidTags: rfidTags.count,
          sourceFile,
        },
        summary:
          "Dọn sạch lịch sử in tem, kiểm kê và Định nghĩa RFID trước khi nạp danh mục mới.",
        targetType: "WarehouseRuntimeReset",
      },
    });
    return {
      auditLogs: auditLogs.count,
      definitionSessions: definitionSessions.count,
      inventoryItems: inventoryItems.count,
      inventorySessions: inventorySessions.count,
      issuanceEvents: issuanceEvents.count,
      rfidTags: rfidTags.count,
    };
  });

  const session: AppSession = {
    displayName: actor.displayName,
    fullAccess: true,
    moduleGroups: ["warehouse"],
    modules: ["warehouse-config"],
    permissions: [],
    roles: ["super-admin"],
    userId: actor.id,
  };
  const source = await fs.readFile(sourceFile);
  const file = new File([source], path.basename(sourceFile), {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const imported = await importWarehouseCatalogFile(session, file);

  const after = {
    definitionSessions: await db.warehouseRfidDefinitionSession.count(),
    inventoryItems: await db.warehouseInventoryScanItem.count(),
    inventorySessions: await db.warehouseInventorySession.count(),
    issuanceEvents: await db.warehouseRfidIssuanceEvent.count(),
    printHistory: await db.auditLog.count({
      where: { targetType: "WarehouseBarcodeLabelPrint" },
    }),
    products: await db.warehouseProduct.count(),
    rfidTags: await db.warehouseRfidTag.count(),
  };
  console.log(
    JSON.stringify(
      {
        after,
        backupFile,
        before: before.counts,
        deleted,
        imported,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

void main();
