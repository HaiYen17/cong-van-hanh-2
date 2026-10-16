import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { openConfigSecret, sealConfigSecret } from "@/lib/config/secret-vault";
import { objectValue } from "@/lib/requests/digital-signature-policy";

export const misaText = (value: unknown) => typeof value === "string" ? value.trim() : "";
export function misaField(value: unknown, name: string): unknown {
  const row = objectValue(value);
  const key = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
  return key ? row[key] : undefined;
}
export function misaData(value: unknown): unknown {
  const data = misaField(value, "data");
  if (typeof data === "string" && /^[\[{]/.test(data.trim())) {
    try { return JSON.parse(data); } catch { /* leave as string */ }
  }
  return data ?? value;
}
export function misaDocument(value: unknown): Record<string, unknown> {
  const data = misaData(value);
  const docs = misaField(data, "pdfDocs") ?? misaField(data, "documents") ?? data;
  return objectValue(Array.isArray(docs) ? docs[0] : docs);
}
export class MisaError extends Error {
  constructor(message: string, public readonly ambiguous = false, public readonly otpRequired = false) { super(message); }
}
type Config = { baseUrl: string; clientId: string; clientSecret: string; userName: string; password: string };
type Session = { token: string; refreshToken: string; userId: string; expiresAt: number; fingerprint: string };
const SESSION_KEY = "esign.runtime.session";
async function config(): Promise<Config> {
  const settings = await getDb().systemSetting.findMany({ where: { key: { in: [
    "esign.baseUrl", "esign.clientId", "esign.clientSecret", "esign.userName", "esign.password",
  ] } } });
  const values = new Map(settings.map((s) => [s.key, s.value || ""]));
  const c = {
    baseUrl: (values.get("esign.baseUrl") || "").replace(/\/+$/, ""),
    clientId: openConfigSecret(values.get("esign.clientId")), clientSecret: openConfigSecret(values.get("esign.clientSecret")),
    userName: values.get("esign.userName") || "", password: openConfigSecret(values.get("esign.password")),
  };
  if (Object.values(c).some((value) => !value)) throw new MisaError("Chưa đủ tài khoản MISA eSign trong Cấu hình Tổng.");
  let url: URL;
  try { url = new URL(c.baseUrl); } catch { throw new MisaError("Base URL MISA eSign chưa hợp lệ."); }
  if (url.protocol !== "https:" || !/(^|\.)misa\.vn$/i.test(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new MisaError("Base URL ký số phải là HTTPS trên tên miền MISA cấp thuộc misa.vn.");
  }
  return c;
}
const fingerprint = (c: Config) => createHash("sha256").update(JSON.stringify(c)).digest("hex");

export async function misaRequest(c: Config, path: string, body?: unknown, token?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${c.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json", ClientID: c.clientId,
        ClientSecret: c.clientSecret, ...(token ? { AuthorizationRM: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45_000),
    });
  } catch { throw new MisaError("Không nhận được phản hồi MISA eSign. Giao dịch cần được kiểm tra lại.", true); }
  const raw = await response.json().catch(() => null);
  const code = misaField(raw, "errorCode") ?? misaField(raw, "statusCode") ?? misaField(raw, "code");
  if (Number(code) === 122) throw new MisaError("MISA eSign yêu cầu OTP. Mở Cấu hình Tổng → MISA eSign để xác thực.", false, true);
  if (!response.ok || raw === null || misaField(raw, "success") === false || misaField(raw, "isSuccess") === false) {
    // Provider payloads can include tokens or document bytes; do not echo them.
    throw new MisaError(`MISA eSign trả lỗi HTTP ${response.status}${typeof code === "number" ? ` (mã ${code})` : ""}.`, response.status >= 500 || raw === null);
  }
  return misaData(raw);
}

async function saveSession(c: Config, raw: unknown, previous?: Session) {
  const data = misaData(raw);
  const token = misaText(misaField(data, "remoteSigningAccessToken"));
  const userId = misaText(misaField(misaField(data, "user"), "id")) || misaText(misaField(data, "userId")) || previous?.userId || "";
  if (!token || !userId) throw new MisaError("MISA chưa trả token ký và UserId. Hoàn tất xác thực OTP trong Cấu hình Tổng.", false, true);
  const seconds = Number(misaField(data, "expiresIn"));
  const session: Session = { token, userId, refreshToken: misaText(misaField(data, "refreshToken")) || previous?.refreshToken || "",
    expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 300) * 1000,
    fingerprint: fingerprint(c) };
  const value = sealConfigSecret(JSON.stringify(session));
  await getDb().systemSetting.upsert({ where: { key: SESSION_KEY }, create: { key: SESSION_KEY, value }, update: { value } });
  return session;
}

async function storedSession(c: Config) {
  const row = await getDb().systemSetting.findUnique({ where: { key: SESSION_KEY } });
  try {
    const session = JSON.parse(openConfigSecret(row?.value)) as Session;
    return session.fingerprint === fingerprint(c) ? session : null;
  } catch { return null; }
}

export async function misaSession() {
  const c = await config();
  const stored = await storedSession(c);
  if (stored?.token && stored.expiresAt > Date.now() + 60_000) return { config: c, ...stored };
  if (stored?.refreshToken) {
    try {
      const raw = await misaRequest(c, "/esign/v1/auth/refreshtoken", { refreshToken: stored.refreshToken });
      return { config: c, ...await saveSession(c, raw, stored) };
    } catch (error) { if (error instanceof MisaError && error.ambiguous) throw error; }
  }
  const raw = await misaRequest(c, "/esign/v1/auth/login-api", { userName: c.userName, password: c.password });
  return { config: c, ...await saveSession(c, raw) };
}

export async function misaAuthenticate(action: string, code?: string, otpType = 0) {
  const c = await config();
  if (action === "resend") {
    await misaRequest(c, "/esign/v1/auth/resend-otp-auth", { userName: c.userName, language: "vi-VN" });
    return { message: "MISA đã nhận yêu cầu gửi lại OTP.", otpRequired: true };
  }
  try {
    if (action === "otp") {
      if (!/^\d{4,10}$/.test(code || "") || ![0, 1].includes(otpType)) throw new Error("Nhập mã OTP hợp lệ.");
      const raw = await misaRequest(c, "/esign/v1/auth/two-factor-auth", { userName: c.userName, code, otpType, remember: true });
      await saveSession(c, raw, await storedSession(c) || undefined);
    } else { await misaSession(); }
    return { message: "Đã kết nối tài khoản MISA eSign.", otpRequired: false };
  } catch (error) {
    if (error instanceof MisaError && error.otpRequired) return { message: error.message, otpRequired: true };
    throw error;
  }
}

export async function misaCertificates() {
  const session = await misaSession();
  const raw = await misaRequest(session.config, "/esign/v1/certificates/by-userId", undefined, session.token);
  const list = Array.isArray(raw) ? raw : misaField(raw, "certificates") ?? misaField(raw, "items");
  if (!Array.isArray(list)) throw new MisaError("Danh sách chứng thư MISA chưa đúng cấu trúc phản hồi.");
  return { session, certificates: list.map(objectValue) };
}

export async function misaCertificate(certAlias: string) {
  const { session, certificates } = await misaCertificates();
  const selected = certificates.find((cert) => misaText(misaField(cert, "keyAlias")) === certAlias);
  if (!selected || misaText(misaField(selected, "keyStatus")).toUpperCase() !== "ACTIVE") {
    throw new MisaError("Chứng thư đã cấu hình không nằm trong danh sách ACTIVE của tài khoản MISA.");
  }
  const detail = await misaRequest(session.config, `/esign/v1/certificates/by-certId?certAlias=${encodeURIComponent(certAlias)}`, undefined, session.token);
  const certificate = misaText(misaField(detail, "certificate"));
  const certificateChain = misaField(detail, "certificateChain");
  if (!certificate || !Array.isArray(certificateChain) || !certificateChain.every((item) => typeof item === "string")) {
    throw new MisaError("MISA chưa trả đủ certificate và certificateChain.");
  }
  return { session, certificate, certificateChain: certificateChain as string[] };
}
