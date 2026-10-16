import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWarehouseRfidSearch } from "./mobile-search";

test("normalizeWarehouseRfidSearch accepts query aliases", () => {
  assert.deepEqual(normalizeWarehouseRfidSearch({ sku: " NTV-001 " }), {
    limit: 100,
    query: "NTV-001",
  });
});

test("normalizeWarehouseRfidSearch caps limit and requires a query", () => {
  assert.equal(
    normalizeWarehouseRfidSearch({ query: "gối", limit: 900 }).limit,
    500,
  );
  assert.throws(() => normalizeWarehouseRfidSearch({}), /Cần query/u);
});
