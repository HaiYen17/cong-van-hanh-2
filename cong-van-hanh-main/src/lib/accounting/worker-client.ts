import { AccountingRpcError, type JsonObject } from "@/lib/accounting/types";

type WorkerRequestOptions = {
  method?: "GET" | "POST";
  secret?: string;
  timeoutMs?: number;
  url?: string;
  retryTransient?: boolean;
};

function transientWorkerStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(15_000, retryAfter * 1_000);
  }
  return Math.min(8_000, 650 * 2 ** attempt + Math.floor(Math.random() * 250));
}

function configuredWorkerUrl(override = "") {
  const raw = (override || process.env.ACCOUNTING_WORKER_URL || "").trim();
  if (!raw) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AccountingRpcError("Địa chỉ worker Kế toán không hợp lệ.");
  }
  const local =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new AccountingRpcError(
      "Worker Kế toán phải dùng HTTPS; HTTP chỉ được phép khi phát triển local.",
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function configuredWorkerSecret(override = "") {
  return (override || process.env.ACCOUNTING_WORKER_SECRET || "").trim();
}

export function accountingWorkerConfig() {
  const workerUrl = configuredWorkerUrl();
  const workerSecret = configuredWorkerSecret();
  return {
    configured: Boolean(workerUrl && workerSecret),
    secretConfigured: Boolean(workerSecret),
    secretPreview: workerSecret
      ? `••••${workerSecret.slice(Math.max(0, workerSecret.length - 4))}`
      : "",
    urlConfigured: Boolean(workerUrl),
    workerUrl,
  };
}

async function cloudRunIdentityToken(audience: string) {
  if (process.env.ACCOUNTING_WORKER_USE_ID_TOKEN !== "true") {
    return "";
  }
  const endpoint = new URL(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity",
  );
  endpoint.searchParams.set("audience", audience);
  endpoint.searchParams.set("format", "full");
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new AccountingRpcError(
      "Không lấy được danh tính dịch vụ để gọi worker Kế toán.",
      503,
    );
  }
  return (await response.text()).trim();
}

export async function callAccountingWorker(
  path: string,
  payload: JsonObject = {},
  options: WorkerRequestOptions = {},
) {
  const workerUrl = configuredWorkerUrl(options.url);
  const workerSecret = configuredWorkerSecret(options.secret);
  if (!workerUrl || !workerSecret) {
    throw new AccountingRpcError(
      "Worker Kế toán chưa được cấu hình trong Google Cloud Secret Manager.",
      503,
    );
  }

  const productionOverride =
    process.env.NODE_ENV === "production" &&
    ((options.url && options.url.trim() !== process.env.ACCOUNTING_WORKER_URL) ||
      (options.secret &&
        options.secret.trim() !== process.env.ACCOUNTING_WORKER_SECRET));
  if (productionOverride) {
    throw new AccountingRpcError(
      "Kết nối worker production được khóa bằng Secret Manager; không thể đổi trực tiếp từ trình duyệt.",
      409,
    );
  }

  const endpoint = `${workerUrl}/${path.replace(/^\/+/, "")}`;
  const identityToken = await cloudRunIdentityToken(workerUrl);
  const method = options.method || "POST";
  let response: Response | undefined;
  const maxAttempts = options.retryTransient ? 3 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      response = await fetch(endpoint, {
        body: method === "POST" ? JSON.stringify(payload) : undefined,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${identityToken || workerSecret}`,
          "X-Accounting-Worker-Secret": workerSecret,
        },
        method,
        signal: AbortSignal.timeout(
          options.timeoutMs ||
            Number(process.env.ACCOUNTING_WORKER_TIMEOUT_MS || 120_000),
        ),
      });
    } catch (error) {
      if (attempt + 1 < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 650 * 2 ** attempt));
        continue;
      }
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "Worker Kế toán phản hồi quá thời gian cho phép."
          : "Không kết nối được worker Kế toán.";
      throw new AccountingRpcError(message, 503);
    }
    if (
      response.ok ||
      !options.retryTransient ||
      !transientWorkerStatus(response.status) ||
      attempt + 1 >= maxAttempts
    ) {
      break;
    }
    await response.body?.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response!, attempt)));
  }
  if (!response) {
    throw new AccountingRpcError("Không kết nối được worker Kế toán.", 503);
  }

  const contentType = response.headers.get("content-type") || "";
  const body: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String(body.detail)
        : body && typeof body === "object" && "message" in body
          ? String(body.message)
          : typeof body === "string" && body.trim()
            ? body.trim().slice(0, 300)
            : `Worker trả mã HTTP ${response.status}.`;
    throw new AccountingRpcError(
      response.status === 429 || detail.toLowerCase().includes("rate exceeded")
        ? "Bộ xử lý Kế toán đang bận. Hệ thống đã tự thử lại nhưng chưa có lượt xử lý; dữ liệu và bản xem trước vẫn được giữ nguyên."
        : detail,
      response.status,
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AccountingRpcError(
      "Worker Kế toán trả dữ liệu không đúng hợp đồng.",
      502,
    );
  }
  return body as JsonObject;
}
