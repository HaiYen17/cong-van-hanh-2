import type { ResolvedSharedJd } from "@/lib/evaluation/jd-resolution";

export type EvaluationPlanningRecord = {
  id: string;
  recordType: string;
  parentId?: string | null;
  legacyId?: string | null;
  code?: string | null;
  name?: string | null;
  status?: string | null;
  content: unknown;
};

export type EvaluationScorePlanRow = {
  code: string;
  name: string;
  content: Record<string, unknown>;
};

export type EvaluationScorePlan = {
  instancePatch: Record<string, unknown>;
  rows: EvaluationScorePlanRow[];
  sectionLabels: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function sectionLabel(value: unknown) {
  const cleaned = text(value).replace(/^\u0110\u00e1nh gi\u00e1\s+/iu, "");
  const normalized = cleaned
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
  if (
    normalized.includes("chuyen mon") ||
    normalized.includes("ket qua cong viec")
  ) {
    return "Chuyên môn";
  }
  if (normalized.includes("van hoa")) return "Văn hóa";
  return cleaned
    ? cleaned.charAt(0).toLocaleUpperCase("vi") + cleaned.slice(1)
    : "";
}

function numberValue(value: unknown, fallback = 0) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const resolved = text(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(resolved)) return true;
  if (["false", "0", "no", "n"].includes(resolved)) return false;
  return fallback;
}

function recordContent(record: EvaluationPlanningRecord | null | undefined) {
  return asRecord(record?.content);
}

function recordReference(record: EvaluationPlanningRecord | null | undefined) {
  const content = recordContent(record);
  return text(
    content.id ||
      record?.legacyId ||
      content.code ||
      record?.code ||
      record?.id,
  );
}

function recordReferences(record: EvaluationPlanningRecord | null | undefined) {
  const content = recordContent(record);
  return new Set(
    [record?.id, record?.legacyId, record?.code, content.id, content.code]
      .map(text)
      .filter(Boolean),
  );
}

function recordMatchesReference(
  record: EvaluationPlanningRecord,
  references: unknown[],
) {
  const keys = recordReferences(record);
  return references
    .map(text)
    .filter(Boolean)
    .some((value) => keys.has(value));
}

function isActiveRecord(record: EvaluationPlanningRecord) {
  const content = recordContent(record);
  const status = text(record.status || content.status).toLowerCase();
  return (
    content.isActive !== false &&
    !["inactive", "deleted", "archived"].includes(status)
  );
}

function normalizeActivityType(value: unknown) {
  const resolved = text(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["management", "manager", "quan_ly", "quanly"].includes(resolved)) {
    return "management";
  }
  if (["excluded", "exclude", "bo_qua", "khong_ap_dung"].includes(resolved)) {
    return "excluded";
  }
  if (
    !resolved ||
    ["unclassified", "unknown", "chua_phan_loai"].includes(resolved)
  ) {
    return "unclassified";
  }
  return "execution";
}

function activityTypeForPlanning(
  records: EvaluationPlanningRecord[],
  content: Record<string, unknown>,
) {
  const directType = normalizeActivityType(content.activityType);
  if (directType !== "unclassified") return directType;
  const workGroup = findRecord(records, "evaluation-work-group-definition", [
    content.evaluationWorkGroupId,
    content.evaluationWorkGroupCode,
    content.evaluationWorkGroupName,
  ]);
  const workGroupContent = recordContent(workGroup);
  return normalizeActivityType(
    workGroupContent.legacyActivityType || workGroupContent.activityType,
  );
}

