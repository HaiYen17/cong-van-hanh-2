import "server-only";

import { getDb } from "@/lib/db";
import {
  asJdContent,
  getEvaluationJdTitle,
  isLegacyBcDocument,
  normalizePositionKey,
  selectEvaluationJdByIdentifier,
  selectSharedJdByPolicy,
  type JdRecordInput,
  type SharedJdSource,
} from "@/lib/evaluation/jd-policy";

type StoredJdRecord = JdRecordInput & {
  legacyId?: string | null;
  parentId?: string | null;
  recordType?: string;
};

export type ResolvedSharedJd = {
  activities: StoredJdRecord[];
  activityCount: number;
  document: StoredJdRecord | null;
  fileName: string;
  fileUrl: string;
  isLegacy: boolean;
  legacyOutputs: StoredJdRecord[];
  position: string;
  manualOverride?: boolean;
  manualOverrideInvalid?: boolean;
  manualOverrideRequested?: boolean;
  requestKey?: string;
  source: SharedJdSource;
  sourceLabel: string;
  title: string;
  version: StoredJdRecord | null;
  workGroupCount: number;
  workGroups: StoredJdRecord[];
};

export type SharedJdRequest = {
  documentId?: string;
  position: string;
  requestKey: string;
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function firstText(values: unknown[]) {
  for (const value of values) {
    const resolved = text(value);
    if (resolved) return resolved;
  }
  return "";
}

function recordDate(record: StoredJdRecord) {
  const content = asJdContent(record.content);
  const value = firstText([
    content.driveModifiedAt,
    content.effectiveDate,
    content.updatedAt,
    record.updatedAt,
  ]);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordSortOrder(record: StoredJdRecord) {
  const content = asJdContent(record.content);
  const value = Number(content.sortOrder || record.sourceRow || 0);
  return Number.isFinite(value) ? value : 0;
}

function isActiveRecord(record: StoredJdRecord) {
  const content = asJdContent(record.content);
  const status = text(record.status || content.status).toLowerCase();
  return (
    content.isActive !== false &&
    !["inactive", "deleted", "archived"].includes(status)
  );
}

function relatesToDocument(
  child: StoredJdRecord,
  document: StoredJdRecord,
) {
  const childContent = asJdContent(child.content);
  const documentContent = asJdContent(document.content);
  const documentIds = new Set(
    [
      documentContent.id,
      document.id,
      document.legacyId,
      document.code,
    ]
      .map(text)
      .filter(Boolean),
  );
  const providerIds = new Set(
    [documentContent.providerFileId, documentContent.fileId, document.code]
      .map(text)
      .filter(Boolean),
  );
  const explicitDocumentId = text(childContent.jdDocumentId);
  const parentId = text(child.parentId);

  if (explicitDocumentId) return documentIds.has(explicitDocumentId);
  if (parentId) return documentIds.has(parentId);

  return [childContent.providerFileId, childContent.fileId]
    .map(text)
    .some((value) => providerIds.has(value));
}

function sourceLabel(source: SharedJdSource) {
  if (source === "evaluation-new") return "JD mới dùng chung";
  if (source === "evaluation-legacy") return "JD [BC] dự phòng";
  if (source === "scoring-legacy") return "File tính điểm cũ dự phòng";
  return "Chưa tìm thấy JD";
}

function resolveFileInfo(
  source: SharedJdSource,
  document: StoredJdRecord | null,
) {
  const content = asJdContent(document?.content);
  const fileId = firstText([
    content.providerFileId,
    content.fileId,
    content.FileId,
  ]);
  return {
    fileName: firstText([
      content.fileName,
      content.FileName,
      document?.name,
    ]),
    fileUrl:
      firstText([content.fileUrl, content.sourceUrl]) ||
      (fileId
        ? `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`
        : ""),
    title:
      source === "scoring-legacy"
        ? firstText([
            content.Position,
            document?.name,
            content.FileName,
            content.FileId,
          ])
        : firstText([
            content.displayTitle,
            content.docTitle,
            content.name,
            document?.name,
            content.jobTitleName,
          ]),
  };
}

function scoringOutputMatches(
  output: StoredJdRecord,
  document: StoredJdRecord,
) {
  const outputContent = asJdContent(output.content);
  const documentContent = asJdContent(document.content);
  const documentKey = normalizePositionKey(
    documentContent.PositionKey ||
      documentContent.Position ||
      document.name,
  );
  return (
    Boolean(documentKey) &&
    [outputContent.PositionKey, outputContent.Position].some(
      (value) => normalizePositionKey(value) === documentKey,
    )
  );
}

/**
 * Bộ phân giải duy nhất cho cả Đánh giá nhân sự và Đánh giá ứng viên.
 * Không module nào được tự lấy scoring-jd-* làm nguồn chính.
 */
export async function resolveSharedJdsForMembers(requests: SharedJdRequest[]) {
  const uniqueRequests = Array.from(
    new Map(
      requests
        .map((request) => ({
          documentId: text(request.documentId),
          position: text(request.position),
          requestKey: text(request.requestKey),
        }))
        .filter((request) => request.requestKey)
        .map((request) => [request.requestKey, request]),
    ).values(),
  );
  if (!uniqueRequests.length) return [];

  const db = getDb();
  const evaluationDocuments =
    (await db.evaluationRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: { recordType: "evaluation-jd-document" },
    })) as StoredJdRecord[];

  const needsScoringFallback = uniqueRequests.some(
    (request) =>
      !request.documentId &&
      selectSharedJdByPolicy(request.position, evaluationDocuments, [])
        .source === "none",
  );
  const scoringDocuments = needsScoringFallback
    ? ((await db.recruitmentConfigRecord.findMany({
        orderBy: [{ updatedAt: "desc" }, { sourceRow: "desc" }],
        where: { recordType: "scoring-jd-file" },
      })) as StoredJdRecord[])
    : [];

  const selections = uniqueRequests.map((request) => {
    const explicitDocument = request.documentId
      ? selectEvaluationJdByIdentifier(request.documentId, evaluationDocuments)
      : null;
    const policy = request.documentId
      ? explicitDocument
        ? {
            evaluation: {
              isLegacy: isLegacyBcDocument(explicitDocument),
              matchQuality: Number.MAX_SAFE_INTEGER,
              record: explicitDocument,
              title: getEvaluationJdTitle(explicitDocument),
            },
            scoring: null,
            source: isLegacyBcDocument(explicitDocument)
              ? ("evaluation-legacy" as const)
              : ("evaluation-new" as const),
          }
        : { evaluation: null, scoring: null, source: "none" as const }
      : selectSharedJdByPolicy(
          request.position,
          evaluationDocuments,
          scoringDocuments,
        );
    return { explicitDocument, policy, request };
  });
  const hasEvaluationSelection = selections.some(
    ({ policy }) => policy.evaluation,
  );
  const hasScoringSelection = selections.some(({ policy }) => policy.scoring);
  const [relatedRecords, scoringOutputs] = await Promise.all([
    hasEvaluationSelection
      ? (db.evaluationRecord.findMany({
          orderBy: { updatedAt: "desc" },
          where: {
            recordType: {
              in: [
                "evaluation-jd-version",
                "evaluation-jd-work-group",
                "evaluation-jd-activity",
              ],
            },
          },
        }) as Promise<StoredJdRecord[]>)
      : Promise.resolve([]),
    hasScoringSelection
      ? (db.recruitmentConfigRecord.findMany({
          orderBy: [{ sourceRow: "asc" }],
          where: { recordType: "scoring-jd-output" },
        }) as Promise<StoredJdRecord[]>)
      : Promise.resolve([]),
  ]);

  return selections.map(({ explicitDocument, policy, request }): ResolvedSharedJd => {
    const position = request.position;
    const document =
      (policy.evaluation?.record as StoredJdRecord | undefined) ||
      (policy.scoring?.record as StoredJdRecord | undefined) ||
      null;
    const related = document
      ? relatedRecords.filter((record) =>
          relatesToDocument(record, document),
        )
      : [];
    const versions = related
      .filter(
        (record) =>
          record.recordType === "evaluation-jd-version" ||
          asJdContent(record.content).recordType === "evaluation-jd-version",
      )
      .sort(
        (left, right) =>
          Number(isActiveRecord(right)) - Number(isActiveRecord(left)) ||
          recordDate(right) - recordDate(left),
      );
    const workGroups = related
      .filter((record) => {
        const content = asJdContent(record.content);
        return (
          (record.recordType === "evaluation-jd-work-group" ||
            content.recordType === "evaluation-jd-work-group") &&
          isActiveRecord(record)
        );
      })
      .sort(
        (left, right) =>
          recordSortOrder(left) - recordSortOrder(right) ||
          text(left.name).localeCompare(text(right.name), "vi"),
      );
    const activities = related
      .filter((record) => {
        const content = asJdContent(record.content);
        return (
          (record.recordType === "evaluation-jd-activity" ||
            content.recordType === "evaluation-jd-activity") &&
          content.isIncluded !== false &&
          isActiveRecord(record)
        );
      })
      .sort(
        (left, right) =>
          recordSortOrder(left) - recordSortOrder(right) ||
          text(left.name).localeCompare(text(right.name), "vi"),
      );
    const legacyOutputs =
      policy.source === "scoring-legacy" && document
        ? scoringOutputs.filter((record) =>
            scoringOutputMatches(record, document),
          )
        : [];
    const fileInfo = resolveFileInfo(policy.source, document);

    return {
      activities,
      activityCount: activities.length || legacyOutputs.length,
      document,
      fileName: fileInfo.fileName,
      fileUrl: fileInfo.fileUrl,
      isLegacy:
        policy.source === "evaluation-legacy" ||
        policy.source === "scoring-legacy",
      legacyOutputs,
      manualOverride: Boolean(request.documentId && explicitDocument),
      manualOverrideInvalid: Boolean(request.documentId && !explicitDocument),
      manualOverrideRequested: Boolean(request.documentId),
      position,
      requestKey: request.requestKey,
      source: policy.source,
      sourceLabel: request.documentId && explicitDocument
        ? "JD Admin chọn thủ công"
        : sourceLabel(policy.source),
      title: fileInfo.title || position,
      version: versions[0] || null,
      workGroupCount: workGroups.length,
      workGroups,
    };
  });
}

export async function resolveSharedJdsForPositions(positions: string[]) {
  const requests = Array.from(
    new Map(
      positions
        .map(text)
        .filter(Boolean)
        .map((position) => [normalizePositionKey(position), position]),
    ).entries(),
  ).map(([requestKey, position]) => ({ position, requestKey }));
  return resolveSharedJdsForMembers(requests);
}
