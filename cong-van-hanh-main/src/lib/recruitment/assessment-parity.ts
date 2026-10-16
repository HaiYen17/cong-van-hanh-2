import { asRecord, numberValue, text, type JsonRecord } from "@/lib/operations/json";

export type RecruitmentCultureChip = {
  code: string;
  label: string;
  order: number;
};

export type RecruitmentCultureValue = {
  gtKey: string;
  gtName: string;
  order: number;
  chips: RecruitmentCultureChip[];
};

export const DEFAULT_RECRUITMENT_CULTURE_VALUES: RecruitmentCultureValue[] = [
  {
    gtKey: "GT1",
    gtName: "Làm chủ tương lai",
    order: 1,
    chips: [
      { code: "GT1_KIENTAO", label: "Tập trung vào giải pháp", order: 1 },
      { code: "GT1_CHUDONG", label: "Chủ động với lời cam kết", order: 2 },
      { code: "GT1_TRACHNHIEM", label: "Nhận trách nhiệm", order: 3 },
    ],
  },
  {
    gtKey: "GT2",
    gtName: "Thắng không kiêu - Bại không nản",
    order: 2,
    chips: [
      { code: "GT2_KIENGCUONG", label: "Kiên cường", order: 1 },
      { code: "GT2_KHIEMNHUONG", label: "Không kiêu ngạo", order: 2 },
    ],
  },
  {
    gtKey: "GT3",
    gtName: "Chân thành là gốc rễ của mối quan hệ tốt đẹp",
    order: 3,
    chips: [
      { code: "GT3_NOIRA", label: "Nói ra", order: 1 },
      { code: "GT3_KHONGXUYENTAC", label: "Không xuyên tạc", order: 2 },
      { code: "GT3_SUTHAT", label: "Tôn trọng sự thật", order: 3 },
    ],
  },
  {
    gtKey: "GT4",
    gtName: "Thấu hiểu - Chia sẻ - Cùng nhau phát triển",
    order: 4,
    chips: [
      { code: "GT4_DATMINH", label: "Đặt mình vào vị trí người khác", order: 1 },
      { code: "GT4_LOIICHCHUNG", label: "Vì lợi ích chung", order: 2 },
      { code: "GT4_HAILONG", label: "Hướng tới sự hài lòng", order: 3 },
    ],
  },
  {
    gtKey: "GT5",
    gtName: "Cầu thị - Học hỏi - Để tiến lên",
    order: 5,
    chips: [
      { code: "GT5_LANGNGHE", label: "Lắng nghe", order: 1 },
      { code: "GT5_THICHNGHI", label: "Học để hành", order: 2 },
      { code: "GT5_SANGTAO", label: "Sáng tạo đổi mới", order: 3 },
    ],
  },
];

type CultureConfigRecord = {
  code?: string | null;
  content?: unknown;
  name?: string | null;
};

export function normalizeRecruitmentCultureValues(
  records: CultureConfigRecord[],
): RecruitmentCultureValue[] {
  const normalized = records
    .map((record, index) => {
      const content = asRecord(record.content);
      const gtKey = text(content.gtKey || content.GT_Code || record.code);
      const gtName = text(content.gtName || content.GT_Name || record.name);
      const rawChips = Array.isArray(content.chips) ? content.chips : [];
      const chips = rawChips
        .map((raw, chipIndex) => {
          const chip = asRecord(raw);
          const code = text(chip.code || chip.Chip_Code);
          const label = text(chip.label || chip.Chip_Label);
          if (!code || !label) return null;
          return {
            code,
            label,
            order: Math.max(1, Math.round(numberValue(chip.order || chip.Order, chipIndex + 1))),
          };
        })
        .filter((chip): chip is RecruitmentCultureChip => Boolean(chip))
        .sort((left, right) => left.order - right.order);
      if (!gtKey || !gtName || !chips.length) return null;
      return {
        gtKey,
        gtName,
        order: Math.max(1, Math.round(numberValue(content.order || content.Order, index + 1))),
        chips,
      };
    })
    .filter((value): value is RecruitmentCultureValue => Boolean(value))
    .sort((left, right) => left.order - right.order);

  return normalized.length ? normalized : DEFAULT_RECRUITMENT_CULTURE_VALUES;
}

