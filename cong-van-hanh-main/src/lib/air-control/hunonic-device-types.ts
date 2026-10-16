import type { HunonicDevice } from "./hunonic-mobile-client";

export type HunonicElectricalDeviceKind = "air-conditioner" | "light";

const AIR_CONDITIONER_TYPES = new Set(["irchild", "irchildv2"]);

// Danh sách công tắc đã được integration Hunonic kiểm chứng. Cố ý không đưa
// elmeter/atmwifi vào đây vì đó có thể là aptomat hoặc công tơ tổng của cả nhà.
const LIGHT_SWITCH_TYPES = new Set([
  "daticbs",
  "daticbsv2",
  "dimmer",
  "lhswitch",
  "lhswitch2v",
  "lhswitch3v",
  "lhrtcsw",
  "nswitch",
  "relay",
  "sswitch",
  "sswitch2v",
  "switch",
  "swsim",
  "swsimv2",
  "swsimv3",
  "swinput",
  "swinputv2",
  "swmini",
  "swminiv2",
  "swshock",
  "swshock_hun",
  "swshockv2",
  "swshohuv2",
  "swstair",
  "wsm",
  "wsdatic",
  "wsdatic3v",
  "wsdatic3vn3",
  "wswc",
  "wswitch",
  "wswitch2v",
  "wswitch3v",
]);

function normalizedRootType(rootType: string) {
  return String(rootType || "")
    .trim()
    .toLowerCase();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function parseHunonicDeviceValue(value: unknown) {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

export function isHunonicAirConditioner(rootType: string) {
  return AIR_CONDITIONER_TYPES.has(normalizedRootType(rootType));
}

export function isHunonicLightSwitch(rootType: string) {
  const normalized = normalizedRootType(rootType);
  return (
    LIGHT_SWITCH_TYPES.has(normalized) || normalized.startsWith("wsdatic3v")
  );
}

export function getHunonicElectricalDeviceKind(
  rootType: string,
): HunonicElectricalDeviceKind | null {
  if (isHunonicAirConditioner(rootType)) return "air-conditioner";
  if (isHunonicLightSwitch(rootType)) return "light";
  return null;
}

export function getHunonicDevicePowerState(
  device: Pick<HunonicDevice, "rootType" | "value">,
) {
  const value = parseHunonicDeviceValue(device.value);
  if (isHunonicAirConditioner(device.rootType)) {
    return Number(value.power) === 1;
  }
  if (isHunonicLightSwitch(device.rootType)) {
    return Number(value.turn) === 1;
  }
  return false;
}

export function hunonicDeviceCapabilities(rootType: string) {
  const kind = getHunonicElectricalDeviceKind(rootType);
  return {
    mode: kind === "air-conditioner",
    power: kind !== null,
    temperature: kind === "air-conditioner",
  };
}
