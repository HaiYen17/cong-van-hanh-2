import assert from "node:assert/strict";
import test from "node:test";

import {
  representativeSkuProductName,
  skuProductNameWithoutSize,
} from "./sku-product-name";

test("removes mattress dimensions but keeps the product line", () => {
  assert.equal(
    skuProductNameWithoutSize(
      "Nệm cao su thiên nhiên Thuần Việt Latex Premium (5cm/160cmx200cm)",
    ),
    "Nệm cao su thiên nhiên Thuần Việt Latex Premium",
  );
  assert.equal(
    skuProductNameWithoutSize("Nệm Foam Premium - 10cm/1m6x2m"),
    "Nệm Foam Premium",
  );
  assert.equal(skuProductNameWithoutSize("Nệm ép 100x200"), "Nệm ép");
});

test("keeps descriptive parentheses and chooses the most common product line", () => {
  assert.equal(
    skuProductNameWithoutSize("Nệm Latex (Phiên bản mới)"),
    "Nệm Latex (Phiên bản mới)",
  );
  assert.equal(
    representativeSkuProductName([
      "Nệm Latex Premium (5cm/100cmx200cm)",
      "Nệm Latex Premium (10cm/160cmx200cm)",
      "Áo nệm Latex Premium (160cmx200cm)",
    ]),
    "Nệm Latex Premium",
  );
});
