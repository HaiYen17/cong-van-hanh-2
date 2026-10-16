import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";

import { EVALUATION_AUTOMATION_SERVICE_ACCOUNT } from "@/lib/evaluation/source-automation";
import { syncSendMailLocationCatalog } from "@/lib/send-mail/location-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const oidcClient = new OAuth2Client();

function secureEqual(left: string, right: string) {
  return timingSafeEqual(
    createHash("sha256").update(left, "utf8").digest(),
    createHash("sha256").update(right, "utf8").digest(),
  );
}

async function isAuthorized(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const customSecret = String(
    request.headers.get("x-cron-secret") || "",
  ).trim();
  const authorization = String(
    request.headers.get("authorization") || "",
  ).replace(/^Bearer\s+/i, "");

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
      process.env.VTP_CATALOG_SCHEDULER_SERVICE_ACCOUNT ||
        process.env.EVALUATION_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT ||
        EVALUATION_AUTOMATION_SERVICE_ACCOUNT,
    )
      .trim()
      .toLowerCase();
    return Boolean(
      allowedEmail &&
        payload?.email_verified &&
        payload.email?.toLowerCase() === allowedEmail,
    );
  } catch {
    return false;
  }
}

async function handle(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json(
      { error: "Unauthorized", ok: false },
      { status: 401 },
    );
  }
  try {
    const result = await syncSendMailLocationCatalog("PROD");
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không đồng bộ được danh mục Viettel Post.",
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
