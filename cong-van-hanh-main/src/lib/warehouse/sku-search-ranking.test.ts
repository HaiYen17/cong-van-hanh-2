import assert from "node:assert/strict";
import test from "node:test";

import { rankWarehouseSkuSearch } from "./sku-search-ranking";

test("ưu tiên SKU bắt đầu đúng từ khóa trước SKU chỉ chứa từ khóa", () => {
  const ranked = rankWarehouseSkuSearch("LTA", [
    { name: "Áo nệm", sku: "AGLAT" },
    { name: "Nệm", sku: "LTA10-6" },
    { name: "Nệm", sku: "XLTA20-8" },
  ]);
  assert.deepEqual(ranked.map((item) => item.sku), ["LTA10-6", "XLTA20-8", "AGLAT"]);
});

test("ưu tiên SKU hơn tên hàng và mã chính xác hơn mã bắt đầu giống", () => {
  const ranked = rankWarehouseSkuSearch("LTA", [
    { name: "LTA áo nệm", sku: "AO-01" },
    { name: "Nệm", sku: "LTA10-6" },
    { name: "Nệm", sku: "LTA" },
  ]);
  assert.deepEqual(ranked.map((item) => item.sku), ["LTA", "LTA10-6", "AO-01"]);
});
