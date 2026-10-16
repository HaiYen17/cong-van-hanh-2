import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  evaluationRecordIdentifiers,
  evaluationRecordLegacyId,
} from "@/lib/evaluation/record-identity";
import {
  asRecord,
  booleanValue,
  numberValue,
  text,
} from "@/lib/operations/json";

const APPLY = process.argv.includes("--apply");
const REPAIR_ACTOR = "Codex - sửa toàn vẹn CnB 2026-08-06";

const MALFORMED_TYPES = new Set([
  "evaluation-decision-field",
  "evaluation-workflow-step",
]);

const MAIL_PRESETS = [
  {
    eventCode: "review_assigned",
    name: "Có lượt đánh giá mới",
    recipientRoles: ["current_reviewer"],
    timing: "immediate",
    offsetDays: 0,
    subjectTemplate: "[CnB] Bạn có lượt đánh giá mới - {{nhan_su}}",
    bodyTemplate:
      "Bạn có một lượt đánh giá mới cho {{nhan_su}} trong kỳ {{ten_ky}}. Hạn đánh giá: {{han_danh_gia}}. Mở phiếu: {{link_danh_gia}}",
  },
  {
    eventCode: "review_reminder",
    name: "Nhắc trước hạn",
    recipientRoles: ["current_reviewer"],
    timing: "before_deadline",
    offsetDays: 2,
    subjectTemplate: "[CnB] Nhắc hoàn tất đánh giá - {{nhan_su}}",
    bodyTemplate:
      "Phiếu đánh giá {{nhan_su}} trong kỳ {{ten_ky}} sắp đến hạn {{han_danh_gia}}. Mở phiếu: {{link_danh_gia}}",
  },
  {
    eventCode: "review_overdue",
    name: "Nhắc quá hạn",
    recipientRoles: ["current_reviewer", "hr"],
    timing: "after_deadline",
    offsetDays: 1,
    subjectTemplate: "[CnB] Phiếu đánh giá đã quá hạn - {{nhan_su}}",
    bodyTemplate:
      "Phiếu đánh giá {{nhan_su}} trong kỳ {{ten_ky}} đã quá hạn {{han_danh_gia}}. Mở phiếu: {{link_danh_gia}}",
  },
  {
    eventCode: "review_returned",
    name: "Phiếu bị trả lại",
    recipientRoles: ["current_reviewer"],
    timing: "immediate",
    offsetDays: 0,
    subjectTemplate: "[CnB] Phiếu đánh giá được trả lại - {{nhan_su}}",
    bodyTemplate:
      "Phiếu đánh giá {{nhan_su}} đã được trả lại để chỉnh sửa. Ghi chú: {{ghi_chu_tra_lai}}. Mở phiếu: {{link_danh_gia}}",
  },
  {
    eventCode: "cnb_finalization_required",
    name: "CnB cần chốt kết quả",
    recipientRoles: ["hr"],
    timing: "immediate",
    offsetDays: 0,
    subjectTemplate: "[CnB] Phiếu đã sẵn sàng chốt - {{nhan_su}}",
    bodyTemplate:
      "Các lượt đánh giá của {{nhan_su}} trong kỳ {{ten_ky}} đã hoàn tất. Vui lòng mở màn Theo dõi để chốt kết quả: {{link_danh_gia}}",
  },
  {
    eventCode: "evaluation_completed",
    name: "Đánh giá hoàn tất",
    recipientRoles: ["employee", "manager", "hr"],
    timing: "immediate",
    offsetDays: 0,
    subjectTemplate: "[CnB] Đánh giá đã hoàn tất - {{nhan_su}}",
    bodyTemplate:
      "Kết quả đánh giá của {{nhan_su}} trong kỳ {{ten_ky}} đã hoàn tất. Kết quả: {{ket_qua}}. Xem phiếu: {{link_danh_gia}}",
  },
] as const;

function makeCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function malformedDetails(record: {
  code: string | null;
  content: unknown;
  id: string;
  name: string | null;
  parentId: string | null;
  recordType: string;
  status: string;
  updatedAt: Date;
}) {
  const wrapper = asRecord(record.content);
  const nested = asRecord(wrapper.record);
  if (
    record.status === "inactive" ||
    wrapper.isActive === false ||
    !MALFORMED_TYPES.has(record.recordType) ||
    !Object.keys(nested).length
  ) {
    return null;
  }
  if (record.recordType === "evaluation-decision-field") {
    const parentId = text(nested.cycleTypeTemplateId);
    const code = text(nested.code || nested.fieldCode) || record.code || "";
    return {
      code: code || makeCode(`FIELD_${parentId}_${text(nested.label)}`),
      key: [record.recordType, parentId, code || text(nested.label)].join("|"),
      name: text(nested.label || nested.fieldLabel || nested.name) || "Câu hỏi",
      nested,
      parentId,
      targetIdentifier: text(nested.databaseId || nested.id),
    };
  }
  const parentId = text(nested.workflowTemplateId);
  const role = text(nested.role || nested.evaluatorRole) || "self";
  const sortOrder = numberValue(nested.sortOrder, 10);
  const code =
    text(nested.code) || makeCode(`STEP_${parentId}_${role}_${sortOrder}`);
  return {
    code,
    key: [record.recordType, parentId, role, sortOrder].join("|"),
    name: text(nested.name) || `Bước ${role}`,
    nested,
    parentId,
    targetIdentifier: text(nested.databaseId || nested.id),
  };
}

function titleCorrection(value: unknown) {
  return text(value)
    .replace(/Chuyên giá/giu, "Chuyên gia")
    .replace(/nệm cao s[ựư]/giu, "nệm cao su")
    .replace(/Kế toán thành toán/gu, "Kế toán thanh toán")
    .replace(/kế toán thành toán/gu, "kế toán thanh toán")
    .replace(/kinh doanh\s+so\s*2/giu, "kinh doanh số 2");
}

