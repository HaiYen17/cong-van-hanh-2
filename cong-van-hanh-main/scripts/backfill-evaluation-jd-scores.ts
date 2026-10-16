import { getDb } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { resolveSharedJdsForPositions } from "@/lib/evaluation/jd-resolution";
import { buildEvaluationScorePlan } from "@/lib/evaluation/score-planning";
import { evaluationRecordIdentifiers } from "@/lib/evaluation/record-identity";
import { asRecord, numberValue, text } from "@/lib/operations/json";

const APPLY = process.argv.includes("--apply");
const PLANNING_TYPES = [
  "evaluation-cycle-type-score-group",
  "evaluation-criteria",
  "evaluation-criteria-set",
  "evaluation-criteria-set-item",
  "evaluation-jd-activity-rule",
  "evaluation-criteria-score",
];

function roundedWeight(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function percentLabel(value: number) {
  return Number.isInteger(value) ? String(value) : String(roundedWeight(value));
}

async function main() {
  const db = getDb();
  const [cycles, members, instances, planningRecords] = await Promise.all([
    db.evaluationRecord.findMany({ where: { recordType: "evaluation-cycle" } }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-cycle-member" },
    }),
    db.evaluationRecord.findMany({
      where: {
        recordType: "evaluation-instance",
        status: { notIn: ["finalized", "inactive", "deleted"] },
      },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: { in: PLANNING_TYPES } },
    }),
  ]);
  const allScores = planningRecords.filter(
    (record) => record.recordType === "evaluation-criteria-score",
  );
  const positions = members
    .map((member) => text(asRecord(member.content).jobTitleName))
    .filter(Boolean);
  const jds = await resolveSharedJdsForPositions(positions);
  const jdByPosition = new Map(jds.map((jd) => [jd.position, jd]));
  const report: Array<Record<string, unknown>> = [];

  for (const instance of instances) {
    const instanceContent = asRecord(instance.content);
    const instanceIds = new Set(evaluationRecordIdentifiers(instance));
    const instanceScores = allScores.filter((score) => {
      const content = asRecord(score.content);
      return (
        score.parentId === instance.id ||
        [content.evaluationInstanceId, content.instanceId]
          .map(text)
          .some((value) => instanceIds.has(value))
      );
    });
    if (
      instanceScores.some(
        (score) => asRecord(score.content).contentMode === "jd_dynamic",
      )
    ) {
      continue;
    }
    const cycle = cycles.find((candidate) => {
      const ids = new Set(evaluationRecordIdentifiers(candidate));
      return [instanceContent.cycleId, instanceContent.evaluationCycleId]
        .map(text)
        .some((value) => ids.has(value));
    });
    const member = members.find((candidate) => {
      const content = asRecord(candidate.content);
      if (text(content.employeeCode) !== text(instanceContent.employeeCode)) {
        return false;
      }
      const cycleIds = cycle
        ? new Set(evaluationRecordIdentifiers(cycle))
        : new Set<string>();
      return [content.cycleId, content.evaluationCycleId, candidate.parentId]
        .map(text)
        .some((value) => cycleIds.has(value));
    });
    if (!cycle || !member) continue;
    const position = text(asRecord(member.content).jobTitleName);
    const jd = jdByPosition.get(position) || null;
    if (!jd || jd.source === "none") continue;

    let plan;
    try {
      plan = buildEvaluationScorePlan({
        cycle,
        instance,
        jd,
        member,
        records: planningRecords,
      });
    } catch (error) {
      report.push({
        employeeCode: instanceContent.employeeCode,
        employeeName: instanceContent.employeeName,
        error: error instanceof Error ? error.message : String(error),
        instanceId: instanceContent.id || instance.id,
      });
      continue;
    }
    const existingCodes = new Set(instanceScores.map((score) => text(score.code)));
    const dynamicRows = plan.rows.filter(
      (row) =>
        row.content.contentMode === "jd_dynamic" &&
        !existingCodes.has(row.code),
    );
    if (!dynamicRows.length) continue;

    const plannedDynamicWeight = roundedWeight(
      plan.rows
        .filter((row) => row.content.contentMode === "jd_dynamic")
        .reduce(
          (total, row) => total + numberValue(row.content.weightPercent),
          0,
        ),
    );
    const staticWeightTarget = roundedWeight(
      Math.max(0, 100 - plannedDynamicWeight),
    );
    const rescalableScores = instanceScores.filter((score) => {
      const content = asRecord(score.content);
      return (
        score.status !== "inactive" &&
        score.status !== "deleted" &&
        content.isActive !== false &&
        content.contentMode !== "jd_dynamic"
      );
    });
    const currentStaticWeight = rescalableScores.reduce(
      (total, score) =>
        total + numberValue(asRecord(score.content).weightPercent),
      0,
    );
    let allocatedStaticWeight = 0;
    const rescaledScores = rescalableScores.map((score, index) => {
      const isLast = index === rescalableScores.length - 1;
      const currentWeight = numberValue(
        asRecord(score.content).weightPercent,
      );
      const proportionalWeight = currentStaticWeight
        ? (currentWeight / currentStaticWeight) * staticWeightTarget
        : staticWeightTarget / Math.max(rescalableScores.length, 1);
      const nextWeight = isLast
        ? roundedWeight(staticWeightTarget - allocatedStaticWeight)
        : roundedWeight(proportionalWeight);
      allocatedStaticWeight = roundedWeight(
        allocatedStaticWeight + nextWeight,
      );
      return { nextWeight, score };
    });
    const currentStaticLabel =
      text(instanceContent.criteriaSetName) || "Tiêu chí hiện có";
    const normalizedStaticLabel =
      currentStaticLabel
        .replace(/\s+\d+(?:[.,]\d+)?%\s*$/u, "")
        .trim() || "Tiêu chí hiện có";
    const criteriaSetName = [
      staticWeightTarget > 0
        ? `${normalizedStaticLabel} ${percentLabel(staticWeightTarget)}%`
        : "",
      `Chuyên môn theo JD ${percentLabel(plannedDynamicWeight)}%`,
    ]
      .filter(Boolean)
      .join(" + ");

    if (APPLY) {
      const now = new Date().toISOString();
      await db.$transaction(async (tx) => {
        await tx.evaluationRecord.update({
          data: {
            content: {
              ...instanceContent,
              ...plan.instancePatch,
              criteriaSetName,
              jdBackfilledAt: now,
              jdBackfilledBy: "Codex migration",
              scoreWeightsNormalizedAt: now,
              updatedAt: now,
            },
            updatedByName: "Codex migration",
          },
          where: { id: instance.id },
        });
        await Promise.all(
          rescaledScores.map(({ nextWeight, score }) =>
            tx.evaluationRecord.update({
              data: {
                content: {
                  ...asRecord(score.content),
                  weightPercent: nextWeight,
                },
                updatedByName: "Codex migration",
              },
              where: { id: score.id },
            }),
          ),
        );
        await tx.evaluationRecord.createMany({
          data: dynamicRows.map((row) => ({
            code: row.code,
            content: row.content as Prisma.InputJsonValue,
            createdByName: "Codex migration",
            name: row.name,
            parentId: instance.id,
            recordType: "evaluation-criteria-score",
            status: "active",
            updatedByName: "Codex migration",
          })),
        });
      });
    }
    report.push({
      addedJdRows: dynamicRows.length,
      activityCount: plan.instancePatch.professionalActivityCount,
      employeeCode: instanceContent.employeeCode,
      employeeName: instanceContent.employeeName,
      instanceId: instanceContent.id || instance.id,
      jdFileName: plan.instancePatch.jdFileName,
      mode: APPLY ? "applied" : "dry-run",
      preservedExistingRows: instanceScores.length,
      rescaledExistingRows: rescaledScores.length,
      staticWeightBefore: roundedWeight(currentStaticWeight),
      staticWeightTarget,
      dynamicWeight: plannedDynamicWeight,
    });
  }

  console.log(JSON.stringify({ apply: APPLY, report }, null, 2));
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
