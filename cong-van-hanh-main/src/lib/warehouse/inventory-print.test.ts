import assert from "node:assert/strict";
import test from "node:test";

import { buildWarehouseInventoryPrintDocument } from "../../app/kho-van/kiem-ke/inventory-print";
import type { WarehouseInventoryDetail } from "./types";

test("biên bản kiểm kê dùng Be Vietnam Pro và ngữ cảnh in riêng", () => {
  const detail = {
    comparison: [
      {
        name: "Nệm Cao Su Foam Retina Sliver",
        physicalQuantity: 3,
        sku: "RTS10-6",
      },
    ],
    sessionKey: "inventory-font-test",
    summary: {
      inStockRfidCount: 3,
      physicalSkuCount: 1,
    },
  } as WarehouseInventoryDetail;

  const html = buildWarehouseInventoryPrintDocument(
    detail,
    "START",
    "Nguyễn Minh Thông",
  );

  assert.match(html, /font-family:\s*"Be Vietnam Pro"/);
  assert.match(html, /font-weight:\s*400/);
  assert.match(html, /font-weight:\s*700/);
  assert.match(html, /\/_next\/static\/media\/.+\.woff2/);
  assert.match(html, /padding:\s*15mm 14mm 14mm/);
  assert.match(html, /Biên bản kiểm kê đầu kỳ/);
  assert.match(html, /class="notranslate"/);
  assert.doesNotMatch(html, /data-warehouse-print-root/);
  assert.doesNotMatch(html, /Tomy 148/i);
  assert.doesNotMatch(html, /Segoe UI/);
});
