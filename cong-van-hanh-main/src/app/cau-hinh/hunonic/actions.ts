"use server";

import { revalidatePath } from "next/cache";

import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  getHunonicConfigSnapshot,
  getHunonicRuntimeSettings,
  HUNONIC_SETTING_KEYS,
  type HunonicConfigSnapshot,
} from "@/lib/air-control/config";
import { sealConfigSecret } from "@/lib/config/secret-vault";
import { getDb } from "@/lib/db";
import {
  bootstrapHunonicMobile,
  getHunonicDevicesMobile,
} from "@/lib/air-control/hunonic-mobile-client";
import {
  isHunonicAirConditioner,
  isHunonicLightSwitch,
} from "@/lib/air-control/hunonic-device-types";
import { syncHunonicElectricalDeviceRegistry } from "@/lib/air-control/hunonic-device-registry";
import { probeHunonicIrGateway } from "@/lib/air-control/hunonic-mqtt-client";
import {
  createElectricalLocation,
  deleteElectricalLocation,
  getElectricalLayoutConfig,
  saveElectricalDevicePlacement,
  updateElectricalLocation,
  type ElectricalLayoutConfigSnapshot,
} from "@/lib/air-control/electrical-layout";

const PATH = "/cau-hinh/hunonic";

export type HunonicConfigInput = {
  apiToken?: string;
  bridgeSecret?: string;
  bridgeUrl?: string;
  clearApiToken?: boolean;
  clearBridgeSecret?: boolean;
  clearPassword?: boolean;
  clearUsername?: boolean;
  liveAuthorized?: boolean;
  password?: string;
  username?: string;
};

export type HunonicDiscoveredDevice = {
  diagnostic: Record<string, unknown>;
  externalId: string;
  homeName: string;
  name: string;
  online: boolean;
  roomName: string;
  rootType: string;
};

export type HunonicActionResult =
  | {
      data: {
        devices?: HunonicDiscoveredDevice[];
        gatewayProbe?: {
          deviceName: string;
          message: string;
          ok: boolean;
        };
        snapshot: HunonicConfigSnapshot;
      };
      message: string;
      ok: true;
    }
  | { message: string; ok: false };

export type ElectricalLayoutActionResult =
  | {
      data: ElectricalLayoutConfigSnapshot;
      message: string;
      ok: true;
    }
  | { message: string; ok: false };

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function requireHunonicAdmin() {
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) {
    throw new Error(
      "Tài khoản hiện tại chưa có quyền quản lý cấu hình Hunonic.",
    );
  }
  return session;
}

function validateBridgeUrl(value: string) {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL bridge Hunonic không hợp lệ.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Bridge Hunonic phải dùng HTTPS trên production.");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("URL bridge Hunonic phải dùng HTTP hoặc HTTPS.");
  }
  return url.toString().replace(/\/+$/, "");
}

function nextSecret(
  current: string | null | undefined,
  next: unknown,
  clear: boolean | undefined,
) {
  const value = text(next);
  if (value) return sealConfigSecret(value);
  if (clear) return null;
  return current ?? null;
}

export async function saveHunonicConfigAction(
  input: HunonicConfigInput,
): Promise<HunonicActionResult> {
  try {
    const session = await requireHunonicAdmin();
    const db = getDb();
    const keys = Object.values(HUNONIC_SETTING_KEYS);
    const rows = await db.systemSetting.findMany({
      select: { key: true, value: true },
      where: { key: { in: keys } },
    });
    const current = new Map(rows.map((row) => [row.key, row.value]));
    const values = new Map<string, string | null>([
      [
        HUNONIC_SETTING_KEYS.username,
        nextSecret(
          current.get(HUNONIC_SETTING_KEYS.username),
          input.username,
          input.clearUsername,
        ),
      ],
      [
        HUNONIC_SETTING_KEYS.password,
        nextSecret(
          current.get(HUNONIC_SETTING_KEYS.password),
          input.password,
          input.clearPassword,
        ),
      ],
      [
        HUNONIC_SETTING_KEYS.apiToken,
        nextSecret(
          current.get(HUNONIC_SETTING_KEYS.apiToken),
          input.apiToken,
          input.clearApiToken,
        ),
      ],
      [
        HUNONIC_SETTING_KEYS.bridgeSecret,
        nextSecret(
          current.get(HUNONIC_SETTING_KEYS.bridgeSecret),
          input.bridgeSecret,
          input.clearBridgeSecret,
        ),
      ],
      [
        HUNONIC_SETTING_KEYS.bridgeUrl,
        validateBridgeUrl(text(input.bridgeUrl)),
      ],
      [
        HUNONIC_SETTING_KEYS.liveAuthorized,
        input.liveAuthorized ? "true" : "false",
      ],
    ]);

    if (input.liveAuthorized) {
      const username = values.get(HUNONIC_SETTING_KEYS.username);
      const password = values.get(HUNONIC_SETTING_KEYS.password);
      const token = values.get(HUNONIC_SETTING_KEYS.apiToken);
      const bridgeUrl = values.get(HUNONIC_SETTING_KEYS.bridgeUrl);
      const bridgeSecret = values.get(HUNONIC_SETTING_KEYS.bridgeSecret);
      if (!username || (!password && !token)) {
        throw new Error(
          "Muốn bật kết nối thật, cần lưu user và password hoặc token Hunonic.",
        );
      }
      if (!bridgeUrl || !bridgeSecret) {
        throw new Error(
          "Muốn bật kết nối thật, cần cấu hình đủ URL và secret của bridge.",
        );
      }
    }

    await db.$transaction(async (tx) => {
      for (const [key, value] of values) {
        await tx.systemSetting.upsert({
          create: { key, updatedById: session.userId, value },
          update: { updatedById: session.userId, value },
          where: { key },
        });
      }
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: {
            cleared: {
              apiToken: Boolean(input.clearApiToken),
              bridgeSecret: Boolean(input.clearBridgeSecret),
              password: Boolean(input.clearPassword),
              username: Boolean(input.clearUsername),
            },
            liveAuthorized: Boolean(input.liveAuthorized),
          },
          summary: "Cập nhật cấu hình kết nối Hunonic.",
          targetId: "hunonic",
          targetType: "SystemSetting",
        },
      });
    });

    revalidatePath(PATH);
    revalidatePath("/nguoi-thuan-viet/dieu-khien-may-lanh");
    return {
      data: { snapshot: await getHunonicConfigSnapshot() },
      message: "Đã lưu cấu hình Hunonic an toàn trong PostgreSQL.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không lưu được cấu hình Hunonic.",
      ok: false,
    };
  }
}

