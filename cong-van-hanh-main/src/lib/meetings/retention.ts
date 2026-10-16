import "server-only";

import { getDb } from "@/lib/db";

export async function runMeetingRetention() {
  const db = getDb();
  const now = new Date();
  const webhookCutoff = new Date(now.getTime() - 30 * 86_400_000);
  const [purgedTranscripts, deletedWebhookEvents] = await db.$transaction([
    db.meetingTranscript.updateMany({
      data: {
        contentText: null,
        purgedAt: now,
        segments: [],
        speakerMap: {},
        status: "PURGED",
      },
      where: {
        expiresAt: { lte: now },
        purgedAt: null,
        status: { in: ["READY", "FAILED"] },
      },
    }),
    db.meetingWebhookEvent.deleteMany({
      where: { createdAt: { lt: webhookCutoff }, processedAt: { not: null } },
    }),
  ]);
  return {
    deletedWebhookEvents: deletedWebhookEvents.count,
    purgedTranscripts: purgedTranscripts.count,
  };
}
