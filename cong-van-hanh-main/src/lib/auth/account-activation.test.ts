import assert from "node:assert/strict";
import test from "node:test";

import {
  activationStatusLabel,
  canRequestAccountActivation,
} from "./account-activation";

test("chỉ tài khoản chưa yêu cầu hoặc từng bị từ chối được gửi yêu cầu", () => {
  assert.equal(canRequestAccountActivation("NOT_REQUESTED"), true);
  assert.equal(canRequestAccountActivation("REJECTED"), true);
  assert.equal(canRequestAccountActivation("PENDING"), false);
  assert.equal(canRequestAccountActivation("APPROVED"), false);
});

test("nhãn kích hoạt hiển thị đúng trạng thái cho Admin", () => {
  assert.equal(activationStatusLabel("NOT_REQUESTED"), "Chưa yêu cầu");
  assert.equal(activationStatusLabel("PENDING"), "Chờ kích hoạt");
  assert.equal(activationStatusLabel("APPROVED"), "Đã kích hoạt");
  assert.equal(activationStatusLabel("REJECTED"), "Đã từ chối");
});
