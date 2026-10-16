import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWarehouseProductionPlanDraftItems,
  toggleWarehouseProductionPlanDate,
} from "./production-plan-selection";

test("bấm lại ngày đang chọn sẽ bỏ chọn ngày kế hoạch", () => {
  assert.equal(
    toggleWarehouseProductionPlanDate("2026-09-07", "2026-09-07"),
    "",
  );
  assert.equal(
    toggleWarehouseProductionPlanDate("2026-09-07", "2026-09-08"),
    "2026-09-08",
  );
});

test("không chọn ngày vẫn mở được bước nhập với danh sách kế hoạch trống", () => {
  assert.deepEqual(buildWarehouseProductionPlanDraftItems(), []);
});

test("ngày được chọn vẫn nạp số lượng kế hoạch làm số lượng tem ban đầu", () => {
  const draftItems = buildWarehouseProductionPlanDraftItems([
    {
      name: "Sản phẩm A",
      plannedQuantity: 12,
      product: null,
      rowNumbers: [3, 5],
      sku: "SKU-A",
    },
  ]);

  assert.equal(draftItems[0]?.quantity, 12);
  assert.equal(draftItems[0]?.sku, "SKU-A");
});
