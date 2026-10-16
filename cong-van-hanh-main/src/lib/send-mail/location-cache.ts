import "server-only";

import { getDb } from "@/lib/db";
import {
  vtpListDistricts,
  vtpListProvinces,
  vtpListWards,
  type VtpDistrict,
  type VtpProvince,
  type VtpWard,
} from "@/lib/integrations/viettelpost-mail";

export type SendMailAddressMode = "new" | "old";

type NewLocationSnapshot = {
  addressMode: "new";
  env: string;
  provinces: VtpProvince[];
  syncedAt: string;
  wardsByProvince: Record<string, VtpWard[]>;
};

type OldLocationSnapshot = {
  addressMode: "old";
  districtsByProvince: Record<string, VtpDistrict[]>;
  env: string;
  provinces: VtpProvince[];
  syncedAt: string;
  wardsByDistrict: Record<string, VtpWard[]>;
};

type LocationSnapshot = NewLocationSnapshot | OldLocationSnapshot;

const KEY_PREFIX = "send_mail.viettelpost_location_snapshot";
const CATALOG_REQUEST_INTERVAL_MS = 220;
const CATALOG_RETRY_DELAYS_MS = [900, 1_800, 3_600, 7_200];

type CatalogResponse = {
  error?: string;
  ok: boolean;
};

type CatalogRequestGate = () => Promise<void>;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function createCatalogRequestGate(
  intervalMs = CATALOG_REQUEST_INTERVAL_MS,
): CatalogRequestGate {
  let nextStartAt = 0;
  let queue = Promise.resolve();

  return async () => {
    let release = () => {};
    const previous = queue;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const waitMs = Math.max(0, nextStartAt - Date.now());
    if (waitMs) await delay(waitMs);
    nextStartAt = Date.now() + intervalMs;
    release();
  };
}

function isTransientCatalogError(error: string | undefined) {
  return /(?:http\s*429|too many|rate limit|timeout|timed out|http\s*5\d\d)/i.test(
    String(error || ""),
  );
}

async function requestAfterGate<T>(
  gate: CatalogRequestGate,
  request: () => Promise<T>,
) {
  await gate();
  return request();
}

async function requestCatalogWithRetry<T extends CatalogResponse>(
  gate: CatalogRequestGate,
  request: () => Promise<T>,
): Promise<T> {
  let result = await requestAfterGate(gate, request);
  for (
    let attempt = 0;
    !result.ok &&
    isTransientCatalogError(result.error) &&
    attempt < CATALOG_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    await delay(CATALOG_RETRY_DELAYS_MS[attempt]);
    result = await requestAfterGate(gate, request);
  }
  return result;
}

function normalizedEnv(env: string) {
  return String(env || "").toUpperCase() === "DEV" ? "DEV" : "PROD";
}

function settingKey(env: string, addressMode: SendMailAddressMode) {
  return `${KEY_PREFIX}.${normalizedEnv(env)}.${addressMode}`;
}

function parseSnapshot(
  raw: string | null | undefined,
  env: string,
  addressMode: SendMailAddressMode,
): LocationSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as LocationSnapshot;
    if (
      value &&
      value.addressMode === addressMode &&
      value.env === normalizedEnv(env) &&
      Array.isArray(value.provinces)
    ) {
      return value;
    }
  } catch {
    // Snapshot hỏng sẽ được bỏ qua và tự nạp lại từ Viettel Post.
  }
  return null;
}

async function readSnapshot(
  env: string,
  addressMode: SendMailAddressMode,
): Promise<LocationSnapshot | null> {
  const row = await getDb().systemSetting.findUnique({
    select: { value: true },
    where: { key: settingKey(env, addressMode) },
  });
  return parseSnapshot(row?.value, env, addressMode);
}

async function writeSnapshot(snapshot: LocationSnapshot) {
  await getDb().systemSetting.upsert({
    create: {
      key: settingKey(snapshot.env, snapshot.addressMode),
      value: JSON.stringify(snapshot),
    },
    update: { value: JSON.stringify(snapshot) },
    where: { key: settingKey(snapshot.env, snapshot.addressMode) },
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length || 1) },
      () => runWorker(),
    ),
  );
  return output;
}

