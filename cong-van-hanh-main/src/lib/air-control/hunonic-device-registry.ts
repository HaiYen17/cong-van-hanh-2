import "server-only";

import { getDb } from "@/lib/db";

import {
  getHunonicDevicePowerState,
  getHunonicElectricalDeviceKind,
  hunonicDeviceCapabilities,
} from "./hunonic-device-types";
import type { HunonicDevice } from "./hunonic-mobile-client";

export function supportedHunonicElectricalDevices(devices: HunonicDevice[]) {
  return devices.filter((device) =>
    Boolean(getHunonicElectricalDeviceKind(device.rootType)),
  );
}

export async function syncHunonicElectricalDeviceRegistry(
  devices: HunonicDevice[],
  options: {
    lastSeenAt?: Date;
    refreshExisting?: boolean;
  } = {},
) {
  const supported = supportedHunonicElectricalDevices(devices);
  if (!supported.length) return [];

  const db = getDb();
  const externalIds = supported.map((device) => device.externalId);
  const existing = await db.airConditionerDevice.findMany({
    where: { externalId: { in: externalIds } },
  });
  const existingByExternalId = new Map(
    existing.map((device) => [device.externalId || "", device]),
  );
  const lastSeenAt = options.lastSeenAt || new Date();
  const pending = supported.flatMap((device, index) => {
    const stored = existingByExternalId.get(device.externalId);
    if (
      stored &&
      !options.refreshExisting &&
      stored.status === "ACTIVE" &&
      !stored.archivedAt
    ) {
      return [];
    }
    const liveData = {
      archivedAt: null,
      capabilities: hunonicDeviceCapabilities(device.rootType),
      lastSeenAt,
      location: device.roomName || device.homeName,
      online: device.online,
      powerOn: getHunonicDevicePowerState(device),
      rootType: device.rootType,
      sourceName: device.name,
      sortOrder: index + 1,
      status: "ACTIVE",
    };
    return [
      db.airConditionerDevice.upsert({
        create: {
          ...liveData,
          externalId: device.externalId,
          name: device.name,
        },
        update: liveData,
        where: { externalId: device.externalId },
      }),
    ];
  });

  if (pending.length) await db.$transaction(pending);
  return db.airConditionerDevice.findMany({
    include: { layoutLocation: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    where: {
      archivedAt: null,
      externalId: { in: externalIds },
      status: "ACTIVE",
    },
  });
}
