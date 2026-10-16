const TRAITS = ["H", "S", "X", "A", "C", "O"] as const;
const GT_KEYS = ["GT1", "GT2", "GT3", "GT4", "GT5"] as const;

export type RecruitmentHexacoTrait = (typeof TRAITS)[number];
export type RecruitmentGtKey = (typeof GT_KEYS)[number];
export type RecruitmentHexacoThreshold = { high: number; low: number };
export type RecruitmentGtContribution = Record<RecruitmentGtKey, number>;
export type RecruitmentFormScoringConfig = {
  gtMap: Record<string, Record<number, RecruitmentGtContribution>>;
  hexacoMap: RecruitmentHexacoTrait[][];
  thresholds: Record<RecruitmentHexacoTrait, RecruitmentHexacoThreshold>;
  usedFallbackHexacoMap: boolean;
};

export const RECRUITMENT_FALLBACK_THRESHOLDS: Record<
  RecruitmentHexacoTrait,
  RecruitmentHexacoThreshold
> = {
  A: { high: 6, low: -3 },
  C: { high: 6, low: -3 },
  H: { high: 4, low: -2 },
  O: { high: 5, low: -3 },
  S: { high: 4, low: -4 },
  X: { high: 3, low: -2 },
};

export const RECRUITMENT_FALLBACK_HEXACO_MAP: RecruitmentHexacoTrait[][] = [
  ["C", "X", "A"], ["A", "O", "S"], ["C", "H", "X"], ["S", "C", "H"],
  ["X", "C", "H"], ["C", "O", "A"], ["O", "X", "C"], ["A", "O", "S"],
  ["C", "H", "A"], ["A", "O", "S"], ["X", "C", "A"], ["S", "C", "H"],
  ["H", "X", "C"], ["C", "O", "S"], ["C", "H", "X"], ["O", "A", "S"],
  ["X", "C", "H"], ["C", "O", "A"], ["H", "A", "C"], ["A", "O", "S"],
  ["C", "H", "A"], ["S", "O", "A"], ["X", "C", "H"], ["S", "O", "A"],
  ["H", "A", "C"], ["A", "O", "C"], ["C", "A", "O"], ["O", "A", "S"],
  ["H", "C", "H"], ["S", "O", "A"], ["H", "O", "C"], ["A", "O", "S"],
  ["C", "H", "A"], ["O", "A", "S"], ["X", "C", "A"], ["S", "C", "A"],
];

export function normalizeRecruitmentSheetText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function finiteNumber(value: unknown) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyGtContribution(): RecruitmentGtContribution {
  return { GT1: 0, GT2: 0, GT3: 0, GT4: 0, GT5: 0 };
}

function parseRecruitmentGtMap(rows: unknown[][]) {
  const gtMap: Record<string, Record<number, RecruitmentGtContribution>> = {};
  let scenario = 0;
  let chip = 0;

  rows.forEach((row) => {
    const scenarioCell = String(row[1] ?? "").trim();
    const chipText = String(row[2] ?? "").trim();
    const formula = String(row[3] ?? "").trim();
    const match = scenarioCell.match(/^Tình huống\s*(\d+)/i);
    if (match) {
      scenario = Number.parseInt(match[1], 10);
      gtMap[String(scenario)] = {};
      chip = 0;
      return;
    }
    if (!scenario || !/^Mình\b/i.test(chipText)) return;

    chip += 1;
    const contribution = emptyGtContribution();
    (formula.match(/GT[1-5]\s*[+\-−]\s*\d+/g) || []).forEach((token) => {
      const parsed = token.match(/(GT[1-5])\s*([+\-−])\s*(\d+)/);
      if (!parsed) return;
      const key = parsed[1] as RecruitmentGtKey;
      contribution[key] =
        (parsed[2] === "-" || parsed[2] === "−" ? -1 : 1) *
        Number.parseInt(parsed[3], 10);
    });
    GT_KEYS.forEach((key, index) => {
      const override = finiteNumber(row[index + 6]);
      if (override != null) contribution[key] = Math.trunc(override);
    });
    gtMap[String(scenario)][chip] = contribution;
  });

  for (let scenario = 1; scenario <= 6; scenario += 1) {
    if (Object.keys(gtMap[String(scenario)] || {}).length !== 12) {
      throw new Error(
        `Cấu hình Giá trị văn hóa chưa đủ 12 lựa chọn cho Tình huống ${scenario}.`,
      );
    }
  }
  return gtMap;
}

