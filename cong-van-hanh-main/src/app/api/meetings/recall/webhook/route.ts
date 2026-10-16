import { after, NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getMeetingRuntimeConfig } from "@/lib/meetings/config";
import {
  processRecallWebhook,
  verifyRecallWebhook,
} from "@/lib/meetings/recall-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const config = await getMeetingRuntimeConfig();
  if (!config.recallVerificationSecret) {
    return NextResponse.json({ error: "Recall webhook chưa được cấu hình." }, { status: 503 });
  }
  let providerEventId = "";
  try {
    providerEventId = verifyRecallWebhook({
      headers: request.headers,
      payload: rawBody,
      secret: config.recallVerificationSecret,
    }).id;
  } catch {
    return NextResponse.json({ error: "Webhook không hợp lệ." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Payload không phải JSON." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Payload không hợp lệ." }, { status: 400 });
  }
  const eventType = String((payload as { event?: unknown }).event || "unknown");
  const db = getDb();
  const existing = await db.meetingWebhookEvent.findUnique({
    where: { providerEventId },
  });
  if (existing) return NextResponse.json({ duplicate: true, ok: true });

  let event;
  try {
    event = await db.meetingWebhookEvent.create({
      data: {
        eventType,
        payload: payload as Prisma.InputJsonValue,
        providerEventId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ duplicate: true, ok: true });
    }
    throw error;
  }
  after(async () => {
    await processRecallWebhook(event.id);
  });
  return NextResponse.json({ accepted: true, ok: true }, { status: 202 });
}
