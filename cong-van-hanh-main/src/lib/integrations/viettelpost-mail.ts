// Gửi thư ViettelPost — bám SendMailModal + Code.js
// (danh mục địa chỉ mới/cũ, báo giá, tạo đơn, in A5 và dò trạng thái).
//
// Các API nghiệp vụ Partner nằm trên partner.viettelpost.vn. api.viettelpost.vn
// là dashboard/supperapp và trả 404 cho các path /v2/order, /v3/categories.
const API_BASE: Record<string, string> = {
  DEV: "https://partnerdev.viettelpost.vn",
  PROD: "https://partner.viettelpost.vn",
};

function apiBase(env: string): string {
  return env === "DEV" ? API_BASE.DEV : API_BASE.PROD;
}

type Ok<T> = { ok: true } & T;
type Err = { error: string; ok: false };

// Tỉnh/thành: { id, name }. Quận/huyện và phường/xã dùng cho địa chỉ cũ.
export type VtpProvince = { code: string; id: number; name: string };
export type VtpDistrict = { id: number; name: string; provinceId: number };
export type VtpWard = { districtId: number; districtName: string; id: number; name: string };
export type VtpService = {
  code: string;
  eta: string;
  extra: { code: string; name: string }[];
  fee: number;
  name: string;
};
export type VtpCreateResult = {
  fee: number;
  moneyCollection: number;
  orderNumber: string;
  raw: unknown;
};
export type VtpPrintLink = {
  label: string;
  type: string;
  url: string;
};
export type VtpTracking = {
  delivered: boolean;
  orderNumber: string;
  raw: unknown;
  statusCode: string;
  statusLabel: string;
};

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const keys = [
    "data",
    "Data",
    "List",
    "list",
    "rows",
    "items",
    "orders",
    "lstData",
    "dataList",
  ];
  for (const key of keys) {
    if (Array.isArray(d[key])) return d[key] as unknown[];
  }
  for (const key of keys) {
    const nested = asArray(d[key]);
    if (nested.length) return nested;
  }
  return [];
}

function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pick<T>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k] as T;
  }
  return undefined;
}

const NEW_PROVINCE_FALLBACK: VtpProvince[] = [
  { code: "ADM1-92", id: 5, name: "Thành phố Cần Thơ" },
  { code: "ADM1-48", id: 4, name: "Thành phố Đà Nẵng" },
  { code: "ADM1-01", id: 1, name: "Thành phố Hà Nội" },
  { code: "ADM1-31", id: 3, name: "Thành phố Hải Phòng" },
  { code: "ADM1-79", id: 2, name: "Thành phố Hồ Chí Minh" },
  { code: "ADM1-46", id: 37, name: "Thành phố Huế" },
  { code: "ADM1-91", id: 56, name: "Tỉnh An Giang" },
  { code: "ADM1-24", id: 11, name: "Tỉnh Bắc Ninh" },
  { code: "ADM1-96", id: 63, name: "Tỉnh Cà Mau" },
  { code: "ADM1-04", id: 19, name: "Tỉnh Cao Bằng" },
  { code: "ADM1-66", id: 45, name: "Tỉnh Đắk Lắk" },
  { code: "ADM1-11", id: 64, name: "Tỉnh Điện Biên" },
  { code: "ADM1-75", id: 51, name: "Tỉnh Đồng Nai" },
  { code: "ADM1-82", id: 55, name: "Tỉnh Đồng Tháp" },
  { code: "ADM1-52", id: 44, name: "Tỉnh Gia Lai" },
  { code: "ADM1-42", id: 34, name: "Tỉnh Hà Tĩnh" },
  { code: "ADM1-33", id: 13, name: "Tỉnh Hưng Yên" },
  { code: "ADM1-56", id: 42, name: "Tỉnh Khánh Hoà" },
  { code: "ADM1-12", id: 29, name: "Tỉnh Lai Châu" },
  { code: "ADM1-68", id: 46, name: "Tỉnh Lâm Đồng" },
  { code: "ADM1-20", id: 22, name: "Tỉnh Lạng Sơn" },
  { code: "ADM1-15", id: 20, name: "Tỉnh Lào Cai" },
  { code: "ADM1-40", id: 33, name: "Tỉnh Nghệ An" },
  { code: "ADM1-37", id: 17, name: "Tỉnh Ninh Bình" },
  { code: "ADM1-25", id: 26, name: "Tỉnh Phú Thọ" },
  { code: "ADM1-51", id: 39, name: "Tỉnh Quảng Ngãi" },
  { code: "ADM1-22", id: 28, name: "Tỉnh Quảng Ninh" },
  { code: "ADM1-44", id: 36, name: "Tỉnh Quảng Trị" },
  { code: "ADM1-14", id: 30, name: "Tỉnh Sơn La" },
  { code: "ADM1-80", id: 49, name: "Tỉnh Tây Ninh" },
  { code: "ADM1-19", id: 25, name: "Tỉnh Thái Nguyên" },
  { code: "ADM1-38", id: 32, name: "Tỉnh Thanh Hoá" },
  { code: "ADM1-08", id: 23, name: "Tỉnh Tuyên Quang" },
  { code: "ADM1-86", id: 57, name: "Tỉnh Vĩnh Long" },
];

