import "server-only";

import { createCipheriv, createDecipheriv } from "node:crypto";
import { connect } from "mqtt";

import { isHunonicLightSwitch } from "./hunonic-device-types";
import type { HunonicDevice } from "./hunonic-mobile-client";

const MQTT_URL = "ws://103.109.43.24:8080/ws";
const MQTT_USERNAME = "bestbug";
const MQTT_PASSWORD = "bigbugdmm";

type JsonRecord = Record<string, unknown>;

export type HunonicAcMode = "auto" | "cool" | "dry" | "fan" | "heat";

export type HunonicAcFanLevel = "auto" | "low" | "medium" | "high";

export type HunonicAcControlProfile = {
  fans: Array<{
    code: number;
    name: HunonicAcFanLevel;
  }>;
  modes: Array<{
    code: number;
    name: HunonicAcMode;
  }>;
  temperature: {
    max: number;
    min: number;
  } | null;
};

export type HunonicAcState = {
  fanCode: number;
  fanLevel: HunonicAcFanLevel | "";
  modeCode: number;
  modeName: HunonicAcMode | "";
  powerOn: boolean;
  swingHorizontalCode: number;
  swingVerticalCode: number;
  temperature: number;
};

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseState(value: unknown) {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return record(value);
}

function remoteEntries(device: HunonicDevice) {
  return Array.isArray(device.diagnostic.remote)
    ? device.diagnostic.remote.map(record)
    : [];
}

function remoteValue(device: HunonicDevice, key: string) {
  const entry = remoteEntries(device).find(
    (item) => String(item.key_name || "").trim() === key,
  );
  return String(entry?.key_value ?? "").trim();
}

function remoteNumber(device: HunonicDevice, key: string) {
  const parsed = Number(remoteValue(device, key));
  return Number.isFinite(parsed) ? parsed : null;
}

function modeOptions(device: HunonicDevice) {
  const raw = remoteValue(device, "mode");
  if (!raw) return [];
  try {
    const modes = JSON.parse(raw);
    if (!Array.isArray(modes)) return [];
    const allowed = new Set<HunonicAcMode>([
      "auto",
      "cool",
      "dry",
      "fan",
      "heat",
    ]);
    return modes.flatMap((item) => {
      const option = record(item);
      const name = String(option.name || "").trim() as HunonicAcMode;
      const code = Number(option.code);
      if (!allowed.has(name) || !Number.isFinite(code)) return [];
      return [{ code, name }];
    });
  } catch {
    return [];
  }
}

function normalizedFanLevel(value: unknown): HunonicAcFanLevel | "" {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  if (name === "auto") return "auto";
  if (name === "min" || name === "low") return "low";
  if (name === "med" || name === "medium" || name === "mid") return "medium";
  if (name === "high" || name === "max") return "high";
  return "";
}

function fanOptions(device: HunonicDevice) {
  const raw = remoteValue(device, "fan");
  if (!raw) return [];
  try {
    const fans = JSON.parse(raw);
    if (!Array.isArray(fans)) return [];
    const order: HunonicAcFanLevel[] = ["low", "medium", "high", "auto"];
    return fans
      .flatMap((item) => {
        const option = record(item);
        const name = normalizedFanLevel(option.name);
        const code = Number(option.code);
        if (!name || !Number.isFinite(code)) return [];
        return [{ code, name }];
      })
      .sort(
        (left, right) => order.indexOf(left.name) - order.indexOf(right.name),
      );
  } catch {
    return [];
  }
}

export function getHunonicAcControlProfile(
  device: HunonicDevice,
): HunonicAcControlProfile {
  const min = remoteNumber(device, "temp_min");
  const max = remoteNumber(device, "temp_max");
  return {
    fans: fanOptions(device),
    modes: modeOptions(device),
    temperature:
      min !== null &&
      max !== null &&
      Number.isInteger(min) &&
      Number.isInteger(max) &&
      min >= 10 &&
      max <= 40 &&
      min <= max
        ? { max, min }
        : null,
  };
}

export function getHunonicAcState(device: HunonicDevice): HunonicAcState {
  const state = parseState(device.value);
  const fanCode = number(state.fan, 0);
  const modeCode = number(state.mode, 0);
  const profile = getHunonicAcControlProfile(device);
  const modeName =
    profile.modes.find((option) => option.code === modeCode)?.name || "";
  return {
    fanCode,
    fanLevel:
      profile.fans.find((option) => option.code === fanCode)?.name || "",
    modeCode,
    modeName,
    powerOn: number(state.power, 0) === 1,
    swingHorizontalCode: number(state.swingh, 0),
    swingVerticalCode: number(state.swingv, 0),
    temperature: number(state.temp, 26),
  };
}

function cipherMaterial(device: HunonicDevice) {
  const key = Buffer.from(device.key, "base64");
  const iv = Buffer.from(device.iv, "base64");
  if (key.length !== 16 || iv.length !== 16) {
    throw new Error("Thiết bị Hunonic không trả key/iv AES-128 hợp lệ.");
  }
  return { iv, key };
}

export function encryptHunonicPayload(
  device: HunonicDevice,
  payload: JsonRecord,
) {
  const { iv, key } = cipherMaterial(device);
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
}

