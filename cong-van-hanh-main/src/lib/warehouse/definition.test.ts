import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWarehouseRfidDefinitionPayload,
  normalizeWarehouseRfidIssuanceStatus,
} from "./definition";

test("normalizes the current Android RFID definition contract", () => {
  const normalized = normalizeWarehouseRfidDefinitionPayload({
    action: "warehouseDefineRfidBatch",
    barcode: "893000000001",
    createdAt: "2026-07-28T14:22:15+07:00",
    deviceName: "CHAINWAY_C72_01",
    expectedQty: 3,
    operator: "Nguyễn Minh Thông",
    rfids: ["e280 0011", "E2800022", "E2800011"],
    scanPower: 5,
    sessionId: "android-def-20260728-142215-001",
    sku: "SKU-001",
  });

  assert.equal(normalized.sessionKey, "android-def-20260728-142215-001");
  assert.equal(normalized.sku, "SKU-001");
  assert.equal(normalized.issuanceStatus, "ACTIVE");
  assert.deepEqual(normalized.rfids, ["E2800011", "E2800022"]);
  assert.equal(normalized.operatorName, "Nguyễn Minh Thông");
  assert.equal(normalized.deviceName, "CHAINWAY_C72_01");
  assert.equal(normalized.expectedQty, 3);
});

test("accepts future cancellation aliases without requiring SKU", () => {
  const normalized = normalizeWarehouseRfidDefinitionPayload({
    action: "warehouseDefineRfidBatch",
    cancelledAt: "2026-07-28T16:30:00+07:00",
    cancelledBy: "Thủ kho",
    rfids: [{ epc: "E2800033" }],
    sessionId: "cancel-001",
    usageStatus: "Hủy",
  });

  assert.equal(normalized.issuanceStatus, "CANCELLED");
  assert.equal(normalized.sku, "");
  assert.deepEqual(normalized.rfids, ["E2800033"]);
  assert.equal(normalized.occurredAt.toISOString(), "2026-07-28T09:30:00.000Z");
});

test("normalizes activation and cancellation status labels", () => {
  assert.equal(normalizeWarehouseRfidIssuanceStatus("Kích hoạt"), "ACTIVE");
  assert.equal(normalizeWarehouseRfidIssuanceStatus("INACTIVE"), "CANCELLED");
  assert.equal(normalizeWarehouseRfidIssuanceStatus("HỦY"), "CANCELLED");
});

test("rejects an activation payload without SKU or Barcode", () => {
  assert.throws(
    () =>
      normalizeWarehouseRfidDefinitionPayload({
        rfids: ["E2800044"],
        sessionId: "invalid-active",
      }),
    /cần có SKU hoặc Barcode/i,
  );
});