export function normalizeLookup(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseJsonRecord(value: unknown): JsonRecord {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

const HEXACO_TRAITS = ["H", "S", "X", "A", "C", "O"] as const;
const HEXACO_LABELS = [
  "Chân thật - Khiêm nhường",
  "Điềm tĩnh - Vững vàng",
  "Hướng ngoại",
  "Dễ chịu - Hợp tác",
  "Tận tâm - Kỷ luật",
  "Cởi mở trải nghiệm",
];
const HEXACO_FALLBACK_THRESHOLDS: Record<string, { high: number; low: number }> = {
  H: { high: 4, low: -2 },
  S: { high: 4, low: -4 },
  X: { high: 3, low: -2 },
  A: { high: 6, low: -3 },
  C: { high: 6, low: -3 },
  O: { high: 5, low: -3 },
};
const HEXACO_GROUP_CONFIG: Record<
  string,
  { peak: string[]; pit: string[] }
> = {
  H: { peak: ["X", "O"], pit: ["S", "A"] },
  S: { peak: ["X", "O"], pit: ["A", "C"] },
  X: { peak: ["A", "C"], pit: ["H", "S"] },
  A: { peak: ["X", "C"], pit: ["H", "S"] },
  C: { peak: ["X", "O"], pit: ["S", "A"] },
  O: { peak: ["H", "C"], pit: ["S", "X"] },
};
const HEXACO_FALLBACK_NAMES: Record<string, string> = {
  H: "Chân thật và khiêm nhường",
  S: "Điềm tĩnh và vững vàng",
  X: "Hướng ngoại và tạo ảnh hưởng",
  A: "Dễ chịu và hợp tác",
  C: "Tận tâm và kỷ luật",
  O: "Cởi mở và đổi mới",
};

type PersonalityConfigRecord = {
  code?: string | null;
  content?: unknown;
  name?: string | null;
};

export function normalizeHexacoPersonality(
  payloadValue: unknown,
  baseRecords: PersonalityConfigRecord[],
  profileRecords: PersonalityConfigRecord[],
) {
  const payload = asRecord(payloadValue);
  const detail = parseJsonRecord(payload["Detail(JSON)"] || payload.detail);
  const detailHex = asRecord(detail.hex);
  const detailLevels = asRecord(detail.lvl);
  const raw = HEXACO_TRAITS.map((trait) =>
    numberValue(payload[trait] ?? detailHex[trait]),
  );
  const hasResult = HEXACO_TRAITS.some(
    (trait) => payload[trait] != null || detailHex[trait] != null,
  );
  if (!hasResult) return null;

  const thresholds = { ...HEXACO_FALLBACK_THRESHOLDS };
  for (const record of baseRecords) {
    const content = asRecord(record.content);
    const trait = text(content.column_6).toUpperCase();
    const high = Number(content.column_8);
    const low = Number(content.column_9);
    if (
      HEXACO_TRAITS.includes(trait as (typeof HEXACO_TRAITS)[number]) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      high !== low
    ) {
      thresholds[trait] = { high, low };
    }
  }
  const percentages = HEXACO_TRAITS.map((trait, index) => {
    const threshold = thresholds[trait];
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(
          ((raw[index] - threshold.low) / (threshold.high - threshold.low)) *
            10_000,
        ) / 100,
      ),
    );
  });
  const levels: Record<string, string> = {};
  HEXACO_TRAITS.forEach((trait) => {
    levels[trait] = text(
      payload[`${trait}_lvl`] ??
        payload[`${trait}_level`] ??
        detailLevels[trait],
    );
  });
  let peakIndex = 0;
  let pitIndex = 0;
  percentages.forEach((value, index) => {
    if (value > percentages[peakIndex]) peakIndex = index;
    if (value < percentages[pitIndex]) pitIndex = index;
  });
  const profileRows = profileRecords.map((record) => {
    const content = asRecord(record.content);
    return {
      analysis: text(content["Phân tích"] || content.analysis),
      code: text(content["Code dò"] || content.Code || record.code),
      detail: text(content["Chi tiết"] || content.detail),
      groupName: text(content["Tên nhóm"] || content.groupName || record.name),
      needs: text(content["Điều họ cần"] || content.needs),
      risk: text(content["Rủi ro"] || content.risk),
      roles: text(content["Vai trò phù hợp"] || content.roles),
    };
  });
  function group(kind: "peak" | "pit", trait: string, pct: number) {
    let code = `${kind === "peak" ? "Đỉnh" : "Đáy"} ${trait}`;
    for (const secondary of HEXACO_GROUP_CONFIG[trait]?.[kind] || []) {
      const level = normalizeLookup(levels[secondary]);
      if (level.includes("cao")) code += ` | ${secondary} Cao`;
      else if (level.includes("thap")) code += ` | ${secondary} Thấp`;
    }
    const expected = normalizeLookup(code);
    const base = normalizeLookup(`${kind === "peak" ? "Đỉnh" : "Đáy"} ${trait}`);
    const matched =
      profileRows.find((row) => normalizeLookup(row.code) === expected) ||
      profileRows.find((row) => normalizeLookup(row.code).startsWith(base));
    return {
      analysis: matched?.analysis || "",
      code,
      detail: matched?.detail || "",
      groupName: matched?.groupName || HEXACO_FALLBACK_NAMES[trait] || trait,
      needs: matched?.needs || "",
      pct,
      risk: matched?.risk || "",
      roles: matched?.roles || "",
      trait,
    };
  }
  const detailGt = asRecord(detail.gt);
  const detailGtAbsolute = asRecord(detail.gtAbs);
  const detailGtProfile = asRecord(detail.gtProfile);
  const gtCodes = ["GT1", "GT2", "GT3", "GT4", "GT5"];
  const gtScores = gtCodes.map((code) =>
    numberValue(
      payload[code] ??
        detailGtProfile[code] ??
        detailGt[code] ??
        detailGtAbsolute[code],
    ),
  );
  const cultureValues = gtCodes.map((code, index) => ({
    absolute: numberValue(detailGtAbsolute[code]),
    code,
    name:
      DEFAULT_RECRUITMENT_CULTURE_VALUES.find((value) => value.gtKey === code)
        ?.gtName || code,
    score: gtScores[index],
  }));
  let culturePeak = 0;
  let culturePit = 0;
  cultureValues.forEach((value, index) => {
    if (value.score > cultureValues[culturePeak].score) culturePeak = index;
    if (value.score < cultureValues[culturePit].score) culturePit = index;
  });
  return {
    completedAt: text(payload["Dấu thời gian"] || detail.lastUpdated),
    cultureProfile: {
      peak: cultureValues[culturePeak],
      pit: cultureValues[culturePit],
      values: cultureValues,
    },
    gtScores,
    labels: HEXACO_LABELS,
    levels,
    peak: group("peak", HEXACO_TRAITS[peakIndex], percentages[peakIndex]),
    percentages,
    pit: group("pit", HEXACO_TRAITS[pitIndex], percentages[pitIndex]),
    raw,
  };
}