async function main() {
  const db = getDb();
  const records = await db.evaluationRecord.findMany({
    orderBy: { updatedAt: "asc" },
    where: { recordType: { startsWith: "evaluation-" } },
  });
  const malformed = records
    .map((record) => ({ details: malformedDetails(record), record }))
    .filter(
      (
        item,
      ): item is typeof item & { details: NonNullable<typeof item.details> } =>
        Boolean(item.details),
    );
  const identifiersByRecord = new Map(
    records.map((record) => [
      record.id,
      new Set(evaluationRecordIdentifiers(record)),
    ]),
  );
  const repairGroups = new Map<string, typeof malformed>();
  for (const item of malformed) {
    const target = item.details.targetIdentifier
      ? records.find(
          (candidate) =>
            candidate.id !== item.record.id &&
            candidate.recordType === item.record.recordType &&
            identifiersByRecord
              .get(candidate.id)
              ?.has(item.details.targetIdentifier),
        )
      : null;
    const groupKey = target
      ? `target:${target.id}`
      : `logical:${item.details.key}`;
    const bucket = repairGroups.get(groupKey) || [];
    bucket.push(item);
    repairGroups.set(groupKey, bucket);
  }

  const malformedPlan: Array<Record<string, unknown>> = [];
  if (APPLY) {
    await db.$transaction(async (tx) => {
      for (const [groupKey, group] of repairGroups) {
        group.sort(
          (left, right) =>
            right.record.updatedAt.getTime() - left.record.updatedAt.getTime(),
        );
        const latest = group[0];
        const targetId = groupKey.startsWith("target:")
          ? groupKey.slice("target:".length)
          : latest.record.id;
        const target =
          records.find((record) => record.id === targetId) || latest.record;
        const desiredStatus =
          latest.details.nested.isActive === false ||
          ["inactive", "archived"].includes(
            text(latest.details.nested.status).toLowerCase(),
          )
            ? "inactive"
            : "active";
        const normalizedContent: Record<string, unknown> = {
          ...asRecord(target.content),
          ...latest.details.nested,
          code: latest.details.code,
          isActive: desiredStatus === "active",
          name: latest.details.name,
          recordType: target.recordType,
          repairedAt: new Date().toISOString(),
          repairedBy: REPAIR_ACTOR,
          repairedFromRecordId: latest.record.id,
          status: desiredStatus,
        };
        delete normalizedContent.record;
        await tx.evaluationRecord.update({
          data: {
            code: latest.details.code,
            content: normalizedContent as Prisma.InputJsonValue,
            name: latest.details.name,
            parentId: latest.details.parentId || null,
            status: desiredStatus,
            updatedByName: REPAIR_ACTOR,
          },
          where: { id: target.id },
        });
        for (const source of group) {
          if (source.record.id === target.id) continue;
          await tx.evaluationRecord.update({
            data: {
              content: {
                ...asRecord(source.record.content),
                archivedAfterRepairAt: new Date().toISOString(),
                archivedAfterRepairBy: REPAIR_ACTOR,
                isActive: false,
                repairedIntoRecordId: target.id,
                status: "inactive",
              } as Prisma.InputJsonValue,
              note: `Đã phục hồi vào ${target.id}; giữ lại để đối soát.`,
              status: "inactive",
              updatedByName: REPAIR_ACTOR,
            },
            where: { id: source.record.id },
          });
        }
        malformedPlan.push({
          action: target.id === latest.record.id ? "normalize" : "merge",
          groupKey,
          sourceCount: group.length,
          targetId: target.id,
        });
      }
    });
  } else {
    for (const [groupKey, group] of repairGroups) {
      malformedPlan.push({
        action: groupKey.startsWith("target:") ? "merge" : "normalize",
        groupKey,
        sourceCount: group.length,
      });
    }
  }

  const inactiveCycles = records.filter(
    (record) =>
      record.recordType === "evaluation-cycle" && record.status === "inactive",
  );
  const orphanIds = new Set<string>();
  for (const cycle of inactiveCycles) {
    const cycleIds = new Set(evaluationRecordIdentifiers(cycle));
    const children = records.filter((record) => {
      if (
        ![
          "evaluation-cycle-member",
          "evaluation-generation-job",
          "evaluation-instance",
        ].includes(record.recordType) ||
        record.status === "inactive"
      ) {
        return false;
      }
      const content = asRecord(record.content);
      return [record.parentId, content.cycleId, content.evaluationCycleId]
        .map(text)
        .some((identifier) => cycleIds.has(identifier));
    });
    children.forEach((child) => orphanIds.add(child.id));
    const instanceIds = new Set(
      children
        .filter((child) => child.recordType === "evaluation-instance")
        .flatMap((child) => [child.id, evaluationRecordLegacyId(child)]),
    );
    records
      .filter((record) =>
        [
          "evaluation-criteria-score",
          "evaluation-decision-value",
          "evaluation-final-result",
        ].includes(record.recordType),
      )
      .filter((record) => {
        const content = asRecord(record.content);
        return [
          record.parentId,
          content.instanceId,
          content.evaluationInstanceId,
        ]
          .map(text)
          .some((identifier) => instanceIds.has(identifier));
      })
      .forEach((child) => orphanIds.add(child.id));
  }
  if (APPLY && orphanIds.size) {
    await db.$transaction(
      async (tx) => {
        for (const id of orphanIds) {
          const record = records.find((item) => item.id === id)!;
          await tx.evaluationRecord.update({
            data: {
              content: {
                ...asRecord(record.content),
                cascadeRepairAt: new Date().toISOString(),
                cascadeRepairBy: REPAIR_ACTOR,
                isActive: false,
                status: "inactive",
              } as Prisma.InputJsonValue,
              status: "inactive",
              updatedByName: REPAIR_ACTOR,
            },
            where: { id },
          });
        }
      },
      { timeout: 60_000 },
    );
  }

  const definitions = records.filter(
    (record) => record.recordType === "evaluation-work-group-definition",
  );
  const execution = definitions.find(
    (record) => record.code === "WG_EXECUTION" && record.status !== "inactive",
  );
  if (!execution) {
    throw new Error("Không tìm thấy Nhóm công việc Thực thi đang hoạt động.");
  }
  if (APPLY) {
    await db.$transaction(async (tx) => {
      for (const definition of definitions) {
        await tx.evaluationRecord.update({
          data: {
            content: {
              ...asRecord(definition.content),
              isDefault: definition.id === execution.id,
            } as Prisma.InputJsonValue,
            updatedByName: REPAIR_ACTOR,
          },
          where: { id: definition.id },
        });
      }
    });
  }
  const unassignedActivities = records.filter((record) => {
    if (
      record.recordType !== "evaluation-jd-activity" ||
      record.status === "inactive"
    ) {
      return false;
    }
    const content = asRecord(record.content);
    return (
      text(content.activityType).toLowerCase() !== "excluded" &&
      !text(content.evaluationWorkGroupId) &&
      !text(content.evaluationWorkGroupCode)
    );
  });
  let backfilledActivities = 0;
  if (APPLY && unassignedActivities.length) {
    backfilledActivities = await db.$executeRaw(
      Prisma.sql`
        UPDATE "EvaluationRecord"
        SET
          "content" = "content" || ${JSON.stringify({
            defaultWorkGroupBackfillAt: new Date().toISOString(),
            defaultWorkGroupBackfillBy: REPAIR_ACTOR,
            evaluationWorkGroupCode: execution.code || "WG_EXECUTION",
            evaluationWorkGroupId: evaluationRecordLegacyId(execution),
            evaluationWorkGroupName: execution.name || "Thực thi",
          })}::jsonb,
          "updatedByName" = ${REPAIR_ACTOR},
          "updatedAt" = NOW()
        WHERE "recordType" = 'evaluation-jd-activity'
          AND "status" <> 'inactive'
          AND COALESCE("content"->>'activityType', '') <> 'excluded'
          AND COALESCE("content"->>'evaluationWorkGroupId', '') = ''
          AND COALESCE("content"->>'evaluationWorkGroupCode', '') = ''
      `,
    );
  }

  const titleRows = records
    .filter((record) => record.recordType === "evaluation-jd-document")
    .map((record) => {
      const content = asRecord(record.content);
      const current = text(
        content.mappedJobTitleName ||
          content.jobTitleName ||
          content.displayTitle ||
          record.name,
      );
      return { corrected: titleCorrection(current), current, record };
    })
    .filter((item) => item.corrected && item.corrected !== item.current);
  if (APPLY) {
    await db.$transaction(async (tx) => {
      for (const item of titleRows) {
        const content = asRecord(item.record.content);
        await tx.evaluationRecord.update({
          data: {
            content: {
              ...content,
              displayTitle: item.corrected,
              jobTitleName: item.corrected,
              mappedJobTitleName: item.corrected,
              personnelJobTitleName: item.corrected,
              titleCorrectedAt: new Date().toISOString(),
              titleCorrectedFrom: item.current,
            } as Prisma.InputJsonValue,
            name: item.corrected,
            updatedByName: REPAIR_ACTOR,
          },
          where: { id: item.record.id },
        });
      }
    });
  }

  const categoryRows = records.filter((record) => {
    const content = asRecord(record.content);
    return (
      record.recordType === "evaluation-cycle-type-template" &&
      text(content.category) === "ad_hoc"
    );
  });
  if (APPLY) {
    await db.$transaction(async (tx) => {
      for (const row of categoryRows) {
        await tx.evaluationRecord.update({
          data: {
            content: {
              ...asRecord(row.content),
              category: "other",
              categoryMigratedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
            updatedByName: REPAIR_ACTOR,
          },
          where: { id: row.id },
        });
      }
    });
  }

  const existingMailEvents = new Set(
    records
      .filter((record) => record.recordType === "evaluation-mail-template")
      .map((record) => text(asRecord(record.content).eventCode)),
  );
  const missingMailPresets = MAIL_PRESETS.filter(
    (preset) => !existingMailEvents.has(preset.eventCode),
  );
  if (APPLY) {
    for (const preset of missingMailPresets) {
      const code = `MAIL_${preset.eventCode.toUpperCase()}`;
      const bodyHtmlTemplate = `<p>${preset.bodyTemplate.replace(/\n/g, "</p><p>")}</p>`;
      await db.evaluationRecord.create({
        data: {
          code,
          content: {
            ...preset,
            bodyHtmlTemplate,
            code,
            eventName: preset.name,
            isActive: false,
            recordType: "evaluation-mail-template",
            sendTime: "08:00",
            senderEmail: "ns.cnb@nemthuanviet.vn",
            senderModuleKey: "evaluation-config",
            senderName: "Thuần Việt - Nhân sự CnB",
            senderProvider: "gmail-workspace",
            status: "draft",
          } as Prisma.InputJsonValue,
          createdByName: REPAIR_ACTOR,
          name: preset.name,
          recordType: "evaluation-mail-template",
          status: "draft",
          updatedByName: REPAIR_ACTOR,
        },
      });
    }
  }

  const schedulesWithoutRule = records.filter(
    (record) =>
      record.recordType === "evaluation-cycle-schedule" &&
      !text(asRecord(record.content).automationRuleKey),
  );
  if (APPLY) {
    await db.$transaction(async (tx) => {
      for (const schedule of schedulesWithoutRule) {
        await tx.evaluationRecord.update({
          data: {
            content: {
              ...asRecord(schedule.content),
              automationRuleKey: "default",
            } as Prisma.InputJsonValue,
            updatedByName: REPAIR_ACTOR,
          },
          where: { id: schedule.id },
        });
      }
    });
  }

  const report = {
    apply: APPLY,
    categoriesMigrated: categoryRows.length,
    inactiveCycleDescendants: orphanIds.size,
    jdActivitiesBackfilled: APPLY
      ? backfilledActivities
      : unassignedActivities.length,
    malformedGroups: malformedPlan,
    malformedRows: malformed.length,
    mailTemplatesSeeded: missingMailPresets.map((preset) => preset.eventCode),
    schedulesNormalized: schedulesWithoutRule.length,
    titleCorrections: titleRows.map((item) => ({
      after: item.corrected,
      before: item.current,
      id: item.record.id,
    })),
    workGroupDefault: {
      code: execution.code,
      id: execution.id,
      legacyId: evaluationRecordLegacyId(execution),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