function normalizeFrequency(value: unknown) {
  const resolved = text(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["quarter", "quarterly", "quy", "hang_quy"].includes(resolved)) {
    return "quarterly";
  }
  if (["year", "yearly", "annual", "nam", "hang_nam"].includes(resolved)) {
    return "yearly";
  }
  return "monthly";
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(/[,;|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWeights<T extends { baseWeight: number }>(items: T[]) {
  if (!items.length) return [] as Array<T & { normalizedWeight: number }>;
  const total = items.reduce(
    (sum, item) => sum + Math.max(0, item.baseWeight),
    0,
  );
  return items.map((item) => ({
    ...item,
    normalizedWeight:
      total > 0
        ? (Math.max(0, item.baseWeight) / total) * 100
        : 100 / items.length,
  }));
}

function findRecord(
  records: EvaluationPlanningRecord[],
  recordType: string,
  references: unknown[],
) {
  return (
    records.find(
      (record) =>
        record.recordType === recordType &&
        isActiveRecord(record) &&
        recordMatchesReference(record, references),
    ) || null
  );
}

function criteriaDefinitions(
  records: EvaluationPlanningRecord[],
  criteriaSetReferences: unknown[],
) {
  const setRecord = findRecord(
    records,
    "evaluation-criteria-set",
    criteriaSetReferences,
  );
  const setReferences = new Set(
    [
      ...criteriaSetReferences,
      ...(setRecord ? Array.from(recordReferences(setRecord)) : []),
    ]
      .map(text)
      .filter(Boolean),
  );
  const itemRecords = records.filter((record) => {
    if (
      record.recordType !== "evaluation-criteria-set-item" ||
      !isActiveRecord(record)
    ) {
      return false;
    }
    const content = recordContent(record);
    return [content.criteriaSetId, content.criteriaSetCode, record.parentId]
      .map(text)
      .some((value) => setReferences.has(value));
  });

  const fromItems = itemRecords.map((item, index) => {
    const content = recordContent(item);
    const criterion = findRecord(records, "evaluation-criteria", [
      content.criteriaId,
      content.criteriaCode,
    ]);
    const criterionContent = recordContent(criterion);
    return {
      baseWeight: numberValue(content.weightPercent, 0),
      code: text(
        criterionContent.criteriaCode ||
          criterion?.code ||
          content.criteriaCode ||
          item.code,
      ),
      id: text(
        criterionContent.id ||
          criterion?.legacyId ||
          content.criteriaId ||
          item.legacyId ||
          item.id,
      ),
      name: text(
        criterionContent.criteriaName ||
          criterion?.name ||
          content.criteriaName ||
          item.name ||
          `Tiêu chí ${index + 1}`,
      ),
      scoreLevelDescriptions: asRecord(
        criterionContent.scoreLevelDescriptions ||
          content.scoreLevelDescriptions,
      ),
      scoreLevelDescriptionsEnabled: booleanValue(
        criterionContent.scoreLevelDescriptionsEnabled ??
          content.scoreLevelDescriptionsEnabled,
        false,
      ),
      scoringMethod: text(
        criterionContent.scoringMethod || content.scoringMethod || "scale_10",
      ),
      sortOrder: numberValue(content.sortOrder, index),
    };
  });
  if (fromItems.length) return normalizeWeights(fromItems);

  // Một số bộ tiêu chí cũ đã mất record cha/con nhưng các phiếu lịch sử vẫn
  // còn đủ mã, tên, thang điểm và tỷ lệ. Dùng chính lịch sử đó làm nguồn phục
  // hồi thay vì rơi về một bộ tiêu chí không liên quan.
  const historical = new Map<
    string,
    {
      baseWeight: number;
      code: string;
      id: string;
      name: string;
      scoringMethod: string;
      scoreLevelDescriptions: Record<string, unknown>;
      scoreLevelDescriptionsEnabled: boolean;
      sortOrder: number;
    }
  >();
  records.forEach((record, index) => {
    if (record.recordType !== "evaluation-criteria-score") return;
    const content = recordContent(record);
    const belongs = [content.criteriaSetId, content.criteriaSetCode]
      .map(text)
      .some((value) => setReferences.has(value));
    if (!belongs) return;
    const key = text(
      content.criteriaId || content.criteriaCode || content.criteriaName,
    );
    if (!key) return;
    const current = historical.get(key);
    const candidateWeight = Math.max(0, numberValue(content.weightPercent, 0));
    historical.set(key, {
      baseWeight: Math.max(current?.baseWeight || 0, candidateWeight),
      code: text(content.criteriaCode),
      id: text(content.criteriaId || key),
      name: text(content.criteriaName || record.name || key),
      scoreLevelDescriptions: asRecord(content.scoreLevelDescriptions),
      scoreLevelDescriptionsEnabled: booleanValue(
        content.scoreLevelDescriptionsEnabled,
        false,
      ),
      scoringMethod: text(content.scoringMethod || "scale_10"),
      sortOrder: current?.sortOrder ?? numberValue(content.sortOrder, index),
    });
  });
  return normalizeWeights(Array.from(historical.values()));
}

function resolveSections(
  records: EvaluationPlanningRecord[],
  cycle: EvaluationPlanningRecord,
  member: EvaluationPlanningRecord,
): Array<Record<string, unknown>> {
  const cycleContent = recordContent(cycle);
  const memberContent = recordContent(member);
  const cycleTypeIds = new Set(
    [cycleContent.cycleTypeTemplateId, cycleContent.cycleTypeId]
      .map(text)
      .filter(Boolean),
  );
  const cycleTypeCodes = new Set(
    [cycleContent.cycleTypeCode].map(text).filter(Boolean),
  );
  const configuredSections = records
    .filter((record) => {
      if (
        record.recordType !== "evaluation-cycle-type-score-group" ||
        !isActiveRecord(record)
      ) {
        return false;
      }
      const content = recordContent(record);
      if (!booleanValue(content.isEnabled, true)) return false;
      return (
        [content.cycleTypeTemplateId, content.cycleTypeId]
          .map(text)
          .some((value) => cycleTypeIds.has(value)) ||
        [content.cycleTypeCode]
          .map(text)
          .some((value) => cycleTypeCodes.has(value))
      );
    })
    .map((record): Record<string, unknown> => ({
      ...recordContent(record),
      _record: record,
    }))
    .sort(
      (left, right) =>
        numberValue(left.sortOrder, 0) - numberValue(right.sortOrder, 0),
    );

  const memberCriteriaSetId = text(memberContent.criteriaSetId);
  if (!memberCriteriaSetId || memberCriteriaSetId === "0") {
    return configuredSections;
  }
  const set = findRecord(records, "evaluation-criteria-set", [
    memberCriteriaSetId,
    memberContent.criteriaSetCode,
  ]);
  if (!set) return configuredSections;
  const setContent = recordContent(set);
  const overrideSection = {
    contentMode: "criteria_set",
    criteriaSetCode: text(setContent.criteriaSetCode || set.code),
    criteriaSetId: recordReference(set),
    criteriaSetName: text(setContent.criteriaSetName || set.name),
    scoreGroupCode: text(setContent.scoreGroupCode),
    scoreGroupId: text(setContent.scoreGroupId),
  };
  const dynamicIndex = configuredSections.findIndex(
    (section) => text(section.contentMode).toLowerCase() === "jd_dynamic",
  );
  if (dynamicIndex < 0) {
    // Tương thích với dữ liệu cũ: khi loại đánh giá không có phần JD,
    // bộ tiêu chí chọn riêng của nhân sự vẫn là toàn bộ nội dung phiếu.
    return [
      {
        ...overrideSection,
        evaluatorRoles: "self, manager",
        sortOrder: 10,
        weightPercent: 100,
      },
    ];
  }
  // Bộ tiêu chí chọn riêng chỉ thay phần Chuyên môn theo JD. Các phần
  // cố định của Loại đánh giá (Văn hóa, Hành vi, KPI...) phải được giữ lại.
  return configuredSections.map((section, index) =>
    index === dynamicIndex ? { ...section, ...overrideSection } : section,
  );
}

function ruleForActivity(
  records: EvaluationPlanningRecord[],
  cycle: EvaluationPlanningRecord,
  section: Record<string, unknown>,
  jd: ResolvedSharedJd,
  activity: EvaluationPlanningRecord,
) {
  const activityContent = recordContent(activity);
  const overrideReferences = [
    activityContent.criteriaSetOverrideId,
    activityContent.criteriaSetOverrideCode,
  ];
  const overrideSet = findRecord(
    records,
    "evaluation-criteria-set",
    overrideReferences,
  );
  if (overrideSet || overrideReferences.map(text).some(Boolean)) {
    return {
      criteriaSetCode: text(
        recordContent(overrideSet).criteriaSetCode ||
          overrideSet?.code ||
          activityContent.criteriaSetOverrideCode,
      ),
      criteriaSetId: text(
        recordReference(overrideSet) || activityContent.criteriaSetOverrideId,
      ),
      criteriaSetName: text(
        recordContent(overrideSet).criteriaSetName || overrideSet?.name,
      ),
    };
  }

  const cycleContent = recordContent(cycle);
  const documentContent = asRecord(jd.document?.content);
  const sourceKeys = new Set(
    [
      section.evaluationSourceId,
      section.sourceId,
      section.sourceCode,
      documentContent.evaluationSourceId,
      documentContent.sourceId,
      documentContent.sourceCode,
    ]
      .map(text)
      .filter(Boolean),
  );
  const type = activityTypeForPlanning(records, activityContent);
  const candidates = records.filter((record) => {
    if (
      record.recordType !== "evaluation-jd-activity-rule" ||
      !isActiveRecord(record)
    ) {
      return false;
    }
    const content = recordContent(record);
    if (normalizeActivityType(content.activityType) !== type) return false;
    const ruleSourceKeys = [
      content.evaluationSourceId,
      content.sourceId,
      content.sourceCode,
    ]
      .map(text)
      .filter(Boolean);
    return (
      !sourceKeys.size ||
      !ruleSourceKeys.length ||
      ruleSourceKeys.some((key) => sourceKeys.has(key))
    );
  });
  const cycleTypeIds = new Set(
    [cycleContent.cycleTypeTemplateId, cycleContent.cycleTypeId]
      .map(text)
      .filter(Boolean),
  );
  const cycleTypeCodes = new Set(
    [cycleContent.cycleTypeCode].map(text).filter(Boolean),
  );
  const workGroupKeys = new Set(
    [
      activityContent.evaluationWorkGroupId,
      activityContent.evaluationWorkGroupCode,
      activityContent.evaluationWorkGroupName,
    ]
      .map(text)
      .filter(Boolean),
  );
  const criteriaMappings = Array.isArray(documentContent.criteriaMappings)
    ? documentContent.criteriaMappings.map(asRecord)
    : [];
  const matchingMappings = criteriaMappings.filter((mapping) =>
    [
      mapping.evaluationWorkGroupId,
      mapping.evaluationWorkGroupCode,
      mapping.evaluationWorkGroupName,
      mapping.workGroupId,
      mapping.workGroupCode,
      mapping.workGroupName,
    ]
      .map(text)
      .filter(Boolean)
      .some((key) => workGroupKeys.has(key)),
  );
  const scopedMapping = matchingMappings.find(
    (mapping) =>
      [mapping.cycleTypeTemplateId, mapping.cycleTypeId]
        .map(text)
        .some((value) => cycleTypeIds.has(value)) ||
      [mapping.cycleTypeCode]
        .map(text)
        .some((value) => cycleTypeCodes.has(value)),
  );
  const defaultMapping = matchingMappings.find(
    (mapping) =>
      !text(
        mapping.cycleTypeTemplateId ||
          mapping.cycleTypeId ||
          mapping.cycleTypeCode,
      ),
  );
  const selectedMapping = scopedMapping || defaultMapping || null;
  if (selectedMapping) {
    const mappedSet = findRecord(records, "evaluation-criteria-set", [
      selectedMapping.criteriaSetId,
      selectedMapping.criteriaSetCode,
    ]);
    const mappedSetContent = recordContent(mappedSet);
    return {
      criteriaSetCode: text(
        mappedSetContent.criteriaSetCode ||
          mappedSet?.code ||
          selectedMapping.criteriaSetCode,
      ),
      criteriaSetId: text(
        recordReference(mappedSet) || selectedMapping.criteriaSetId,
      ),
      criteriaSetName: text(
        mappedSetContent.criteriaSetName ||
          mappedSet?.name ||
          selectedMapping.criteriaSetName,
      ),
    };
  }
  const scoped = candidates.find((record) => {
    const content = recordContent(record);
    return (
      [content.cycleTypeTemplateId, content.cycleTypeId]
        .map(text)
        .some((value) => cycleTypeIds.has(value)) ||
      [content.cycleTypeCode]
        .map(text)
        .some((value) => cycleTypeCodes.has(value))
    );
  });
  const selected =
    scoped ||
    candidates.find((record) => {
      const content = recordContent(record);
      return !text(
        content.cycleTypeTemplateId ||
          content.cycleTypeId ||
          content.cycleTypeCode,
      );
    }) ||
    null;
  const selectedContent = recordContent(selected);
  return {
    criteriaSetCode: text(selectedContent.criteriaSetCode),
    criteriaSetId: text(selectedContent.criteriaSetId),
    criteriaSetName: text(selectedContent.criteriaSetName),
  };
}

function buildActivityEntries(
  jd: ResolvedSharedJd,
  allowedFrequencies: string[],
) {
  const allowed = new Set(allowedFrequencies.map(normalizeFrequency));
  const activities = (jd.activities as EvaluationPlanningRecord[]).filter(
    (activity) => {
      const content = recordContent(activity);
      const type = normalizeActivityType(content.activityType);
      const hasAssignedWorkGroup = Boolean(
        text(
          content.evaluationWorkGroupId ||
            content.evaluationWorkGroupCode ||
            content.evaluationWorkGroupName,
        ),
      );
      return (
        content.isIncluded !== false &&
        type !== "excluded" &&
        (type !== "unclassified" || hasAssignedWorkGroup) &&
        (!allowed.size || allowed.has(normalizeFrequency(content.frequency)))
      );
    },
  );
  const groups = jd.workGroups as EvaluationPlanningRecord[];
  const buckets = new Map<
    string,
    {
      group: EvaluationPlanningRecord | null;
      activities: EvaluationPlanningRecord[];
      baseWeight: number;
    }
  >();
  activities.forEach((activity) => {
    const content = recordContent(activity);
    const group =
      groups.find((candidate) => {
        const candidateContent = recordContent(candidate);
        const candidateKeys = new Set(
          [
            candidate.id,
            candidate.legacyId,
            candidate.code,
            candidate.name,
            candidateContent.id,
            candidateContent.jdWorkGroupId,
            candidateContent.workGroupCode,
            candidateContent.workGroupName,
          ]
            .map(text)
            .filter(Boolean),
        );
        return [
          content.jdWorkGroupId,
          content.workGroupCode,
          content.workGroupName,
          activity.parentId,
        ]
          .map(text)
          .filter(Boolean)
          .some((key) => candidateKeys.has(key));
      }) || null;
    const groupContent = recordContent(group);
    const key = text(
      recordReference(group) ||
        content.jdWorkGroupId ||
        content.workGroupCode ||
        content.workGroupName ||
        "ungrouped",
    );
    if (!buckets.has(key)) {
      buckets.set(key, {
        activities: [],
        baseWeight: numberValue(groupContent.weightPercent, 0),
        group,
      });
    }
    buckets.get(key)!.activities.push(activity);
  });

  const weightedGroups = normalizeWeights(Array.from(buckets.values()));
  return weightedGroups.flatMap((entry) => {
    const weightedActivities = normalizeWeights(
      entry.activities.map((activity) => ({
        activity,
        baseWeight: numberValue(recordContent(activity).weightPercent, 0),
      })),
    );
    return weightedActivities.map((activityEntry) => ({
      activity: activityEntry.activity,
      activityWeightPercent: activityEntry.normalizedWeight,
      group: entry.group,
      groupWeightPercent: entry.normalizedWeight,
    }));
  });
}

function roundedWeight(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function normalizePlannedSectionWeight(
  rows: EvaluationScorePlanRow[],
  startIndex: number,
  targetWeight: number,
) {
  const sectionRows = rows.slice(startIndex);
  const lastRow = sectionRows.at(-1);
  if (!lastRow) return;
  const currentWeight = sectionRows.reduce(
    (total, row) => total + numberValue(row.content.weightPercent),
    0,
  );
  const adjustment = roundedWeight(targetWeight - currentWeight);
  if (!adjustment) return;
  lastRow.content.weightPercent = roundedWeight(
    numberValue(lastRow.content.weightPercent) + adjustment,
  );
}

export function buildEvaluationScorePlan(args: {
  cycle: EvaluationPlanningRecord;
  instance: EvaluationPlanningRecord;
  jd: ResolvedSharedJd | null;
  member: EvaluationPlanningRecord;
  records: EvaluationPlanningRecord[];
}): EvaluationScorePlan {
  const { cycle, instance, jd, member, records } = args;
  const cycleContent = recordContent(cycle);
  const instanceReference = recordReference(instance);
  const sections = resolveSections(records, cycle, member);
  if (!sections.length) {
    throw new Error("Loại đánh giá của kỳ chưa có nội dung đánh giá.");
  }

  const rows: EvaluationScorePlanRow[] = [];
  const sectionLabels: string[] = [];
  let dynamicActivityCount = 0;
  let selectedJd = false;

  sections.forEach((section) => {
    const sectionRowStart = rows.length;
    const contentMode = text(section.contentMode).toLowerCase();
    const sectionWeight = numberValue(section.weightPercent, 0);
    const evaluatorRoles = text(section.evaluatorRoles || "self, manager");
    const scoreGroup = findRecord(records, "evaluation-score-group", [
      section.scoreGroupId,
      section.scoreGroupCode,
    ]);
    const scoreGroupContent = recordContent(scoreGroup);
    const scoreGroupSortOrder = Number(scoreGroupContent.sortOrder);
    const sectionSortOrder = Number.isFinite(scoreGroupSortOrder)
      ? scoreGroupSortOrder
      : numberValue(section.sortOrder, 0);
    const scoreGroupName = text(
      scoreGroupContent.scoreGroupName ||
        scoreGroup?.name ||
        section.scoreGroupName,
    );
    const sectionReference = text(
      recordReference(
        section._record as EvaluationPlanningRecord | undefined,
      ) ||
        section.code ||
        section.criteriaSetId ||
        section.criteriaSetCode,
    );
    if (contentMode !== "jd_dynamic") {
      const criteriaSetReferences = [
        section.criteriaSetId,
        section.criteriaSetCode,
      ];
      const criteria = criteriaDefinitions(records, criteriaSetReferences);
      if (!criteria.length) {
        throw new Error(
          `Bộ tiêu chí "${text(section.criteriaSetName || section.criteriaSetCode)}" chưa có tiêu chí chi tiết.`,
        );
      }
      const criteriaSet = findRecord(
        records,
        "evaluation-criteria-set",
        criteriaSetReferences,
      );
      const criteriaSetContent = recordContent(criteriaSet);
      const criteriaSetId = text(
        recordReference(criteriaSet) || section.criteriaSetId,
      );
      const criteriaSetCode = text(
        criteriaSetContent.criteriaSetCode ||
          criteriaSet?.code ||
          section.criteriaSetCode,
      );
      const criteriaSetName = text(
        criteriaSetContent.criteriaSetName ||
          criteriaSet?.name ||
          section.criteriaSetName ||
          criteriaSetCode,
      );
      const sectionName = sectionLabel(
        scoreGroupName || section.sectionName || criteriaSetName,
      );
      criteria.forEach((criterion) => {
        rows.push({
          code: [
            "SCORE",
            instanceReference,
            criteriaSetId || criteriaSetCode,
            criterion.id || criterion.code,
          ].join("_"),
          name: criterion.name,
          content: {
            contentMode: "criteria_set",
            criteriaCode: criterion.code,
            criteriaId: criterion.id,
            criteriaName: criterion.name,
            criteriaSortOrder: criterion.sortOrder,
            criteriaSetCode,
            criteriaSetId,
            criteriaSetName,
            cycleId: recordReference(cycle),
            cycleTypeCode: text(cycleContent.cycleTypeCode),
            cycleTypeTemplateId: text(cycleContent.cycleTypeTemplateId),
            employeeScore: "",
            evaluationInstanceId: instanceReference,
            evaluatorRoles,
            instanceId: instanceReference,
            managerScore: "",
            scoreLevelDescriptions: criterion.scoreLevelDescriptions,
            scoreLevelDescriptionsEnabled:
              criterion.scoreLevelDescriptionsEnabled,
            scoreGroupName,
            sectionCode: sectionReference,
            sectionName,
            sectionSortOrder,
            sectionWeightPercent: sectionWeight,
            scoringMethod: criterion.scoringMethod,
            status: "active",
            isActive: true,
            weightPercent: roundedWeight(
              (sectionWeight * criterion.normalizedWeight) / 100,
            ),
          },
        });
      });
      normalizePlannedSectionWeight(rows, sectionRowStart, sectionWeight);
      sectionLabels.push(`${criteriaSetName} ${sectionWeight}%`);
      return;
    }

    if (!jd || jd.source === "none" || !jd.document) {
      throw new Error("Chưa tìm thấy JD phù hợp với chức danh nhân sự.");
    }
    selectedJd = true;
    const sectionName =
      sectionLabel(scoreGroupName || section.sectionName) || "Chuyên môn";
    const allowedFrequencies = stringList(
      section.jdAllowedFrequencies ||
        section.allowedJdFrequencies ||
        section.allowedFrequencies ||
        cycleContent.jdAllowedFrequencies ||
        cycleContent.allowedJdFrequencies,
    );
    const entries = buildActivityEntries(jd, allowedFrequencies);
    if (!entries.length) {
      throw new Error(
        `JD "${jd.title || jd.fileName}" chưa có đầu việc phù hợp tần suất của loại đánh giá.`,
      );
    }
    dynamicActivityCount += entries.length;
    const documentContent = asRecord(jd.document.content);
    const versionContent = asRecord(jd.version?.content);
    entries.forEach((entry) => {
      const activity = entry.activity;
      const activityContent = recordContent(activity);
      const groupContent = recordContent(entry.group);
      const criteriaSet = ruleForActivity(
        records,
        cycle,
        section,
        jd,
        activity,
      );
      const criteria = criteriaDefinitions(records, [
        criteriaSet.criteriaSetId,
        criteriaSet.criteriaSetCode,
      ]);
      if (!criteria.length) {
        throw new Error(
          `Chưa có bộ tiêu chí dùng được cho đầu việc "${text(activityContent.activityText || activity.name)}".`,
        );
      }
      const activityId = recordReference(activity);
      const activityCode = text(
        activityContent.activityCode || activity.code || activityId,
      );
      criteria.forEach((criterion) => {
        rows.push({
          code: [
            "SCORE",
            instanceReference,
            activityCode || activityId,
            criterion.id || criterion.code,
          ].join("_"),
          name: criterion.name,
          content: {
            activityCode,
            activityFrequency: normalizeFrequency(activityContent.frequency),
            activityFrequencyName: text(activityContent.frequencyName),
            activityId,
            activitySortOrder: numberValue(activityContent.sortOrder, 0),
            activityText: text(activityContent.activityText || activity.name),
            activityType: activityTypeForPlanning(records, activityContent),
            activityTypeName: text(activityContent.activityTypeName),
            activityWeightPercent: entry.activityWeightPercent,
            contentMode: "jd_dynamic",
            criteriaCode: criterion.code,
            criteriaId: criterion.id,
            criteriaName: criterion.name,
            criteriaSortOrder: criterion.sortOrder,
            criteriaSetCode: criteriaSet.criteriaSetCode,
            criteriaSetId: criteriaSet.criteriaSetId,
            criteriaSetName: criteriaSet.criteriaSetName,
            cycleId: recordReference(cycle),
            cycleTypeCode: text(cycleContent.cycleTypeCode),
            cycleTypeTemplateId: text(cycleContent.cycleTypeTemplateId),
            employeeScore: "",
            evaluationInstanceId: instanceReference,
            evaluationWorkGroupCode: text(
              activityContent.evaluationWorkGroupCode,
            ),
            evaluationWorkGroupId: text(activityContent.evaluationWorkGroupId),
            evaluationWorkGroupName: text(
              activityContent.evaluationWorkGroupName,
            ),
            evaluatorRoles,
            expectedOutputText: text(
              activityContent.expectedOutputText ||
                activityContent.expectedOutput ||
                activityContent.Output,
            ),
            instanceId: instanceReference,
            isActive: true,
            jdDocumentId: recordReference(
              jd.document as EvaluationPlanningRecord,
            ),
            jdFileName: jd.fileName,
            jdJobTitleCode: text(
              documentContent.jobTitleCode ||
                documentContent.mappedJobTitleCode,
            ),
            jdJobTitleName: text(
              documentContent.mappedJobTitleName ||
                documentContent.jobTitleName ||
                jd.title,
            ),
            jdVersionId: text(
              versionContent.id ||
                (jd.version as EvaluationPlanningRecord | null)?.legacyId ||
                (jd.version as EvaluationPlanningRecord | null)?.id,
            ),
            managerScore: "",
            scoreLevelDescriptions: criterion.scoreLevelDescriptions,
            scoreLevelDescriptionsEnabled:
              criterion.scoreLevelDescriptionsEnabled,
            scoreGroupName,
            sectionCode: sectionReference,
            sectionName,
            sectionSortOrder,
            sectionWeightPercent: sectionWeight,
            scoringMethod: criterion.scoringMethod,
            status: "active",
            weightPercent: roundedWeight(
              (sectionWeight *
                entry.groupWeightPercent *
                entry.activityWeightPercent *
                criterion.normalizedWeight) /
                1_000_000,
            ),
            workGroupCode: text(
              activityContent.workGroupCode || groupContent.workGroupCode,
            ),
            workGroupName: text(
              activityContent.workGroupName ||
                groupContent.workGroupName ||
                entry.group?.name ||
                "Công việc theo JD",
            ),
            workGroupSortOrder: numberValue(
              groupContent.sortOrder,
              Math.floor(numberValue(activityContent.sortOrder, 0) / 1000) * 10,
            ),
            workGroupWeightPercent: entry.groupWeightPercent,
          },
        });
      });
    });
    normalizePlannedSectionWeight(rows, sectionRowStart, sectionWeight);
    sectionLabels.push(`Chuyên môn theo JD ${sectionWeight}%`);
  });

  const documentContent = asRecord(jd?.document?.content);
  const versionContent = asRecord(jd?.version?.content);
  return {
    instancePatch: {
      criteriaSetCode: sections
        .map((section) => text(section.criteriaSetCode))
        .filter(Boolean)
        .join(","),
      criteriaSetName: sectionLabels.join(" + "),
      ...(selectedJd && jd?.document
        ? {
            jdDocumentId: recordReference(
              jd.document as EvaluationPlanningRecord,
            ),
            jdFileName: jd.fileName,
            jdJobTitleCode: text(
              documentContent.jobTitleCode ||
                documentContent.mappedJobTitleCode,
            ),
            jdJobTitleName: text(
              documentContent.mappedJobTitleName ||
                documentContent.jobTitleName ||
                jd.title,
            ),
            jdSource: jd.source,
            jdSourceLabel: jd.sourceLabel,
            jdVersionId: text(
              versionContent.id ||
                (jd.version as EvaluationPlanningRecord | null)?.legacyId ||
                (jd.version as EvaluationPlanningRecord | null)?.id,
            ),
            professionalActivityCount: dynamicActivityCount,
          }
        : {}),
    },
    rows,
    sectionLabels,
  };
}
