import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeShelfSkuGroups,
  normalizeShelfSkuFloors,
  shelfSkuFamily,
  skuBelongsToShelf,
} from "./shelf-sku";

test("gom SKU theo phần chữ đầu mã", () => {
  assert.equal(shelfSkuFamily("CSTN10-5"), "CSTN");
  assert.equal(shelfSkuFamily(" cstn12-6 "), "CSTN");
  assert.equal(shelfSkuFamily("10-CSTN"), "");
  assert.equal(skuBelongsToShelf("CSTN12-6", ["CSTN"]), true);
  assert.equal(skuBelongsToShelf("ABC12-6", ["CSTN"]), false);
});

test("mỗi nhóm SKU phải có đúng một tầng hợp lệ", () => {
  assert.deepEqual(normalizeShelfSkuFloors(["CSTN", "ABC"], { CSTN: 3, ABC: 1 }, 3), { CSTN: 3, ABC: 1 });
  assert.throws(() => normalizeShelfSkuFloors(["CSTN"], { CSTN: 4 }, 3), /từ 1 đến 3/i);
  assert.throws(() => normalizeShelfSkuFloors(["CSTN"], { CSTN: 2, ABC: 1 }, 3), /không còn trong cấu hình/i);
});

test("chuẩn hóa, bỏ trùng và giới hạn 6 nhóm SKU", () => {
  assert.deepEqual(normalizeShelfSkuGroups(["CSTN10-5", "cstn12-6", "ABC01"]), ["CSTN", "ABC"]);
  assert.throws(() => normalizeShelfSkuGroups(["A1", "B1", "C1", "D1", "E1", "F1", "G1"]), /tối đa 6/i);
  assert.throws(() => normalizeShelfSkuGroups(["123-ABC"]), /Không lấy được/i);
});
