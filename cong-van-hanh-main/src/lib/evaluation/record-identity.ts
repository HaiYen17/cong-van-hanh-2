import "server-only";

import { getDb } from "@/lib/db";
import { asRecord, text } from "@/lib/operations/json";

type EvaluationRecordIdentity = {
  code?: string | null;
  content: unknown;
  id: string;
  parentId?: string | null;
  recordType: string;
};

const LEGACY_ID_KEYS: Record<string, string[]> = {
  "evaluation-criteria": ["id", "criteriaId"],
  "evaluation-criteria-score": ["id", "criteriaScoreId", "scoreId"],
  "evaluation-criteria-set": ["id", "criteriaSetId"],
  "evaluation-criteria-set-item": ["id", "criteriaSetItemId"],
  "evaluation-cycle": ["id", "cycleId", "evaluationCycleId"],
  "evaluation-cycle-schedule": ["id", "cycleScheduleId", "scheduleId"],
  "evaluation-cycle-member": ["id", "memberId", "cycleMemberId"],
  "evaluation-cycle-type-score-group": ["id", "cycleTypeScoreGroupId"],
  "evaluation-cycle-type-template": ["id", "cycleTypeTemplateId"],
  "evaluation-decision-field": ["id", "decisionFieldId"],
  "evaluation-decision-option": ["id", "decisionOptionId"],
  "evaluation-decision-template": ["id", "decisionTemplateId"],
  "evaluation-decision-value": ["id", "decisionValueId"],
  "evaluation-final-result": ["id", "finalResultId", "resultId"],
  "evaluation-generation-job": ["id", "generationJobId", "jobId"],
  "evaluation-instance": ["id", "instanceId", "evaluationInstanceId"],
  "evaluation-jd-activity": ["id", "jdActivityId", "activityId"],
  "evaluation-jd-activity-rule": ["id", "jdActivityRuleId", "ruleId"],
  "evaluation-jd-classification-job": ["id", "classificationJobId", "jobId"],
  "evaluation-jd-document": ["id", "jdDocumentId", "documentId"],
  "evaluation-jd-folder": ["id", "jdFolderId", "folderId"],
  "evaluation-jd-version": ["id", "jdVersionId", "versionId"],
  "evaluation-jd-work-group": ["id", "jdWorkGroupId", "workGroupId"],
  "evaluation-position-level": ["id", "positionLevelId", "levelId"],
  "evaluation-score-group": ["id", "scoreGroupId"],
  "evaluation-source": ["id", "evaluationSourceId"],
  "evaluation-source-item": ["id", "evaluationSourceItemId", "sourceItemId"],
  "evaluation-workflow-step": ["id", "workflowStepId"],
  "evaluation-workflow-template": ["id", "workflowTemplateId"],
};

export function evaluationRecordLegacyId(record: EvaluationRecordIdentity) {
  const content = asRecord(record.content);
  for (const key of LEGACY_ID_KEYS[record.recordType] || ["id"]) {
    const value = text(content[key]);
    if (value) return value;
  }
  return record.id;
}

export function buildEvaluationLegacyIdMap(
  records: EvaluationRecordIdentity[],
) {
  return new Map(
    records.map((record) => [record.id, evaluationRecordLegacyId(record)]),
  );
}

export function mapEvaluationLegacyReferences(
  value: unknown,
  legacyIdByDatabaseId: Map<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      mapEvaluationLegacyReferences(item, legacyIdByDatabaseId),
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        mapEvaluationLegacyReferences(item, legacyIdByDatabaseId),
      ]),
    );
  }
  const mapped = legacyIdByDatabaseId.get(text(value));
  return mapped || value;
}

export async function findEvaluationRecordByIdentifier(
  recordType: string,
  identifier: unknown,
  client: Pick<ReturnType<typeof getDb>, "evaluationRecord"> = getDb(),
) {
  const normalized = text(identifier);
  if (!normalized) return null;
  const direct = await client.evaluationRecord.findFirst({
    where: {
      recordType,
      OR: [{ id: normalized }, { code: normalized }],
    },
  });
  if (direct) return direct;

  const candidates = await client.evaluationRecord.findMany({
    where: { recordType },
  });
  return (
    candidates.find(
      (candidate) => evaluationRecordLegacyId(candidate) === normalized,
    ) || null
  );
}

export function evaluationRecordIdentifiers(record: EvaluationRecordIdentity) {
  const content = asRecord(record.content);
  return Array.from(
    new Set(
      [
        record.id,
        record.code,
        evaluationRecordLegacyId(record),
        ...((LEGACY_ID_KEYS[record.recordType] || ["id"]).map(
          (key) => content[key],
        )),
      ]
        .map(text)
        .filter(Boolean),
    ),
  );
}
