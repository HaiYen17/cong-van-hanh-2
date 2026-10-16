import "server-only";

import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import { getHunonicRuntimeSettings } from "./config";
import {
  getHunonicDevicePowerState,
  getHunonicElectricalDeviceKind,
  isHunonicAirConditioner,
  isHunonicLightSwitch,
} from "./hunonic-device-types";
import { syncHunonicElectricalDeviceRegistry } from "./hunonic-device-registry";
import { getHunonicDevicesMobile } from "./hunonic-mobile-client";
import type { HunonicDevice } from "./hunonic-mobile-client";
import {
  controlHunonicAc,
  controlHunonicSwitchPower,
  getHunonicAcControlProfile,
  getHunonicAcState,
} from "./hunonic-mqtt-client";
import type { HunonicAcFanLevel, HunonicAcMode } from "./hunonic-mqtt-client";

import { resolveAirControlRuntimeConfig, type AirControlMode } from "./policy";
import {
  electricalDeviceDisplayName,
  electricalLocationPath,
  type ElectricalLocationPath,
} from "./electrical-layout";

export type AirConditionerDeviceView = {
  availableFanLevels: AirConditionerFanLevel[];
  availableModes: AirConditionerClimateMode[];
  capabilities: {
    mode: boolean;
    power: boolean;
    temperature: boolean;
  };
  climateMode: AirConditionerClimateMode | "";
  fanLevel: AirConditionerFanLevel | "";
  id: string;
  kind: "air-conditioner";
  location: string;
  maxTemperature: number | null;
  minTemperature: number | null;
  name: string;
  online: boolean;
  placement: ElectricalLocationPath | null;
  powerOn: boolean;
  rootType: string;
  temperature: number | null;
  updatedAt: string;
};

export type LightSwitchDeviceView = {
  channel: number;
  id: string;
  kind: "light";
  location: string;
  name: string;
  online: boolean;
  placement: ElectricalLocationPath | null;
  powerOn: boolean;
  rootType: string;
  updatedAt: string;
};

export type ElectricalDeviceView =
  AirConditionerDeviceView | LightSwitchDeviceView;

export type AirControlSnapshot = {
  devices: AirConditionerDeviceView[];
  generatedAt: string;
  lights: LightSwitchDeviceView[];
  mode: AirControlMode;
  warning: string;
};

export type AirControlStateSnapshot = {
  climateMode: AirConditionerClimateMode | "";
  fanLevel: AirConditionerFanLevel | "";
  powerOn: boolean;
  temperature: number | null;
};

export type AirControlActivityView = {
  actionText: string;
  actorName: string;
  afterState: AirControlStateSnapshot | null;
  beforeState: AirControlStateSnapshot | null;
  command: CommandName;
  completedAt: string | null;
  createdAt: string;
  deviceId: string;
  deviceKind: "air-conditioner" | "light";
  deviceName: string;
  error: string;
  id: string;
  location: string;
  status: "COMPLETED" | "FAILED" | "PENDING";
};

export type AirControlActivityPage = {
  items: AirControlActivityView[];
  nextBefore: string;
  serverTime: string;
};

export type AirConditionerClimateMode = Extract<
  HunonicAcMode,
  "auto" | "cool" | "dry" | "fan"
>;

export type AirConditionerFanLevel = HunonicAcFanLevel;

export type CommandName =
  "power_off" | "power_on" | "set_fan" | "set_mode" | "set_temperature";

const SAFE_FAN_LEVELS = new Set<AirConditionerFanLevel>([
  "auto",
  "low",
  "medium",
  "high",
]);

const FAN_LEVEL_LABELS: Record<AirConditionerFanLevel, string> = {
  auto: "Tự động",
  low: "Thấp",
  medium: "Vừa",
  high: "Cao",
};

const SAFE_CLIMATE_MODES = new Set<AirConditionerClimateMode>([
  "auto",
  "cool",
  "dry",
  "fan",
]);

const CLIMATE_MODE_LABELS: Record<AirConditionerClimateMode, string> = {
  auto: "Tự động",
  cool: "Làm lạnh",
  dry: "Hút ẩm",
  fan: "Quạt",
};

const CLIMATE_MODE_ORDER: AirConditionerClimateMode[] = [
  "auto",
  "cool",
  "dry",
  "fan",
];

