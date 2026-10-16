import assert from "node:assert/strict";
import test from "node:test";

import { normalizeElectricalDeviceIds } from "@/lib/air-control/electrical-layout";

test("electrical layout keeps the first selected device id", () => {
  assert.deepEqual(normalizeElectricalDeviceIds(["device-first"]), [
    "device-first",
  ]);
});

test("electrical layout trims, removes blanks and de-duplicates device ids", () => {
  assert.deepEqual(
    normalizeElectricalDeviceIds([
      " device-one ",
      "",
      "device-two",
      "device-one",
    ]),
    ["device-one", "device-two"],
  );
});
