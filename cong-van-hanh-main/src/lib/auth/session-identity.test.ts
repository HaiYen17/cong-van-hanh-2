import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSessionIdentity,
  sessionOwnsUserId,
} from "./session-identity";

test("tài khoản không liên kết vẫn giữ nguyên danh tính", () => {
  const identity = resolveSessionIdentity({
    authenticatedEmployeeCode: "E01",
    authenticatedEmployeeId: "employee-1",
    authenticatedUserId: "user-1",
  });

  assert.equal(identity.userId, "user-1");
  assert.equal(identity.authenticatedUserId, "user-1");
  assert.deepEqual(identity.linkedEmployeeIds, ["employee-1"]);
  assert.deepEqual(identity.linkedUserIds, ["user-1"]);
});

test("mọi tài khoản trong nhóm dùng tài khoản chính làm danh tính nghiệp vụ", () => {
  const identity = resolveSessionIdentity({
    authenticatedEmployeeCode: "VPTV2",
    authenticatedEmployeeId: "employee-ntc",
    authenticatedUserId: "user-ntc",
    link: {
      members: [
        {
          employeeCode: "VPTV2",
          employeeId: "employee-ntc",
          userId: "user-ntc",
          userStatus: "ACTIVE",
        },
        {
          employeeCode: "2106003",
          employeeId: "employee-tvg",
          userId: "user-tvg",
          userStatus: "ACTIVE",
        },
      ],
      primaryEmployeeId: "employee-tvg",
      status: "ACTIVE",
    },
  });

  assert.equal(identity.userId, "user-tvg");
  assert.equal(identity.authenticatedUserId, "user-ntc");
  assert.equal(identity.primaryEmployeeId, "employee-tvg");
  assert.deepEqual(identity.linkedEmployeeCodes, ["VPTV2", "2106003"]);
  assert.deepEqual(identity.linkedEmployeeIds, ["employee-ntc", "employee-tvg"]);
  assert.deepEqual(identity.linkedUserIds, ["user-tvg", "user-ntc"]);
  assert.equal(sessionOwnsUserId(identity, "user-ntc"), true);
  assert.equal(sessionOwnsUserId(identity, "user-tvg"), true);
});

test("tài khoản chính bị khóa không làm mất quyền đăng nhập của thành viên đang hoạt động", () => {
  const identity = resolveSessionIdentity({
    authenticatedEmployeeId: "employee-2",
    authenticatedUserId: "user-2",
    link: {
      members: [
        {
          employeeId: "employee-1",
          userId: "user-1",
          userStatus: "INACTIVE",
        },
        {
          employeeId: "employee-2",
          userId: "user-2",
          userStatus: "ACTIVE",
        },
      ],
      primaryEmployeeId: "employee-1",
      status: "ACTIVE",
    },
  });

  assert.equal(identity.userId, "user-2");
  assert.deepEqual(identity.linkedUserIds, ["user-2", "user-1"]);
});

test("liên kết không hoạt động không được áp dụng vào session", () => {
  const identity = resolveSessionIdentity({
    authenticatedEmployeeId: "employee-2",
    authenticatedUserId: "user-2",
    link: {
      members: [
        { employeeId: "employee-1", userId: "user-1" },
        { employeeId: "employee-2", userId: "user-2" },
      ],
      primaryEmployeeId: "employee-1",
      status: "INACTIVE",
    },
  });

  assert.equal(identity.userId, "user-2");
  assert.deepEqual(identity.linkedEmployeeIds, ["employee-2"]);
  assert.deepEqual(identity.linkedUserIds, ["user-2"]);
});