export function parseRecruitmentFormScoringConfig(
  rows: unknown[][],
): RecruitmentFormScoringConfig {
  const thresholds = { ...RECRUITMENT_FALLBACK_THRESHOLDS };
  rows.forEach((row) => {
    const trait = String(row[5] ?? "").trim() as RecruitmentHexacoTrait;
    const high = finiteNumber(row[7]);
    const low = finiteNumber(row[8]);
    if (TRAITS.includes(trait) && high != null && low != null) {
      thresholds[trait] = { high, low };
    }
  });

  const parsedMap: RecruitmentHexacoTrait[][] = [];
  let currentQuestion: number | null = null;
  let current: Partial<Record<"A" | "B" | "C", RecruitmentHexacoTrait>> = {};
  const flush = () => {
    if (currentQuestion == null) return;
    parsedMap[currentQuestion - 1] = [
      current.A,
      current.B,
      current.C,
    ].filter(Boolean) as RecruitmentHexacoTrait[];
  };

  rows.forEach((row) => {
    const questionText = normalizeRecruitmentSheetText(row[1]);
    const optionText = String(row[2] ?? "").trim();
    const trait = String(row[5] ?? "").trim() as RecruitmentHexacoTrait;
    const questionMatch = questionText.match(/^(\d+)\)\s/);
    if (questionMatch) {
      flush();
      currentQuestion = Number.parseInt(questionMatch[1], 10);
      current = {};
      return;
    }
    const optionMatch = optionText.match(/^([ABCabc])\./);
    if (!currentQuestion || !optionMatch || !TRAITS.includes(trait)) return;
    current[optionMatch[1].toUpperCase() as "A" | "B" | "C"] = trait;
    if (current.A && current.B && current.C) {
      flush();
      currentQuestion = null;
      current = {};
    }
  });
  flush();

  const validMap =
    parsedMap.length === 36 &&
    parsedMap.every(
      (entry) =>
        entry?.length === 3 && entry.every((trait) => TRAITS.includes(trait)),
    );
  return {
    gtMap: parseRecruitmentGtMap(rows),
    hexacoMap: validMap ? parsedMap : RECRUITMENT_FALLBACK_HEXACO_MAP,
    thresholds,
    usedFallbackHexacoMap: !validMap,
  };
}

function optionLetter(value: unknown) {
  return String(value ?? "")
    .trim()
    .match(/^([ABCabc])\./)?.[1]
    ?.toUpperCase() as "A" | "B" | "C" | undefined;
}

function parseChips(value: unknown) {
  const chips: number[] = [];
  const expression = /#\s*(\d+)\s*\./g;
  const content = String(value ?? "");
  let match: RegExpExecArray | null;
  while ((match = expression.exec(content)) !== null) {
    chips.push(Number.parseInt(match[1], 10));
  }
  return chips;
}

export function findRecruitmentFormColumns(headers: unknown[]) {
  const normalized = headers.map(normalizeRecruitmentSheetText);
  const most: number[] = [];
  const least: number[] = [];
  for (let question = 1; question <= 36; question += 1) {
    const prefix = `${question})`;
    let mostIndex = normalized.findIndex(
      (header) =>
        header.startsWith(prefix) && header.includes("(1) giong ban nhat"),
    );
    let leastIndex = normalized.findIndex(
      (header) =>
        header.startsWith(prefix) && header.includes("(2) khong giong ban"),
    );
    if (mostIndex < 0) {
      mostIndex = normalized.findIndex(
        (header) => header.startsWith(prefix) && header.includes("(1)"),
      );
    }
    if (leastIndex < 0) {
      leastIndex = normalized.findIndex(
        (header) => header.startsWith(prefix) && header.includes("(2)"),
      );
    }
    if (mostIndex < 0 || leastIndex < 0) {
      throw new Error(`Không tìm thấy đủ hai cột HEXACO cho câu ${question}.`);
    }
    most.push(mostIndex);
    least.push(leastIndex);
  }
  const culture = Array.from({ length: 6 }, (_, index) => {
    const scenario = index + 1;
    const found = normalized.findIndex((header) =>
      header.startsWith(`tinh huong ${scenario}`),
    );
    if (found < 0) {
      throw new Error(`Không tìm thấy cột Giá trị văn hóa Tình huống ${scenario}.`);
    }
    return found;
  });
  const code = normalized.findIndex((header) =>
    ["ma phong van", "ma ung vien"].includes(header),
  );
  if (code < 0) throw new Error("Không tìm thấy cột Mã phỏng vấn.");
  return { code, culture, least, most };
}

