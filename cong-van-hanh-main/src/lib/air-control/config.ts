import "server-only";

import {
  hasConfigSecret,
  openConfigSecret,
  previewConfigSecret,
} from "@/lib/config/secret-vault";
import { getDb } from "@/lib/db";

export const HUNONIC_SETTING_KEYS = {
  apiToken: "hunonic.apiToken",
  bridgeSecret: "hunonic.bridgeSecret",
  bridgeUrl: "hunonic.bridgeUrl",
  lastConnectedAt: "hunonic.lastConnectedAt",
  lastDeviceCount: "hunonic.lastDeviceCount",
  lastProfileName: "hunonic.lastProfileName",
  liveAuthorized: "hunonic.liveAuthorized",
  password: "hunonic.password",
  username: "hunonic.username",
} as const;

export type HunonicConfigSnapshot = {
  apiTokenConfigured: boolean;
  apiTokenPreview: string;
  bridgeReady: boolean;
  bridgeSecretConfigured: boolean;
  bridgeSecretPreview: string;
  bridgeUrl: string;
  deviceCount: number;
  lastConnectedAt: string;
  liveAuthorized: boolean;
  passwordConfigured: boolean;
  passwordPreview: string;
  profileName: string;
  updatedAt: string;
  usernameConfigured: boolean;
  usernamePreview: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function settingMap() {
  const rows = await getDb().systemSetting.findMany({
    select: { key: true, updatedAt: true, value: true },
    where: { key: { in: Object.values(HUNONIC_SETTING_KEYS) } },
  });
  return new Map(rows.map((row) => [row.key, row]));
}

export async function getHunonicRuntimeSettings() {
  const rows = await settingMap();
  const value = (key: string) => text(rows.get(key)?.value);
  return {
    apiToken: openConfigSecret(value(HUNONIC_SETTING_KEYS.apiToken)),
    bridgeSecret: openConfigSecret(value(HUNONIC_SETTING_KEYS.bridgeSecret)),
    bridgeUrl: value(HUNONIC_SETTING_KEYS.bridgeUrl).replace(/\/+$/, ""),
    liveAuthorized: value(HUNONIC_SETTING_KEYS.liveAuthorized) === "true",
    liveAuthorizedConfigured: rows.has(HUNONIC_SETTING_KEYS.liveAuthorized),
    password: openConfigSecret(value(HUNONIC_SETTING_KEYS.password)),
    username: openConfigSecret(value(HUNONIC_SETTING_KEYS.username)),
  };
}

export async function getHunonicConfigSnapshot(): Promise<HunonicConfigSnapshot> {
  const rows = await settingMap();
  const stored = (key: string) => text(rows.get(key)?.value);
  const bridgeUrl = stored(HUNONIC_SETTING_KEYS.bridgeUrl);
  const bridgeSecret = stored(HUNONIC_SETTING_KEYS.bridgeSecret);
  const updatedAt = [...rows.values()]
    .map((row) => row.updatedAt)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    apiTokenConfigured: hasConfigSecret(stored(HUNONIC_SETTING_KEYS.apiToken)),
    apiTokenPreview: previewConfigSecret(stored(HUNONIC_SETTING_KEYS.apiToken)),
    bridgeReady: Boolean(bridgeUrl && bridgeSecret),
    bridgeSecretConfigured: hasConfigSecret(bridgeSecret),
    bridgeSecretPreview: previewConfigSecret(bridgeSecret),
    bridgeUrl,
    deviceCount: Number(stored(HUNONIC_SETTING_KEYS.lastDeviceCount) || 0),
    lastConnectedAt: stored(HUNONIC_SETTING_KEYS.lastConnectedAt),
    liveAuthorized: stored(HUNONIC_SETTING_KEYS.liveAuthorized) === "true",
    passwordConfigured: hasConfigSecret(stored(HUNONIC_SETTING_KEYS.password)),
    passwordPreview: hasConfigSecret(stored(HUNONIC_SETTING_KEYS.password))
      ? "••••••••"
      : "",
    profileName: stored(HUNONIC_SETTING_KEYS.lastProfileName),
    updatedAt: updatedAt?.toISOString() || "",
    usernameConfigured: hasConfigSecret(stored(HUNONIC_SETTING_KEYS.username)),
    usernamePreview: previewConfigSecret(stored(HUNONIC_SETTING_KEYS.username)),
  };
}
