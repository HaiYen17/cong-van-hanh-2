import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import {
  LocationMapWorkspace,
  type LocationZone,
} from "./location-map-workspace";

export const metadata: Metadata = {
  title: "Bản đồ định vị | Cổng vận hành",
};

type LocationConfig = {
  avatars?: Record<string, { imageId?: string; imageUrl?: string } | string>;
  enabled?: boolean;
  offices?: Record<
    string,
    { imageId?: string; imageUrl?: string; label?: string }
  >;
  trackedEmployeeIds?: string[];
};

type PresenceEntry = {
  department?: string;
  lastMs?: number | string;
  name?: string;
  officeKey?: string;
};

function jsonObject(value: string | null | undefined) {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function settingJson(
  settings: { key: string; value: string | null }[],
  keys: string[],
) {
  for (const key of keys) {
    const setting = settings.find((item) => item.key === key);
    const value = jsonObject(setting?.value);
    if (Object.keys(value).length) return value;
  }
  return {};
}

function imageUrl(value: unknown, size: "w200" | "w800") {
  if (typeof value === "string") {
    const imageId = value.trim();
    return imageId
      ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(imageId)}&sz=${size}`
      : "";
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  if (record.imageUrl) return String(record.imageUrl);
  return imageUrl(record.imageId, size);
}

export default async function LocationMapPage() {
  const session = await requireCurrentSession();
  const canOpen =
    session.fullAccess ||
    session.moduleGroups.includes("hanh-chinh-nv") ||
    session.modules.includes("location-map");

  if (!canOpen) {
    return (
      <AppShell activePath="/" moduleKey="location-map" session={session}>
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở Bản đồ định vị.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const db = getDb();
  const [employees, companies, locationSettings] = await Promise.all([
    db.employee.findMany({
      orderBy: [{ fullName: "asc" }],
      select: {
        department: true,
        employeeCode: true,
        fullName: true,
      },
      where: { archivedAt: null, status: "ACTIVE" },
    }),
    db.company.findMany({
      orderBy: [{ code: "asc" }],
      select: { code: true, legalName: true, shortName: true },
      where: { status: "ACTIVE" },
    }),
    db.systemSetting.findMany({
      select: { key: true, value: true },
      where: {
        key: {
          in: [
            "location.config",
            "location.presence",
            "HC_LOCATION_CONFIG_V1",
            "HC_LOCATION_PRESENCE_V1",
          ],
        },
      },
    }),
  ]);

  const config = settingJson(locationSettings, [
    "location.config",
    "HC_LOCATION_CONFIG_V1",
  ]) as LocationConfig;
  const presence = settingJson(locationSettings, [
    "location.presence",
    "HC_LOCATION_PRESENCE_V1",
  ]) as Record<string, PresenceEntry>;
  const employeesByCode = new Map(
    employees.map((employee) => [employee.employeeCode, employee]),
  );
  const tracked = new Set(
    Array.isArray(config.trackedEmployeeIds)
      ? config.trackedEmployeeIds.map(String)
      : [],
  );
  const officeEntries = Object.entries(config.offices || {});
  const officeLabel = (key: string, storedLabel?: string) => {
    if (storedLabel) return storedLabel;
    const normalized = key.toLocaleLowerCase("vi");
    const company = companies.find(
      (item) =>
        item.code.toLocaleLowerCase("vi") === normalized ||
        item.shortName?.toLocaleLowerCase("vi") === normalized,
    );
    return company?.shortName || company?.legalName || key;
  };
  const zones: LocationZone[] = officeEntries.map(([key, office]) => ({
    imageUrl: imageUrl(office, "w800"),
    key,
    label: officeLabel(key, office.label),
    people: [],
  }));
  zones.push({ imageUrl: "", key: "other", label: "Nơi khác", people: [] });
  const zoneByKey = new Map(zones.map((zone) => [zone.key, zone]));
  // Server Component cần mốc hiện tại để áp TTL hiện diện 5 phút.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  for (const [employeeCode, entry] of Object.entries(presence)) {
    const lastMs = Number(entry.lastMs || 0);
    if (!lastMs || now - lastMs > 5 * 60 * 1000) continue;
    if (tracked.size && !tracked.has(employeeCode)) continue;
    const employee = employeesByCode.get(employeeCode);
    const avatar = config.avatars?.[employeeCode];
    const zone = zoneByKey.get(entry.officeKey || "") || zoneByKey.get("other");
    zone?.people.push({
      avatarUrl: imageUrl(avatar, "w200"),
      department: entry.department || employee?.department || "",
      employeeCode,
      lastMs,
      name: entry.name || employee?.fullName || employeeCode,
    });
  }

  return (
    <AppShell activePath="/" moduleKey="location-map" session={session}>
      <LocationMapWorkspace
        enabled={Boolean(config.enabled)}
        serverMs={now}
        zones={zones}
      />
    </AppShell>
  );
}