export function normalizeRecruitmentGtProfile(
  absolute: RecruitmentGtContribution,
) {
  const values = GT_KEYS.map((key) => absolute[key] || 0);
  if (values.every((value) => value === 0)) {
    return { GT1: 50, GT2: 50, GT3: 50, GT4: 50, GT5: 50 };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  const deviation = Math.sqrt(variance) || 1;
  return Object.fromEntries(
    GT_KEYS.map((key, index) => {
      const zScore = (values[index] - mean) / deviation;
      return [key, Math.round(((Math.tanh(zScore / 2) + 1) / 2) * 100)];
    }),
  ) as RecruitmentGtContribution;
}

export function scoreRecruitmentFormSubmission(input: {
  config: RecruitmentFormScoringConfig;
  headers: unknown[];
  row: unknown[];
}) {
  const columns = findRecruitmentFormColumns(input.headers);
  const hex = { A: 0, C: 0, H: 0, O: 0, S: 0, X: 0 } as Record<
    RecruitmentHexacoTrait,
    number
  >;
  const detailHex: Array<{
    addTrait: string;
    least: string;
    most: string;
    q: number;
    subTrait: string;
  }> = [];
  const optionIndex = { A: 0, B: 1, C: 2 } as const;
  for (let question = 0; question < 36; question += 1) {
    const mostAnswer = input.row[columns.most[question]];
    const leastAnswer = input.row[columns.least[question]];
    const mostLetter = optionLetter(mostAnswer);
    const leastLetter = optionLetter(leastAnswer);
    const addTrait = mostLetter
      ? input.config.hexacoMap[question]?.[optionIndex[mostLetter]] || ""
      : "";
    const subTrait = leastLetter
      ? input.config.hexacoMap[question]?.[optionIndex[leastLetter]] || ""
      : "";
    if (addTrait) hex[addTrait] += 1;
    if (subTrait) hex[subTrait] -= 1;
    detailHex.push({
      addTrait,
      least: String(leastAnswer ?? ""),
      most: String(mostAnswer ?? ""),
      q: question + 1,
      subTrait,
    });
  }

  const levels = Object.fromEntries(
    TRAITS.map((trait) => {
      const threshold = input.config.thresholds[trait];
      return [
        trait,
        hex[trait] >= (threshold.high + threshold.low) / 2 ? "Cao" : "Thấp",
      ];
    }),
  ) as Record<RecruitmentHexacoTrait, string>;

  const totals = emptyGtContribution();
  columns.culture.forEach((column, scenarioIndex) => {
    const chips = parseChips(input.row[column]);
    if (!chips.length) return;
    const raw = emptyGtContribution();
    const counts = emptyGtContribution();
    const scenarioMap = input.config.gtMap[String(scenarioIndex + 1)] || {};
    chips.forEach((chip) => {
      const contribution = scenarioMap[chip];
      if (!contribution) return;
      GT_KEYS.forEach((key) => {
        const value = contribution[key] || 0;
        if (!value) return;
        raw[key] += value;
        counts[key] += 1;
      });
    });
    GT_KEYS.forEach((key) => {
      if (counts[key]) totals[key] += raw[key] / (counts[key] * 2);
    });
  });
  const gtAbsolute = Object.fromEntries(
    GT_KEYS.map((key) => [key, Math.round((totals[key] / 6 + 1) * 50)]),
  ) as RecruitmentGtContribution;
  const gtProfile = normalizeRecruitmentGtProfile(gtAbsolute);
  const ordered = TRAITS.map((trait) => [trait, hex[trait]] as const);
  const peak = ordered.reduce((best, item) => (item[1] > best[1] ? item : best));
  const pit = ordered.reduce((best, item) => (item[1] < best[1] ? item : best));

  return {
    code: String(input.row[columns.code] ?? "").trim(),
    detailHex,
    gtAbsolute,
    gtProfile,
    hex,
    levels,
    peak: `${peak[0]}: ${peak[1]}`,
    pit: `${pit[0]}: ${pit[1]}`,
  };
}

export const RECRUITMENT_FORM_TRAITS = TRAITS;
export const RECRUITMENT_FORM_GT_KEYS = GT_KEYS;
