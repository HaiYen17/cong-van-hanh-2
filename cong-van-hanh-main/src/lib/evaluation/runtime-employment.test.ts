import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichEvaluationMemberContent,
  evaluationEmployeeEmploymentState,
} from "@/lib/evaluation/runtime";

const NOW = new Date("2026-08-19T03:00:00.000Z");

test("chỉ coi nhân sự ACTIVE, chưa archive và chưa đến ngày nghỉ là còn làm", () => {
  assert.deepEqual(
    evaluationEmployeeEmploymentState(
      { archivedAt: null, status: "ACTIVE", terminationDate: null },
      NOW,
    ),
    { code: "active", eligible: true, reason: "Đang làm việc" },
  );
  assert.equal(
    evaluationEmployeeEmploymentState(
      { archivedAt: null, status: "INACTIVE", terminationDate: null },
      NOW,
    ).eligible,
    false,
  );
  assert.equal(
    evaluationEmployeeEmploymentState(
      {
        archivedAt: "2026-08-01T00:00:00.000Z",
        status: "ACTIVE",
        terminationDate: null,
      },
      NOW,
    ).code,
    "archived",
  );
  assert.equal(evaluationEmployeeEmploymentState(null, NOW).code, "not_found");
});

test("ngày nghỉ đã đến bị loại, ngày nghỉ tương lai vẫn được sinh phiếu", () => {
  assert.equal(
    evaluationEmployeeEmploymentState(
      { archivedAt: null, status: "ACTIVE", terminationDate: "19/08/2026" },
      NOW,
    ).code,
    "terminated",
  );
  assert.equal(
    evaluationEmployeeEmploymentState(
      { archivedAt: null, status: "ACTIVE", terminationDate: "2026-08-18" },
      NOW,
    ).eligible,
    false,
  );
  assert.equal(
    evaluationEmployeeEmploymentState(
      { archivedAt: null, status: "ACTIVE", terminationDate: "20/08/2026" },
      NOW,
    ).eligible,
    true,
  );
});

test("ngày nghỉ không hợp lệ không tự loại nhầm nhân sự ACTIVE", () => {
  assert.equal(
    evaluationEmployeeEmploymentState(
      {
        archivedAt: null,
        status: "ACTIVE",
        terminationDate: "chưa xác định",
      },
      NOW,
    ).eligible,
    true,
  );
});

test("đổi mã người duyệt phải thay cả tên và email cũ theo danh mục nhân sự", () => {
  const directory = new Map([
    [
      "nv001",
      {
        archivedAt: null,
        department: "C&B",
        email: "nhanvien@example.com",
        employeeCode: "NV001",
        fullName: "Nhân viên được đánh giá",
        status: "ACTIVE",
        terminationDate: null,
        title: "Chuyên viên",
      },
    ],
    [
      "y001",
      {
        archivedAt: null,
        department: "C&B",
        email: "yen@example.com",
        employeeCode: "Y001",
        fullName: "Yến",
        status: "ACTIVE",
        terminationDate: null,
        title: "Quản lý",
      },
    ],
  ]);
  const enriched = enrichEvaluationMemberContent(
    {
      employeeCode: "NV001",
      hrEmail: "nguoi-cu@example.com",
      hrEmployeeCode: "Y001",
      hrName: "Người phân bổ cũ",
      indirectManagerEmail: "nguoi-cu@example.com",
      indirectManagerEmployeeCode: "Y001",
      indirectManagerName: "Người phân bổ cũ",
    },
    directory,
  );
  assert.equal(enriched.hrName, "Yến");
  assert.equal(enriched.hrEmail, "yen@example.com");
  assert.equal(enriched.indirectManagerName, "Yến");
  assert.equal(enriched.indirectManagerEmail, "yen@example.com");
});
