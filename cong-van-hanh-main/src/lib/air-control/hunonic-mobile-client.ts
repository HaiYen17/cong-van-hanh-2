import "server-only";

import { createHash } from "node:crypto";

const MOBILE_API_URL = "https://api.hunonicpro.com/v3/";
const USER_AGENT = "okhttp/4.9.2";
const SLOT5 = "HUNONICBIGBUG94d3c445e72ae7805fca3489edac9608c893e66b";
const SLOT6 = "accessKey98ccdcbbe7b5528bec0ca31bbe8d93b4e76590dd";
const ENV7 = 58;

type JsonRecord = Record<string, unknown>;

export type HunonicDevice = {
  diagnostic: Record<string, unknown>;
  externalId: string;
  gatewayRootId: string;
  homeId: string;
  homeName: string;
  indexInRoot: number;
  iv: string;
  key: string;
  name: string;
  online: boolean;
  roomId: string;
  roomName: string;
  rootId: string;
  rootType: string;
  topicPublish: string;
  topicSubscribe: string;
  value: unknown;
};

export type HunonicSession = {
  devices: HunonicDevice[];
  profileName: string;
  token: string;
  userId: string;
};

export class HunonicMobileApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HunonicMobileApiError";
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function md5(value: string) {
  return createHash("md5").update(value, "utf8").digest("hex");
}

function isZero(value: string) {
  if (!value) return true;
  const number = Number(value);
  return Number.isFinite(number) && number === 0;
}

export function hunonicSign(params: Record<string, unknown>) {
  let accumulator = 0;
  for (const [key, rawValue] of Object.entries(params)) {
    if (key === "signature") continue;
    const value = text(rawValue);
    if (isZero(value)) {
      accumulator += (key.charCodeAt(0) || "a".charCodeAt(0)) + ENV7;
      continue;
    }
    const encoded = Buffer.from(value, "utf8").toString("base64");
    accumulator +=
      encoded.charCodeAt(0) +
      encoded.charCodeAt(Math.floor(encoded.length / 2)) +
      encoded.charCodeAt(encoded.length - 1);
  }
  return md5(`sha256fakeaccessKey=${SLOT6}${md5(String(accumulator))}${SLOT5}`);
}

function signedQuery(params: Record<string, unknown>) {
  const normalized = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, text(value)]),
  );
  return new URLSearchParams({
    ...normalized,
    signature: hunonicSign(normalized),
  });
}

async function responsePayload(response: Response) {
  const payload = record(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new HunonicMobileApiError(
      `Hunonic không phản hồi thành công (HTTP ${response.status}).`,
    );
  }
  if (payload.status !== true) {
    const code = text(payload.error_code);
    const message = text(payload.message) || "Hunonic từ chối yêu cầu.";
    throw new HunonicMobileApiError(
      code ? `${message} (mã ${code})` : message,
    );
  }
  return payload;
}

export async function loginHunonicMobile(username: string, password: string) {
  const fields = {
    app_name: "hunonic",
    app_role: "1",
    is_pro_app: "0",
    lang: "vi",
    password: md5(password),
    phone: username,
  };
  const body = new FormData();
  for (const [key, value] of Object.entries({
    ...fields,
    signature: hunonicSign(fields),
  })) {
    body.append(key, value);
  }

  const response = await fetch(`${MOBILE_API_URL}user/login`, {
    body,
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await responsePayload(response);
  const data = record(payload.data);
  const token = text(data.token_id);
  if (!token) {
    throw new HunonicMobileApiError(
      "Hunonic xác nhận đăng nhập nhưng không trả token phiên.",
    );
  }
  return {
    profileName: text(data.name),
    token,
    userId: text(data.id),
  };
}

function normalizeDevice(
  rawDevice: unknown,
  context: {
    homeId: string;
    homeName: string;
    roomId: string;
    roomName: string;
  },
): HunonicDevice | null {
  const device = record(rawDevice);
  const rootId = text(device.root_id);
  const rootType = text(device.root_type);
  const indexInRoot = Number(device.index_in_root || 1);
  const nativeId = text(device.id || device.device_id);
  const externalId = nativeId || `${rootId}:${indexInRoot}`;
  if (!externalId || !rootId) return null;
  const metadata = array(device.meta).map(record);
  const gatewayRootId =
    text(record(device.irchild_root_id).value || device.irchild_root_id) ||
    text(
      metadata.find((item) => text(item.meta_key) === "irchild_root_id")?.value,
    );

  return {
    diagnostic: {
      availableFields: Object.keys(device).sort(),
      brand: device.brand ?? null,
      category: device.category ?? null,
      code: device.code ?? null,
      data: device.data ?? null,
      dataExtra: device.data_extra ?? null,
      deviceBrands: device.device_brands ?? null,
      deviceType: device.device_type ?? device.type ?? null,
      meta: device.meta ?? null,
      model: device.model ?? null,
      remote: device.remote ?? null,
      rootExtra: device.root_extra ?? null,
      status: device.status ?? null,
      template: device.template ?? null,
      value: device.value ?? null,
    },
    externalId,
    gatewayRootId,
    homeId: context.homeId,
    homeName: context.homeName,
    indexInRoot: Number.isFinite(indexInRoot) ? indexInRoot : 1,
    iv: text(device.iv),
    key: text(device.key),
    name: text(device.name) || `Thiết bị ${externalId}`,
    online: String(device.state) === "1",
    roomId: context.roomId,
    roomName: context.roomName,
    rootId,
    rootType,
    topicPublish: text(device.topicpub),
    topicSubscribe: text(device.topicsub),
    value: device.value ?? null,
  };
}

export function flattenHunonicDevices(data: unknown) {
  const devices: HunonicDevice[] = [];
  const homes = Array.isArray(data) ? data : [data];
  for (const rawHome of homes) {
    const home = record(rawHome);
    const homeId = text(home.id || home.home_id);
    const homeName = text(home.name) || (homeId ? `Nhà ${homeId}` : "");
    for (const rawRoom of array(home.rooms)) {
      const room = record(rawRoom);
      const roomId = text(room.id || room.room_id);
      const roomName = text(room.name);
      for (const rawDevice of array(room.devices)) {
        const normalized = normalizeDevice(rawDevice, {
          homeId,
          homeName,
          roomId,
          roomName,
        });
        if (normalized) devices.push(normalized);
      }
    }
  }
  return devices;
}

export async function getHunonicDevicesMobile(token: string) {
  const query = signedQuery({ app_role: "1", home_id: "", token_id: token });
  const response = await fetch(
    `${MOBILE_API_URL}device/listDeviceByHome?${query.toString()}`,
    {
      body: "",
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = await responsePayload(response);
  return flattenHunonicDevices(payload.data);
}

export async function bootstrapHunonicMobile(
  username: string,
  password: string,
): Promise<HunonicSession> {
  const profile = await loginHunonicMobile(username, password);
  const devices = await getHunonicDevicesMobile(profile.token);
  return { ...profile, devices };
}
