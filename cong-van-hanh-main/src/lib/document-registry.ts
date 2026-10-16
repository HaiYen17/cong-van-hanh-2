// Engine cấp số văn bản — bám buildCapGiayCycleKey_ / poolKey / render bản Hành chính cũ.
import { TOKEN_BY_KEY, type FormatToken } from "@/lib/document-numbering";

export function normalizeCompare(v: string): string {
  return (v || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, "");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// cycleKey theo ngày ký (dùng lịch UTC để khớp giá trị ngày người dùng nhập).
export function buildCycleKey(cycle: string | null | undefined, signDate: Date): string {
  const y = signDate.getUTCFullYear();
  const m = pad2(signDate.getUTCMonth() + 1);
  const d = pad2(signDate.getUTCDate());
  const c = normalizeCompare(cycle || "");
  if (c.includes("theongay")) return `${y}${m}${d}`;
  if (c.includes("theothang")) return `${y}${m}`;
  if (c.includes("theogioihan")) return `${y}-limit`;
  return `${y}`; // Theo năm (mặc định)
}

// poolKey = loại văn bản + viết tắt công ty + chu kỳ. STT tăng trong cùng pool.
export function buildPoolKey(docTypeId: string, companyShort: string, cycleKey: string): string {
  return [docTypeId, normalizeCompare(companyShort), cycleKey].join("||");
}

function serialMaskLen(tokens: FormatToken[]): number {
  const serial = tokens.find((t) => t.type === "SERIAL");
  const mask = serial?.value || "###";
  return (mask.match(/#/g) || []).length || 1;
}

// STT tối đa cho phép (nếu có giới hạn vòng lặp).
export function maxSerial(startIndex: number, cycleLimit: number | null | undefined): number {
  const limit = Number(cycleLimit || 0);
  return limit > 0 ? startIndex + limit - 1 : 999999;
}

export function effectiveDocumentStartIndex(
  defaultStartIndex: number,
  companyStartIndex?: number | null,
): number {
  const companyStart = Number(companyStartIndex || 0);
  if (Number.isInteger(companyStart) && companyStart > 0) return companyStart;
  const fallback = Number(defaultStartIndex || 0);
  return Number.isInteger(fallback) && fallback > 0 ? fallback : 1;
}

export type NumberingSlot = {
  serial: number;
  status: string;
};

// Không tự lấp các khoảng trống lịch sử vì có thể đó là số đã phát hành ngoài
// hệ thống trước khi migrate. Chỉ tái dùng slot được đánh dấu CANCELLED rõ ràng;
// nếu không thì tiếp tục sau số ISSUED lớn nhất của đúng pháp nhân + chu kỳ.
export function nextDocumentSerial(
  startIndex: number,
  ceiling: number,
  slots: NumberingSlot[],
): number | null {
  const start = effectiveDocumentStartIndex(startIndex);
  const issuedSerials = new Set(
    slots
      .filter((slot) => slot.status === "ISSUED")
      .map((slot) => slot.serial),
  );
  const reusable = slots
    .filter(
      (slot) =>
        slot.status === "CANCELLED" &&
        !issuedSerials.has(slot.serial) &&
        slot.serial >= start &&
        slot.serial <= ceiling,
    )
    .map((slot) => slot.serial)
    .sort((left, right) => left - right)[0];
  if (reusable != null) return reusable;

  const issuedMax = [...issuedSerials].reduce(
    (max, serial) => Math.max(max, serial),
    start - 1,
  );
  const candidate = Math.max(start, issuedMax + 1);
  return candidate <= ceiling ? candidate : null;
}

// Render số văn bản cuối cùng theo ngày ký + STT thật.
export function renderNumber(
  tokens: FormatToken[],
  serial: number,
  companyShort: string,
  signDate: Date,
  customText = "",
): string {
  const maskLen = serialMaskLen(tokens);
  const sample: Record<string, string> = {
    DD: pad2(signDate.getUTCDate()),
    MM: pad2(signDate.getUTCMonth() + 1),
    YY: String(signDate.getUTCFullYear()).slice(-2),
    YYYY: String(signDate.getUTCFullYear()),
  };
  return tokens
    .map((tk) => {
      const def = TOKEN_BY_KEY.get(tk.type);
      if (!def) return "";
      switch (def.kind) {
        case "separator":
          return def.literal ?? "";
        case "company":
          return (companyShort || "CTY").replace(/\s+/g, "").toUpperCase();
        case "custom":
          return customText.trim();
        case "date":
          return sample[def.key] ?? "";
        case "serial":
          return String(serial).padStart(maskLen, "0");
        case "fixed":
          return (tk.value || "").trim();
        default:
          return "";
      }
    })
    .join("");
}
