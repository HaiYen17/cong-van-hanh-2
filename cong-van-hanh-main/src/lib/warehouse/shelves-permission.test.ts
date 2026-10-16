import assert from "node:assert/strict";
import test from "node:test";

import { canUseShelf } from "./shelves";

function actor(modules: string[]) {
  return {
    displayName: "Quản kho",
    fullAccess: false,
    moduleGroups: [],
    modules,
    userId: "warehouse-user",
  };
}

test("Thông tin kho được đọc và định nghĩa lại Xe/Kệ", () => {
  assert.equal(canUseShelf(actor(["warehouse-info"]), "shelves:read"), true);
  assert.equal(canUseShelf(actor(["warehouse-info"]), "shelves:write"), true);
});

test("Kiểm kê Kho chỉ được đọc danh mục Xe/Kệ", () => {
  assert.equal(
    canUseShelf(actor(["warehouse-inventory"]), "shelves:read"),
    true,
  );
  assert.equal(
    canUseShelf(actor(["warehouse-inventory"]), "shelves:write"),
    false,
  );
});

test("Cấu hình kệ được đọc và cập nhật danh mục kệ", () => {
  assert.equal(canUseShelf(actor(["warehouse-shelf-config"]), "shelves:read"), true);
  assert.equal(canUseShelf(actor(["warehouse-shelf-config"]), "shelves:write"), true);
});
