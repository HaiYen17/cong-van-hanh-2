"use server";

import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export async function reactToEventAction(
  eventId: string,
  value: string,
  label: string,
): Promise<void> {
  const session = await requireCurrentSession();
  const db = getDb();

  const event = await db.motivationEvent.findUnique({
    select: { saveResponse: true },
    where: { id: eventId },
  });

  if (!event || event.saveResponse === false) {
    return;
  }

  // Ghi nhận ngầm — KHÔNG revalidate "/" để tránh server xáo lại làm đổi thông điệp đang xem.
  await db.motivationReaction.upsert({
    create: { eventId, label, userId: session.userId, value },
    update: { label, value },
    where: { eventId_userId: { eventId, userId: session.userId } },
  });
}
