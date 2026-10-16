import assert from "node:assert/strict";
import test from "node:test";

import { disclosurePdfTestUtils } from "@/lib/accounting/disclosure-pdf";

test("B09 PDF keeps the workbook name and replaces only the extension", () => {
  assert.equal(
    disclosurePdfTestUtils.pdfFileName(
      "B09 DN Thuyet minh bao cao tai chinh - 2026-01-31.xlsx",
    ),
    "B09 DN Thuyet minh bao cao tai chinh - 2026-01-31.pdf",
  );
});

test("B09 PDF rejects an empty workbook before starting LibreOffice", () => {
  assert.throws(
    () => disclosurePdfTestUtils.workbookBuffer({}),
    /File Excel B09 vừa tạo đang rỗng/,
  );
});
