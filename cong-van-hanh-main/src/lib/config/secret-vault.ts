import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "enc:v1";
const AAD = Buffer.from("thuan-viet-global-config:v1", "utf8");

function encryptionKey() {
  const configured = String(process.env.CONFIG_SECRET_ENCRYPTION_KEY || "").trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Google Cloud Secret Manager chưa cấp CONFIG_SECRET_ENCRYPTION_KEY.",
      );
    }
    return createHash("sha256")
      .update("thuan-viet-local-development-config-secret")
      .digest();
  }

  return createHash("sha256").update(configured, "utf8").digest();
}

export function sealConfigSecret(value: string | null | undefined) {
  const plainText = String(value || "").trim();
  if (!plainText) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function openConfigSecret(value: string | null | undefined) {
  const stored = String(value || "").trim();
  if (!stored) return "";

  // Tương thích dữ liệu V3 dựng tạm trước đây đang lưu plain text.
  if (!stored.startsWith(`${PREFIX}:`)) return stored;

  const parts = stored.split(":");
  if (parts.length !== 5) {
    throw new Error("Secret cấu hình có định dạng không hợp lệ.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(parts[2], "base64url"),
  );
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(parts[3], "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(parts[4], "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hasConfigSecret(value: string | null | undefined) {
  return Boolean(String(value || "").trim());
}

export function previewConfigSecret(value: string | null | undefined) {
  const text = openConfigSecret(value);
  if (!text) return "";
  if (text.length <= 12) return `${text.slice(0, 3)}...${text.slice(-2)}`;
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}
