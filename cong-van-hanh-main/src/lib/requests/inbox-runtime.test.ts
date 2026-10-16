import assert from "node:assert/strict";
import test from "node:test";

import { extractInboxPayloadItems } from "./inbox-runtime";

test("đọc đủ hồ sơ V3 khi payload có cả wrapper và items", () => {
  const items = extractInboxPayloadItems({
    items: [{ loai: "Hợp đồng lao động" }, { loai: "Phụ lục" }],
    payload: { source: "document-seal" },
  });

  assert.equal(items.length, 2);
  assert.equal(items[1].loai, "Phụ lục");
});

test("đọc được payload cũ lồng nhiều lớp", () => {
  const items = extractInboxPayloadItems({
    payload: {
      rows: [{ hoso: "Đơn đề nghị" }, { hoso: "Thông báo" }],
    },
  });

  assert.deepEqual(items.map((item) => item.hoso), ["Đơn đề nghị", "Thông báo"]);
});

test("vẫn hỗ trợ đơn cũ chỉ có một payload object", () => {
  const items = extractInboxPayloadItems({ payload: { hoso: "Biên bản" } });

  assert.equal(items.length, 1);
  assert.equal(items[0].hoso, "Biên bản");
});