export type LegacySnapshotInput = {
  createdAt?: Date | string | null;
  id: string;
  kind: string;
  payload: unknown;
  sourceUpdatedAt?: Date | string | null;
};

type LegacyEvaluationEntry = {
  items: JsonRecord[];
  reasonUpdate: string;
  round: string;
  time: string;
  updatedBy: string;
  version: number;
};

export type LegacyAssessmentVersion = {
  applicationId: string;
  candidateCode: string;
  createdAt: string;
  decision: string;
  editRevision: number;
  finalScore: number | "";
  historyReason: string;
  id: string;
  isHistoricLog: true;
  isLegacy: true;
  legacyScoring: { culture: JsonRecord[]; source: string; tech: JsonRecord[] };
  legacySectionMeta: JsonRecord;
  overallComment: string;
  reviewerName: string;
  roundKey: string;
  roundLabel: string;
  scorecardId: string;
  scoringMode: "jd";
  status: "submitted";
  submittedAt: string;
  updatedAt: string;
  version: number;
};

export function normalizeLegacyRound(value: unknown) {
  const normalized = normalizeLookup(value);
  if (
    normalized.includes("so van") ||
    normalized.includes("so khao") ||
    normalized === "preliminary"
  ) {
    return "preliminary";
  }
  if (
    normalized.includes("vong 2") ||
    normalized.includes("v2") ||
    normalized === "round 2" ||
    normalized === "round_2"
  ) {
    return "round_2";
  }
  if (
    normalized.includes("vong 1") ||
    normalized.includes("v1") ||
    normalized === "round 1" ||
    normalized === "round_1"
  ) {
    return "round_1";
  }
  return "";
}

