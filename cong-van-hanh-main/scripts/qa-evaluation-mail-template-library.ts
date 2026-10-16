import "server-only";

import assert from "node:assert/strict";

import { getDb } from "@/lib/db";
import { dispatchEvaluationRpc } from "@/lib/evaluation/runtime";
import { asRecord, text } from "@/lib/operations/json";

async function main() {
  const db = getDb();
  const admin = await db.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: { status: "ACTIVE" },
  });
  assert(admin, "Cần một tài khoản active để chạy QA cấu hình mail.");
  const cycleType = await db.evaluationRecord.findFirst({
    orderBy: { updatedAt: "desc" },
    where: {
      recordType: "evaluation-cycle-type-template",
      status: { notIn: ["inactive", "archived", "deleted"] },
    },
  });
  assert(cycleType, "Cần một Loại đánh giá active để chạy QA cấu hình mail.");
  const cycleTypeContent = asRecord(cycleType.content);
  const cycleTypeId = text(
    cycleTypeContent.id ||
      cycleTypeContent.cycleTypeTemplateId ||
      cycleType.id,
  );
  const session = {
    displayName: admin.displayName,
    fullAccess: true,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: ["admin"],
    userId: admin.id,
  };
  const suffix = Date.now().toString(36).toUpperCase();
  const eventCode = `qa_mail_event_${suffix.toLowerCase()}`;
  const createdIds: string[] = [];
  const save = async (index: number) => {
    const response = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntity", {
        entityType: "evaluationMailTemplate",
        record: {
          bodyHtmlTemplate: `<p>QA mẫu ${index}</p>`,
          bodyTemplate: `QA mẫu ${index}`,
          code: `QA_MAIL_${suffix}_${index}`,
          cycleTypeCode: text(cycleTypeContent.cycleTypeCode || cycleType.code),
          cycleTypeTemplateId: cycleTypeId,
          eventCode,
          isActive: true,
          name: `QA mail ${suffix} ${index}`,
          recipientRoles: ["self"],
          roleTemplates: [
            {
              bodyHtmlTemplate: `<p>QA mẫu ${index}</p>`,
              bodyTemplate: `QA mẫu ${index}`,
              enabled: true,
              isActive: true,
              role: "self",
              status: "active",
              subjectTemplate: `QA ${suffix} ${index}`,
            },
          ],
          senderEmail: "ns.cnb@nemthuanviet.vn",
          senderModuleKey: "evaluation-config",
          status: "active",
          subjectTemplate: `QA ${suffix} ${index}`,
          timing: "immediate",
        },
      }),
    );
    const record = asRecord(response.record);
    const id = text(record.databaseId || record.id);
    assert(id, "Mẫu mail QA phải trả databaseId.");
    createdIds.push(id);
    return id;
  };
  try {
    const firstId = await save(1);
    const secondId = await save(2);
    const records = await db.evaluationRecord.findMany({
      where: { id: { in: [firstId, secondId] } },
    });
    const first = records.find((record) => record.id === firstId);
    const second = records.find((record) => record.id === secondId);
    assert.equal(first?.status, "inactive", "Mẫu cũ cùng sự kiện phải tự tắt.");
    assert.equal(
      asRecord(first?.content).isActive,
      false,
      "Content mẫu cũ phải được đánh dấu inactive.",
    );
    assert.equal(
      text(asRecord(first?.content).deactivatedByMailTemplateId),
      secondId,
      "Mẫu cũ phải ghi nhận mẫu mới đã thay thế.",
    );
    assert.equal(second?.status, "active", "Mẫu mới phải là mẫu đang dùng.");
    const deleted = asRecord(
      await dispatchEvaluationRpc(session, "deleteEvaluationConfigEntity", {
        databaseId: secondId,
        entityType: "evaluationMailTemplate",
        id: secondId,
      }),
    );
    assert.equal(
      deleted.hardDeleted,
      true,
      "Xóa mẫu mail phải là hard-delete khỏi PostgreSQL.",
    );
    assert.equal(
      await db.evaluationRecord.findUnique({ where: { id: secondId } }),
      null,
      "Bản ghi mẫu mail phải biến mất hoàn toàn khỏi bảng EvaluationRecord.",
    );
    const deleteAudit = await db.auditLog.findFirst({
      orderBy: { createdAt: "desc" },
      where: { action: "DELETE", targetId: secondId },
    });
    assert(deleteAudit, "Hard-delete mẫu mail phải được ghi Audit Log.");
    assert.equal(
      asRecord(deleteAudit.metadata).hardDeleted,
      true,
      "Audit Log phải đánh dấu đây là hard-delete.",
    );
    console.log(
      JSON.stringify({ deletedTemplate: secondId, eventCode, ok: true, replacedTemplate: firstId }),
    );
  } finally {
    if (createdIds.length) {
      await db.evaluationRecord.deleteMany({ where: { id: { in: createdIds } } });
      await db.auditLog.deleteMany({ where: { targetId: { in: createdIds } } });
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
