const BASE: Record<string, string> = {
  DEV: "https://partnerdev.viettelpost.vn",
  PROD: "https://partner.viettelpost.vn",
};

const DASHBOARD_BASE = "https://api.viettelpost.vn";
const DASHBOARD_ORDER_PATH = "/api/supperapp/get-list-order-by-status-v2";
const ORDER_STATUSES =
  "-100,-101,-102,-108,-109,-110,100,101,102,103,104,105,107,200,201,202,300,301,302,303,320,400,500,501,502,503,504,505,506,507,508,509,515,550,551,570,516,517";

export function vtpBaseUrl(env: string): string {
  return env === "DEV" ? BASE.DEV : BASE.PROD;
}

type Ok<T> = { ok: true } & T;
type Err = { error: string; ok: false };

export type VtpApiDiagnostic = {
  completedAt: string;
  endpoint: string;
  request: {
    body: Record<string, unknown>;
    headers: Record<string, string>;
    method: "POST";
  };
  response: {
    body: unknown;
    httpStatus: number | null;
    statusText: string;
  };
  step: "partner-login" | "owner-connect";
};

type TokenResult =
  | Ok<{ diagnostic: VtpApiDiagnostic; token: string }>
  | (Err & { diagnostic: VtpApiDiagnostic });

const REDACTED = "[Đã che]";
const SENSITIVE_KEY =
  /(password|passcode|authorization|cookie|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|(^|[-_])token($|[-_])|jwt)/i;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g;
const OPAQUE_SECRET_VALUE = /^[A-Za-z0-9+/_=.-]{48,}$/;

export function redactVtpDiagnosticValue(
  value: unknown,
  key = "",
): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (Array.isArray(value)) {
    return value.map((item) => redactVtpDiagnosticValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [
        childKey,
        redactVtpDiagnosticValue(item, childKey),
      ]),
    );
  }
  if (typeof value === "string") {
    if (OPAQUE_SECRET_VALUE.test(value.trim())) return REDACTED;
    return value.replace(JWT_VALUE, REDACTED);
  }
  return value;
}

function tokenDiagnostic(
  endpoint: string,
  step: VtpApiDiagnostic["step"],
  username: string,
  response?: Response,
  responseBody?: unknown,
  hasPartnerToken = false,
): VtpApiDiagnostic {
  return {
    completedAt: new Date().toISOString(),
    endpoint,
    request: {
      body: {
        PASSWORD: REDACTED,
        USERNAME: username,
      },
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json;charset=UTF-8",
        ...(hasPartnerToken ? { Token: REDACTED } : {}),
      },
      method: "POST",
    },
    response: {
      body: redactVtpDiagnosticValue(responseBody ?? {}),
      httpStatus: response?.status ?? null,
      statusText: response?.statusText ?? "",
    },
    step,
  };
}

async function readTokenResponse(
  response: Response,
  endpoint: string,
  step: VtpApiDiagnostic["step"],
  username: string,
  hasPartnerToken = false,
) {
  const text = await response.text();
  let json: unknown = {};
  let parseError = "";
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      parseError = "Viettel Post trả dữ liệu không phải JSON hợp lệ.";
      json = { raw: text.slice(0, 4_000) };
    }
  }
  const diagnostic = tokenDiagnostic(
    endpoint,
    step,
    username,
    response,
    json,
    hasPartnerToken,
  );
  if (parseError) {
    return {
      diagnostic,
      error: `${parseError} (HTTP ${response.status}).`,
      json,
    };
  }
  if (!response.ok) {
    return {
      diagnostic,
      error: `Viettel Post lỗi HTTP ${response.status}: ${errorText(json, "Không rõ lỗi.")}`,
      json,
    };
  }
  return { diagnostic, error: "", json };
}

function errorText(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Record<string, unknown>;
  const body =
    row.body && typeof row.body === "object"
      ? (row.body as Record<string, unknown>)
      : {};
  const candidate =
    row.message ??
    row.Message ??
    row.errorMessage ??
    row.msg ??
    body.message ??
    body.Message ??
    body.errorMessage ??
    body.msg;
  return candidate ? String(candidate) : fallback;
}

