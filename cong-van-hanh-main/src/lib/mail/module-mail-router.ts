import "server-only";

import { randomUUID } from "node:crypto";

import { GoogleAuth } from "google-auth-library";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const IAM_SIGN_JWT_BASE_URL =
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/";

export type ModuleMailRoute = {
  moduleKey: string;
  provider: "gmail-workspace";
  senderEmail: string;
  senderName: string;
};

export type ModuleMailMessage = {
  attachments?: ModuleMailAttachment[];
  bcc?: string[] | string;
  cc?: string[] | string;
  htmlBody?: string;
  replyTo?: string;
  senderName?: string;
  subject: string;
  textBody?: string;
  to: string[] | string;
};

export type ModuleMailAttachment = {
  content: Buffer | Uint8Array;
  contentType?: string;
  fileName: string;
};

const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

const ROUTES: Record<string, Omit<ModuleMailRoute, "moduleKey" | "provider">> = {
  evaluation: {
    senderEmail: "ns.cnb@nemthuanviet.vn",
    senderName: "Thuần Việt - Nhân sự CnB",
  },
  "evaluation-config": {
    senderEmail: "ns.cnb@nemthuanviet.vn",
    senderName: "Thuần Việt - Nhân sự CnB",
  },
  "candidate-management": {
    senderEmail: "ns.tuyendung@nemthuanviet.vn",
    senderName: "Thuần Việt - Tuyển dụng",
  },
  "candidate-assessment": {
    senderEmail: "ns.tuyendung@nemthuanviet.vn",
    senderName: "Thuần Việt - Tuyển dụng",
  },
  "candidate-results": {
    senderEmail: "ns.tuyendung@nemthuanviet.vn",
    senderName: "Thuần Việt - Tuyển dụng",
  },
  default: {
    senderEmail: "admin@nemthuanviet.vn",
    senderName: "Thuần Việt - Hệ thống",
  },
};

const ALLOWED_SENDERS = new Set(
  Object.values(ROUTES).map((route) => route.senderEmail),
);

const mailAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

let cachedDelegatedToken:
  | { expiresAt: number; senderEmail: string; token: string }
  | undefined;

function normalizeModuleKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeHeader(value: unknown) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmail(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

function recipients(value: string[] | string | undefined, required: boolean) {
  const input = Array.isArray(value)
    ? value
    : String(value || "").split(/[;,]/g);
  const result: string[] = [];
  for (const item of input) {
    const email = normalizeEmail(item);
    if (!email) continue;
    if (!isEmail(email)) throw new Error(`Địa chỉ email không hợp lệ: ${email}`);
    if (!result.includes(email)) result.push(email);
  }
  if (required && !result.length) {
    throw new Error("Email cần ít nhất một người nhận.");
  }
  return result;
}

function optionalEmail(value: unknown) {
  const email = normalizeEmail(value);
  if (!email) return "";
  if (!isEmail(email)) throw new Error("Địa chỉ Reply-To không hợp lệ.");
  return email;
}

function stripHtml(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function base64(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function encodedHeader(value: string) {
  return `=?UTF-8?B?${base64(sanitizeHeader(value))}?=`;
}

function encodedBody(value: string) {
  return base64(value).replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/g, "");
}

function sanitizeAttachmentFileName(value: unknown) {
  const fileName = String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (!fileName) throw new Error("File đính kèm cần có tên.");
  return fileName;
}

function normalizeAttachmentContentType(value: unknown) {
  const contentType = String(value || "application/octet-stream")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)) {
    throw new Error("Định dạng file đính kèm không hợp lệ.");
  }
  return contentType;
}

function normalizeAttachments(value: ModuleMailAttachment[] | undefined) {
  const attachments = (Array.isArray(value) ? value : []).map((attachment) => {
    const content = Buffer.from(attachment.content);
    if (!content.length) throw new Error("File đính kèm đang rỗng.");
    if (content.length > MAX_ATTACHMENT_BYTES) {
      throw new Error("File đính kèm vượt quá giới hạn 18 MB của hệ thống mail.");
    }
    return {
      content,
      contentType: normalizeAttachmentContentType(attachment.contentType),
      fileName: sanitizeAttachmentFileName(attachment.fileName),
    };
  });
  const totalBytes = attachments.reduce(
    (total, attachment) => total + attachment.content.length,
    0,
  );
  if (totalBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      "Tổng dung lượng file đính kèm vượt quá giới hạn 18 MB của hệ thống mail.",
    );
  }
  return attachments;
}

function encodedAttachment(value: Buffer) {
  return value
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .replace(/\r\n$/g, "");
}

