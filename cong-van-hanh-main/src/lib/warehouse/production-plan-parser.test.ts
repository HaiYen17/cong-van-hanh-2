import assert from "node:assert/strict";
import test from "node:test";

import { parseWarehouseProductionPlanRows } from "./production-plan-parser";

test("gộp các dòng trùng SKU trong cùng ngày và giữ đúng số dòng nguồn", () => {
  const dates = parseWarehouseProductionPlanRows(
    ["STT", "Ngày", "Thứ", "Mã", "Tên sản phẩm (đầy đủ)", "Số lượng"],
    [
      [1, "28/08/2026", "Thứ Sáu", "sku-01", "Sản phẩm 1", 2],
      [2, "28/08/2026", "Thứ Sáu", "SKU-01", "Sản phẩm 1", 3],
      [3, "29/08/2026", "Thứ Bảy", "SKU-02", "Sản phẩm 2", 4],
    ],
    2,
  );

  assert.equal(dates.length, 2);
  assert.equal(dates[0]?.rowCount, 2);
  assert.equal(dates[0]?.skuCount, 1);
  assert.equal(dates[0]?.totalQuantity, 5);
  assert.deepEqual(dates[0]?.items[0]?.rowNumbers, [3, 4]);
  assert.equal(dates[0]?.items[0]?.plannedQuantity, 5);
});

test("bỏ qua dòng thiếu ngày, mã hoặc số lượng dương", () => {
  const dates = parseWarehouseProductionPlanRows(
    ["Ngày", "Mã", "Số lượng"],
    [
      ["28/08/2026", "SKU-01", 0],
      ["", "SKU-02", 2],
      ["28/08/2026", "", 2],
      ["28/08/2026", "SKU-03", 7],
    ],
    2,
  );
  assert.equal(dates.length, 1);
  assert.equal(dates[0]?.skuCount, 1);
  assert.equal(dates[0]?.items[0]?.sku, "SKU-03");
});

test("báo rõ khi sheet thiếu cột bắt buộc", () => {
  assert.throws(
    () => parseWarehouseProductionPlanRows(["Ngày", "Mã"], []),
    /Ngày, Mã và Số lượng/,
  );
});
