import assert from "node:assert/strict";
import test from "node:test";

import {
  allocationRecipientMatches,
  buildAllocationReceiptView,
  confirmAllocationReceiptRows,
} from "./allocation-receipt";

const identity = {
  employeeCodes: ["2411301"],
  employeeIds: ["employee-db-id"],
  names: ["Nguyễn Minh Thông"],
};

test("nhận diện đúng người được cấp phát bằng id, mã nhân viên và nhãn cũ", () => {
  assert.equal(
    allocationRecipientMatches({ assigneeId: "employee-db-id" }, identity),
    true,
  );
  assert.equal(
    allocationRecipientMatches(
      { assignee: "Nguyễn Minh Thông · 2411301 · Phòng Kiến tạo nhân sự" },
      identity,
    ),
    true,
  );
  assert.equal(
    allocationRecipientMatches(
      { assigneeId: "employee-khac", assignee: "Nguyễn Minh Thông" },
      identity,
    ),
    false,
  );
});

test("mỗi người chỉ xác nhận các dòng cấp phát thuộc về mình", () => {
  const rows = [
    {
      assigneeId: "employee-db-id",
      category: "Đồng phục",
      description: "Nữ · M",
      itemName: "Áo polo",
      quantity: "2",
    },
    {
      assigneeId: "employee-khac",
      category: "Đồng phục",
      itemName: "Áo khoác",
      quantity: "1",
    },
  ];
  const result = confirmAllocationReceiptRows(
    rows,
    identity,
    {
      employeeCode: "2411301",
      employeeId: "employee-db-id",
      name: "Nguyễn Minh Thông",
      userId: "user-id",
    },
    "2026-08-20T08:00:00.000Z",
  );

  assert.deepEqual(result.confirmedIndexes, [0]);
  assert.deepEqual(result.rows[0]?.recipientReceipt, {
    confirmedAt: "2026-08-20T08:00:00.000Z",
    confirmedByEmployeeCode: "2411301",
    confirmedByEmployeeId: "employee-db-id",
    confirmedByName: "Nguyễn Minh Thông",
    confirmedByUserId: "user-id",
    status: "RECEIVED",
  });
  assert.equal(result.rows[1]?.recipientReceipt, undefined);
  assert.deepEqual(buildAllocationReceiptView(result.rows, identity), {
    confirmedCount: 1,
    items: [
      {
        assignee: "",
        category: "Đồng phục",
        confirmedAt: "2026-08-20T08:00:00.000Z",
        confirmedByName: "Nguyễn Minh Thông",
        description: "Nữ · M",
        itemIndex: 0,
        itemName: "Áo polo",
        quantity: "2",
        status: "RECEIVED",
      },
    ],
    pendingCount: 0,
    recipient: true,
    totalCount: 1,
  });
});

test("bấm xác nhận lần hai là idempotent", () => {
  const rows = [
    {
      assigneeId: "employee-db-id",
      itemName: "Áo polo",
      recipientReceipt: {
        confirmedAt: "2026-08-20T08:00:00.000Z",
        status: "RECEIVED",
      },
    },
  ];
  const result = confirmAllocationReceiptRows(
    rows,
    identity,
    { employeeCode: "2411301", employeeId: "employee-db-id", name: "Nguyễn Minh Thông", userId: "user-id" },
    "2026-08-20T09:00:00.000Z",
  );
  assert.deepEqual(result.confirmedIndexes, []);
  assert.deepEqual(result.alreadyConfirmedIndexes, [0]);
  assert.deepEqual(result.rows[0]?.recipientReceipt, rows[0].recipientReceipt);
});
