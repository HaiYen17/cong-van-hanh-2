import assert from "node:assert/strict";
import test from "node:test";

import type { HunonicDevice } from "./hunonic-mobile-client";
import {
  buildHunonicAcAction,
  buildHunonicSwitchAction,
  decryptHunonicPayload,
  encryptHunonicPayload,
  getHunonicAcControlProfile,
  getHunonicAcState,
} from "./hunonic-mqtt-client";

const device: HunonicDevice = {
  diagnostic: {
    brand: { id: "121" },
    remote: [
      { key_name: "temp_min", key_value: "16" },
      { key_name: "temp_max", key_value: "32" },
      {
        key_name: "mode",
        key_value:
          '[{"name":"auto","code":3},{"name":"cool","code":2},{"name":"dry","code":7},{"name":"fan","code":0},{"name":"heat","code":1}]',
      },
      {
        key_name: "fan",
        key_value:
          '[{"name":"low","code":1},{"name":"med","code":3},{"name":"high","code":5}]',
      },
    ],
  },
  externalId: "3733003",
  gatewayRootId: "HUN171680092713irwifiv2N1",
  homeId: "1",
  homeName: "Nhà",
  indexInRoot: 1,
  iv: Buffer.from("0123456789abcdef").toString("base64"),
  key: Buffer.from("abcdef0123456789").toString("base64"),
  name: "Phòng Chủ Động",
  online: true,
  roomId: "2",
  roomName: "Phòng",
  rootId: "HUN-CHILD",
  rootType: "irchildv2",
  topicPublish: "u/1/device/1/ok",
  topicSubscribe: "u/1/device/1",
  value:
    '{"power":1,"mode":3,"temp":26,"fan":1,"swingv":-1,"swingh":6,"brand":121}',
};

test("Hunonic MQTT AES-128-CBC payload round-trips as raw bytes", () => {
  const payload = { irwifiv2: 105 };
  assert.deepEqual(
    decryptHunonicPayload(device, encryptHunonicPayload(device, payload)),
    payload,
  );
});

test("air-conditioner power command preserves the current IR state", () => {
  assert.deepEqual(
    buildHunonicAcAction(device, { powerOn: false, userId: 7 }),
    {
      irwifiv2: 1,
      act: 0,
      brand: 121,
      fan: 1,
      mode: 3,
      power: 0,
      swingh: 6,
      swingv: -1,
      temp: 26,
      type: 1,
      u: 7,
    },
  );
});

test("air-conditioner temperature, mode and fan commands only patch requested fields", () => {
  assert.deepEqual(
    buildHunonicAcAction(device, {
      modeCode: 2,
      temperature: 27,
      userId: 7,
    }),
    {
      irwifiv2: 1,
      act: 0,
      brand: 121,
      fan: 1,
      mode: 2,
      power: 1,
      swingh: 6,
      swingv: -1,
      temp: 27,
      type: 1,
      u: 7,
    },
  );
  const fanAction = buildHunonicAcAction(device, { fanCode: 5, userId: 7 });
  assert.equal(fanAction.fan, 5);
  assert.equal(fanAction.mode, 3);
  assert.equal(fanAction.power, 1);
  assert.equal(fanAction.temp, 26);
});

test("fan speed is independent from every safe operating mode", () => {
  for (const modeCode of [3, 2, 7, 0]) {
    const deviceInMode = {
      ...device,
      value: JSON.stringify({
        brand: 121,
        fan: 1,
        mode: modeCode,
        power: 1,
        swingh: 6,
        swingv: -1,
        temp: 24,
      }),
    };
    const action = buildHunonicAcAction(deviceInMode, {
      fanCode: 5,
      userId: 7,
    });
    assert.equal(action.fan, 5);
    assert.equal(action.mode, modeCode);
    assert.equal(action.power, 1);
    assert.equal(action.temp, 24);
  }
});