async function connectHunonicSession(
  forceFreshLogin: boolean,
): Promise<HunonicActionResult> {
  try {
    const session = await requireHunonicAdmin();
    const settings = await getHunonicRuntimeSettings();
    if (!settings.username || !settings.password) {
      throw new Error("Chưa có đủ user và password Hunonic đã lưu.");
    }

    let connected;
    if (!forceFreshLogin && settings.apiToken) {
      try {
        connected = {
          devices: await getHunonicDevicesMobile(settings.apiToken),
          profileName: "",
          token: settings.apiToken,
          userId: "",
        };
      } catch {
        connected = await bootstrapHunonicMobile(
          settings.username,
          settings.password,
        );
      }
    } else {
      connected = await bootstrapHunonicMobile(
        settings.username,
        settings.password,
      );
    }
    const connectedAt = new Date().toISOString();
    const airConditioners = connected.devices.filter((device) =>
      isHunonicAirConditioner(device.rootType),
    );
    const lightSwitches = connected.devices.filter((device) =>
      isHunonicLightSwitch(device.rootType),
    );
    const probeDevice = connected.devices.find((device) =>
      isHunonicAirConditioner(device.rootType),
    );
    let gatewayProbe:
      { deviceName: string; message: string; ok: boolean } | undefined;
    if (probeDevice) {
      try {
        await probeHunonicIrGateway(probeDevice);
        gatewayProbe = {
          deviceName: probeDevice.name,
          message:
            "Hub IR đã phản hồi lệnh hỏi trạng thái, không thay đổi máy lạnh.",
          ok: true,
        };
      } catch (error) {
        gatewayProbe = {
          deviceName: probeDevice.name,
          message:
            error instanceof Error
              ? error.message
              : "Chưa nhận được phản hồi trạng thái từ hub IR.",
          ok: false,
        };
      }
    }

    const db = getDb();
    const connectionSettings = [
      [HUNONIC_SETTING_KEYS.apiToken, sealConfigSecret(connected.token)],
      [HUNONIC_SETTING_KEYS.lastConnectedAt, connectedAt],
      [HUNONIC_SETTING_KEYS.lastDeviceCount, String(connected.devices.length)],
      ...(connected.profileName
        ? ([
            [HUNONIC_SETTING_KEYS.lastProfileName, connected.profileName],
          ] as const)
        : []),
    ] as const;
    await db.$transaction(async (tx) => {
      for (const [key, value] of connectionSettings) {
        await tx.systemSetting.upsert({
          create: { key, updatedById: session.userId, value },
          update: { updatedById: session.userId, value },
          where: { key },
        });
      }
      await tx.auditLog.create({
        data: {
          action: "SYNC",
          actorId: session.userId,
          metadata: {
            deviceCount: connected.devices.length,
            airConditionerCount: airConditioners.length,
            lightSwitchCount: lightSwitches.length,
            operation: forceFreshLogin
              ? "reconnect-mobile-session"
              : "bootstrap-mobile-session",
          },
          summary: `${
            forceFreshLogin ? "Tái kết nối" : "Đăng nhập"
          } Hunonic và phát hiện ${connected.devices.length} thiết bị.`,
          targetId: "hunonic.apiToken",
          targetType: "SystemSetting",
        },
      });
    });
    await syncHunonicElectricalDeviceRegistry(connected.devices, {
      lastSeenAt: new Date(connectedAt),
      refreshExisting: true,
    });

    revalidatePath(PATH);
    revalidatePath("/nguoi-thuan-viet/dieu-khien-may-lanh");
    return {
      data: {
        devices: connected.devices.map((device) => ({
          diagnostic: device.diagnostic,
          externalId: device.externalId,
          homeName: device.homeName,
          name: device.name,
          online: device.online,
          roomName: device.roomName,
          rootType: device.rootType,
        })),
        gatewayProbe,
        snapshot: await getHunonicConfigSnapshot(),
      },
      message: `Đã ${
        forceFreshLogin ? "tái kết nối" : "đăng nhập"
      } Hunonic và đọc được ${connected.devices.length} thiết bị.${gatewayProbe?.ok ? " Hub IR đã phản hồi kiểm tra an toàn." : ""}`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : forceFreshLogin
            ? "Không tái kết nối được Hunonic."
            : "Không lấy được key Hunonic.",
      ok: false,
    };
  }
}

