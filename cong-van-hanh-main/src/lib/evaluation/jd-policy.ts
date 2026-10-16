export type SharedJdSource =
  "evaluation-new" | "evaluation-legacy" | "scoring-legacy" | "none";

export type JdRecordInput = {
  id: string;
  code?: string | null;
  content?: unknown;
  name?: string | null;
  sourceRow?: number | null;
  status?: string | null;
  updatedAt?: Date | string | null;
};

export type SelectedJdRecord = {
  isLegacy: boolean;
  matchQuality: number;
  record: JdRecordInput;
  title: string;
};

export type SharedJdPolicySelection = {
  evaluation: SelectedJdRecord | null;
  scoring: SelectedJdRecord | null;
  source: SharedJdSource;
};

const BC_PREFIX = /^\s*\[BC\]\s*(?:[-–—:]\s*)?/i;

const VIETNAMESE_JOB_TITLE_WORDS: Record<string, string> = {
  bao: "bảo",
  bo: "bộ",
  canh: "cảnh",
  cap: "cấp",
  cb: "C&B",
  cham: "chăm",
  chi: "chi",
  chinh: "chính",
  chuyen: "chuyên",
  chu: "chủ",
  chuc: "chức",
  cong: "công",
  co: "cơ",
  cua: "cửa",
  cuahang: "cửa hàng",
  dao: "đào",
  dich: "dịch",
  dieu: "điều",
  dien: "điện",
  doc: "đốc",
  dot: "đốt",
  dong: "đóng",
  dung: "dựng",
  duong: "dưỡng",
  giam: "giám",
  gia: "giá",
  giao: "giao",
  goi: "gói",
  hang: "hàng",
  hanh: "hành",
  he: "hệ",
  hnag: "hàng",
  hoa: "hóa",
  hoach: "hoạch",
  hop: "hợp",
  hut: "hút",
  khai: "khai",
  ke: "kế",
  kien: "kiến",
  kiem: "kiểm",
  khi: "khí",
  kho: "kho",
  khoi: "khối",
  ky: "kỹ",
  lam: "làm",
  luc: "lực",
  ly: "lý",
  lo: "lò",
  mua: "mua",
  nem: "nệm",
  nguon: "nguồn",
  nhan: "nhân",
  nhanh: "nhánh",
  nhiem: "nhiệm",
  nhom: "nhóm",
  no: "nợ",
  noi: "nội",
  phat: "phát",
  phi: "phí",
  phong: "phòng",
  pho: "phó",
  phu: "phụ",
  quan: "quản",
  san: "sản",
  so: "số",
  soat: "soát",
  soc: "sóc",
  sinh: "sinh",
  su: "sự",
  tai: "tài",
  tap: "tập",
  tao: "tạo",
  thanh: "thành",
  thiet: "thiết",
  thuat: "thuật",
  thuc: "thực",
  thue: "thuế",
  thong: "thống",
  tho: "thợ",
  tmdt: "TMĐT",
  to: "tổ",
  toan: "toán",
  tong: "tổng",
  trach: "trách",
  trien: "triển",
  trinh: "trình",
  tri: "trì",
  truong: "trưởng",
  tuan: "tuân",
  van: "vận",
  va: "và",
  ve: "vệ",
  vien: "viên",
  vu: "vụ",
  xay: "xây",
  xe: "xế",
  xuat: "xuất",
};