function asciiAttachmentFileName(fileName: string) {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (ascii || "attachment").slice(0, 120).replace(/"/g, "");
}

export function resolveModuleMailRoute(
  moduleKey: string,
  options: { allowDefault?: boolean } = {},
): ModuleMailRoute {
  const normalizedKey = normalizeModuleKey(moduleKey);
  const configured = ROUTES[normalizedKey];
  if (!configured && options.allowDefault === false) {
    throw new Error(`Module ${normalizedKey || "(trống)"} chưa có mail gửi riêng.`);
  }
  const route = configured || ROUTES.default;
  const senderEmail = normalizeEmail(route.senderEmail);
  if (!ALLOWED_SENDERS.has(senderEmail)) {
    throw new Error("Mail gửi nằm ngoài danh sách tài khoản được phép.");
  }
  return {
    moduleKey: configured ? normalizedKey : "default",
    provider: "gmail-workspace",
    senderEmail,
    senderName: sanitizeHeader(route.senderName) || "Thuần Việt",
  };
}

export function listModuleMailRoutes(moduleKeys: string[]) {
  const seen = new Set<string>();
  return moduleKeys
    .map((moduleKey) =>
      resolveModuleMailRoute(moduleKey, { allowDefault: false }),
    )
    .filter((route) => {
      const key = `${route.senderEmail}|${route.moduleKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeMessage(message: ModuleMailMessage) {
  const htmlBody = String(message.htmlBody || "");
  const textBody = String(message.textBody || "") || stripHtml(htmlBody);
  const subject = sanitizeHeader(message.subject);
  if (!subject) throw new Error("Email cần có tiêu đề.");
  if (!textBody && !htmlBody) throw new Error("Email cần có nội dung.");
  return {
    attachments: normalizeAttachments(message.attachments),
    bcc: recipients(message.bcc, false),
    cc: recipients(message.cc, false),
    htmlBody,
    replyTo: optionalEmail(message.replyTo),
    senderName: sanitizeHeader(message.senderName),
    subject,
    textBody,
    to: recipients(message.to, true),
  };
}

function buildRawMessage(
  route: ModuleMailRoute,
  message: ReturnType<typeof normalizeMessage>,
) {
  const lineBreak = "\r\n";
  const boundarySeed = randomUUID().replace(/[^A-Za-z0-9]/g, "");
  const alternativeBoundary = `tv-alt-${boundarySeed}`;
  const mixedBoundary = `tv-mixed-${boundarySeed}`;
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `From: ${encodedHeader(route.senderName)} <${route.senderEmail}>`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${encodedHeader(message.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (message.cc.length) headers.push(`Cc: ${message.cc.join(", ")}`);
  if (message.bcc.length) headers.push(`Bcc: ${message.bcc.join(", ")}`);
  if (message.replyTo) headers.push(`Reply-To: ${message.replyTo}`);
  if (!message.attachments.length && !message.htmlBody) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: base64");
    return `${headers.join(lineBreak)}${lineBreak}${lineBreak}${encodedBody(message.textBody)}${lineBreak}`;
  }
  if (!message.attachments.length) {
    headers.push(
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    );
    return [
      headers.join(lineBreak),
      "",
      `--${alternativeBoundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodedBody(message.textBody),
      `--${alternativeBoundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodedBody(message.htmlBody),
      `--${alternativeBoundary}--`,
      "",
    ].join(lineBreak);
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  const parts = [headers.join(lineBreak), "", `--${mixedBoundary}`];
  if (message.htmlBody) {
    parts.push(
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      "",
      `--${alternativeBoundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodedBody(message.textBody),
      `--${alternativeBoundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodedBody(message.htmlBody),
      `--${alternativeBoundary}--`,
    );
  } else {
    parts.push(
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodedBody(message.textBody),
    );
  }
  for (const attachment of message.attachments) {
    const fallbackName = asciiAttachmentFileName(attachment.fileName);
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType}; name="${encodedHeader(attachment.fileName)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "",
      encodedAttachment(attachment.content),
    );
  }
  parts.push(`--${mixedBoundary}--`, "");
  return parts.join(lineBreak);
}

async function delegatedAccessToken(senderEmail: string) {
  if (
    cachedDelegatedToken &&
    cachedDelegatedToken.senderEmail === senderEmail &&
    cachedDelegatedToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedDelegatedToken.token;
  }
  const serviceAccountEmail =
    process.env.MODULE_MAIL_SERVICE_ACCOUNT_EMAIL ||
    "thuan-viet-mail-router@tvg-ops-dev.iam.gserviceaccount.com";
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
    iss: serviceAccountEmail,
    scope: GMAIL_SEND_SCOPE,
    sub: senderEmail,
  };
  const client = await mailAuth.getClient();
  const signed = await client.request<{ signedJwt?: string }>({
    data: { payload: JSON.stringify(claims) },
    method: "POST",
    url: `${IAM_SIGN_JWT_BASE_URL}${encodeURIComponent(serviceAccountEmail)}:signJwt`,
  });
  if (!signed.data.signedJwt) {
    throw new Error("Không thể ký JWT gửi email qua Mail Router.");
  }
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      assertion: signed.data.signedJwt,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    error_description?: string;
    expires_in?: number;
  };
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description ||
        `Không thể lấy quyền gửi email CnB (HTTP ${tokenResponse.status}).`,
    );
  }
  cachedDelegatedToken = {
    expiresAt: Date.now() + Math.max(60, tokenData.expires_in || 3600) * 1000,
    senderEmail,
    token: tokenData.access_token,
  };
  return tokenData.access_token;
}

export async function sendModuleEmail(
  moduleKey: string,
  message: ModuleMailMessage,
) {
  const route = resolveModuleMailRoute(moduleKey, { allowDefault: false });
  const normalized = normalizeMessage(message);
  const effectiveRoute = normalized.senderName
    ? { ...route, senderName: normalized.senderName }
    : route;
  const token = await delegatedAccessToken(route.senderEmail);
  const response = await fetch(GMAIL_SEND_URL, {
    body: JSON.stringify({
      raw: base64Url(buildRawMessage(effectiveRoute, normalized)),
    }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  const result = (await response.json()) as {
    error?: { message?: string };
    id?: string;
    threadId?: string;
  };
  if (!response.ok || !result.id) {
    throw new Error(
      result.error?.message ||
        `Không thể gửi email qua ${route.senderEmail} (HTTP ${response.status}).`,
    );
  }
  return {
    messageId: result.id,
    moduleKey: route.moduleKey,
    ok: true,
    senderEmail: route.senderEmail,
    threadId: result.threadId || "",
  };
}

export const moduleMailRouterTestUtils = {
  buildRawMessage,
  normalizeMessage,
};
