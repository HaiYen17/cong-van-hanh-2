import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateWarehouseInventory,
  mergeWarehouseInventoryBatch,
  normalizeWarehouseInventoryPayload,
  type WarehouseInventoryAccumulationState,
  warehouseInventoryAction,
} from "./inventory";

test("bỏ qua RFID đã Hủy khỏi SKU và không xếp vào mã chưa xác định", () => {
  const normalized = normalizeWarehouseInventoryPayload({
    rfids: ["ACTIVE-01", "CANCELLED-01", "UNKNOWN-01"],
    sessionId: "cancelled-inventory-01",
  });
  const result = evaluateWarehouseInventory(
    normalized.tags,
    new Map([
      [
        "ACTIVE-01",
        {
          id: "active-tag",
          issuanceStatus: "ACTIVE",
          product: { name: "Nệm Active", sku: "SKU-ACTIVE" },
          productId: "product-active",
          productName: "Nệm Active",
          productSku: "SKU-ACTIVE",
        },
      ],
      [
        "CANCELLED-01",
        {
          id: "cancelled-tag",
          issuanceStatus: "CANCELLED",
          product: { name: "Nệm đã Hủy", sku: "SKU-CANCELLED" },
          productId: "product-cancelled",
          productName: "Nệm đã Hủy",
          productSku: "SKU-CANCELLED",
        },
      ],
    ]),
    3,
  );

  assert.equal(result.summary.cancelledRfidCount, 1);
  assert.equal(result.summary.inStockRfidCount, 1);
  assert.equal(result.summary.unknownRfidCount, 1);
  assert.deepEqual(
    result.comparison.map((line) => line.sku),
    ["SKU-ACTIVE"],
  );
  assert.deepEqual(
    result.unknownRfids.map((item) => item.rfid),
    ["UNKNOWN-01"],
  );
  assert.doesNotMatch(result.message, /chưa gắn SKU.*2/i);
});

test("giữ tương thích payload máy Android/RFID cũ", () => {
  const payload = {
    action: "warehouseInventoryScan",
    area: "Kho Long An",
    companyKey: "TVD",
    date: "2026-05-18",
    deviceName: "CHAINWAY_C72_01",
    inventoryType: "START",
    operator: "Nguyễn Minh Thông",
    rfids: ["e280001", "e280002"],
    sessionId: "inv_20260518_start_tvd_001",
    shelf: "Khu A",
    tags: [
      { epc: "E280001", timestamp: "2026-05-18T07:10:12+07:00" },
      { epc: "E280002", timestamp: "2026-05-18T07:10:13+07:00" },
    ],
    totalReadCount: 120,
  };
  const normalized = normalizeWarehouseInventoryPayload(payload);
  assert.equal(warehouseInventoryAction(payload), "warehouseInventoryScan");
  assert.equal(normalized.sessionKey, "inv_20260518_start_tvd_001");
  assert.equal(normalized.companyKey, "TVD");
  assert.equal(normalized.inventoryType, "START");
  assert.equal(normalized.tags.length, 2);
  assert.equal(normalized.tags[0]?.readCount, 1);
  assert.equal(normalized.requestedReadCount, 120);
});

test("nhận các alias scanSession, legalEntity, checkpoint và rfidList", () => {
  const normalized = normalizeWarehouseInventoryPayload({
    checkpoint: "cuối ngày",
    legalEntity: "Thuần Việt Global",
    rfidList: "abc, def",
    scanDate: "27/07/2026",
    scanSession: "legacy-alias-01",
  });
  assert.equal(normalized.companyKey, "TVG");
  assert.equal(normalized.inventoryType, "END");
  assert.deepEqual(
    normalized.tags.map((item) => item.epc),
    ["ABC", "DEF"],
  );
});

test("nhận JSON tối giản, không bắt buộc Eshop, pháp nhân hay mã phiên", () => {
  const normalized = normalizeWarehouseInventoryPayload({
    deviceName: "RFID-01",
    rfids: ["abc", "abc", "def"],
  });
  assert.equal(normalized.companyKey, "");
  assert.equal(normalized.inventoryType, "");
  assert.match(normalized.sessionKey, /^rfid-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/);
  assert.deepEqual(
    normalized.tags.map((item) => [item.epc, item.readCount]),
    [
      ["ABC", 2],
      ["DEF", 1],
    ],
  );
});

test("nhận danh sách RFID dạng object từ máy quét", () => {
  const normalized = normalizeWarehouseInventoryPayload({
    sessionId: "object-rfid-01",
    rfids: [{ rfid: "e20001" }, { code: "e20002" }, { epc: "e20003" }],
  });
  assert.deepEqual(
    normalized.tags.map((item) => item.epc),
    ["E20001", "E20002", "E20003"],
  );
});

function androidInventoryBatch(offset: number, count: number) {
  const rfids = Array.from(
    { length: count },
    (_, index) => `E280${String(offset + index + 1).padStart(6, "0")}`,
  );
  return normalizeWarehouseInventoryPayload({
    action: "warehouseInventoryScan",
    area: "Kho tổng",
    deviceName: "CHAINWAY_C72_01",
    rfids,
    sessionId: "inventory-20260809-095621-420",
    tags: rfids.map((item) => ({
      epc: item,
      timestamp: "2026-08-09T10:03:00+07:00",
    })),
    totalReadCount: count,
  });
}

test("cộng dồn đủ 515 RFID khi Android chia request theo batch 100", () => {
  let state: WarehouseInventoryAccumulationState = {
    requestedReadCount: 0,
    tags: [],
  };
  const batches = [
    androidInventoryBatch(0, 100),
    androidInventoryBatch(100, 100),
    androidInventoryBatch(200, 100),
    androidInventoryBatch(300, 100),
    androidInventoryBatch(400, 100),
    androidInventoryBatch(500, 15),
  ];

  for (const batch of batches) {
    state = mergeWarehouseInventoryBatch(state, batch);
  }

  assert.equal(state.tags.length, 515);
  assert.equal(state.requestedReadCount, 515);

  const retried = mergeWarehouseInventoryBatch(state, batches[5]);
  assert.equal(retried.tags.length, 515);
  assert.equal(retried.requestedReadCount, 515);
});

test("gửi lại toàn bộ phiên sửa được session cũ chỉ còn batch 15", () => {
  const batches = [
    androidInventoryBatch(0, 100),
    androidInventoryBatch(100, 100),
    androidInventoryBatch(200, 100),
    androidInventoryBatch(300, 100),
    androidInventoryBatch(400, 100),
    androidInventoryBatch(500, 15),
  ];
  let state = mergeWarehouseInventoryBatch(
    { requestedReadCount: 0, tags: [] },
    batches[5],
  );

  for (const batch of batches) {
    state = mergeWarehouseInventoryBatch(state, batch);
  }

  assert.equal(state.tags.length, 515);
  assert.equal(state.requestedReadCount, 515);
  assert.equal(new Set(state.tags.map((item) => item.epc)).size, 515);
});
