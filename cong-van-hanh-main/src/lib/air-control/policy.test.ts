import assert from "node:assert/strict";
import test from "node:test";

import { resolveAirControlRuntimeConfig } from "./policy";

test("air control defaults to demo without explicit authorization", () => {
  const config = resolveAirControlRuntimeConfig({
    AIR_CONTROL_BRIDGE_SECRET: "secret",
    AIR_CONTROL_BRIDGE_URL: "https://bridge.example",
  });

  assert.equal(config.mode, "demo");
  assert.equal(config.liveAuthorized, false);
});

test("air control only enables live with authorization and complete bridge config", () => {
  const config = resolveAirControlRuntimeConfig({
    AIR_CONTROL_BRIDGE_SECRET: "secret",
    AIR_CONTROL_BRIDGE_URL: "https://bridge.example/",
    AIR_CONTROL_HUNONIC_PASSWORD: "password",
    AIR_CONTROL_HUNONIC_USERNAME: "portal-account",
    AIR_CONTROL_LIVE_AUTHORIZED: "true",
  });

  assert.equal(config.mode, "live");
  assert.equal(config.bridgeUrl, "https://bridge.example");
});
