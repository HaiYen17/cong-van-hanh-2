import "server-only";

import { hasConfigSecret, openConfigSecret } from "@/lib/config/secret-vault";
import { getDb } from "@/lib/db";

import {
  type MeetingConfigSnapshot,
} from "./config-shared";

export { RECALL_REGIONS } from "./config-shared";
export type { MeetingConfigSnapshot } from "./config-shared";

export const MEETING_SETTING_KEYS = {
  audioRetentionDays: "meetings.audioRetentionDays",
  botJoinLeadMinutes: "meetings.botJoinLeadMinutes",
  defaultTimezone: "meetings.defaultTimezone",
  googleOrganizerEmail: "meetings.googleOrganizerEmail",
  recallApiKey: "meetings.recallApiKey",
  recallEnabled: "meetings.recallEnabled",
  recallRegion: "meetings.recallRegion",
  recallVerificationSecret: "meetings.recallVerificationSecret",
  transcriptRetentionDays: "meetings.transcriptRetentionDays",
} as const;

function integer(value: string | null | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: string | null | undefined, fallback: boolean) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "true";
}

async function settingMap() {
  const rows = await getDb().systemSetting.findMany({
    select: { key: true, value: true },
    where: { key: { in: Object.values(MEETING_SETTING_KEYS) } },
  });
  return new Map(rows.map((row) => [row.key, row.value]));
}

function snapshotFromValues(
  values: Map<string, string | null>,
): MeetingConfigSnapshot {
  return {
    audioRetentionDays: integer(
      values.get(MEETING_SETTING_KEYS.audioRetentionDays),
      7,
    ),
    botJoinLeadMinutes: integer(
      values.get(MEETING_SETTING_KEYS.botJoinLeadMinutes),
      2,
    ),
    defaultTimezone:
      values.get(MEETING_SETTING_KEYS.defaultTimezone) || "Asia/Ho_Chi_Minh",
    googleOrganizerEmail:
      values.get(MEETING_SETTING_KEYS.googleOrganizerEmail) ||
      "admin@nemthuanviet.vn",
    googleServiceAccountEmail:
      process.env.MODULE_MAIL_SERVICE_ACCOUNT_EMAIL ||
      "thuan-viet-mail-router@tvg-ops-dev.iam.gserviceaccount.com",
    recallApiKeyConfigured: hasConfigSecret(
      values.get(MEETING_SETTING_KEYS.recallApiKey),
    ),
    recallEnabled: booleanValue(
      values.get(MEETING_SETTING_KEYS.recallEnabled),
      true,
    ),
    recallRegion:
      values.get(MEETING_SETTING_KEYS.recallRegion) || "ap-northeast-1",
    recallVerificationSecretConfigured: hasConfigSecret(
      values.get(MEETING_SETTING_KEYS.recallVerificationSecret),
    ),
    transcriptRetentionDays: integer(
      values.get(MEETING_SETTING_KEYS.transcriptRetentionDays),
      90,
    ),
  };
}

export async function getMeetingConfigSnapshot(): Promise<MeetingConfigSnapshot> {
  return snapshotFromValues(await settingMap());
}

export async function getMeetingRuntimeConfig() {
  const values = await settingMap();
  const snapshot = snapshotFromValues(values);
  return {
    ...snapshot,
    recallApiKey: openConfigSecret(
      values.get(MEETING_SETTING_KEYS.recallApiKey),
    ),
    recallVerificationSecret: openConfigSecret(
      values.get(MEETING_SETTING_KEYS.recallVerificationSecret),
    ),
  };
}