test("air-conditioner mode command can power on an inactive device atomically", () => {
  const poweredOffDevice = {
    ...device,
    value:
      '{"power":0,"mode":3,"temp":26,"fan":1,"swingv":-1,"swingh":6,"brand":121}',
  };
  assert.deepEqual(
    buildHunonicAcAction(poweredOffDevice, {
      modeCode: 2,
      powerOn: true,
      userId: 7,
    }),
    {
      irwifiv2: 1,
      act: 0,
      brand: 121,
      fan: 1,
      mode: 2,
      power: 1,
      swingh: 6,
      swingv: -1,
      temp: 26,
      type: 1,
      u: 7,
    },
  );
});

test("returning from fan mode to auto keeps the air conditioner powered on", () => {
  const fanModeDevice = {
    ...device,
    value:
      '{"power":1,"mode":0,"temp":22,"fan":1,"swingv":-1,"swingh":6,"brand":121}',
  };
  const action = buildHunonicAcAction(fanModeDevice, {
    modeCode: 3,
    powerOn: true,
    userId: 7,
  });
  assert.equal(action.power, 1);
  assert.equal(action.mode, 3);
  assert.equal(action.temp, 22);
});

test("air-conditioner profile follows the remote-specific temperature and mode map", () => {
  assert.deepEqual(getHunonicAcControlProfile(device), {
    fans: [
      { code: 1, name: "low" },
      { code: 3, name: "medium" },
      { code: 5, name: "high" },
    ],
    modes: [
      { code: 3, name: "auto" },
      { code: 2, name: "cool" },
      { code: 7, name: "dry" },
      { code: 0, name: "fan" },
      { code: 1, name: "heat" },
    ],
    temperature: { max: 32, min: 16 },
  });
  assert.deepEqual(getHunonicAcState(device), {
    fanCode: 1,
    fanLevel: "low",
    modeCode: 3,
    modeName: "auto",
    powerOn: true,
    swingHorizontalCode: 6,
    swingVerticalCode: -1,
    temperature: 26,
  });
});

test("air-conditioner fan profile normalizes remote-specific min/max names", () => {
  const remoteSpecificDevice = {
    ...device,
    diagnostic: {
      ...device.diagnostic,
      remote: [
        ...(device.diagnostic.remote as Array<Record<string, unknown>>).filter(
          (entry) => entry.key_name !== "fan",
        ),
        {
          key_name: "fan",
          key_value:
            '[{"name":"min","code":4},{"name":"med","code":3},{"name":"high","code":2},{"name":"auto","code":1}]',
        },
      ],
    },
    value:
      '{"power":0,"mode":2,"temp":25,"fan":2,"swingv":-1,"swingh":5,"brand":121}',
  };
  assert.deepEqual(getHunonicAcControlProfile(remoteSpecificDevice).fans, [
    { code: 4, name: "low" },
    { code: 3, name: "medium" },
    { code: 2, name: "high" },
    { code: 1, name: "auto" },
  ]);
  assert.equal(getHunonicAcState(remoteSpecificDevice).fanLevel, "high");
});

test("multi-channel Hunonic light switch uses odd/even action codes", () => {
  const lightSwitch: HunonicDevice = {
    ...device,
    externalId: "light-channel-3",
    gatewayRootId: "",
    indexInRoot: 3,
    name: "Đèn phòng họp",
    rootId: "HUN-LIGHT-ROOT",
    rootType: "wsdatic3v",
    value: '{"turn":1}',
  };

  assert.deepEqual(
    buildHunonicSwitchAction(lightSwitch, { powerOn: true, userId: 9 }),
    { act_id: 0, action: 5, u: 9, wsdatic3v: 0 },
  );
  assert.deepEqual(
    buildHunonicSwitchAction(lightSwitch, { powerOn: false, userId: 9 }),
    { act_id: 0, action: 6, u: 9, wsdatic3v: 0 },
  );
});