type ClimateView = Pick<
  AirConditionerDeviceView,
  | "availableFanLevels"
  | "availableModes"
  | "climateMode"
  | "fanLevel"
  | "maxTemperature"
  | "minTemperature"
  | "temperature"
>;

export class AirControlRuntimeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AirControlRuntimeError";
    this.status = status;
  }
}

export function canAccessAirControl(session: AppSession) {
  return (
    session.fullAccess ||
    session.moduleGroups.includes("tien-ich") ||
    session.modules.includes("air-conditioner-control")
  );
}

export function canViewAirControlHistory(session: AppSession) {
  return session.fullAccess && session.roles.includes("super-admin");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function stateSnapshot(
  powerOn: boolean,
  climate?: ClimateView,
): AirControlStateSnapshot {
  return {
    climateMode: climate?.climateMode ?? "",
    fanLevel: climate?.fanLevel ?? "",
    powerOn,
    temperature: climate?.temperature ?? null,
  };
}

function storedStateSnapshot(value: unknown): AirControlStateSnapshot | null {
  const record = asRecord(value);
  if (typeof record.powerOn !== "boolean") return null;
  const climateMode = text(record.climateMode) as AirConditionerClimateMode;
  const fanLevel = text(record.fanLevel) as AirConditionerFanLevel;
  const temperature = Number(record.temperature);
  return {
    climateMode: SAFE_CLIMATE_MODES.has(climateMode) ? climateMode : "",
    fanLevel: SAFE_FAN_LEVELS.has(fanLevel) ? fanLevel : "",
    powerOn: record.powerOn,
    temperature: Number.isFinite(temperature) ? temperature : null,
  };
}

function completedActionText(input: {
  afterState: AirControlStateSnapshot;
  beforeState: AirControlStateSnapshot;
  climateMode: AirConditionerClimateMode;
  command: CommandName;
  deviceName: string;
  fanLevel: AirConditionerFanLevel;
  temperature: number;
}) {
  if (input.command === "power_on") return `bật ${input.deviceName}`;
  if (input.command === "power_off") return `tắt ${input.deviceName}`;
  if (input.command === "set_temperature") {
    const before = input.beforeState.temperature;
    const after = input.afterState.temperature ?? input.temperature;
    if (before !== null && before !== after) {
      return `${after > before ? "tăng" : "giảm"} nhiệt độ ${input.deviceName} từ ${before}°C ${after > before ? "lên" : "xuống"} ${after}°C`;
    }
    return `đặt nhiệt độ ${input.deviceName} ở ${after}°C`;
  }
  if (input.command === "set_fan") {
    const before = input.beforeState.fanLevel;
    const after = input.afterState.fanLevel || input.fanLevel;
    return before && before !== after
      ? `chỉnh mức gió ${input.deviceName} từ ${FAN_LEVEL_LABELS[before]} sang ${FAN_LEVEL_LABELS[after]}`
      : `chỉnh mức gió ${input.deviceName} sang ${FAN_LEVEL_LABELS[after]}`;
  }
  const mode = input.afterState.climateMode || input.climateMode;
  return `chuyển ${input.deviceName} sang chế độ ${CLIMATE_MODE_LABELS[mode]}`;
}

function fallbackActionText(command: string, deviceName: string) {
  if (command === "power_on") return `bật ${deviceName}`;
  if (command === "power_off") return `tắt ${deviceName}`;
  if (command === "set_temperature") return `điều chỉnh nhiệt độ ${deviceName}`;
  if (command === "set_fan") return `điều chỉnh mức gió ${deviceName}`;
  if (command === "set_mode") return `điều chỉnh chế độ ${deviceName}`;
  return `điều khiển ${deviceName}`;
}

function activityLocation(device: {
  layoutLocation?: {
    area: string;
    building: string;
    floor: string;
    id: string;
    room: string;
  } | null;
  location: string | null;
}) {
  const placement = electricalLocationPath(device.layoutLocation);
  return placement
    ? [placement.building, placement.floor, placement.room, placement.area]
        .filter(Boolean)
        .join(" · ")
    : device.location || "Chưa phân khu";
}

function activityRecordView(record: {
  actorName: string | null;
  command: string;
  completedAt: Date | null;
  createdAt: Date;
  device: {
    customName: string | null;
    id: string;
    layoutLocation?: {
      area: string;
      building: string;
      floor: string;
      id: string;
      room: string;
    } | null;
    location: string | null;
    name: string;
    rootType: string | null;
    sourceName: string | null;
  };
  error: string | null;
  id: string;
  response: unknown;
  status: string;
}): AirControlActivityView {
  const response = asRecord(record.response);
  const activity = asRecord(response.activity);
  const currentDeviceName = electricalDeviceDisplayName(record.device);
  const deviceName = text(activity.deviceName) || currentDeviceName;
  const storedKind = text(activity.deviceKind);
  const deviceKind =
    storedKind === "light" || storedKind === "air-conditioner"
      ? storedKind
      : isHunonicLightSwitch(record.device.rootType || "")
        ? "light"
        : "air-conditioner";
  const status =
    record.status === "COMPLETED" || record.status === "FAILED"
      ? record.status
      : "PENDING";
  return {
    actionText:
      text(activity.actionText) || fallbackActionText(record.command, deviceName),
    actorName: record.actorName || "Người dùng Cổng",
    afterState: storedStateSnapshot(activity.afterState),
    beforeState: storedStateSnapshot(activity.beforeState),
    command: record.command as CommandName,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    deviceId: record.device.id,
    deviceKind,
    deviceName,
    error: record.error || "",
    id: record.id,
    location: text(activity.location) || activityLocation(record.device),
    status,
  };
}

function hunonicClimateView(device: HunonicDevice): ClimateView {
  const profile = getHunonicAcControlProfile(device);
  const state = getHunonicAcState(device);
  const availableModes = profile.modes
    .flatMap((mode) =>
      SAFE_CLIMATE_MODES.has(mode.name as AirConditionerClimateMode)
        ? [mode.name as AirConditionerClimateMode]
        : [],
    )
    .sort(
      (left, right) =>
        CLIMATE_MODE_ORDER.indexOf(left) - CLIMATE_MODE_ORDER.indexOf(right),
    );
  return {
    availableFanLevels: profile.fans.map((fan) => fan.name),
    availableModes,
    climateMode: SAFE_CLIMATE_MODES.has(
      state.modeName as AirConditionerClimateMode,
    )
      ? (state.modeName as AirConditionerClimateMode)
      : "",
    fanLevel: SAFE_FAN_LEVELS.has(state.fanLevel as AirConditionerFanLevel)
      ? (state.fanLevel as AirConditionerFanLevel)
      : "",
    maxTemperature: profile.temperature?.max ?? null,
    minTemperature: profile.temperature?.min ?? null,
    temperature: profile.temperature ? state.temperature : null,
  };
}

function capabilities(value: unknown) {
  const record = asRecord(value);
  return {
    mode: record.mode === true,
    power: record.power !== false,
    temperature: record.temperature === true,
  };
}

function deviceView(
  device: {
    capabilities: unknown;
    customName?: string | null;
    id: string;
    layoutLocation?: ElectricalLocationPath | null;
    location: string | null;
    name: string;
    online: boolean;
    powerOn: boolean;
    rootType: string | null;
    sourceName?: string | null;
    updatedAt: Date;
  },
  climate?: ClimateView,
): AirConditionerDeviceView {
  const storedCapabilities = capabilities(device.capabilities);
  return {
    availableFanLevels: climate?.availableFanLevels ?? [],
    availableModes: climate?.availableModes ?? [],
    capabilities: {
      mode: climate
        ? climate.availableModes.length > 0
        : storedCapabilities.mode,
      power: storedCapabilities.power,
      temperature: climate
        ? climate.temperature !== null
        : storedCapabilities.temperature,
    },
    climateMode: climate?.climateMode ?? "",
    fanLevel: climate?.fanLevel ?? "",
    id: device.id,
    kind: "air-conditioner",
    location: device.location || "",
    maxTemperature: climate?.maxTemperature ?? null,
    minTemperature: climate?.minTemperature ?? null,
    name: electricalDeviceDisplayName(device),
    online: device.online,
    placement: electricalLocationPath(device.layoutLocation),
    powerOn: device.powerOn,
    rootType: device.rootType || "",
    temperature: climate?.temperature ?? null,
    updatedAt: device.updatedAt.toISOString(),
  };
}

function lightSwitchView(
  device: {
    id: string;
    customName?: string | null;
    layoutLocation?: ElectricalLocationPath | null;
    location: string | null;
    name: string;
    online: boolean;
    powerOn: boolean;
    rootType: string | null;
    sourceName?: string | null;
    updatedAt: Date;
  },
  channel = 1,
): LightSwitchDeviceView {
  return {
    channel: Math.max(1, Math.trunc(channel || 1)),
    id: device.id,
    kind: "light",
    location: device.location || "",
    name: electricalDeviceDisplayName(device),
    online: device.online,
    placement: electricalLocationPath(device.layoutLocation),
    powerOn: device.powerOn,
    rootType: device.rootType || "",
    updatedAt: device.updatedAt.toISOString(),
  };
}

function storedElectricalDeviceView(device: Parameters<typeof deviceView>[0]) {
  return isHunonicLightSwitch(device.rootType || "")
    ? lightSwitchView(device)
    : deviceView(device);
}

function requireAccess(session: AppSession) {
  if (!canAccessAirControl(session)) {
    throw new AirControlRuntimeError(
      "Tài khoản hiện tại chưa được cấp quyền Quản lý hệ thống điện.",
      403,
    );
  }
}

async function runtimeConfig() {
  const stored = await getHunonicRuntimeSettings();
  return resolveAirControlRuntimeConfig({
    ...process.env,
    AIR_CONTROL_BRIDGE_SECRET:
      stored.bridgeSecret || process.env.AIR_CONTROL_BRIDGE_SECRET,
    AIR_CONTROL_BRIDGE_URL:
      stored.bridgeUrl || process.env.AIR_CONTROL_BRIDGE_URL,
    AIR_CONTROL_HUNONIC_PASSWORD:
      stored.password || process.env.AIR_CONTROL_HUNONIC_PASSWORD,
    AIR_CONTROL_HUNONIC_TOKEN:
      stored.apiToken || process.env.AIR_CONTROL_HUNONIC_TOKEN,
    AIR_CONTROL_HUNONIC_USERNAME:
      stored.username || process.env.AIR_CONTROL_HUNONIC_USERNAME,
    AIR_CONTROL_LIVE_AUTHORIZED: stored.liveAuthorizedConfigured
      ? String(stored.liveAuthorized)
      : process.env.AIR_CONTROL_LIVE_AUTHORIZED,
  });
}

export async function getAirControlSnapshot(
  session: AppSession,
): Promise<AirControlSnapshot> {
  requireAccess(session);
  const config = await runtimeConfig();
  const settings = await getHunonicRuntimeSettings();
  if (settings.apiToken) {
    try {
      const hunonicDevices = await getHunonicDevicesMobile(settings.apiToken);
      const airConditioners = hunonicDevices.filter((device) =>
        isHunonicAirConditioner(device.rootType),
      );
      const lightSwitches = hunonicDevices.filter((device) =>
        isHunonicLightSwitch(device.rootType),
      );
      const rows = await syncHunonicElectricalDeviceRegistry(hunonicDevices);
      const byExternalId = new Map(
        rows.map((device) => [device.externalId || "", device]),
      );
      const generatedAt = new Date();
      const devices = airConditioners.flatMap((hunonicDevice) => {
        const storedDevice = byExternalId.get(hunonicDevice.externalId);
        if (!storedDevice) return [];
        const state = getHunonicAcState(hunonicDevice);
        return [
          deviceView(
            {
              ...storedDevice,
              online: hunonicDevice.online,
              powerOn: state.powerOn,
              rootType: hunonicDevice.rootType,
              updatedAt: generatedAt,
            },
            hunonicClimateView(hunonicDevice),
          ),
        ];
      });
      const lights = lightSwitches.flatMap((hunonicDevice) => {
        const storedDevice = byExternalId.get(hunonicDevice.externalId);
        if (!storedDevice) return [];
        return [
          lightSwitchView(
            {
              ...storedDevice,
              online: hunonicDevice.online,
              powerOn: getHunonicDevicePowerState(hunonicDevice),
              rootType: hunonicDevice.rootType,
              updatedAt: generatedAt,
            },
            hunonicDevice.indexInRoot,
          ),
        ];
      });
      return {
        devices,
        generatedAt: generatedAt.toISOString(),
        lights,
        mode: "live",
        warning:
          devices.length || lights.length
            ? ""
            : "Hunonic đã kết nối nhưng chưa phát hiện máy lạnh hoặc công tắc đèn tương thích.",
      };
    } catch (error) {
      config.warning =
        error instanceof Error
          ? `Tạm thời chưa đọc được Hunonic: ${error.message}`
          : "Tạm thời chưa đọc được trạng thái Hunonic.";
    }
  }
  const devices = await getDb().airConditionerDevice.findMany({
    include: { layoutLocation: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    where: { archivedAt: null, status: "ACTIVE" },
  });
  const airConditioners = devices.filter((device) =>
    isHunonicAirConditioner(device.rootType || ""),
  );
  const lights = devices.filter((device) =>
    isHunonicLightSwitch(device.rootType || ""),
  );

  return {
    devices: airConditioners.map((device) => deviceView(device)),
    generatedAt: new Date().toISOString(),
    lights: lights.map((device) => lightSwitchView(device)),
    mode: config.mode,
    warning: config.warning,
  };
}

async function sendHunonicCommand(input: {
  climateMode?: AirConditionerClimateMode;
  command: CommandName;
  externalDeviceId: string;
  fanLevel?: AirConditionerFanLevel;
  temperature?: number;
}) {
  const settings = await getHunonicRuntimeSettings();
  if (!settings.apiToken) {
    throw new AirControlRuntimeError("Phiên Hunonic chưa sẵn sàng.", 503);
  }
  const device = (await getHunonicDevicesMobile(settings.apiToken)).find(
    (item) => item.externalId === input.externalDeviceId,
  );
  if (!device || !isHunonicAirConditioner(device.rootType)) {
    throw new AirControlRuntimeError(
      "Không tìm thấy máy lạnh này trên Hunonic.",
      404,
    );
  }
  if (!device.online) {
    throw new AirControlRuntimeError("Máy lạnh đang ngoại tuyến.", 409);
  }

  const state = getHunonicAcState(device);
  const profile = getHunonicAcControlProfile(device);
  const climate = hunonicClimateView(device);
  const beforeState = stateSnapshot(state.powerOn, { ...climate });
  const control: {
    fanCode?: number;
    modeCode?: number;
    powerOn?: boolean;
    temperature?: number;
  } = {};
  let powerOn = state.powerOn;

  if (input.command === "power_on" || input.command === "power_off") {
    powerOn = input.command === "power_on";
    control.powerOn = powerOn;
  } else if (input.command === "set_temperature") {
    if (!profile.temperature || input.temperature === undefined) {
      throw new AirControlRuntimeError(
        "Remote của máy lạnh này chưa khai báo khoảng nhiệt độ.",
        409,
      );
    }
    if (
      input.temperature < profile.temperature.min ||
      input.temperature > profile.temperature.max
    ) {
      throw new AirControlRuntimeError(
        `Máy lạnh này chỉ nhận nhiệt độ từ ${profile.temperature.min}–${profile.temperature.max}°C.`,
      );
    }
    control.temperature = input.temperature;
    climate.temperature = input.temperature;
  } else if (input.command === "set_fan") {
    const option = profile.fans.find((fan) => fan.name === input.fanLevel);
    if (!option || !input.fanLevel) {
      throw new AirControlRuntimeError(
        "Remote của máy lạnh này không hỗ trợ mức gió đã chọn.",
        409,
      );
    }
    if (!state.powerOn) {
      throw new AirControlRuntimeError(
        "Hãy bật máy trước khi đổi mức gió.",
        409,
      );
    }
    control.fanCode = option.code;
    climate.fanLevel = input.fanLevel;
  } else if (input.command === "set_mode") {
    const option = profile.modes.find(
      (mode) =>
        mode.name === input.climateMode &&
        SAFE_CLIMATE_MODES.has(mode.name as AirConditionerClimateMode),
    );
    if (!option || !input.climateMode) {
      throw new AirControlRuntimeError(
        "Remote của máy lạnh này không hỗ trợ chế độ đã chọn.",
        409,
      );
    }
    control.modeCode = option.code;
    control.powerOn = true;
    climate.climateMode = input.climateMode;
    powerOn = true;
  }

  const raw = await controlHunonicAc(device, control);
  return {
    afterState: stateSnapshot(powerOn, climate),
    beforeState,
    climate,
    online: true,
    powerOn,
    raw,
  };
}

async function sendHunonicLightCommand(input: {
  command: Extract<CommandName, "power_off" | "power_on">;
  externalDeviceId: string;
}) {
  const settings = await getHunonicRuntimeSettings();
  if (!settings.apiToken) {
    throw new AirControlRuntimeError("Phiên Hunonic chưa sẵn sàng.", 503);
  }
  const device = (await getHunonicDevicesMobile(settings.apiToken)).find(
    (item) => item.externalId === input.externalDeviceId,
  );
  if (!device || !isHunonicLightSwitch(device.rootType)) {
    throw new AirControlRuntimeError(
      "Không tìm thấy công tắc đèn này trên Hunonic.",
      404,
    );
  }
  if (!device.online) {
    throw new AirControlRuntimeError("Công tắc đèn đang ngoại tuyến.", 409);
  }

  const beforePowerOn = getHunonicDevicePowerState(device);
  const powerOn = input.command === "power_on";
  const raw = await controlHunonicSwitchPower(device, powerOn);
  return {
    afterState: stateSnapshot(powerOn),
    beforeState: stateSnapshot(beforePowerOn),
    climate: undefined,
    online: true,
    powerOn,
    raw,
  };
}

async function sendBridgeCommand(input: {
  climateMode?: AirConditionerClimateMode;
  command: CommandName;
  externalDeviceId: string;
  fanLevel?: AirConditionerFanLevel;
  currentPowerOn: boolean;
  requestId: string;
  temperature?: number;
}) {
  const config = await runtimeConfig();
  if (config.mode !== "live") {
    throw new AirControlRuntimeError(
      "Bridge điều khiển thật chưa sẵn sàng.",
      503,
    );
  }
  if (
    input.command === "set_fan" ||
    input.command === "set_mode" ||
    input.command === "set_temperature"
  ) {
    throw new AirControlRuntimeError(
      "Bridge dự phòng chưa hỗ trợ nhiệt độ và chế độ.",
      501,
    );
  }

  const response = await fetch(`${config.bridgeUrl}/v1/commands`, {
    body: JSON.stringify(input),
    headers: {
      Authorization: `Bearer ${config.bridgeSecret}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = asRecord(await response.json().catch(() => ({})));

  if (!response.ok || payload.ok === false) {
    throw new AirControlRuntimeError(
      text(payload.message) || "Bridge không chấp nhận lệnh điều khiển.",
      502,
    );
  }

  const bridgeDevice = asRecord(payload.device);
  return {
    afterState: stateSnapshot(
      typeof bridgeDevice.powerOn === "boolean"
        ? bridgeDevice.powerOn
        : input.command === "power_on",
    ),
    beforeState: stateSnapshot(input.currentPowerOn),
    climate: undefined,
    online: bridgeDevice.online !== false,
    powerOn:
      typeof bridgeDevice.powerOn === "boolean"
        ? bridgeDevice.powerOn
        : input.command === "power_on",
    raw: payload,
  };
}

export async function executeAirControlCommand(
  session: AppSession,
  input: unknown,
) {
  requireAccess(session);
  const payload = asRecord(input);
  const deviceId = text(payload.deviceId);
  const requestId = text(payload.requestId);
  const command = text(payload.command) as CommandName;
  const climateMode = text(payload.climateMode) as AirConditionerClimateMode;
  const fanLevel = text(payload.fanLevel) as AirConditionerFanLevel;
  const temperature = Number(payload.temperature);

  if (!deviceId || !requestId) {
    throw new AirControlRuntimeError("Thiếu thiết bị hoặc mã yêu cầu.");
  }
  if (!/^(?:air|electric)-[a-zA-Z0-9_-]{8,100}$/.test(requestId)) {
    throw new AirControlRuntimeError("Mã yêu cầu điều khiển không hợp lệ.");
  }
  if (
    command !== "power_on" &&
    command !== "power_off" &&
    command !== "set_fan" &&
    command !== "set_mode" &&
    command !== "set_temperature"
  ) {
    throw new AirControlRuntimeError("Lệnh điều khiển không được hỗ trợ.");
  }
  if (
    command === "set_temperature" &&
    (!Number.isInteger(temperature) || temperature < 10 || temperature > 40)
  ) {
    throw new AirControlRuntimeError("Nhiệt độ yêu cầu không hợp lệ.");
  }
  if (command === "set_fan" && !SAFE_FAN_LEVELS.has(fanLevel)) {
    throw new AirControlRuntimeError("Mức gió yêu cầu không hợp lệ.");
  }
  if (command === "set_mode" && !SAFE_CLIMATE_MODES.has(climateMode)) {
    throw new AirControlRuntimeError("Chế độ yêu cầu không hợp lệ.");
  }

  const db = getDb();
  const config = await runtimeConfig();
  const settings = await getHunonicRuntimeSettings();
  const existing = await db.airConditionerCommand.findUnique({
    include: { device: { include: { layoutLocation: true } } },
    where: { requestId },
  });
  if (existing) {
    return {
      device: storedElectricalDeviceView(existing.device),
      message: "Yêu cầu này đã được tiếp nhận trước đó.",
      mode: config.mode,
    };
  }

  const device = await db.airConditionerDevice.findFirst({
    include: { layoutLocation: true },
    where: { archivedAt: null, id: deviceId, status: "ACTIVE" },
  });
  if (!device) {
    throw new AirControlRuntimeError("Không tìm thấy thiết bị điện này.", 404);
  }
  const deviceKind = getHunonicElectricalDeviceKind(device.rootType || "");
  if (!deviceKind) {
    throw new AirControlRuntimeError(
      "Thiết bị Hunonic này chưa được hỗ trợ trong module.",
      409,
    );
  }
  if (!device.online) {
    throw new AirControlRuntimeError("Thiết bị đang ngoại tuyến.", 409);
  }
  if (
    deviceKind === "light" &&
    command !== "power_on" &&
    command !== "power_off"
  ) {
    throw new AirControlRuntimeError(
      "Công tắc đèn chỉ hỗ trợ lệnh bật hoặc tắt.",
      409,
    );
  }
  const directHunonic = Boolean(
    settings.apiToken &&
    device.externalId &&
    getHunonicElectricalDeviceKind(device.rootType || ""),
  );
  if (deviceKind === "light" && !directHunonic) {
    throw new AirControlRuntimeError(
      "Phiên Hunonic chưa sẵn sàng để điều khiển công tắc đèn.",
      503,
    );
  }
  const effectiveMode: AirControlMode = directHunonic ? "live" : config.mode;
  if (effectiveMode === "live" && !device.externalId) {
    throw new AirControlRuntimeError(
      "Thiết bị chưa được ánh xạ với mã trên bridge.",
      409,
    );
  }

  const now = new Date();
  const rateLimitBefore = new Date(now.getTime() - 1_000);
  const commandRecord = await db.$transaction(async (tx) => {
    const reserved = await tx.airConditionerDevice.updateMany({
      data: { lastCommandAt: now },
      where: {
        archivedAt: null,
        id: device.id,
        lastCommandAt: { lt: rateLimitBefore },
        online: true,
        status: "ACTIVE",
      },
    });
    if (!reserved.count) {
      const reservedNull = await tx.airConditionerDevice.updateMany({
        data: { lastCommandAt: now },
        where: {
          archivedAt: null,
          id: device.id,
          lastCommandAt: null,
          online: true,
          status: "ACTIVE",
        },
      });
      if (!reservedNull.count) {
        throw new AirControlRuntimeError(
          "Vui lòng chờ 1 giây trước khi gửi lệnh tiếp theo.",
          429,
        );
      }
    }

    return tx.airConditionerCommand.create({
      data: {
        actorId: session.userId,
        actorName: session.displayName,
        command,
        deviceId: device.id,
        mode: effectiveMode.toUpperCase(),
        requestId,
      },
    });
  });

  try {
    const result =
      directHunonic && deviceKind === "light"
        ? await sendHunonicLightCommand({
            command: command as Extract<CommandName, "power_off" | "power_on">,
            externalDeviceId: device.externalId!,
          })
        : directHunonic
          ? await sendHunonicCommand({
              climateMode: command === "set_mode" ? climateMode : undefined,
              command,
              externalDeviceId: device.externalId!,
              fanLevel: command === "set_fan" ? fanLevel : undefined,
              temperature:
                command === "set_temperature" ? temperature : undefined,
            })
          : config.mode === "live"
             ? await sendBridgeCommand({
                 climateMode: command === "set_mode" ? climateMode : undefined,
                 command,
                 currentPowerOn: device.powerOn,
                 externalDeviceId: device.externalId!,
                fanLevel: command === "set_fan" ? fanLevel : undefined,
                requestId,
                temperature:
                  command === "set_temperature" ? temperature : undefined,
              })
             : {
                 afterState: stateSnapshot(
                   command === "power_on"
                     ? true
                     : command === "power_off"
                       ? false
                       : device.powerOn,
                 ),
                 beforeState: stateSnapshot(device.powerOn),
                 climate: undefined,
                online: true,
                powerOn:
                  command === "power_on"
                    ? true
                    : command === "power_off"
                      ? false
                      : device.powerOn,
                raw: { simulated: true },
               };

    const actionText = completedActionText({
      afterState: result.afterState,
      beforeState: result.beforeState,
      climateMode,
      command,
      deviceName: electricalDeviceDisplayName(device),
      fanLevel,
      temperature,
    });
    const completedAt = new Date();
    const { completedCommand, updatedDevice } = await db.$transaction(async (tx) => {
      const updated = await tx.airConditionerDevice.update({
        data: {
          lastSeenAt: completedAt,
          online: result.online,
          powerOn: result.powerOn,
        },
        include: { layoutLocation: true },
        where: { id: device.id },
      });
      const completed = await tx.airConditionerCommand.update({
        data: {
          completedAt,
          response: JSON.parse(
            JSON.stringify({
              activity: {
                actionText,
                afterState: result.afterState,
                beforeState: result.beforeState,
                deviceKind,
                deviceName: electricalDeviceDisplayName(device),
                location: activityLocation(device),
              },
              provider: result.raw,
            }),
          ),
          status: "COMPLETED",
        },
        include: { device: { include: { layoutLocation: true } } },
        where: { id: commandRecord.id },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: {
            climateMode: command === "set_mode" ? climateMode : undefined,
            command,
            fanLevel: command === "set_fan" ? fanLevel : undefined,
            mode: effectiveMode,
            requestId,
            temperature:
              command === "set_temperature" ? temperature : undefined,
          },
          summary: `${session.displayName} đã ${actionText}.`,
          targetId: device.id,
          targetType:
            deviceKind === "light"
              ? "HunonicLightSwitch"
              : "AirConditionerDevice",
        },
      });
      return { completedCommand: completed, updatedDevice: updated };
    });

    return {
      activity: activityRecordView(completedCommand),
      device:
        deviceKind === "light"
          ? lightSwitchView(updatedDevice)
          : deviceView(updatedDevice, result.climate),
      message: `${
        effectiveMode === "demo" ? "Đã mô phỏng" : "Đã gửi lệnh"
      } ${actionText}.`,
      mode: effectiveMode,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không gửi được lệnh điều khiển.";
    await db.airConditionerCommand.update({
      data: { completedAt: new Date(), error: message, status: "FAILED" },
      where: { id: commandRecord.id },
    });
    if (error instanceof AirControlRuntimeError) throw error;
    throw new AirControlRuntimeError(message, 502);
  }
}

function validDate(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function getRecentAirControlActivities(
  session: AppSession,
  after = "",
): Promise<AirControlActivityPage> {
  requireAccess(session);
  const now = new Date();
  const recentFloor = new Date(now.getTime() - 120_000);
  const requestedAfter = validDate(after);
  const effectiveAfter =
    requestedAfter && requestedAfter > recentFloor && requestedAfter <= now
      ? requestedAfter
      : recentFloor;
  const records = await getDb().airConditionerCommand.findMany({
    include: { device: { include: { layoutLocation: true } } },
    orderBy: { completedAt: "asc" },
    take: 12,
    where: {
      completedAt: { gt: effectiveAfter, lte: now },
      status: "COMPLETED",
    },
  });
  return {
    items: records.map(activityRecordView),
    nextBefore: "",
    serverTime: now.toISOString(),
  };
}

export async function getAirControlHistory(
  session: AppSession,
  input: { before?: string; limit?: number; status?: string } = {},
): Promise<AirControlActivityPage> {
  requireAccess(session);
  if (!canViewAirControlHistory(session)) {
    throw new AirControlRuntimeError(
      "Chỉ Super Admin được xem lịch sử điều khiển hệ thống điện.",
      403,
    );
  }
  const limit = Math.min(100, Math.max(10, Math.trunc(input.limit || 50)));
  const before = validDate(input.before || "");
  const status = ["COMPLETED", "FAILED", "PENDING"].includes(
    input.status || "",
  )
    ? input.status
    : undefined;
  const records = await getDb().airConditionerCommand.findMany({
    include: { device: { include: { layoutLocation: true } } },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    where: {
      ...(before ? { createdAt: { lt: before } } : {}),
      ...(status ? { status } : {}),
    },
  });
  const hasMore = records.length > limit;
  const visible = records.slice(0, limit);
  return {
    items: visible.map(activityRecordView),
    nextBefore:
      hasMore && visible.length
        ? visible[visible.length - 1].createdAt.toISOString()
        : "",
    serverTime: new Date().toISOString(),
  };
}
