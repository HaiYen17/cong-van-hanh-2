import "server-only";

import assert from "node:assert/strict";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  processEvaluationMailOutbox,
  queueEvaluationMailForCycle,
} from "@/lib/evaluation/mail-delivery";
import { asRecord, text } from "@/lib/operations/json";

async function main() {
  const db = getDb();
  const suffix = Date.now().toString(36).toUpperCase();
  const createdIds: string[] = [];
  try {
    const cycle = await db.evaluationRecord.create({
      data: {
        code: `QA_MAIL_CYCLE_${suffix}`,
        content: {
          id: `QA_MAIL_CYCLE_${suffix}`,
          isActive: false,
          status: "inactive",
        } as Prisma.InputJsonValue,
        name: `QA kỳ đã xóa ${suffix}`,
        recordType: "evaluation-cycle",
        status: "inactive",
      },
    });
    createdIds.push(cycle.id);
    const instance = await db.evaluationRecord.create({
      data: {
        code: `QA_MAIL_INSTANCE_${suffix}`,
        content: {
          activeStepRoles: ["self"],
          cycleId: `QA_MAIL_CYCLE_${suffix}`,
          cycleName: cycle.name,
          deadline: "2099-12-31",
          employeeCode: `QA_${suffix}`,
          employeeName: "Nhân sự QA",
          id: `QA_MAIL_INSTANCE_${suffix}`,
          isActive: true,
          status: "in_progress",
        } as Prisma.InputJsonValue,
        name: "Nhân sự QA",
        parentId: cycle.id,
        recordType: "evaluation-instance",
        status: "in_progress",
      },
    });
    createdIds.push(instance.id);
    const delivery = await db.evaluationRecord.create({
      data: {
        code: `QA_MAIL_DELIVERY_${suffix}`,
        content: {
          attempts: 0,
          eventCode: "review_reminder",
          htmlBody: "<p>Không được gửi</p>",
          instanceId: `QA_MAIL_INSTANCE_${suffix}`,
          recipientEmail: "qa-do-not-send@example.invalid",
          status: "queued",
          subject: "QA không được gửi",
          textBody: "Không được gửi",
        } as Prisma.InputJsonValue,
        name: `QA mail an toàn ${suffix}`,
        parentId: instance.id,
        recordType: "evaluation-mail-delivery",
        status: "queued",
      },
    });
    createdIds.push(delivery.id);

    const cycleResult = await queueEvaluationMailForCycle(cycle.id);
    assert.equal(cycleResult.reason, "cycle_not_active");
    assert.equal(cycleResult.queued, 0);
    assert.equal(cycleResult.sent, 0);

    const outboxResult = await processEvaluationMailOutbox({
      ids: [delivery.id],
    });
    assert.equal(outboxResult.cancelled, 1);
    assert.equal(outboxResult.sent, 0);
    const stored = await db.evaluationRecord.findUnique({
      where: { id: delivery.id },
    });
    const storedContent = asRecord(stored?.content);
    assert.equal(stored?.status, "cancelled");
    assert.equal(text(storedContent.cancellationReason), "cycle_not_active");
    assert.equal(text(storedContent.sentAt), "");
    assert.equal(text(storedContent.messageId), "");

    console.log(
      JSON.stringify(
        {
          cancelledQueuedMailFromDeletedCycle: "ok",
          inactiveCycleBulkSend: "blocked",
          ok: true,
          sent: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    if (createdIds.length) {
      await db.evaluationRecord.deleteMany({
        where: { id: { in: createdIds } },
      });
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
