import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildAppSessionForUserId } from "../src/lib/auth/session-runtime";
import { getDb } from "../src/lib/db";
import {
  compareShelfInventoryReports,
  createShelfInventoryReport,
  getShelfInventoryReport,
} from "../src/lib/warehouse/shelf-reports";

const db = getDb();
const marker = `qa-${randomUUID().slice(0, 10)}`;
const reportIds: string[] = [];
const shelfIds = [`${marker}-shelf-a`, `${marker}-shelf-b`];
const sessionIds = [1, 2].flatMap((round) => shelfIds.map((_, index) => `${marker}-r${round}-s${index + 1}`));
const epcs = ["A1", "B2"].map((suffix) => `FFFF${marker.replace(/[^a-f0-9]/gi, "").toUpperCase().padEnd(12, "0").slice(0, 12)}${suffix}`);

async function main() {
  const user = await db.user.findFirst({
    select: { id: true },
    where: {
      activationStatus: "APPROVED",
      status: "ACTIVE",
      userRoles: { some: { role: { key: "super-admin", status: "ACTIVE" } } },
    },
  });
  assert(user, "Cần tài khoản full quyền đang hoạt động cho QA báo cáo kệ.");
  const actor = await buildAppSessionForUserId(user.id);
  assert(actor?.fullAccess, "Phiên QA phải có fullAccess.");

  for (let index = 0; index < shelfIds.length; index++) {
    const entityType = index === 0 ? "SHELF" : "VEHICLE";
    const floorCount = index === 0 ? 5 : 0;
    await db.$executeRawUnsafe(
      "INSERT INTO rfid_entity_registry(epc,entity_type,entity_id) VALUES($1,$2,$3)",
      epcs[index], entityType, shelfIds[index],
    );
    await db.$executeRawUnsafe(`INSERT INTO rfid_shelves
      (shelf_id,code,name,warehouse,epc,version,operation_id,created_by,entity_type,floor_count)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9)`, shelfIds[index], `QA-${index + 1}`, index === 0 ? "Kệ QA 5 tầng" : "Xe QA", marker, epcs[index], `${marker}-op-${index}`, user.id, entityType, floorCount);
  }

  for (let round = 1; round <= 2; round++) {
    for (let index = 0; index < shelfIds.length; index++) {
      const sessionId = `${marker}-r${round}-s${index + 1}`;
      const quantity = round * 10 + index;
      const entityType = index === 0 ? "SHELF" : "VEHICLE";
      const floorCount = index === 0 ? 5 : 0;
      const floor = index === 0 ? 5 : 0;
      const payload = {
        entityType,
        excludedReadCount: 0,
        floorCount,
        lines: [{ floor, name: "Sản phẩm QA", quantity, sku: "SKU-QA" }],
        operatorName: actor.displayName,
        sessionId,
        shelfCode: `QA-${index + 1}`,
        shelfId: shelfIds[index],
        shelfName: index === 0 ? "Kệ QA 5 tầng" : "Xe QA",
        submittedAt: new Date().toISOString(),
        warehouse: marker,
      };
      await db.$executeRawUnsafe(`INSERT INTO rfid_shelf_inventory_sessions
        (session_id,shelf_id,warehouse,actor_id,operator_name,request_hash,payload,scanned_quantity,final_quantity,sku_count,created_at,entity_type,floor_count)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,1,now(),$9,$10)`, sessionId, shelfIds[index], marker, user.id, actor.displayName, `${marker}-hash-${round}-${index}`, JSON.stringify(payload), quantity, entityType, floorCount);
      await db.$executeRawUnsafe(`INSERT INTO rfid_shelf_inventory_lines(session_id,floor,sku,name,quantity)
        VALUES($1,$2,'SKU-QA','Sản phẩm QA',$3)`, sessionId, floor, quantity);
    }
  }

  const input = await createShelfInventoryReport(actor, sessionIds.slice(0, 2));
  const output = await createShelfInventoryReport(actor, sessionIds.slice(2));
  reportIds.push(input.reportId!, output.reportId!);
  assert.equal(input.shelves.length, 2);
  assert.equal(output.shelves.length, 2);
  assert.equal(input.shelves[0].floorCount, 5);
  assert.equal(input.shelves[1].entityType, "VEHICLE");
  assert.equal(input.shelves[1].lines[0].floor, 0);
  const comparison = await compareShelfInventoryReports(actor, input.reportId!, output.reportId!);
  assert.equal(comparison.summary.inputQuantity, 21);
  assert.equal(comparison.summary.outputQuantity, 41);
  assert.equal(comparison.summary.differenceQuantity, 20);
  assert.equal(comparison.summary.changedShelfCount, 2);

  await db.$executeRawUnsafe("UPDATE rfid_shelf_inventory_lines SET quantity=999 WHERE session_id=$1", sessionIds[0]);
  const saved = await getShelfInventoryReport(actor, input.reportId!);
  assert.equal(saved.shelves[0].lines[0].quantity, 10, "Snapshot báo cáo đã ghép bị thay đổi theo phiên nguồn.");
  const linkCount = await db.$queryRawUnsafe<Array<{ count: number }>>(
    "SELECT count(*)::int AS count FROM rfid_shelf_inventory_report_sessions WHERE report_id=ANY($1::text[])",
    reportIds,
  );
  assert.equal(linkCount[0].count, 4);
  console.log("Shelf/vehicle report production QA: configurable floors, floorless vehicle, merge, immutable snapshot and comparison passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Shelf report production QA failed.");
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (reportIds.length) {
      await db.$executeRawUnsafe('DELETE FROM "AuditLog" WHERE "targetType"=\'ShelfInventoryReport\' AND "targetId"=ANY($1::text[])', reportIds);
      await db.$executeRawUnsafe("DELETE FROM rfid_shelf_inventory_reports WHERE report_id=ANY($1::text[])", reportIds);
    }
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_inventory_lines WHERE session_id=ANY($1::text[])", sessionIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelf_inventory_sessions WHERE session_id=ANY($1::text[])", sessionIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_shelves WHERE shelf_id=ANY($1::text[])", shelfIds);
    await db.$executeRawUnsafe("DELETE FROM rfid_entity_registry WHERE entity_type IN ('SHELF','VEHICLE') AND entity_id=ANY($1::text[])", shelfIds);
    const leftovers = await db.$queryRawUnsafe<Array<{ count: number }>>(`SELECT
      (SELECT count(*) FROM rfid_shelf_inventory_reports WHERE report_id=ANY($1::text[])) +
      (SELECT count(*) FROM rfid_shelf_inventory_sessions WHERE session_id=ANY($2::text[])) +
      (SELECT count(*) FROM rfid_shelves WHERE shelf_id=ANY($3::text[])) AS count`, reportIds, sessionIds, shelfIds);
    assert.equal(Number(leftovers[0]?.count), 0, "Dữ liệu QA báo cáo kệ chưa được dọn hết.");
    console.log("Shelf report production QA fixtures cleaned.");
  } finally {
    await db.$disconnect();
  }
});