type VtpEnvelope = {
  data?: unknown;
  error?: boolean;
  message?: string;
  status?: number;
};

async function readEnvelope(response: Response): Promise<VtpEnvelope> {
  const json = (await response.json().catch(() => null)) as VtpEnvelope | null;
  if (!response.ok) {
    throw new Error(json?.message || `Viettel Post trả HTTP ${response.status}.`);
  }
  if (json?.error) {
    throw new Error(json.message || `Viettel Post từ chối yêu cầu (${json.status || "không rõ mã"}).`);
  }
  return json || {};
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeProvinces(data: unknown): VtpProvince[] {
  return asArray(data)
    .map((r) => {
      const o = r as Record<string, unknown>;
      return {
        code: String(
          pick<string>(o, [
            "PROVINCE_CODE",
            "ProvinceCode",
            "provinceCode",
            "code",
            "CODE",
          ]) ?? "",
        ),
        id: num(pick(o, ["PROVINCE_ID", "ProvinceId", "provinceId", "id", "ID"])),
        name: String(
          pick<string>(o, [
            "PROVINCE_NAME",
            "ProvinceName",
            "provinceName",
            "name",
            "NAME",
          ]) ?? "",
        ),
      };
    })
    .filter((province) => province.id > 0 && province.name)
    .sort((left, right) => left.name.localeCompare(right.name, "vi"));
}

// GET /v3/categories/listProvinceNew (mới) hoặc /v2/categories/listProvince (cũ).
// Danh mục mới có fallback nội bộ giống bản GAS để module vẫn mở khi VTP chập chờn.
export async function vtpListProvinces(
  env: string,
  addressMode: "new" | "old" = "new",
): Promise<Ok<{ provinces: VtpProvince[]; source: "api" | "fallback" }> | Err> {
  try {
    const path =
      addressMode === "old"
        ? "/v2/categories/listProvince"
        : "/v3/categories/listProvinceNew";
    const res = await fetch(`${apiBase(env)}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(35_000),
    });
    const envelope = await readEnvelope(res);
    const provinces = normalizeProvinces(envelope.data ?? envelope);
    if (!provinces.length) throw new Error("Viettel Post trả danh mục tỉnh/thành rỗng.");
    return { ok: true, provinces, source: "api" };
  } catch (error) {
    if (addressMode === "new") {
      return {
        ok: true,
        provinces: NEW_PROVINCE_FALLBACK.map((item) => ({ ...item })),
        source: "fallback",
      };
    }
    return {
      error: errorText(error, "Không gọi được API Viettel Post (tỉnh/thành cũ)."),
      ok: false,
    };
  }
}

export async function vtpListDistricts(
  env: string,
  provinceId: number,
): Promise<Ok<{ districts: VtpDistrict[] }> | Err> {
  try {
    const res = await fetch(
      `${apiBase(env)}/v2/categories/listDistrict?provinceId=${encodeURIComponent(provinceId)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(35_000),
      },
    );
    const envelope = await readEnvelope(res);
    const districts = asArray(envelope.data ?? envelope)
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          id: num(pick(item, ["DISTRICT_ID", "DistrictId", "districtId", "id", "ID"])),
          name: String(
            pick<string>(item, [
              "DISTRICT_NAME",
              "DistrictName",
              "districtName",
              "name",
              "NAME",
            ]) ?? "",
          ),
          provinceId: num(
            pick(item, ["PROVINCE_ID", "ProvinceId", "provinceId"]),
          ),
        };
      })
      .filter((district) => district.id > 0 && district.name)
      .sort((left, right) => left.name.localeCompare(right.name, "vi"));
    if (!districts.length) {
      throw new Error("Viettel Post trả danh mục quận/huyện rỗng.");
    }
    return { districts, ok: true };
  } catch (error) {
    return {
      error: errorText(error, "Không gọi được API Viettel Post (quận/huyện)."),
      ok: false,
    };
  }
}

