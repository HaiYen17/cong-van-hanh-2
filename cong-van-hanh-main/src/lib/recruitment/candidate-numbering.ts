export const REINDEXABLE_CANDIDATE_STATUSES = [
  "CV Nộp",
  "Loại CV",
  "Duyệt CV",
  "CV lưu trữ",
  "Liên hệ UV",
  "Fail call",
  "Mới nạp",
  "Lọc hồ sơ",
] as const;

export type CandidateNumberingRow = {
  candidateCode?: string | null;
  hasEvaluation?: boolean;
  id: string;
  order: number;
  requisitionCode: string;
  status?: string | null;
};

export type CandidateNumberingUpdate = {
  from: string;
  id: string;
  sequence: number;
  to: string;
};

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const reindexableStatusSet = new Set(
  REINDEXABLE_CANDIDATE_STATUSES.map(normalize),
);

export function candidateSequence(
  candidateCode: string | null | undefined,
  requisitionCode: string,
) {
  const code = String(candidateCode || "").replace(/\s+/g, "").trim();
  const request = String(requisitionCode || "").replace(/\s+/g, "").trim();
  if (!code || !request || !code.startsWith(`${request}-`)) return null;
  const tail = code.slice(request.length + 1);
  if (!/^\d{1,3}$/.test(tail)) return null;
  const sequence = Number(tail);
  return sequence >= 1 && sequence <= 999 ? sequence : null;
}

function availableDescriptor(used: Set<number>, fixed: Set<number>) {
  let firstAvailable: number | null = null;
  for (let value = 1; value <= 999; value += 1) {
    if (!used.has(value)) {
      firstAvailable = value;
      break;
    }
  }
  const tokens: Array<{ start: number; text: string }> = [];
  let rangeStart: number | null = null;
  let previous: number | null = null;
  const flush = () => {
    if (rangeStart == null || previous == null) return;
    tokens.push({
      start: rangeStart,
      text: rangeStart === previous ? `[${rangeStart}]` : `[${rangeStart},${previous}]`,
    });
    rangeStart = null;
    previous = null;
  };
  for (let value = 1; value <= 999; value += 1) {
    if (fixed.has(value) && (firstAvailable == null || value >= firstAvailable)) {
      tokens.push({ start: value, text: `{${value}}` });
    }
    if (!used.has(value)) {
      if (rangeStart == null) rangeStart = value;
      previous = value;
    } else {
      flush();
    }
  }
  flush();
  return tokens
    .sort((left, right) => left.start - right.start)
    .map((item) => item.text)
    .join(",") || "[]";
}

export function candidateAvailableOrder(used: Set<number>) {
  return availableDescriptor(used, new Set<number>());
}

export function compactCandidateNumbers(rows: CandidateNumberingRow[]) {
  const fixed = new Set<number>();
  const movable: Array<CandidateNumberingRow & { currentSequence: number | null }> = [];
  for (const row of rows) {
    const currentSequence = candidateSequence(row.candidateCode, row.requisitionCode);
    const canMove = reindexableStatusSet.has(normalize(row.status)) && !row.hasEvaluation;
    if (canMove) movable.push({ ...row, currentSequence });
    else if (currentSequence != null) fixed.add(currentSequence);
  }
  movable.sort((left, right) => {
    const leftSequence = left.currentSequence ?? Number.MAX_SAFE_INTEGER;
    const rightSequence = right.currentSequence ?? Number.MAX_SAFE_INTEGER;
    return leftSequence - rightSequence || left.order - right.order;
  });
  const used = new Set(fixed);
  const updates: CandidateNumberingUpdate[] = [];
  let nextSequence = 1;
  for (const row of movable) {
    while (nextSequence <= 999 && used.has(nextSequence)) nextSequence += 1;
    if (nextSequence > 999) {
      throw new Error(`Nhu cầu ${row.requisitionCode} đã dùng hết 999 số ứng viên.`);
    }
    const nextCode = `${row.requisitionCode}-${String(nextSequence).padStart(3, "0")}`;
    used.add(nextSequence);
    if (String(row.candidateCode || "") !== nextCode) {
      updates.push({
        from: String(row.candidateCode || ""),
        id: row.id,
        sequence: nextSequence,
        to: nextCode,
      });
    }
    nextSequence += 1;
  }
  return {
    availableOrder: availableDescriptor(used, fixed),
    fixedCount: fixed.size,
    movableCount: movable.length,
    updates,
  };
}
