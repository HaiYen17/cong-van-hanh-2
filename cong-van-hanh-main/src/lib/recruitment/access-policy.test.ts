import assert from "node:assert/strict";
import test from "node:test";

import { isRecruitmentAdministrator } from "./access-policy";

test("Admin Tuyển dụng có phạm vi dữ liệu quản trị trong ba Module Tuyển dụng", () => {
  assert.equal(
    isRecruitmentAdministrator({
      isAdmin: false,
      roles: ["employee", "admin-tuyen-dung"],
    }),
    true,
  );
});

test("người phỏng vấn thông thường không được nâng thành Admin Tuyển dụng", () => {
  assert.equal(
    isRecruitmentAdministrator({ isAdmin: false, roles: ["employee"] }),
    false,
  );
});

test("Admin hệ thống vẫn có toàn quyền dữ liệu Tuyển dụng", () => {
  assert.equal(isRecruitmentAdministrator({ isAdmin: true, roles: [] }), true);
});
