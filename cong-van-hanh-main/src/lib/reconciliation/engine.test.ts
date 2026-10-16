import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReconciliationPeriod,
  parseFlexibleDate,
  runReconciliationEngine,
} from "@/lib/reconciliation/engine";
import type { HrEntry } from "@/lib/reconciliation/types";

const hr: HrEntry[] = [
  {
    accountNames: ["Trưởng phòng Marketing"],
    company: "Thuần Việt Global",
    department: "Marketing",
    employeeCode: "NV001",
    employeeName: "Nguyễn Văn A",
    username: "vana",
  },
];

test("ghép mã giao dịch trùng theo lần xuất hiện và dùng lại dòng cuối khi dư", () => {
  const result = runReconciliationEngine({
    baseRewardRows: [
      {
        "Giá (điểm)": 100,
        "Mã giao dịch": "TX1",
        Tên: "Nguyễn Văn A",
        Username: "vana",
      },
      {
        "Giá (điểm)": 200,
        "Mã giao dịch": "TX1",
        Tên: "Trưởng phòng Marketing",
        Username: "vana",
      },
    ],
    hrEntries: hr,
    period: buildReconciliationPeriod(7, 2026),
    urboxRows: [1, 2, 3].map((index) => ({
      __sourceRow: index + 2,
      "Giá trị": 0,
      "Mã giao dịch": "TX1",
      "Số lượng": 1,
      "Tên quà": `Quà ${index}`,
      "Thời gian đổi quà": "2026-07-01T10:00:00",
    })),
  });

  assert.deepEqual(
    result.details.map((row) => row.value),
    [100, 200, 200],
  );
  assert.deepEqual(
    result.details.map((row) => row.occurrence),
    [1, 2, 3],
  );
  assert.equal(result.accountResolvedCount, 2);
});

test("giữ khác biệt công thức tổng công ty và tổng người dùng", () => {
  const result = runReconciliationEngine({
    baseRewardRows: [
      {
        "Mã giao dịch": "TX2",
        Tên: "Nguyễn Văn A",
        Username: "vana",
      },
    ],
    hrEntries: hr,
    period: buildReconciliationPeriod(7, 2026),
    urboxRows: [
      {
        "Giá trị": 50,
        "Mã giao dịch": "TX2",
        "Số lượng": 3,
        "Tên quà": "Voucher",
        "Thời gian đổi quà": "01/07/2026",
      },
    ],
  });

  assert.equal(result.companyStats["Thuần Việt Global"][0].total, 150);
  assert.equal(result.userStats["Thuần Việt Global"][0].total, 50);
});

test("lọc kỳ bao gồm ngày 26 tháng trước đến hết ngày 25", () => {
  const result = runReconciliationEngine({
    baseRewardRows: [
      { "Mã giao dịch": "A", Tên: "Nguyễn Văn A" },
      { "Mã giao dịch": "B", Tên: "Nguyễn Văn A" },
      { "Mã giao dịch": "C", Tên: "Nguyễn Văn A" },
    ],
    hrEntries: hr,
    period: buildReconciliationPeriod(7, 2026),
    urboxRows: [
      {
        "Mã giao dịch": "A",
        "Tên quà": "A",
        "Thời gian đổi quà": "25/06/2026",
      },
      {
        "Mã giao dịch": "B",
        "Tên quà": "B",
        "Thời gian đổi quà": "26/06/2026",
      },
      {
        "Mã giao dịch": "C",
        "Tên quà": "C",
        "Thời gian đổi quà": "25/07/2026",
      },
    ],
  });

  assert.deepEqual(
    result.details.map((row) => row.transactionCode),
    ["B", "C"],
  );
});

test("giữ nguyên giờ phút của datetime ISO để sắp xếp bảng kê", () => {
  assert.equal(
    parseFlexibleDate("2026-07-01T15:45:30+07:00")?.toISOString(),
    "2026-07-01T08:45:30.000Z",
  );
});

test("khớp Account chức danh sang đúng nhân sự PostgreSQL", () => {
  const result = runReconciliationEngine({
    accountMappings: [
      {
        accountName: "Trưởng phòng Marketing",
        employeeName: "Nguyễn Văn A",
        username: "vana",
      },
    ],
    baseRewardRows: [
      {
        "Mã giao dịch": "TX-MAP",
        Tên: "Trưởng phòng Marketing",
        Username: "vana",
      },
    ],
    hrEntries: [{ ...hr[0], accountNames: [] }],
    period: buildReconciliationPeriod(7, 2026),
    urboxRows: [
      {
        "Giá trị": 100,
        "Mã giao dịch": "TX-MAP",
        "Tên quà": "Voucher",
        "Thời gian đổi quà": "01/07/2026",
      },
    ],
  });

  assert.equal(result.details[0].employeeName, "Nguyễn Văn A");
  assert.equal(result.details[0].company, "Thuần Việt Global");
  assert.equal(result.details[0].accountMatched, true);
  assert.equal(result.details[0].hrMatched, true);
});

test("quy nhân sự nhiều pháp nhân về tài khoản lấy chính", () => {
  const result = runReconciliationEngine({
    baseRewardRows: [
      {
        "Mã giao dịch": "TX-PRIMARY",
        Tên: "Giám đốc Digital",
        Username: "vana.digital",
      },
    ],
    hrEntries: [
      {
        accountNames: ["Giám đốc Digital"],
        aliases: ["Nguyễn Văn A Digital"],
        company: "Thuần Việt Global",
        department: "Ban giám đốc",
        employeeCode: "TVG001",
        employeeName: "Nguyễn Văn A",
        username: "vana",
        usernames: ["vana", "vana.digital"],
      },
    ],
    period: buildReconciliationPeriod(7, 2026),
    urboxRows: [
      {
        "Giá trị": 100,
        "Mã giao dịch": "TX-PRIMARY",
        "Tên quà": "Voucher",
        "Thời gian đổi quà": "01/07/2026",
      },
    ],
  });

  assert.equal(result.details[0].employeeName, "Nguyễn Văn A");
  assert.equal(result.details[0].employeeCode, "TVG001");
  assert.equal(result.details[0].company, "Thuần Việt Global");
  assert.equal(result.details[0].accountMatched, true);
  assert.equal(result.details[0].hrMatched, true);
});
