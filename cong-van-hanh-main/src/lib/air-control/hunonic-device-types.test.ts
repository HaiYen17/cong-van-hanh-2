import assert from "node:assert/strict";
import test from "node:test";

import {
  getHunonicDevicePowerState,
  getHunonicElectricalDeviceKind,
  isHunonicLightSwitch,
} from "./hunonic-device-types";

test("Hunonic device types separate air conditioners and safe light switches", () => {
  assert.equal(getHunonicElectricalDeviceKind("irchildv2"), "air-conditioner");
  assert.equal(getHunonicElectricalDeviceKind("wsdatic3v"), "light");
  assert.equal(getHunonicElectricalDeviceKind("wsdatic3vN3"), "light");
  assert.equal(getHunonicElectricalDeviceKind("atmwifi"), null);
  assert.equal(isHunonicLightSwitch("relay"), true);
});

test("Hunonic light state reads the REST turn field", () => {
  assert.equal(
    getHunonicDevicePowerState({ rootType: "wsdatic3v", value: '{"turn":1}' }),
    true,
  );
  assert.equal(
    getHunonicDevicePowerState({ rootType: "wsdatic3v", value: { turn: 2 } }),
    false,
  );
});
