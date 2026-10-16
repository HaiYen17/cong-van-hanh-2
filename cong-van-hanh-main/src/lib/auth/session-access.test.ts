import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeSessionAccess,
  resolveSessionAccess,
  type SessionAccessRole,
} from "./session-access";

function role(overrides: Partial<SessionAccessRole> = {}): SessionAccessRole {
  return {
    key: "employee",
    roleModuleGroups: [],
    roleModules: [],
    rolePermissions: [],
    ...overrides,
  };
}

test("quyền nhóm được bung thành module con dùng được trong page/action", () => {
  const access = resolveSessionAccess([
    role({
      roleModuleGroups: [
        {
          moduleGroup: {
            isActive: true,
            key: "legal",
            modules: [
              { isActive: true, key: "authorization-letter" },
              { isActive: true, key: "document-seal" },
            ],
          },
        },
      ],
      rolePermissions: [
        { permission: { key: "authorization_letter.read" } },
      ],
    }),
  ]);

  assert.deepEqual(access.moduleGroups, ["legal"]);
  assert.deepEqual(access.modules, ["authorization-letter", "document-seal"]);
  assert.deepEqual(access.permissions, ["authorization_letter.read"]);
  assert.equal(access.fullAccess, false);
});

test("module tắt không được kế thừa từ nhóm hoặc cấp riêng", () => {
  const access = resolveSessionAccess([
    role({
      roleModuleGroups: [
        {
          moduleGroup: {
            isActive: true,
            key: "legal",
            modules: [{ isActive: false, key: "authorization-letter" }],
          },
        },
      ],
      roleModules: [
        { appModule: { isActive: false, key: "authorization-letter" } },
      ],
    }),
  ]);

  assert.deepEqual(access.modules, []);
});

test("nhiều vai trò được hợp nhất, super-admin vẫn có full access", () => {
  const access = resolveSessionAccess([
    role({
      key: "super-admin",
      roleModules: [
        { appModule: { isActive: true, key: "permissions" } },
      ],
    }),
    role({
      roleModules: [
        { appModule: { isActive: true, key: "authorization-letter" } },
      ],
    }),
  ]);

  assert.equal(access.fullAccess, true);
  assert.deepEqual(access.modules, ["authorization-letter", "permissions"]);
  assert.deepEqual(access.roleKeys, ["employee", "super-admin"]);
});

test("hợp quyền ngữ cảnh chỉ cộng thêm, không làm mất quyền nền", () => {
  const merged = mergeSessionAccess(
    {
      fullAccess: false,
      moduleGroups: ["legal", "orders"],
      modules: ["authorization-letter", "my-orders"],
      permissions: ["portal.my-orders.view"],
      roleKeys: ["employee"],
    },
    {
      fullAccess: false,
      moduleGroups: [],
      modules: ["candidate-assessment"],
      permissions: ["context.recruitment-panel.assigned"],
      roleKeys: [],
    },
  );

  assert.deepEqual(merged.moduleGroups, ["legal", "orders"]);
  assert.deepEqual(merged.modules, [
    "authorization-letter",
    "candidate-assessment",
    "my-orders",
  ]);
  assert.deepEqual(merged.roleKeys, ["employee"]);
});