export async function bootstrapHunonicSessionAction(): Promise<HunonicActionResult> {
  return connectHunonicSession(false);
}

export async function reconnectHunonicSessionAction(): Promise<HunonicActionResult> {
  return connectHunonicSession(true);
}

async function electricalLayoutMutation(
  mutation: (session: Awaited<ReturnType<typeof requireHunonicAdmin>>) => Promise<{
    auditMetadata?: Record<string, unknown>;
    auditTargetId: string;
    message: string;
    summary: string;
  }>,
): Promise<ElectricalLayoutActionResult> {
  try {
    const session = await requireHunonicAdmin();
    const result = await mutation(session);
    await getDb().auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: result.auditMetadata
          ? JSON.parse(JSON.stringify(result.auditMetadata))
          : {},
        summary: result.summary,
        targetId: result.auditTargetId,
        targetType: "ElectricalLayout",
      },
    });
    revalidatePath(PATH);
    revalidatePath("/nguoi-thuan-viet/dieu-khien-may-lanh");
    return {
      data: await getElectricalLayoutConfig(),
      message: result.message,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không cập nhật được sơ đồ hệ thống điện.",
      ok: false,
    };
  }
}

export async function createElectricalLocationAction(input: {
  area: string;
  building?: string;
  floor: string;
  room: string;
}): Promise<ElectricalLayoutActionResult> {
  return electricalLayoutMutation(async () => {
    const location = await createElectricalLocation(input);
    return {
      auditMetadata: input,
      auditTargetId: location.id,
      message: "Đã thêm vị trí vào sơ đồ hệ thống điện.",
      summary: `Tạo vị trí ${location.building} / ${location.floor} / ${location.room} / ${location.area}.`,
    };
  });
}

export async function updateElectricalLocationAction(input: {
  area: string;
  building?: string;
  floor: string;
  id: string;
  room: string;
}): Promise<ElectricalLayoutActionResult> {
  return electricalLayoutMutation(async () => {
    const location = await updateElectricalLocation(input);
    return {
      auditMetadata: input,
      auditTargetId: location.id,
      message: "Đã cập nhật tầng, phòng và khu vực.",
      summary: `Cập nhật vị trí ${location.building} / ${location.floor} / ${location.room} / ${location.area}.`,
    };
  });
}

export async function saveElectricalDevicePlacementAction(input: {
  customName?: string;
  deviceId: string;
  locationId?: string;
}): Promise<ElectricalLayoutActionResult> {
  return electricalLayoutMutation(async () => {
    await saveElectricalDevicePlacement({
      customName: input.customName,
      deviceIds: [input.deviceId],
      locationId: input.locationId,
    });
    return {
      auditMetadata: {
        customName: input.customName,
        locationId: input.locationId || null,
      },
      auditTargetId: input.deviceId,
      message: "Đã lưu tên và vị trí thiết bị.",
      summary: "Cập nhật tên hiển thị và vị trí thiết bị Hunonic.",
    };
  });
}

export async function bulkAssignElectricalDevicesAction(input: {
  deviceIds: string[];
  locationId?: string;
}): Promise<ElectricalLayoutActionResult> {
  return electricalLayoutMutation(async () => {
    const count = await saveElectricalDevicePlacement(input);
    return {
      auditMetadata: {
        count,
        deviceIds: input.deviceIds,
        locationId: input.locationId || null,
      },
      auditTargetId: input.locationId || "unassigned",
      message: `Đã gán vị trí cho ${count} thiết bị.`,
      summary: `Gán vị trí hàng loạt cho ${count} thiết bị Hunonic.`,
    };
  });
}

export async function deleteElectricalLocationAction(
  id: string,
): Promise<ElectricalLayoutActionResult> {
  return electricalLayoutMutation(async () => {
    await deleteElectricalLocation(id);
    return {
      auditTargetId: id,
      message: "Đã xóa khu vực không còn sử dụng.",
      summary: "Xóa vị trí khỏi sơ đồ hệ thống điện.",
    };
  });
}