function normalizeLegacyItems(itemsValue: unknown, kind: "tech" | "culture") {
  if (!Array.isArray(itemsValue)) return [];
  return itemsValue.map((raw, index) => {
    const item = asRecord(raw);
    if (kind === "culture") {
      return {
        chips: Array.isArray(item.chips) ? item.chips.map(asRecord) : [],
        gtKey: text(item.gtKey) || `GT${index + 1}`,
        gtName: text(item.gtName || item.gtKey) || `Giá trị ${index + 1}`,
        note: text(item.note),
        score: item.score === "" || item.score == null ? "" : numberValue(item.score),
      };
    }
    const detailPayload = parseJsonRecord(item.detailPayload);
    const bonusFlags = asRecord(detailPayload.bonusFlags);
    return {
      bonusLearn: Boolean(item.bonusLearn ?? bonusFlags.learn),
      bonusTech: Boolean(item.bonusTech ?? bonusFlags.tech),
      detailPayload,
      groupName:
        text(item.groupName || detailPayload.groupName || detailPayload.output) ||
        `Nhóm công việc ${index + 1}`,
      itemName: text(detailPayload.output || detailPayload.itemName),
      level:
        item.level === "" || item.level == null
          ? numberValue(detailPayload.level, 0)
          : numberValue(item.level),
      note: text(item.note),
      score: item.score === "" || item.score == null ? "" : numberValue(item.score),
    };
  });
}

function legacyEntries(
  detail: JsonRecord,
  kind: "tech" | "culture",
  forcedRound: string,
  sourceKind: string,
) {
  const isTech = kind === "tech";
  const currentKey = isTech ? "techEval" : "gtEval";
  const historyKey = isTech ? "techEvalHistory" : "gtEvalHistory";
  const prefix = sourceKind === "preliminary" ? "sv" : isTech ? "" : "gt";
  const history = Array.isArray(detail[historyKey]) ? detail[historyKey] : [];
  const entries: LegacyEvaluationEntry[] = history
    .map((raw, index) => {
      const item = asRecord(raw);
      return {
        items: normalizeLegacyItems(item.items, kind),
        reasonUpdate: text(item.reasonUpdate),
        round: forcedRound || text(item.round || item.historyUpdatedRound),
        time: text(item.time),
        updatedBy: text(item.updatedBy),
        version: index + 1,
      };
    })
    .filter((entry) => entry.items.length);
  const current = normalizeLegacyItems(detail[currentKey], kind);
  if (current.length) {
    entries.push({
      items: current,
      reasonUpdate: "",
      round:
        forcedRound ||
        text(
          detail[`${prefix}UpdatedRound`] ||
            detail[`${isTech ? "" : "gt"}UpdatedRound`] ||
            detail.updatedRound ||
            detail.firstEvalRound,
        ),
      time: text(
        detail[`${prefix}LastUpdated`] ||
          detail[`${isTech ? "" : "gt"}LastUpdated`] ||
          detail.lastUpdated ||
          detail.firstEvalTime,
      ),
      updatedBy: text(
        detail[`${prefix}UpdatedBy`] ||
          detail[`${isTech ? "" : "gt"}UpdatedBy`] ||
          detail.updatedBy ||
          detail.firstEvalBy,
      ),
      version: entries.length + 1,
    });
  }
  const byRound = new Map<string, LegacyEvaluationEntry[]>();
  for (const entry of entries) {
    const round = forcedRound || normalizeLegacyRound(entry.round) || "round_1";
    byRound.set(round, [...(byRound.get(round) || []), entry]);
  }
  const output: LegacyEvaluationEntry[] = [];
  for (const [round, roundEntries] of byRound.entries()) {
    roundEntries
      .sort((left, right) => Date.parse(left.time || "") - Date.parse(right.time || ""))
      .forEach((entry, index) => {
        output.push({ ...entry, round, version: index + 1 });
      });
  }
  return output;
}

function roundLabel(round: string) {
  if (round === "preliminary") return "Sơ vấn";
  if (round === "round_2") return "Vòng 2";
  return "Vòng 1";
}

