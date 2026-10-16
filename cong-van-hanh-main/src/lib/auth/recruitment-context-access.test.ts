import assert from "node:assert/strict";
import test from "node:test";

import {
  grantRecruitmentPanelContext,
  RECRUITMENT_PANEL_CONTEXT_PERMISSION,
  RECRUITMENT_PANEL_MODULE_KEY,
} from "./recruitment-context-access";

test("phân công phỏng vấn tự mở đúng Module đánh giá theo ngữ cảnh", () => {
  const access = grantRecruitmentPanelContext({
    fullAccess: false,
    moduleGroups: ["nguoi-thuan-viet"],
    modules: ["my-orders"],
    permissions: ["portal.my-orders.view"],
    roleKeys: ["employee"],
  });

  assert.deepEqual(access.modules, ["candidate-assessment", "my-orders"]);
  assert.equal(
    access.permissions.includes(RECRUITMENT_PANEL_CONTEXT_PERMISSION),
    true,
  );
  assert.equal(
    access.permissions.includes(`portal.${RECRUITMENT_PANEL_MODULE_KEY}.edit`),
    false,
  );
});

test("cấp quyền ngữ cảnh lặp lại không tạo dữ liệu trùng", () => {
  const once = grantRecruitmentPanelContext({
    fullAccess: false,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roleKeys: [],
  });
  const twice = grantRecruitmentPanelContext(once);

  assert.deepEqual(twice, once);
});

test("thành viên Hội đồng thiếu vai trò vẫn được bù toàn bộ quyền Nhân viên", () => {
  const access = grantRecruitmentPanelContext(
    {
      fullAccess: false,
      moduleGroups: [],
      modules: [],
      permissions: [],
      roleKeys: [],
    },
    {
      fullAccess: false,
      moduleGroups: ["asset-repair", "hanh-chinh-nv", "legal", "orders"],
      modules: [
        "authorization-letter",
        "document-seal",
        "my-orders",
      ],
      permissions: ["portal.my-orders.view"],
      roleKeys: ["employee"],
    },
  );

  assert.deepEqual(access.moduleGroups, [
    "asset-repair",
    "hanh-chinh-nv",
    "legal",
    "orders",
  ]);
  assert.deepEqual(access.modules, [
    "authorization-letter",
    "candidate-assessment",
    "document-seal",
    "my-orders",
  ]);
  assert.deepEqual(access.roleKeys, ["employee"]);
});