export async function getSendMailProvinces(
  env: string,
  addressMode: SendMailAddressMode,
) {
  const cached = await readSnapshot(env, addressMode);
  if (cached?.provinces.length) {
    return {
      provinces: cached.provinces,
      source: "postgres" as const,
      syncedAt: cached.syncedAt,
    };
  }

  const response = await vtpListProvinces(env, addressMode);
  if (!response.ok) {
    return { error: response.error, provinces: [] as VtpProvince[] };
  }

  const snapshot: LocationSnapshot =
    addressMode === "old"
      ? {
          addressMode,
          districtsByProvince: {},
          env: normalizedEnv(env),
          provinces: response.provinces,
          syncedAt: new Date().toISOString(),
          wardsByDistrict: {},
        }
      : {
          addressMode,
          env: normalizedEnv(env),
          provinces: response.provinces,
          syncedAt: new Date().toISOString(),
          wardsByProvince: {},
        };
  await writeSnapshot(snapshot);
  return {
    provinces: response.provinces,
    source: response.source,
    syncedAt: snapshot.syncedAt,
  };
}

export async function getSendMailDistricts(env: string, provinceId: number) {
  const cached = await readSnapshot(env, "old");
  if (cached?.addressMode === "old") {
    const districts = cached.districtsByProvince[String(provinceId)];
    if (districts?.length) {
      return {
        districts,
        source: "postgres" as const,
        syncedAt: cached.syncedAt,
      };
    }
  }

  const response = await vtpListDistricts(env, provinceId);
  if (!response.ok) {
    return { districts: [] as VtpDistrict[], error: response.error };
  }
  const provincesResult = cached?.provinces.length
    ? { provinces: cached.provinces }
    : await getSendMailProvinces(env, "old");
  const provinces = provincesResult.provinces;
  const snapshot: OldLocationSnapshot = {
    addressMode: "old",
    districtsByProvince: {
      ...(cached?.addressMode === "old" ? cached.districtsByProvince : {}),
      [String(provinceId)]: response.districts,
    },
    env: normalizedEnv(env),
    provinces,
    syncedAt: cached?.syncedAt || new Date().toISOString(),
    wardsByDistrict:
      cached?.addressMode === "old" ? cached.wardsByDistrict : {},
  };
  await writeSnapshot(snapshot);
  return {
    districts: response.districts,
    source: "api" as const,
    syncedAt: snapshot.syncedAt,
  };
}

export async function getSendMailWards(
  env: string,
  input: {
    addressMode: SendMailAddressMode;
    districtId?: number;
    provinceId?: number;
  },
) {
  const cached = await readSnapshot(env, input.addressMode);
  const lookupId =
    input.addressMode === "old" ? input.districtId : input.provinceId;
  if (!lookupId) {
    return { error: "Thiếu khu vực để tải phường/xã.", wards: [] as VtpWard[] };
  }

  if (cached?.addressMode === "new") {
    const wards = cached.wardsByProvince[String(lookupId)];
    if (wards?.length) {
      return { source: "postgres" as const, syncedAt: cached.syncedAt, wards };
    }
  }
  if (cached?.addressMode === "old") {
    const wards = cached.wardsByDistrict[String(lookupId)];
    if (wards?.length) {
      return { source: "postgres" as const, syncedAt: cached.syncedAt, wards };
    }
  }

  const response = await vtpListWards(env, input);
  if (!response.ok) {
    return { error: response.error, wards: [] as VtpWard[] };
  }
  const provincesResult = cached?.provinces.length
    ? { provinces: cached.provinces }
    : await getSendMailProvinces(env, input.addressMode);
  const provinces = provincesResult.provinces;
  const syncedAt = cached?.syncedAt || new Date().toISOString();

  if (input.addressMode === "old") {
    const oldSnapshot: OldLocationSnapshot = {
      addressMode: "old",
      districtsByProvince:
        cached?.addressMode === "old" ? cached.districtsByProvince : {},
      env: normalizedEnv(env),
      provinces,
      syncedAt,
      wardsByDistrict: {
        ...(cached?.addressMode === "old" ? cached.wardsByDistrict : {}),
        [String(lookupId)]: response.wards,
      },
    };
    await writeSnapshot(oldSnapshot);
  } else {
    const newSnapshot: NewLocationSnapshot = {
      addressMode: "new",
      env: normalizedEnv(env),
      provinces,
      syncedAt,
      wardsByProvince: {
        ...(cached?.addressMode === "new" ? cached.wardsByProvince : {}),
        [String(lookupId)]: response.wards,
      },
    };
    await writeSnapshot(newSnapshot);
  }
  return { source: "api" as const, syncedAt, wards: response.wards };
}

