import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";

import { runMeetingRetention } from "@/lib/meetings/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function secureEqual(left: string, right: string) {
  return timingSafeEqual(
    createHash("sha256").update(left, "utf8").digest(),
    createHash("sha256").update(right, "utf8").digest(),
  );
}

const oidcClient = new OAuth2Client();

async function isAuthorized(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const customSecret = String(request.headers.get("x-cron-secret") || "").trim();
  if (
    secret &&
    ((authorization && secureEqual(authorization, secret)) ||
      (customSecret && secureEqual(customSecret, secret)))
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
      process.env.MEETING_RETENTION_SCHEDULER_SERVICE_ACCOUNT ||
      "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";
    return Boolean(
      payload?.email_verified &&
        payload.email &&
        payload.email.toLowerCase() === allowedEmail.toLowerCase(),
    );
  } catch {
    return false;
  }
}

async function handle(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized", ok: false }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, result: await runMeetingRetention() });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Không chạy được retention lịch họp.",
        ok: false,
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