function pickToken(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const direct = typeof root.data === "string" ? root.data : "";
  const first =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : {};
  const second =
    first.data && typeof first.data === "object"
      ? (first.data as Record<string, unknown>)
      : {};
  const value =
    direct ||
    first.token ||
    first.TOKEN ||
    first.Token ||
    first.access_token ||
    first.accessToken ||
    first.shortToken ||
    first.longToken ||
    second.token ||
    second.TOKEN ||
    second.accessToken ||
    root.token ||
    root.TOKEN ||
    root.accessToken;
  return value ? String(value).trim() : null;
}

function timeoutSignal(ms: number) {
  return AbortSignal.timeout(ms);
}

async function jsonResponse(response: Response) {
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Viettel Post trả dữ liệu không hợp lệ (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Viettel Post lỗi HTTP ${response.status}: ${errorText(json, "Không rõ lỗi.")}`,
    );
  }
  return json;
}

export async function vtpShortToken(
  env: string,
  username: string,
  password: string,
): Promise<TokenResult> {
  const endpoint = `${vtpBaseUrl(env)}/v2/user/Login`;
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({ PASSWORD: password, USERNAME: username }),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json;charset=UTF-8",
      },
      method: "POST",
      signal: timeoutSignal(35_000),
    });
    const parsed = await readTokenResponse(
      response,
      endpoint,
      "partner-login",
      username,
    );
    if (parsed.error) {
      return {
        diagnostic: parsed.diagnostic,
        error: parsed.error,
        ok: false,
      };
    }
    const token = pickToken(parsed.json);
    if (!token) {
      return {
        diagnostic: parsed.diagnostic,
        error: "Viettel Post không trả về token ngắn hạn.",
        ok: false,
      };
    }
    return { diagnostic: parsed.diagnostic, ok: true, token };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không gọi được API Viettel Post.";
    return {
      diagnostic: tokenDiagnostic(endpoint, "partner-login", username, undefined, {
        networkError: message,
      }),
      error: message,
      ok: false,
    };
  }
}

export async function vtpLongTokenFromShort(
  env: string,
  username: string,
  password: string,
  shortToken: string,
): Promise<TokenResult> {
  const endpoint = `${vtpBaseUrl(env)}/v2/user/ownerconnect`;
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({ PASSWORD: password, USERNAME: username }),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json;charset=UTF-8",
        Token: shortToken,
      },
      method: "POST",
      signal: timeoutSignal(35_000),
    });
    const parsed = await readTokenResponse(
      response,
      endpoint,
      "owner-connect",
      username,
      true,
    );
    if (parsed.error) {
      return {
        diagnostic: parsed.diagnostic,
        error: parsed.error,
        ok: false,
      };
    }
    const token = pickToken(parsed.json);
    if (!token) {
      return {
        diagnostic: parsed.diagnostic,
        error: "API ownerconnect không trả về token dài hạn.",
        ok: false,
      };
    }
    return { diagnostic: parsed.diagnostic, ok: true, token };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không gọi được API Viettel Post (ownerconnect).";
    return {
      diagnostic: tokenDiagnostic(
        endpoint,
        "owner-connect",
        username,
        undefined,
        { networkError: message },
        true,
      ),
      error: message,
      ok: false,
    };
  }
}

export async function vtpLongToken(
  env: string,
  username: string,
  password: string,
): Promise<Ok<{ token: string }> | Err> {
  const short = await vtpShortToken(env, username, password);
  if (!short.ok) return short;
  return vtpLongTokenFromShort(env, username, password, short.token);
}

function extractPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  return row.body ?? row.data ?? row.Data ?? row.result ?? row.Result ?? value;
}

function extractList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const keys = [
    "data",
    "Data",
    "items",
    "Items",
    "rows",
    "Rows",
    "list",
    "List",
    "content",
    "result",
    "orders",
    "order",
    "lstData",
    "dataList",
    "LIST_ORDER",
    "ListOrder",
    "listOrder",
  ];
  for (const key of keys) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  for (const key of keys) {
    const nested = extractList(row[key]);
    if (nested.length) return nested;
  }
  return [];
}

function firstText(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const text = String(row[key] ?? "").trim();
    if (text) return text;
  }
  return "";
}

export async function vtpTestProvince(
  env: string,
  token?: string | null,
): Promise<Ok<{ count: number; sample: string }> | Err> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) {
      headers.Token = token;
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(
      `${vtpBaseUrl(env)}/v2/categories/listProvince`,
      {
        cache: "no-store",
        headers,
        signal: timeoutSignal(35_000),
      },
    );
    const rows = extractList(extractPayload(await jsonResponse(response)));
    return {
      count: rows.length,
      ok: true,
      sample: firstText(rows[0], [
        "PROVINCE_NAME",
        "provinceName",
        "NAME",
        "name",
      ]),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Không gọi được API Viettel Post.",
      ok: false,
    };
  }
}

function orderSample(value: unknown) {
  return firstText(value, [
    "ORDER_NUMBER",
    "OrderNumber",
    "orderNumber",
    "ORDER_CODE",
    "OrderCode",
    "orderCode",
    "MA_VAN_DON",
    "billCode",
    "BillCode",
    "CODE",
    "code",
  ]);
}

function dateVn(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

export async function vtpTestOrders(input: {
  dashboardToken?: string;
  env: "DEV" | "PROD";
  orderCode?: string;
  token?: string;
}): Promise<
  | Ok<{
      mode: "detail" | "list";
      returned: number;
      sample: string;
      total: number;
    }>
  | Err
> {
  try {
    const orderCode = String(input.orderCode || "").trim();
    if (orderCode) {
      if (!input.token) {
        return {
          error: "Cần API token dài hạn để kiểm tra chi tiết mã vận đơn.",
          ok: false,
        };
      }
      const response = await fetch(
        `${vtpBaseUrl(input.env)}/v2/core/orders/query?code=${encodeURIComponent(orderCode)}`,
        {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${input.token}`,
            Token: input.token,
          },
          signal: timeoutSignal(45_000),
        },
      );
      const payload = extractPayload(await jsonResponse(response));
      const rows = extractList(payload);
      const first =
        rows[0] ??
        (payload && typeof payload === "object" ? payload : undefined);
      return {
        mode: "detail",
        ok: true,
        returned: first ? 1 : 0,
        sample: orderSample(first) || orderCode,
        total: first ? 1 : 0,
      };
    }

    const now = new Date();
    const from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const useDashboard = Boolean(input.dashboardToken);
    const url = useDashboard
      ? `${DASHBOARD_BASE}${DASHBOARD_ORDER_PATH}`
      : `${vtpBaseUrl(input.env)}/v2/order/order-filter?page=1`;
    const token = useDashboard ? input.dashboardToken : input.token;
    if (!token) {
      return {
        error: "Thiếu API token Viettel Post để lấy danh sách đơn.",
        ok: false,
      };
    }
    const body = useDashboard
      ? {
          COD_STATUS: null,
          DATE_FROM: dateVn(from),
          DATE_TO: dateVn(now),
          INVENTORY: null,
          IS_FAST_DELIVERY: "",
          ORDER_PAYMENT: "",
          ORDER_PAYMENT_TYPE: "",
          ORDER_PROPERTIES: "",
          ORDER_STATUS: ORDER_STATUSES,
          PAGE_INDEX: 1,
          PAGE_SIZE: 100,
          REASON_RETURN: null,
          SOURCE: "WEB",
          TYPE: 0,
          deviceId: "",
        }
      : {
          filter: "",
          from_date: dateVn(from),
          limit: 100,
          list_inventory: [],
          list_status: [],
          page_size: 100,
          to_date: dateVn(now),
        };
    const response = await fetch(url, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json;charset=UTF-8",
        ...(useDashboard
          ? {
              Origin: "https://viettelpost.vn",
              Referer: "https://viettelpost.vn/",
            }
          : {}),
        Token: token,
      },
      method: "POST",
      signal: timeoutSignal(45_000),
    });
    const json = await jsonResponse(response);
    const payload = extractPayload(json);
    const rows = extractList(payload);
    const root =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const total = Number(
      root.total ??
        root.Total ??
        root.TOTAL ??
        root.totalRecord ??
        root.totalRecords ??
        root.TOTAL_ORDER ??
        rows.length,
    );
    return {
      mode: "list",
      ok: true,
      returned: rows.length,
      sample: orderSample(rows[0]),
      total: Number.isFinite(total) ? total : rows.length,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Không gọi được API Viettel Post.",
      ok: false,
    };
  }
}

export async function vtpTestOrder(
  env: string,
  token: string,
  orderCode: string,
): Promise<Ok<{ found: boolean }> | Err> {
  const result = await vtpTestOrders({
    env: env === "DEV" ? "DEV" : "PROD",
    orderCode,
    token,
  });
  if (!result.ok) return result;
  return { found: result.returned > 0, ok: true };
}
