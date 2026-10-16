import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";

import {
  EVALUATION_AUTOMATION_SERVICE_ACCOUNT,
} from "@/lib/evaluation/source-automation";
import { queueScheduledEvaluationMail } from "@/lib/evaluation/mail-delivery";
import { runEvaluationAutomation } from "@/lib/evaluation/runtime";

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
    const allowedEmail =
      process.env.EVALUATION_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT ||
      EVALUATION_AUTOMATION_SERVICE_ACCOUNT;
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
    const [automation, mail] = await Promise.all([
      runEvaluationAutomation(),
      queueScheduledEvaluationMail(),
    ]);
    return NextResponse.json({ ok: true, result: { automation, mail } });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không chạy được lịch sinh phiếu đánh giá tự động.",
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
