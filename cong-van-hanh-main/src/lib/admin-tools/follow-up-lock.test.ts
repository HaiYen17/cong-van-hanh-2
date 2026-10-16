import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedModuleKeys,
  followUpBlocksAnyModule,
} from "./follow-up-lock";

test("chuẩn hóa danh sách module đang bị hậu kiểm chặn", () => {
  assert.deepEqual(
    blockedModuleKeys(["document-seal", " document-seal ", "asset-allocation"]),
    ["document-seal", "asset-allocation"],
  );
  assert.deepEqual(blockedModuleKeys(true), ["*"]);
});

test("chỉ coi hậu kiểm có module cụ thể là đang khóa", () => {
  assert.equal(followUpBlocksAnyModule(["document-seal"]), true);
  assert.equal(followUpBlocksAnyModule([]), false);
  assert.equal(followUpBlocksAnyModule(false), false);
  assert.equal(followUpBlocksAnyModule(null), false);
});
