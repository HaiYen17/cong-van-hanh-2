import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPoolKey,
  effectiveDocumentStartIndex,
  nextDocumentSerial,
} from "./document-registry";

test("ưu tiên điểm bắt đầu riêng của pháp nhân", () => {
  assert.equal(effectiveDocumentStartIndex(1, 53), 53);
  assert.equal(effectiveDocumentStartIndex(7, null), 7);
  assert.equal(effectiveDocumentStartIndex(0, 0), 1);
});

test("tiếp tục sau số issued lớn nhất và không tự lấp khoảng trống lịch sử", () => {
  assert.equal(
    nextDocumentSerial(1, 999999, [
      { serial: 1, status: "ISSUED" },
      { serial: 15, status: "ISSUED" },
    ]),
    16,
  );
});

test("chỉ tái dùng slot đã hủy rõ ràng", () => {
  assert.equal(
    nextDocumentSerial(10, 100, [
      { serial: 10, status: "ISSUED" },
      { serial: 11, status: "CANCELLED" },
      { serial: 52, status: "ISSUED" },
    ]),
    11,
  );
});

test("dữ liệu legacy trùng serial không được làm sống lại số đã cấp", () => {
  assert.equal(
    nextDocumentSerial(1, 999999, [
      { serial: 5, status: "CANCELLED" },
      { serial: 5, status: "ISSUED" },
      { serial: 78, status: "ISSUED" },
    ]),
    79,
  );
});

test("hai pháp nhân luôn có pool độc lập", () => {
  const ntv = buildPoolKey("hop-dong", "NTV", "2026");
  const tvd = buildPoolKey("hop-dong", "TVD", "2026");
  assert.notEqual(ntv, tvd);
});

test("trả null khi chạm giới hạn và không còn slot hủy", () => {
  assert.equal(
    nextDocumentSerial(50, 52, [
      { serial: 50, status: "ISSUED" },
      { serial: 51, status: "ISSUED" },
      { serial: 52, status: "ISSUED" },
    ]),
    null,
  );
});
