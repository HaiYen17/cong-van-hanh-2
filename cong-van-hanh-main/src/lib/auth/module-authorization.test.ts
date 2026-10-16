import assert from "node:assert/strict";
import test from "node:test";

import type { AppSession } from "@/lib/auth/session";
import { canUsePortalModule } from "@/lib/auth/module-authorization";

function session(overrides: Partial<AppSession> = {}): AppSession {
  return {
    displayName: "Test",
    fullAccess: false,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: [],
    userId: "test-user",
    ...overrides,
  };
}

test("module visible is not enough to write without action permission", () => {
  const value = session({ modules: ["candidate-management"] });
  assert.equal(canUsePortalModule(value, "candidate-management", "edit"), false);
});

test("candidate recruitment role can use the exact granted action", () => {
  const value = session({
    modules: ["candidate-management"],
    permissions: ["portal.candidate-management.edit"],
    roles: ["admin-tuyen-dung"],
  });
  assert.equal(canUsePortalModule(value, "candidate-management", "view"), true);
  assert.equal(canUsePortalModule(value, "candidate-management", "edit"), true);
  assert.equal(canUsePortalModule(value, "candidate-management", "delete"), false);
});

test("global administrators keep full module access", () => {
  const value = session({ roles: ["admin"] });
  assert.equal(canUsePortalModule(value, "candidate-management", "delete"), true);
});
