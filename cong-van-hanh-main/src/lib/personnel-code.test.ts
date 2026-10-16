import assert from "node:assert/strict";
import test from "node:test";

import {
  employeeCodeIdentity,
  employeeCodesMatch,
  normalizedEmployeeCode,
} from "./personnel-code";

test("giữ nguyên mã nhân sự đúng như nguồn", () => {
  assert.equal(normalizedEmployeeCode(" 00143 "), "00143");
});

test("nhận diện mã số cũ bị mất số 0 đầu là cùng một nhân sự", () => {
  assert.equal(employeeCodeIdentity("00143"), "143");
  assert.equal(employeeCodesMatch("00143", "143"), true);
  assert.equal(employeeCodesMatch("000", "0"), true);
});

test("mã có chữ chỉ so sánh không phân biệt hoa thường", () => {
  assert.equal(employeeCodesMatch(" VPTV2 ", "vptv2"), true);
  assert.equal(employeeCodesMatch("NV001", "NV1"), false);
});
