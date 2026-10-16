import assert from "node:assert/strict";
import test from "node:test";

import { effectiveSealDeclarationModes } from "./document-declaration";

test("HĐLĐ cũ được bổ sung cách khai báo theo nhân sự/đối tác", () => {
  assert.deepEqual(
    effectiveSealDeclarationModes("Hợp đồng lao động", ["period"]),
    ["partner", "period"],
  );
});

test("không thay đổi loại hồ sơ thông thường", () => {
  assert.deepEqual(
    effectiveSealDeclarationModes("Thông báo nội bộ", ["detail"]),
    ["detail"],
  );
});

test("không nhân đôi partner đã có", () => {
  assert.deepEqual(
    effectiveSealDeclarationModes("Phụ lục Hợp đồng", ["partner", "period"]),
    ["partner", "period"],
  );
});