// Địa chỉ mới lấy ward theo province; địa chỉ cũ lấy ward theo district.
export async function vtpListWards(
  env: string,
  input:
    | number
    | {
        addressMode?: "new" | "old";
        districtId?: number;
        provinceId?: number;
      },
): Promise<Ok<{ wards: VtpWard[] }> | Err> {
  const request =
    typeof input === "number" ? { provinceId: input } : input;
  const addressMode = request.addressMode === "old" ? "old" : "new";
  const locationId =
    addressMode === "old" ? request.districtId : request.provinceId;
  if (!locationId) return { error: "Thiếu khu vực để tải phường/xã.", ok: false };
  const path =
    addressMode === "old"
      ? `/v2/categories/listWards?districtId=${encodeURIComponent(locationId)}`
      : `/v3/categories/listWardsNew?provinceId=${encodeURIComponent(locationId)}`;
  try {
    const res = await fetch(`${apiBase(env)}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(35_000),
    });
    const envelope = await readEnvelope(res);
    const wards = asArray(envelope.data ?? envelope)
      .map((r) => {
        const o = r as Record<string, unknown>;
        return {
          districtId: num(pick(o, ["DISTRICT_ID", "districtId", "DISTRICTID"])),
          districtName: String(pick<string>(o, ["DISTRICT_NAME", "districtName"]) ?? ""),
          id: num(pick(o, ["WARDS_ID", "WARD_ID", "wardId", "id", "ID"])),
          name: String(pick<string>(o, ["WARDS_NAME", "WARD_NAME", "wardName", "name", "NAME"]) ?? ""),
        };
      })
      .filter((w) => w.id > 0 && w.name);
    if (!wards.length) throw new Error("Viettel Post trả danh mục phường/xã rỗng.");
    return { ok: true, wards };
  } catch (error) {
    return {
      error: errorText(error, "Không gọi được API Viettel Post (phường/xã)."),
      ok: false,
    };
  }
}

export type PricePayload = {
  moneyCollection: number;
  productHeight: number;
  productLength: number;
  productPrice: number;
  productType: string;
  productWeight: number;
  productWidth: number;
  receiverDistrict: number;
  receiverProvince: number;
  receiverWard: number;
  senderDistrict: number;
  senderProvince: number;
  senderWard: number;
};

// POST /v2/order/getPriceAll — cần token. Trả danh sách dịch vụ + cước.
export async function vtpGetPriceAll(env: string, token: string, p: PricePayload): Promise<Ok<{ services: VtpService[] }> | Err> {
  try {
    const res = await fetch(`${apiBase(env)}/v2/order/getPriceAll`, {
      body: JSON.stringify({
        MONEY_COLLECTION: p.moneyCollection,
        PRODUCT_HEIGHT: p.productHeight,
        PRODUCT_LENGTH: p.productLength,
        PRODUCT_PRICE: p.productPrice,
        PRODUCT_TYPE: p.productType,
        PRODUCT_WEIGHT: p.productWeight,
        PRODUCT_WIDTH: p.productWidth,
        RECEIVER_DISTRICT: p.receiverDistrict,
        RECEIVER_PROVINCE: p.receiverProvince,
        RECEIVER_WARD: p.receiverWard,
        SENDER_DISTRICT: p.senderDistrict,
        SENDER_PROVINCE: p.senderProvince,
        SENDER_WARD: p.senderWard,
        TYPE: 1,
      }),
      cache: "no-store",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json;charset=UTF-8", Token: token },
      method: "POST",
      signal: AbortSignal.timeout(45_000),
    });
    const envelope = await readEnvelope(res);
    const rows = asArray(envelope.data ?? envelope);
    const services = rows
      .map((r) => {
        const o = r as Record<string, unknown>;
        const extraRaw = pick<unknown>(o, ["EXTRA_SERVICE", "EXTRA_SERVICES", "extraService"]);
        const extra = Array.isArray(extraRaw)
          ? extraRaw.map((e) => {
              const eo = e as Record<string, unknown>;
              return {
                code: String(pick<string>(eo, ["SERVICE_CODE", "EXTRA_CODE", "code"]) ?? ""),
                name: String(pick<string>(eo, ["SERVICE_NAME", "EXTRA_NAME", "name"]) ?? ""),
              };
            }).filter((e) => e.code)
          : [];
        return {
          code: String(pick<string>(o, ["MA_DV_CHINH", "SERVICE_CODE", "serviceCode", "code"]) ?? ""),
          eta: String(pick<string>(o, ["THOI_GIAN", "TIME", "eta"]) ?? ""),
          extra,
          fee: num(pick(o, ["GIA_CUOC", "MONEY_TOTAL", "TOTAL_PRICE", "fee", "PRICE"])),
          name: String(pick<string>(o, ["TEN_DICHVU", "SERVICE_NAME", "serviceName", "name"]) ?? ""),
        };
      })
      .filter((s) => s.code);
    return { ok: true, services };
  } catch (error) {
    return {
      error: errorText(error, "Không gọi được API Viettel Post (tính cước)."),
      ok: false,
    };
  }
}

export type CreateOrderPayload = {
  checkUnique: boolean;
  moneyCollection: number;
  note: string;
  orderNumber: string;
  orderPayment: number;
  orderService: string;
  orderServiceAdd: string;
  productHeight: number;
  productLength: number;
  productName: string;
  productPrice: number;
  productQuantity: number;
  productType: string;
  productWeight: number;
  productWidth: number;
  receiverAddress: string;
  receiverDistrict: number;
  receiverFullname: string;
  receiverPhone: string;
  receiverProvince: number;
  receiverWard: number;
  senderAddress: string;
  senderDistrict: number;
  senderFullname: string;
  senderPhone: string;
  senderProvince: number;
  senderWard: number;
};

// POST /v2/order/createOrder — cần token. Bám buildSendMailCreateOrderPayload_.
export async function vtpCreateOrder(env: string, token: string, p: CreateOrderPayload): Promise<Ok<VtpCreateResult> | Err> {
  const body = {
    CHECK_UNIQUE: p.checkUnique,
    LIST_ITEM: [
      {
        PRODUCT_NAME: p.productName,
        PRODUCT_PRICE: p.productPrice,
        PRODUCT_QUANTITY: p.productQuantity,
        PRODUCT_WEIGHT: p.productWeight,
      },
    ],
    MONEY_COLLECTION: p.moneyCollection,
    ORDER_NOTE: p.note,
    ORDER_NUMBER: p.orderNumber || undefined,
    ORDER_PAYMENT: p.orderPayment,
    ORDER_SERVICE: p.orderService,
    ORDER_SERVICE_ADD: p.orderServiceAdd || undefined,
    PRODUCT_HEIGHT: p.productHeight,
    PRODUCT_LENGTH: p.productLength,
    PRODUCT_NAME: p.productName,
    PRODUCT_PRICE: p.productPrice,
    PRODUCT_QUANTITY: p.productQuantity,
    PRODUCT_TYPE: p.productType,
    PRODUCT_WEIGHT: p.productWeight,
    PRODUCT_WIDTH: p.productWidth,
    RECEIVER_ADDRESS: p.receiverAddress,
    RECEIVER_DISTRICT: p.receiverDistrict,
    RECEIVER_FULLNAME: p.receiverFullname,
    RECEIVER_PHONE: p.receiverPhone,
    RECEIVER_PROVINCE: p.receiverProvince,
    RECEIVER_WARD: p.receiverWard,
    SENDER_ADDRESS: p.senderAddress,
    SENDER_DISTRICT: p.senderDistrict,
    SENDER_FULLNAME: p.senderFullname,
    SENDER_PHONE: p.senderPhone,
    SENDER_PROVINCE: p.senderProvince,
    SENDER_WARD: p.senderWard,
    TYPE: 1,
  };
  try {
    const res = await fetch(`${apiBase(env)}/v2/order/createOrder`, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json;charset=UTF-8", Token: token },
      method: "POST",
      signal: AbortSignal.timeout(60_000),
    });
    const json = await readEnvelope(res);
    const dataRaw = json?.data;
    const data = (Array.isArray(dataRaw) ? dataRaw[0] : dataRaw) as Record<string, unknown> | undefined;
    const orderNumber = String(pick<string>(data ?? {}, ["ORDER_NUMBER", "orderNumber"]) ?? "");
    if (!orderNumber) return { error: json?.message ? String(json.message) : "Không nhận được mã vận đơn.", ok: false };
    return {
      fee: num(pick(data ?? {}, ["MONEY_TOTAL", "MONEY_TOTAL_FEE", "TOTAL_PRICE"])),
      moneyCollection: num(pick(data ?? {}, ["MONEY_COLLECTION"])),
      ok: true,
      orderNumber,
      raw: json,
    };
  } catch (error) {
    return {
      error: errorText(error, "Không gọi được API Viettel Post (tạo đơn)."),
      ok: false,
    };
  }
}

function printUrls(printCode: string, showPostage: 0 | 1): VtpPrintLink[] {
  const base = "https://digitalize.viettelpost.vn/DigitalizePrint/report.do";
  return [
    { label: "Nhãn A5", type: "1" },
    { label: "Nhãn A6", type: "2" },
    { label: "Nhãn A6 biến thể", type: "a6_1" },
    { label: "Nhãn A7", type: "100" },
    { label: "Nhãn A7 biến thể", type: "1001" },
  ].map((item) => ({
    ...item,
    url: `${base}?type=${encodeURIComponent(item.type)}&bill=${encodeURIComponent(printCode)}&showPostage=${showPostage}`,
  }));
}

export async function vtpGetPrintLinks(
  env: string,
  token: string,
  orderNumbers: string[],
  showPostage: 0 | 1 = 1,
): Promise<Ok<{ links: VtpPrintLink[]; printCode: string }> | Err> {
  const orders = orderNumbers.map((item) => item.trim()).filter(Boolean);
  if (!orders.length) {
    return { error: "Thiếu mã vận đơn để lấy link in.", ok: false };
  }
  try {
    const response = await fetch(`${apiBase(env)}/v2/order/printing-code`, {
      body: JSON.stringify({
        EXPIRY_TIME: Date.now() + 24 * 60 * 60 * 1000,
        ORDER_ARRAY: orders,
      }),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json;charset=UTF-8",
        Token: token,
      },
      method: "POST",
      signal: AbortSignal.timeout(45_000),
    });
    const envelope = await readEnvelope(response);
    const data =
      envelope.data && typeof envelope.data === "object"
        ? (envelope.data as Record<string, unknown>)
        : {};
    const printCode = [
      typeof envelope.data === "string" ? envelope.data : "",
      pick<string>(data, ["message", "printCode", "PRINT_CODE", "code"]),
      envelope.message,
    ]
      .map((value) => String(value || "").trim())
      .find((value) => value && value.toUpperCase() !== "OK");
    if (!printCode) {
      return {
        error: "Viettel Post chưa trả mã in cho vận đơn vừa tạo.",
        ok: false,
      };
    }
    return {
      links: printUrls(printCode, showPostage),
      ok: true,
      printCode,
    };
  } catch (error) {
    return {
      error: errorText(error, "Không lấy được link in Viettel Post."),
      ok: false,
    };
  }
}

function textField(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  return String(pick<string>(row, keys) ?? "").trim();
}

function deliveredStatus(label: string, code: string) {
  const normalized = `${label} ${code}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return (
    normalized.includes("giao thanh cong") ||
    normalized.includes("phat thanh cong") ||
    normalized.includes("da giao") ||
    normalized.includes("delivered") ||
    code === "501"
  );
}

export async function vtpQueryTracking(
  env: string,
  token: string,
  orderNumber: string,
): Promise<Ok<{ tracking: VtpTracking }> | Err> {
  try {
    const response = await fetch(
      `${apiBase(env)}/v2/core/orders/query?code=${encodeURIComponent(orderNumber)}`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          Token: token,
        },
        signal: AbortSignal.timeout(45_000),
      },
    );
    const envelope = await readEnvelope(response);
    const rows = asArray(envelope.data ?? envelope);
    const source =
      (rows.find((row) => {
        const candidate = textField(row, [
          "ORDER_NUMBER",
          "OrderNumber",
          "orderNumber",
          "ORDER_CODE",
          "orderCode",
          "MA_VAN_DON",
          "code",
        ]);
        return candidate.replace(/\W/g, "").toUpperCase() ===
          orderNumber.replace(/\W/g, "").toUpperCase();
      }) ||
        rows[0] ||
        (envelope.data && typeof envelope.data === "object"
          ? envelope.data
          : null)) as Record<string, unknown> | null;
    if (!source) {
      return {
        error: `Viettel Post chưa trả trạng thái vận đơn ${orderNumber}.`,
        ok: false,
      };
    }
    const statusLabel = textField(source, [
      "ORDER_STATUS_NAME",
      "STATUS_NAME",
      "ORDER_STATUS_TEXT",
      "STATUS_TEXT",
      "STATUS_DESCRIPTION",
      "statusName",
      "statusText",
      "description",
      "message",
    ]);
    let statusCode = textField(source, [
      "ORDER_STATUS",
      "ORDER_STATUS_CODE",
      "STATUS_CODE",
      "STATUS_ID",
      "statusCode",
      "statusId",
    ]);
    const statusRaw = textField(source, ["STATUS", "status"]);
    const label = statusLabel || (/\D/.test(statusRaw) ? statusRaw : "");
    if (!statusCode && /^\d+$/.test(statusRaw)) statusCode = statusRaw;
    return {
      ok: true,
      tracking: {
        delivered: deliveredStatus(label, statusCode),
        orderNumber,
        raw: source,
        statusCode,
        statusLabel: label || statusCode || "Không rõ trạng thái",
      },
    };
  } catch (error) {
    return {
      error: errorText(error, "Không dò được trạng thái Viettel Post."),
      ok: false,
    };
  }
}
