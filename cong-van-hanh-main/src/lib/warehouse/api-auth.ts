import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { getModuleConfigSecret } from "@/lib/config/global-config";

import { extractWarehouseApiKey } from "./inventory";

export class WarehouseApiAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WarehouseApiAuthError";
  }
}

function secureEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

export async function assertWarehouseApiRequest(
  request: Request,
  payload?: unknown,
) {
  const configuredKey = await getModuleConfigSecret(
    "warehouseKts.androidApiKey",
  );
  if (!configuredKey) {
    throw new WarehouseApiAuthError(
      "Chưa cấu hình Android RFID API key trong Cấu hình Tổng.",
      503,
    );
  }
  const suppliedKey =
    extractWarehouseApiKey(payload) ||
    String(request.headers.get("x-api-key") || "").trim() ||
    String(request.headers.get("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
  if (!suppliedKey || !secureEqual(suppliedKey, configuredKey)) {
    throw new WarehouseApiAuthError("RFID API key không hợp lệ.", 401);
  }
}