export function asJdContent(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

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

function asciiKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function deriveEvaluationJdTitle(value: unknown) {
  return text(value)
    .replace(/\.(?:docx?|pdf)$/i, "")
    .replace(/^\d{6,8}[_\s-]*/i, "")
    .replace(/^JD[_\s-]*/i, "")
    .replace(BC_PREFIX, "")
    .replace(/\s*(?:\(\d+\)|copy\s*\d*|bản sao\s*\d*)\s*$/i, "")
    .replace(/([A-ZĐ]{2,})([A-ZĐ][a-zà-ỹ])/g, "$1 $2")
    .replace(/([a-zà-ỹ])([A-ZĐ])/g, "$1 $2")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function restoreEvaluationJdTitle(value: unknown) {
  const words = deriveEvaluationJdTitle(value).split(/\s+/).filter(Boolean);
  const restored = words.map((word, index) => {
    const key = asciiKey(word);
    const previous = asciiKey(words[index - 1]);
    const next = asciiKey(words[index + 1]);
    const afterNext = asciiKey(words[index + 2]);

    if (/^(?:[a-z]+\d+[a-z0-9]*|\d+[a-z][a-z0-9]*)$/i.test(word)) {
      return word.toUpperCase();
    }
    if (key === "ban") {
      return next === "giam" && afterNext === "doc" ? "ban" : "bán";
    }
    if (key === "quan") return previous === "canh" ? "quan" : "quản";
    if (key === "gia") return previous === "chuyen" ? "gia" : "giá";
    if (key === "su") return previous === "cao" ? "su" : "sự";
    if (key === "thu") return next === "quy" || next === "kho" ? "thủ" : "thu";
    if (key === "quy") return "quỹ";
    if (key === "thanh" && next === "toan") return "thanh";
    if (key === "dung" && previous === "su") return "dụng";
    if (VIETNAMESE_JOB_TITLE_WORDS[key]) return VIETNAMESE_JOB_TITLE_WORDS[key];
    if (/^[A-ZĐ0-9&]{2,}$/.test(word)) return word;
    return word.toLowerCase();
  });
  if (!restored.length) return "";
  restored[0] =
    restored[0].charAt(0).toLocaleUpperCase("vi") + restored[0].slice(1);
  return restored.join(" ").replace(/\s+&\s+/g, " & ");
}

function collapseSpacedAlphaNumericCodes(value: string) {
  let resolved = value;
  for (let pass = 0; pass < 3; pass += 1) {
    resolved = resolved
      .replace(/\b([A-Za-z])\s+(?=\d[A-Za-z0-9]*\b)/g, "$1")
      .replace(/\b([A-Za-z]\d)\s+(?=[A-Za-z]\b)/g, "$1");
  }
  return resolved;
}

export function normalizePositionKey(value: unknown) {
  return collapseSpacedAlphaNumericCodes(text(value))
    .replace(BC_PREFIX, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/^TITLE[\s_-]+/, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function positionAliasKeys(value: unknown) {
  const key = normalizePositionKey(value);
  if (!key) return [];
  const withoutGenericLevel = key.replace(
    /^(?:NHAN_VIEN|CHUYEN_VIEN|NV|CV)_/,
    "",
  );
  return Array.from(new Set([key, withoutGenericLevel].filter(Boolean)));
}

export function matchEvaluationJdDirectoryTitle(
  input: {
    fileName?: unknown;
    storedTitles?: unknown[];
  },
  directoryTitles: unknown[],
) {
  const candidates = [
    ...(input.storedTitles || []),
    deriveEvaluationJdTitle(input.fileName),
    restoreEvaluationJdTitle(input.fileName),
  ].filter((value) => text(value));
  const matches = directoryTitles
    .map(text)
    .filter(Boolean)
    .filter((directoryTitle) =>
      candidates.some((candidate) => {
        const candidateKeys = positionAliasKeys(candidate);
        const directoryKeys = positionAliasKeys(directoryTitle);
        return candidateKeys.some((key) => directoryKeys.includes(key));
      }),
    );
  return (
    matches.sort((left, right) => {
      const leftExact = candidates.some(
        (candidate) =>
          normalizePositionKey(candidate) === normalizePositionKey(left),
      );
      const rightExact = candidates.some(
        (candidate) =>
          normalizePositionKey(candidate) === normalizePositionKey(right),
      );
      return (
        Number(rightExact) - Number(leftExact) ||
        left.localeCompare(right, "vi")
      );
    })[0] || ""
  );
}

export function canonicalEvaluationJdTitle(
  input: {
    fileName?: unknown;
    recordName?: unknown;
    storedTitles?: unknown[];
  },
  directoryTitles: unknown[] = [],
) {
  const storedTitle = firstText(input.storedTitles || []);
  const restoredTitle = restoreEvaluationJdTitle(input.fileName);
  const directoryTitle = matchEvaluationJdDirectoryTitle(
    input,
    directoryTitles,
  );
  if (directoryTitle) return directoryTitle;
  if (
    storedTitle &&
    restoredTitle &&
    normalizePositionKey(storedTitle) === normalizePositionKey(restoredTitle)
  ) {
    return restoredTitle;
  }
  return (
    storedTitle ||
    restoredTitle ||
    deriveEvaluationJdTitle(input.fileName) ||
    text(input.recordName)
  );
}

function positionKeysMatch(positionKey: string, candidate: unknown) {
  const candidateKeys = positionAliasKeys(candidate);
  if (candidateKeys.includes(positionKey)) return 2;
  const positionKeys = positionAliasKeys(positionKey);
  return positionKeys.some((key) => candidateKeys.includes(key)) ? 1 : 0;
}

export function getEvaluationJdTitle(record: JdRecordInput) {
  const content = asJdContent(record.content);
  return canonicalEvaluationJdTitle({
    fileName: content.fileName,
    recordName: record.name,
    storedTitles: [
      content.mappedJobTitleName,
      content.personnelJobTitleName,
      content.jobTitleName,
      content.displayTitle,
      content.docTitle,
      content.name,
      record.name,
    ],
  });
}

export function isLegacyBcDocument(record: JdRecordInput) {
  const content = asJdContent(record.content);
  return [
    content.displayTitle,
    content.docTitle,
    content.name,
    record.name,
  ].some((value) => BC_PREFIX.test(text(value)));
}

function inferTitleFromFileName(value: unknown) {
  return deriveEvaluationJdTitle(value);
}

export function isSelectableEvaluationJd(record: JdRecordInput) {
  const content = asJdContent(record.content);
  const status = text(record.status || content.status).toLowerCase();
  return (
    content.isActive !== false &&
    !text(content.duplicateOfDocumentId) &&
    !["inactive", "deleted"].includes(status)
  );
}

export function selectEvaluationJdByIdentifier(
  identifier: unknown,
  documents: JdRecordInput[],
) {
  const target = text(identifier);
  if (!target) return null;
  return (
    documents.find((record) => {
      if (!isSelectableEvaluationJd(record)) return false;
      const content = asJdContent(record.content);
      return [
        record.id,
        record.code,
        content.id,
        content.jdDocumentId,
        content.providerFileId,
        content.fileId,
      ].some((value) => text(value) === target);
    }) || null
  );
}

function evaluationMatchQuality(positionKey: string, record: JdRecordInput) {
  const content = asJdContent(record.content);
  const keyGroups = [
    [
      content.jobTitleMatchKey,
      content.mappedJobTitleCode,
      content.jobTitleCode,
    ],
    [
      content.jobTitleName,
      content.personnelJobTitleName,
      content.mappedJobTitleName,
    ],
    [content.displayTitle, content.docTitle, content.name, record.name],
    [inferTitleFromFileName(content.fileName)],
  ];

  for (let index = 0; index < keyGroups.length; index += 1) {
    const closeness = Math.max(
      ...keyGroups[index].map((candidate) =>
        positionKeysMatch(positionKey, candidate),
      ),
    );
    if (closeness) return (keyGroups.length - index) * 2 + closeness;
  }
  return 0;
}

function activeRank(record: JdRecordInput) {
  const content = asJdContent(record.content);
  const status = text(record.status || content.status).toLowerCase();
  return status === "active" || content.isActive === true ? 1 : 0;
}

function availabilityRank(record: JdRecordInput) {
  const content = asJdContent(record.content);
  const availability = text(content.availabilityStatus).toLowerCase();
  if (availability === "current" || availability === "available") return 2;
  if (availability === "archived") return 0;
  return 1;
}

function dateRank(record: JdRecordInput) {
  const content = asJdContent(record.content);
  const value = firstText([
    content.driveModifiedAt,
    content.effectiveDate,
    content.updatedAt,
    record.updatedAt,
    content.Date,
  ]);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericIdRank(record: JdRecordInput) {
  const content = asJdContent(record.content);
  const value = Number(content.id || record.sourceRow || 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Chính sách nghiệp vụ đã chốt:
 * 1. Khớp đúng vị trí.
 * 2. Nếu có JD không mang tiền tố [BC], luôn chọn nhóm này.
 * 3. Chỉ dùng JD [BC] khi không có JD mới cho vị trí.
 * 4. Trạng thái/ngày sửa chỉ được dùng để xếp hạng bên trong cùng một nhóm.
 */
export function selectPreferredEvaluationJd(
  position: string,
  documents: JdRecordInput[],
) {
  const positionKey = normalizePositionKey(position);
  if (!positionKey) return null;

  const candidates = documents
    .filter(isSelectableEvaluationJd)
    .map((record): SelectedJdRecord | null => {
      const matchQuality = evaluationMatchQuality(positionKey, record);
      if (!matchQuality) return null;
      return {
        isLegacy: isLegacyBcDocument(record),
        matchQuality,
        record,
        title: getEvaluationJdTitle(record),
      };
    })
    .filter((candidate): candidate is SelectedJdRecord => Boolean(candidate));

  candidates.sort((left, right) => {
    if (left.isLegacy !== right.isLegacy) return left.isLegacy ? 1 : -1;
    return (
      right.matchQuality - left.matchQuality ||
      activeRank(right.record) - activeRank(left.record) ||
      availabilityRank(right.record) - availabilityRank(left.record) ||
      dateRank(right.record) - dateRank(left.record) ||
      numericIdRank(right.record) - numericIdRank(left.record) ||
      left.record.id.localeCompare(right.record.id)
    );
  });

  return candidates[0] || null;
}

function scoringMatchQuality(positionKey: string, record: JdRecordInput) {
  const content = asJdContent(record.content);
  return Math.max(
    ...[content.PositionKey, content.Position, record.name].map((candidate) =>
      positionKeysMatch(positionKey, candidate),
    ),
  );
}

export function selectPreferredScoringJd(
  position: string,
  records: JdRecordInput[],
) {
  const positionKey = normalizePositionKey(position);
  if (!positionKey) return null;

  const candidates = records
    .map((record): SelectedJdRecord | null => {
      const matchQuality = scoringMatchQuality(positionKey, record);
      if (!matchQuality) return null;
      const content = asJdContent(record.content);
      return {
        isLegacy: true,
        matchQuality,
        record,
        title: firstText([
          content.Position,
          record.name,
          content.FileName,
          position,
        ]),
      };
    })
    .filter((candidate): candidate is SelectedJdRecord => Boolean(candidate));

  candidates.sort(
    (left, right) =>
      dateRank(right.record) - dateRank(left.record) ||
      numericIdRank(right.record) - numericIdRank(left.record) ||
      left.record.id.localeCompare(right.record.id),
  );
  return candidates[0] || null;
}

export function selectSharedJdByPolicy(
  position: string,
  evaluationDocuments: JdRecordInput[],
  scoringDocuments: JdRecordInput[],
): SharedJdPolicySelection {
  const evaluation = selectPreferredEvaluationJd(position, evaluationDocuments);
  if (evaluation) {
    return {
      evaluation,
      scoring: null,
      source: evaluation.isLegacy ? "evaluation-legacy" : "evaluation-new",
    };
  }

  const scoring = selectPreferredScoringJd(position, scoringDocuments);
  return {
    evaluation: null,
    scoring,
    source: scoring ? "scoring-legacy" : "none",
  };
}
