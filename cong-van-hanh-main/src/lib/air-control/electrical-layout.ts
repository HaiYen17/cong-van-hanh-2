import "server-only";

import { getDb } from "@/lib/db";

import { getHunonicRuntimeSettings } from "./config";
import {
  supportedHunonicElectricalDevices,
  syncHunonicElectricalDeviceRegistry,
} from "./hunonic-device-registry";
import { getHunonicElectricalDeviceKind } from "./hunonic-device-types";
import { getHunonicDevicesMobile } from "./hunonic-mobile-client";

export type ElectricalLocationView = {
  area: string;
  building: string;
  deviceCount: number;
  floor: string;
  id: string;
  room: string;
  sortOrder: number;
};

export type ElectricalLayoutDeviceView = {
  customName: string;
  displayName: string;
  externalId: string;
  id: string;
  kind: "air-conditioner" | "light";
  locationId: string;
  online: boolean;
  rootType: string;
  sourceLocation: string;
  sourceName: string;
};

export type ElectricalLayoutConfigSnapshot = {
  devices: ElectricalLayoutDeviceView[];
  generatedAt: string;
  locations: ElectricalLocationView[];
};

export type ElectricalLocationPath = {
  area: string;
  building: string;
  floor: string;
  id: string;
  room: string;
};

function text(value: unknown, maxLength = 120) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function normalizeElectricalDeviceIds(deviceIds: unknown[]) {
  return [...new Set(deviceIds.map((deviceId) => text(deviceId)).filter(Boolean))];
}

function requiredLabel(value: unknown, label: string) {
  const result = text(value);
  if (!result) throw new Error(`Vui lòng nhập ${label}.`);
  return result;
}

export function electricalDeviceDisplayName(device: {
  customName?: string | null;
  name: string;
  sourceName?: string | null;
}) {
  return text(device.customName || device.sourceName || device.name) || "Thiết bị Hunonic";
}

export function electricalLocationPath(
  location: {
    area: string;
    building: string;
    floor: string;
    id: string;
    room: string;
  } | null | undefined,
): ElectricalLocationPath | null {
  if (!location) return null;
  return {
    area: location.area,
    building: location.building,
    floor: location.floor,
    id: location.id,
    room: location.room,
  };
}

export async function getElectricalLayoutConfig(): Promise<ElectricalLayoutConfigSnapshot> {
  const db = getDb();
  let currentExternalIds: string[] | null = null;
  try {
    const settings = await getHunonicRuntimeSettings();
    if (settings.apiToken) {
      const liveDevices = supportedHunonicElectricalDevices(
        await getHunonicDevicesMobile(settings.apiToken),
      );
      await syncHunonicElectricalDeviceRegistry(liveDevices, {
        lastSeenAt: new Date(),
        refreshExisting: true,
      });
      currentExternalIds = liveDevices.map((device) => device.externalId);
    }
  } catch {
    // Nếu Hunonic tạm thời không phản hồi, cấu hình vẫn mở bằng registry gần nhất.
  }
  const [locations, devices] = await Promise.all([
    db.electricalLocation.findMany({
      include: { _count: { select: { devices: true } } },
      orderBy: [
        { building: "asc" },
        { floor: "asc" },
        { room: "asc" },
        { sortOrder: "asc" },
        { area: "asc" },
      ],
    }),
    db.airConditionerDevice.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      where: {
        archivedAt: null,
        externalId:
          currentExternalIds === null
            ? { not: { startsWith: "demo-" } }
            : { in: currentExternalIds },
        status: "ACTIVE",
      },
    }),
  ]);

  return {
    devices: devices.flatMap((device) => {
      const kind = getHunonicElectricalDeviceKind(device.rootType || "");
      if (!kind) return [];
      return [{
        customName: device.customName || "",
        displayName: electricalDeviceDisplayName(device),
        externalId: device.externalId || "",
        id: device.id,
        kind,
        locationId: device.locationId || "",
        online: device.online,
        rootType: device.rootType || "",
        sourceLocation: device.location || "",
        sourceName: device.sourceName || device.name,
      }];
    }),
    generatedAt: new Date().toISOString(),
    locations: locations.map((location) => ({
      area: location.area,
      building: location.building,
      deviceCount: location._count.devices,
      floor: location.floor,
      id: location.id,
      room: location.room,
      sortOrder: location.sortOrder,
    })),
  };
}

export async function createElectricalLocation(input: {
  area: unknown;
  building?: unknown;
  floor: unknown;
  room: unknown;
}) {
  const building = text(input.building) || "Trụ sở chính";
  const floor = requiredLabel(input.floor, "tầng");
  const room = requiredLabel(input.room, "phòng");
  const area = requiredLabel(input.area, "khu vực");

  return getDb().electricalLocation.upsert({
    create: { area, building, floor, room },
    update: {},
    where: { building_floor_room_area: { area, building, floor, room } },
  });
}

export async function updateElectricalLocation(input: {
  area: unknown;
  building?: unknown;
  floor: unknown;
  id: string;
  room: unknown;
}) {
  return getDb().electricalLocation.update({
    data: {
      area: requiredLabel(input.area, "khu vực"),
      building: text(input.building) || "Trụ sở chính",
      floor: requiredLabel(input.floor, "tầng"),
      room: requiredLabel(input.room, "phòng"),
    },
    where: { id: input.id },
  });
}

export async function saveElectricalDevicePlacement(input: {
  customName?: unknown;
  deviceIds: string[];
  locationId?: unknown;
}) {
  const deviceIds = normalizeElectricalDeviceIds(input.deviceIds);
  if (!deviceIds.length) throw new Error("Vui lòng chọn ít nhất một thiết bị.");
  const locationId = text(input.locationId) || null;
  const customName = input.customName === undefined ? undefined : text(input.customName);
  const db = getDb();

  if (locationId) {
    const exists = await db.electricalLocation.count({ where: { id: locationId } });
    if (!exists) throw new Error("Khu vực đã chọn không còn tồn tại.");
  }

  if (customName !== undefined && deviceIds.length !== 1) {
    throw new Error("Chỉ đổi tên khi lưu từng thiết bị.");
  }

  const result = await db.airConditionerDevice.updateMany({
    data: {
      locationId,
      ...(customName === undefined ? {} : { customName: customName || null }),
    },
    where: {
      archivedAt: null,
      id: { in: deviceIds },
      status: "ACTIVE",
    },
  });
  if (result.count !== deviceIds.length) {
    throw new Error("Có thiết bị không còn tồn tại hoặc đã ngừng hoạt động.");
  }
  return result.count;
}

export async function deleteElectricalLocation(id: string) {
  const db = getDb();
  const location = await db.electricalLocation.findUnique({
    include: { _count: { select: { devices: true } } },
    where: { id: text(id) },
  });
  if (!location) throw new Error("Khu vực không còn tồn tại.");
  if (location._count.devices) {
    throw new Error("Hãy chuyển thiết bị sang khu vực khác trước khi xóa.");
  }
  await db.electricalLocation.delete({ where: { id: location.id } });
}
