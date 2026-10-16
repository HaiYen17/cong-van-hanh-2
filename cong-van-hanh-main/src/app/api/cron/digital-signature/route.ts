import { createHash, timingSafeEqual } from "node:crypto";

import { OAuth2Client } from "google-auth-library";
import { NextResponse } from "next/server";

import { runDigitalSignatureQueue } from "@/lib/requests/digital-signature-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const oidcClient = new OAuth2Client();
const DEFAULT_SCHEDULER_SERVICE_ACCOUNT =
  "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";

function secureEqual(left: string, right: string) {
  return timingSafeEqual(
    createHash("sha256").update(left, "utf8").digest(),
    createHash("sha256").update(right, "utf8").digest(),
  );
}

async function authorized(request: Request) {
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
    const allowedEmail =
      process.env.DIGITAL_SIGNATURE_SCHEDULER_SERVICE_ACCOUNT ||
      DEFAULT_SCHEDULER_SERVICE_ACCOUNT;
    return Boolean(
      payload?.email_verified &&
      payload.email?.toLowerCase() === allowedEmail.toLowerCase(),
    );
  } catch {
    return false;
  }
}

async function run(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...await runDigitalSignatureQueue() });
}

export const GET = run;
export const POST = run;