export function buildLegacyAssessmentVersions(
  snapshots: LegacySnapshotInput[],
  applicationId: string,
  candidateCode: string,
) {
  const latestByKind = new Map<string, LegacySnapshotInput>();
  for (const snapshot of snapshots) {
    if (!['hexaco', 'so-van'].includes(snapshot.kind)) continue;
    const current = latestByKind.get(snapshot.kind);
    const timestamp = new Date(snapshot.sourceUpdatedAt || snapshot.createdAt || 0).getTime();
    const currentTimestamp = new Date(
      current?.sourceUpdatedAt || current?.createdAt || 0,
    ).getTime();
    if (!current || timestamp >= currentTimestamp) latestByKind.set(snapshot.kind, snapshot);
  }
  const versions: LegacyAssessmentVersion[] = [];
  for (const snapshot of latestByKind.values()) {
    const payload = asRecord(snapshot.payload);
    const detail = parseJsonRecord(
      payload["Detail(JSON)"] || payload["SV_Detail(JSON)"],
    );
    const sourceKind = snapshot.kind === "so-van" ? "preliminary" : "hexaco";
    const forcedRound = sourceKind === "preliminary" ? "preliminary" : "";
    const techEntries = legacyEntries(detail, "tech", forcedRound, sourceKind);
    const cultureEntries = legacyEntries(detail, "culture", forcedRound, sourceKind);
    const grouped = new Map<
      string,
      {
        culture: JsonRecord[];
        meta: LegacyEvaluationEntry[];
        round: string;
        sectionMeta: Partial<Record<"tech" | "culture", LegacyEvaluationEntry>>;
        tech: JsonRecord[];
        version: number;
      }
    >();
    const add = (entry: LegacyEvaluationEntry, section: "tech" | "culture") => {
      const round = forcedRound || normalizeLegacyRound(entry.round) || "round_1";
      const key = `${round}|${entry.version}`;
      const group = grouped.get(key) || {
        culture: [],
        meta: [],
        round,
        sectionMeta: {},
        tech: [],
        version: entry.version,
      };
      group[section] = entry.items;
      group.sectionMeta[section] = entry;
      group.meta.push(entry);
      grouped.set(key, group);
    };
    techEntries.forEach((entry) => add(entry, "tech"));
    cultureEntries.forEach((entry) => add(entry, "culture"));
    for (const group of grouped.values()) {
      const meta = [...group.meta].sort(
        (left, right) => Date.parse(right.time || "") - Date.parse(left.time || ""),
      )[0];
      const scores = [...group.tech, ...group.culture]
        .map((item) => Number(item.score))
        .filter(Number.isFinite);
      const overallComment = [...group.tech, ...group.culture]
        .map((item) => text(item.note))
        .filter(Boolean)
        .slice(0, 3)
        .join(" · ");
      const id = `legacy-log:${snapshot.id}:${group.round}:${group.version}`;
      versions.push({
        applicationId,
        candidateCode,
        createdAt: meta?.time || "",
        decision: "",
        editRevision: 0,
        finalScore: scores.length
          ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
          : "",
        historyReason: meta?.reasonUpdate || "",
        id,
        isHistoricLog: true,
        isLegacy: true,
        legacyScoring: {
          culture: group.culture,
          source: sourceKind,
          tech: group.tech,
        },
        legacySectionMeta: {
          culture: group.sectionMeta.culture
            ? {
                reasonUpdate: group.sectionMeta.culture.reasonUpdate,
                reviewerName: group.sectionMeta.culture.updatedBy,
                updatedAt: group.sectionMeta.culture.time,
                version: group.sectionMeta.culture.version,
              }
            : {},
          technical: group.sectionMeta.tech
            ? {
                reasonUpdate: group.sectionMeta.tech.reasonUpdate,
                reviewerName: group.sectionMeta.tech.updatedBy,
                updatedAt: group.sectionMeta.tech.time,
                version: group.sectionMeta.tech.version,
              }
            : {},
        },
        overallComment,
        reviewerName: meta?.updatedBy || "Người chấm trước đây",
        roundKey: group.round,
        roundLabel: roundLabel(group.round),
        scorecardId: id,
        scoringMode: "jd",
        status: "submitted",
        submittedAt: meta?.time || "",
        updatedAt: meta?.time || "",
        version: group.version,
      });
    }
  }
  return versions.sort((left, right) => {
    const order = { preliminary: 0, round_1: 1, round_2: 2 };
    const roundDifference =
      (order[left.roundKey as keyof typeof order] ?? 9) -
      (order[right.roundKey as keyof typeof order] ?? 9);
    return roundDifference || left.version - right.version;
  });
}

export function calculateRecruitmentScore(
  items: Array<{
    bonusLearning?: boolean;
    bonusTechnical?: boolean;
    level?: number | null;
    score?: number | null;
    sectionKey?: string;
    weight?: number | null;
  }>,
) {
  if (!items.length) return 0;
  let total = 0;
  let totalWeight = 0;
  for (const item of items) {
    const weight = Math.max(numberValue(item.weight, 1), 0);
    if (weight <= 0) continue;
    const score =
      item.sectionKey === "preliminary"
        ? Math.min(
            10,
            numberValue(item.level) * 2 +
              Number(Boolean(item.bonusTechnical)) +
              Number(Boolean(item.bonusLearning)),
          )
        : numberValue(item.score);
    total += score * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round((total / totalWeight) * 100) / 100 : 0;
}
