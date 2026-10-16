import assert from "node:assert/strict";
import test from "node:test";

import {
  compareMotivationBulletins,
  filterMotivationRecords,
  formatMotivationCompactSchedule,
  formatMotivationSchedule,
  matchesMotivationAudience,
  type MotivationAudience,
  type MotivationPolicyRecord,
} from "./motivation-policy";

const audience: MotivationAudience = {
  companyTokens: ["company-ntv", "NTV", "Thuần Việt Digital"],
  department: "Phòng Kiến tạo Nhân sự",
  employeeCode: "2411301",
  employeeId: "employee-1",
  email: "minh.thong@example.com",
  userId: "user-1",
  username: "2411301",
};

function record(
  overrides: Partial<MotivationPolicyRecord> = {},
): MotivationPolicyRecord {
  return {
    createdAt: new Date("2026-07-01T00:00:00+07:00"),
    displayChannel: "both",
    endAt: null,
    kind: "notice",
    priority: 0,
    startAt: null,
    targetCompanies: [],
    targetDepartments: [],
    targetEmployees: [],
    targetScope: "all",
    title: "Thông báo",
    updatedAt: new Date("2026-07-01T00:00:00+07:00"),
    ...overrides,
  };
}

test("lọc đúng cửa sổ hiệu lực", () => {
  const now = new Date("2026-07-31T12:00:00+07:00");
  const visible = filterMotivationRecords(
    [
      record({ title: "không giới hạn" }),
      record({
        endAt: new Date("2026-07-31T13:00:00+07:00"),
        startAt: new Date("2026-07-31T11:00:00+07:00"),
        title: "đang hiệu lực",
      }),
      record({
        endAt: new Date("2026-07-31T11:59:00+07:00"),
        title: "đã hết hạn",
      }),
      record({
        startAt: new Date("2026-07-31T12:01:00+07:00"),
        title: "chưa bắt đầu",
      }),
    ],
    audience,
    now,
  );
  assert.deepEqual(
    visible.map((item) => item.title),
    ["không giới hạn", "đang hiệu lực"],
  );
});

test("đối tượng công ty nhận cả ID, mã và tên cũ", () => {
  assert.equal(
    matchesMotivationAudience(
      record({
        targetCompanies: ["Thuần Việt Digital"],
        targetScope: "company",
      }),
      audience,
    ),
    true,
  );
  assert.equal(
    matchesMotivationAudience(
      record({
        targetCompanies: ["Công ty không liên quan"],
        targetScope: "company",
      }),
      audience,
    ),
    false,
  );
});

test("đối tượng phòng ban và nhân viên được chuẩn hóa dấu", () => {
  assert.equal(
    matchesMotivationAudience(
      record({
        targetDepartments: ["Phong Kien tao Nhan su"],
        targetScope: "department",
      }),
      audience,
    ),
    true,
  );
  assert.equal(
    matchesMotivationAudience(
      record({
        targetEmployees: ["2411301"],
        targetScope: "employee",
      }),
      audience,
    ),
    true,
  );
});

test("ưu tiên cao hơn trước, cùng ưu tiên thì thông báo trước sự kiện", () => {
  const values = [
    record({ kind: "event", priority: 2, title: "Sự kiện" }),
    record({ kind: "notice", priority: 2, title: "Thông báo" }),
    record({ kind: "event", priority: 3, title: "Ưu tiên cao" }),
  ].sort(compareMotivationBulletins);
  assert.deepEqual(
    values.map((item) => item.title),
    ["Ưu tiên cao", "Thông báo", "Sự kiện"],
  );
});

test("định dạng thời gian bằng múi giờ Việt Nam", () => {
  const label = formatMotivationSchedule(
    "2026-07-31T01:00:00.000Z",
    "2026-07-31T03:00:00.000Z",
  );
  assert.match(label ?? "", /31\/07\/2026/);
  assert.match(label ?? "", /08:00/);
  assert.match(label ?? "", /10:00/);
});

test("định dạng thời gian gọn cho thẻ bản tin", () => {
  const label = formatMotivationCompactSchedule(
    "2026-07-31T01:00:00.000Z",
    "2026-08-01T03:30:00.000Z",
  );
  assert.equal(label, "31/07 · 08:00 → 01/08 · 10:30");
});
