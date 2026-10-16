// Tích hợp Eshop (mShopKeeper) — bám refreshGlobalEshopOpenPlatformToken bản cũ.
import { createHmac } from "node:crypto";

const AUTH_BASE = "https://graphapi.mshopkeeper.vn/auth";

type Result = { ok: true; token: string } | { error: string; ok: false };

// Lấy token OpenPlatform: POST /api/Account/Login với SignatureInfo = HMAC-SHA256(loginData, apiSecret).
// Thử ký dạng hex rồi base64 (giống bản cũ).
export async function eshopOpenPlatformToken(apiDomain: string, apiAppId: string, apiSecret: string): Promise<Result> {
  const loginTime = new Date().toISOString();
  const loginData = JSON.stringify({ AppID: apiAppId, Domain: apiDomain, LoginTime: loginTime });
  const signatures = [
    createHmac("sha256", apiSecret).update(loginData).digest("hex"),
    createHmac("sha256", apiSecret).update(loginData).digest("base64"),
  ];

  let lastErr = "Không lấy được token Eshop.";
  for (const sig of signatures) {
    try {
      const res = await fetch(`${AUTH_BASE}/api/Account/Login`, {
        body: JSON.stringify({ AppID: apiAppId, Domain: apiDomain, LoginTime: loginTime, SignatureInfo: sig }),
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        lastErr = `Đăng nhập Eshop lỗi ${res.status}.`;
        continue;
      }
      const data = (await res.json()) as {
        Data?: Record<string, unknown> | string;
        data?: Record<string, unknown> | string;
      };
      let raw = data.Data ?? data.data ?? {};
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          raw = {};
        }
      }
      const d = raw;
      const token = d.AccessToken ?? d.Token ?? d.access_token;
      if (token) return { ok: true, token: String(token) };
      lastErr = "Phản hồi không có token (kiểm tra Domain/AppID/Secret).";
    } catch (error) {
      lastErr =
        error instanceof Error ? error.message : "Không gọi được API Eshop.";
    }
  }
  return { error: lastErr, ok: false };
}
