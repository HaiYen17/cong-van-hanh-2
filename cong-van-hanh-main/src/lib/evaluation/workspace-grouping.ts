export type EvaluationWorkspaceScoreRecord = {
  content: Record<string, unknown>;
  id: string;
  name?: string | null;
};

export type EvaluationWorkspaceScoreActivity<T> = {
  activity: string;
  expected: string;
  key: string;
  rows: T[];
  sortOrder: number;
};

export type EvaluationWorkspaceScoreGroup<T> = {
  activities: Array<EvaluationWorkspaceScoreActivity<T>>;
  key: string;
  name: string;
  sortOrder: number;
};

export type EvaluationWorkspaceScoreSection<T> = {
  contentMode: string;
  groups: Array<EvaluationWorkspaceScoreGroup<T>>;
  key: string;
  name: string;
  sortOrder: number;
  weightPercent: number;
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function numberValue(value: unknown, fallback = 0) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

function cleanSectionName(value: unknown) {
  const cleaned = text(value).replace(/^Đánh giá\s+/i, "");
  return cleaned
    ? cleaned.charAt(0).toLocaleUpperCase("vi") + cleaned.slice(1)
    : "";
}

export function groupEvaluationWorkspaceScores<
  T extends EvaluationWorkspaceScoreRecord,
>(scores: T[]): Array<EvaluationWorkspaceScoreSection<T>> {
  type MutableActivity = EvaluationWorkspaceScoreActivity<T> & {
    insertionOrder: number;
  };
  type MutableGroup = Omit<EvaluationWorkspaceScoreGroup<T>, "activities"> & {
    activities: Map<string, MutableActivity>;
    insertionOrder: number;
  };
  type MutableSection = Omit<EvaluationWorkspaceScoreSection<T>, "groups"> & {
    groups: Map<string, MutableGroup>;
    insertionOrder: number;
  };

  const sections = new Map<string, MutableSection>();
  scores.forEach((score, index) => {
    const content = score.content || {};
    const contentMode = text(content.contentMode).toLowerCase();
    const fallbackSectionName =
      contentMode === "jd_dynamic"
        ? "Chuyên môn"
        : cleanSectionName(content.criteriaSetName) || "Nội dung đánh giá";
    const sectionName =
      cleanSectionName(content.sectionName || content.scoreGroupName) ||
      fallbackSectionName;
    const sectionKey =
      text(content.sectionCode) ||
      `${contentMode || "criteria_set"}:${sectionName}:${text(content.criteriaSetCode)}`;
    if (!sections.has(sectionKey)) {
      sections.set(sectionKey, {
        contentMode,
        groups: new Map(),
        insertionOrder: index,
        key: sectionKey,
        name: sectionName,
        sortOrder: numberValue(content.sectionSortOrder, index),
        weightPercent: numberValue(content.sectionWeightPercent, 0),
      });
    }
    const section = sections.get(sectionKey)!;
    const groupName =
      contentMode === "jd_dynamic"
        ? text(content.workGroupName) || "Công việc theo JD"
        : text(content.criteriaSetName) || sectionName;
    const groupKey =
      contentMode === "jd_dynamic"
        ? text(content.workGroupCode || content.workGroupId) || groupName
        : text(content.criteriaSetCode || content.criteriaSetId) || groupName;
    if (!section.groups.has(groupKey)) {
      section.groups.set(groupKey, {
        activities: new Map(),
        insertionOrder: index,
        key: groupKey,
        name: groupName,
        sortOrder: numberValue(content.workGroupSortOrder, index),
      });
    }
    const group = section.groups.get(groupKey)!;
    const activity =
      contentMode === "jd_dynamic"
        ? text(content.activityText) ||
          text(content.expectedOutputText) ||
          "Tiêu chí chung"
        : "Tiêu chí";
    const activityKey =
      text(content.activityCode || content.activityId) || activity;
    if (!group.activities.has(activityKey)) {
      group.activities.set(activityKey, {
        activity,
        expected: text(content.expectedOutputText),
        insertionOrder: index,
        key: activityKey,
        rows: [],
        sortOrder: numberValue(content.activitySortOrder, index),
      });
    }
    group.activities.get(activityKey)!.rows.push(score);
  });

  return Array.from(sections.values())
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.insertionOrder - right.insertionOrder,
    )
    .map((section) => ({
      contentMode: section.contentMode,
      groups: Array.from(section.groups.values())
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.insertionOrder - right.insertionOrder,
        )
        .map((group) => ({
          activities: Array.from(group.activities.values())
            .sort(
              (left, right) =>
                left.sortOrder - right.sortOrder ||
                left.insertionOrder - right.insertionOrder,
            )
            .map((activity) => ({
              activity: activity.activity,
              expected: activity.expected,
              key: activity.key,
              rows: activity.rows.sort(
                (left, right) =>
                  numberValue(left.content.criteriaSortOrder, 0) -
                    numberValue(right.content.criteriaSortOrder, 0) ||
                  text(left.name).localeCompare(text(right.name), "vi"),
              ),
              sortOrder: activity.sortOrder,
            })),
          key: group.key,
          name: group.name,
          sortOrder: group.sortOrder,
        })),
      key: section.key,
      name: section.name,
      sortOrder: section.sortOrder,
      weightPercent: section.weightPercent,
    }));
}
