import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWarehouseGroupedLabelPrintPages,
  buildWarehouseLabelPrintPages,
  isWarehouseLabelStartSlotValid,
  warehouseLabelSlotsPerPage,
} from "./label-print-layout";

test("trả đúng sức chứa cho hai khổ decal đang dùng", () => {
  assert.equal(warehouseLabelSlotsPerPage("TOMY_133_16"), 16);
  assert.equal(warehouseLabelSlotsPerPage("TOMY_148_33"), 33);
  assert.equal(warehouseLabelSlotsPerPage("TOMY_148_BARCODE_33"), 33);
});

test("bắt đầu ô 5 theo trái sang phải rồi trên xuống dưới", () => {
  const pages = buildWarehouseLabelPrintPages(["A", "B", "C"], 16, 5);
  assert.deepEqual(pages, [
    [
      { item: "A", slotIndex: 4 },
      { item: "B", slotIndex: 5 },
      { item: "C", slotIndex: 6 },
    ],
  ]);
});

test("chỉ trang đầu dùng vị trí bắt đầu, trang sau trở lại ô 1", () => {
  const labels = Array.from({ length: 14 }, (_, index) => index + 1);
  const pages = buildWarehouseLabelPrintPages(labels, 16, 5);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]?.[0]?.slotIndex, 4);
  assert.equal(pages[0]?.at(-1)?.slotIndex, 15);
  assert.equal(pages[1]?.[0]?.slotIndex, 0);
  assert.equal(pages[1]?.[1]?.slotIndex, 1);
});

test("chặn thứ tự bắt đầu vượt sức chứa của mẫu", () => {
  assert.equal(isWarehouseLabelStartSlotValid("TOMY_133_16", 16), true);
  assert.equal(isWarehouseLabelStartSlotValid("TOMY_133_16", 17), false);
  assert.equal(isWarehouseLabelStartSlotValid("TOMY_148_33", 33), true);
  assert.equal(isWarehouseLabelStartSlotValid("TOMY_148_33", 34), false);
});

test("xếp SKU kế tiếp vào đầu hàng mới trên mẫu ba cột", () => {
  const pages = buildWarehouseGroupedLabelPrintPages(
    [["A1", "A2", "A3", "A4", "A5"], ["B1", "B2"]],
    33,
    3,
    1,
    true,
  );

  assert.deepEqual(pages, [
    [
      { item: "A1", slotIndex: 0 },
      { item: "A2", slotIndex: 1 },
      { item: "A3", slotIndex: 2 },
      { item: "A4", slotIndex: 3 },
      { item: "A5", slotIndex: 4 },
      { item: "B1", slotIndex: 6 },
      { item: "B2", slotIndex: 7 },
    ],
  ]);
});

test("tắt sắp xếp theo hàng thì các SKU in liền nhau", () => {
  const pages = buildWarehouseGroupedLabelPrintPages(
    [["A1", "A2", "A3", "A4", "A5"], ["B1"]],
    33,
    3,
    1,
    false,
  );

  assert.equal(pages[0]?.at(-1)?.slotIndex, 5);
});

test("ưu tiên SKU nhiều tem và gom SKU một tem liên tục ở cuối", () => {
  const pages = buildWarehouseGroupedLabelPrintPages(
    [["A1"], ["B1", "B2", "B3"], ["C1"], ["D1", "D2"]],
    33,
    3,
    1,
    true,
  );

  assert.deepEqual(pages, [
    [
      { item: "B1", slotIndex: 0 },
      { item: "B2", slotIndex: 1 },
      { item: "B3", slotIndex: 2 },
      { item: "D1", slotIndex: 3 },
      { item: "D2", slotIndex: 4 },
      { item: "A1", slotIndex: 6 },
      { item: "C1", slotIndex: 7 },
    ],
  ]);
});