async function buildNewSnapshot(
  env: string,
  gate: CatalogRequestGate,
): Promise<NewLocationSnapshot> {
  const provinceResult = await requestAfterGate(gate, () =>
    vtpListProvinces(env, "new"),
  );
  if (!provinceResult.ok || provinceResult.source !== "api") {
    throw new Error(
      provinceResult.ok
        ? "Viettel Post không trả danh mục tỉnh mới; không thay snapshot cũ."
        : provinceResult.error,
    );
  }
  const pairs = await mapWithConcurrency(
    provinceResult.provinces,
    8,
    async (province) => {
      const wards = await requestCatalogWithRetry(gate, () =>
        vtpListWards(env, {
          addressMode: "new",
          provinceId: province.id,
        }),
      );
      if (!wards.ok) {
        throw new Error(`${province.name}: ${wards.error}`);
      }
      return [String(province.id), wards.wards] as const;
    },
  );
  return {
    addressMode: "new",
    env: normalizedEnv(env),
    provinces: provinceResult.provinces,
    syncedAt: new Date().toISOString(),
    wardsByProvince: Object.fromEntries(pairs),
  };
}

async function buildOldSnapshot(
  env: string,
  gate: CatalogRequestGate,
): Promise<OldLocationSnapshot> {
  const provinceResult = await requestCatalogWithRetry(gate, () =>
    vtpListProvinces(env, "old"),
  );
  if (!provinceResult.ok) throw new Error(provinceResult.error);

  const districtPairs = await mapWithConcurrency(
    provinceResult.provinces,
    8,
    async (province) => {
      const districts = await requestCatalogWithRetry(gate, () =>
        vtpListDistricts(env, province.id),
      );
      if (!districts.ok) {
        throw new Error(`${province.name}: ${districts.error}`);
      }
      return [String(province.id), districts.districts] as const;
    },
  );
  const districtsByProvince = Object.fromEntries(districtPairs);
  const allDistricts = districtPairs.flatMap(([, districts]) => districts);
  const wardPairs = await mapWithConcurrency(
    allDistricts,
    10,
    async (district) => {
      const wards = await requestCatalogWithRetry(gate, () =>
        vtpListWards(env, {
          addressMode: "old",
          districtId: district.id,
        }),
      );
      if (!wards.ok) {
        throw new Error(`${district.name}: ${wards.error}`);
      }
      return [String(district.id), wards.wards] as const;
    },
  );

  return {
    addressMode: "old",
    districtsByProvince,
    env: normalizedEnv(env),
    provinces: provinceResult.provinces,
    syncedAt: new Date().toISOString(),
    wardsByDistrict: Object.fromEntries(wardPairs),
  };
}

export async function syncSendMailLocationCatalog(env = "PROD") {
  // Chỉ ghi sau khi từng snapshot hoàn thành; lỗi giữa chừng không phá cache cũ.
  const gate = createCatalogRequestGate();
  const newSnapshot = await buildNewSnapshot(env, gate);
  await writeSnapshot(newSnapshot);

  const oldSnapshot = await buildOldSnapshot(env, gate);
  await writeSnapshot(oldSnapshot);

  return {
    env: normalizedEnv(env),
    new: {
      provinces: newSnapshot.provinces.length,
      syncedAt: newSnapshot.syncedAt,
      wards: Object.values(newSnapshot.wardsByProvince).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    },
    old: {
      districts: Object.values(oldSnapshot.districtsByProvince).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
      provinces: oldSnapshot.provinces.length,
      syncedAt: oldSnapshot.syncedAt,
      wards: Object.values(oldSnapshot.wardsByDistrict).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    },
  };
}
