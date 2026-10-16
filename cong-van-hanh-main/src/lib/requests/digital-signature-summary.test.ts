import assert from "node:assert/strict";
import test from "node:test";

import { parseDigitalSummary } from "./digital-signature-summary";

test("Gemini signature summary accepts only the four expected string fields", () => {
  assert.deepEqual(
    parseDigitalSummary('```json\n{"documentType":"Hợp đồng","counterparty":"Công ty A","value":"100.000.000 VND","summary":"Cung cấp dịch vụ trong 12 tháng."}\n```'),
    {
      counterparty: "Công ty A",
      documentType: "Hợp đồng",
      summary: "Cung cấp dịch vụ trong 12 tháng.",
      value: "100.000.000 VND",
    },
  );
  assert.throws(() => parseDigitalSummary("không phải JSON"), /JSON hợp lệ/);
  assert.throws(
    () => parseDigitalSummary('{"documentType":[],"summary":"Có nội dung"}'),
    /sai cấu trúc/,
  );
  assert.throws(
    () => parseDigitalSummary('{"documentType":"Hợp đồng","summary":""}'),
    /chưa trả nội dung/,
  );
});
