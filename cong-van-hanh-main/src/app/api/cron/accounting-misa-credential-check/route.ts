import { createHash, timingSafeEqual } from "node:crypto";

import { OAuth2Client } from "google-auth-library";

import { callAccountingWorker } from "@/lib/accounting/worker-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const oidcClient = new OAuth2Client();
const DEFAULT_SCHEDULER_SERVICE_ACCOUNT =
  "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";

function secureEqual(left: string, right: string) {
  return timingSafeEqual(
    createHash("sha256").update(left, "utf8").digest(),
    createHash("sha256").update(right, "utf8").digest(),
  );
}

async function isAuthorized(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const customSecret = String(request.headers.get("x-cron-secret") || "").trim();
  const authorization = String(request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (
    secret &&
    ((customSecret && secureEqual(customSecret, secret)) ||
      (authorization && secureEqual(authorization, secret)))
  ) {
    return true;
  }
  if (!authorization || authorization.split(".").length !== 3) return false;
  try {
    const configuredOrigin = String(process.env.APP_URL || "").trim();
    const ticket = await oidcClient.verifyIdToken({
      audience: configuredOrigin
        ? new URL(configuredOrigin).origin
        : new URL(request.url).origin,
      idToken: authorization,
    });
    const payload = ticket.getPayload();
    const allowedEmail = String(
      process.env.ACCOUNTING_CREDENTIAL_SCHEDULER_SERVICE_ACCOUNT ||
        DEFAULT_SCHEDULER_SERVICE_ACCOUNT,
    ).toLowerCase();
    return Boolean(
      payload?.email_verified &&
        payload.email &&
        payload.email.toLowerCase() === allowedEmail,
    );
  } catch {
    return false;
  }
}

async function handle(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await callAccountingWorker(
      "/sessions/misa/check",
      { force: false },
      { timeoutMs: 240_000 },
    );
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Không kiểm tra được Bearer MISA theo lịch.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