export function decryptHunonicPayload(device: HunonicDevice, payload: Buffer) {
  const { iv, key } = cipherMaterial(device);
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  const plainText = Buffer.concat([
    decipher.update(payload),
    decipher.final(),
  ]).toString("utf8");
  return record(JSON.parse(plainText));
}

export function buildHunonicAcAction(
  device: HunonicDevice,
  input: {
    fanCode?: number;
    modeCode?: number;
    powerOn?: boolean;
    temperature?: number;
    userId?: number;
  },
) {
  const state = parseState(device.value);
  const brandRecord = record(device.diagnostic.brand);
  const brand = number(state.brand ?? brandRecord.id, 0);
  const rootKey = device.gatewayRootId ? "irwifiv2" : device.rootType;
  if (!rootKey || !brand) {
    throw new Error("Máy lạnh Hunonic chưa có đủ loại hub hoặc mã hãng IR.");
  }
  return {
    [rootKey]: 1,
    act: 0,
    brand,
    fan: number(input.fanCode, number(state.fan, 0)),
    mode: number(input.modeCode, number(state.mode, 0)),
    power:
      typeof input.powerOn === "boolean"
        ? input.powerOn
          ? 1
          : 0
        : number(state.power, 0),
    swingh: number(state.swingh, 0),
    swingv: number(state.swingv, 0),
    temp: number(input.temperature, number(state.temp, 26)),
    type: 1,
    u: number(input.userId, 0),
  };
}

export function buildHunonicSwitchAction(
  device: HunonicDevice,
  input: { powerOn: boolean; userId?: number },
) {
  if (!isHunonicLightSwitch(device.rootType)) {
    throw new Error(
      "Thiết bị Hunonic này không phải công tắc đèn được hỗ trợ.",
    );
  }
  const channel = Math.max(1, Math.trunc(number(device.indexInRoot, 1)));
  return {
    [device.rootType]: 0,
    act_id: 0,
    action: input.powerOn ? 2 * channel - 1 : 2 * channel,
    u: number(input.userId, 0),
  };
}

async function publishHunonicAndWait(
  device: HunonicDevice,
  command: JsonRecord,
  matchesResponse: (payload: JsonRecord) => boolean = () => true,
) {
  if (!device.topicSubscribe || !device.topicPublish) {
    throw new Error("Thiết bị Hunonic không trả đủ topic MQTT.");
  }

  return new Promise<JsonRecord>((resolve, reject) => {
    const client = connect(MQTT_URL, {
      clean: true,
      clientId: `cong-van-hanh-probe-${crypto.randomUUID()}`,
      connectTimeout: 10_000,
      password: MQTT_PASSWORD,
      protocolVersion: 4,
      reconnectPeriod: 0,
      username: MQTT_USERNAME,
    });
    let settled = false;
    const finish = (error?: Error, payload?: JsonRecord) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      if (error) reject(error);
      else resolve(payload || {});
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `${device.name} không phản hồi lệnh Hunonic trong 12 giây.`,
          ),
        ),
      12_000,
    );

    client.on("error", (error) => finish(error));
    client.on("message", (topic, payload) => {
      if (topic !== device.topicPublish) return;
      try {
        const decrypted = decryptHunonicPayload(device, payload);
        if (matchesResponse(decrypted)) finish(undefined, decrypted);
      } catch {
        // Bỏ qua gói không thuộc đúng key/iv và tiếp tục chờ phản hồi phù hợp.
      }
    });
    client.on("connect", () => {
      client.subscribe(device.topicPublish, { qos: 1 }, (subscribeError) => {
        if (subscribeError) return finish(subscribeError);
        const payload = encryptHunonicPayload(device, command);
        client.publish(
          device.topicSubscribe,
          payload,
          { qos: 1 },
          (publishError) => publishError && finish(publishError),
        );
      });
    });
  });
}

export async function probeHunonicIrGateway(device: HunonicDevice) {
  return publishHunonicAndWait(device, { irwifiv2: 105 });
}

export async function controlHunonicAcPower(
  device: HunonicDevice,
  powerOn: boolean,
) {
  return controlHunonicAc(device, { powerOn });
}

export async function controlHunonicAc(
  device: HunonicDevice,
  input: {
    fanCode?: number;
    modeCode?: number;
    powerOn?: boolean;
    temperature?: number;
  },
) {
  const topicOwner = /^u\/([^/]+)\//.exec(device.topicSubscribe)?.[1];
  const action = buildHunonicAcAction(device, {
    ...input,
    userId: number(topicOwner, 0),
  });
  return publishHunonicAndWait(device, action);
}

export async function controlHunonicSwitchPower(
  device: HunonicDevice,
  powerOn: boolean,
) {
  const topicOwner = /^u\/([^/]+)\//.exec(device.topicSubscribe)?.[1];
  const action = buildHunonicSwitchAction(device, {
    powerOn,
    userId: number(topicOwner, 0),
  });
  return publishHunonicAndWait(
    device,
    action,
    (payload) =>
      Number(payload.action) === action.action &&
      Number(payload.result ?? 1) === 1,
  );
}
