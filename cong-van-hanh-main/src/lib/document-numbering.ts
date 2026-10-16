// Cấu hình đánh số văn bản — bám APP_CONFIG bản Hành chính cũ (Code.js:79-120).

export type TokenKind =
  | "separator"
  | "company"
  | "custom"
  | "date"
  | "serial"
  | "fixed";

export type TokenDef = {
  key: string;
  label: string;
  kind: TokenKind;
  literal?: string; // cho separator
  requiresConfig?: boolean; // serial (mask ###) / fixed (cụm từ)
};

// Bảng token (palette). Thứ tự hiển thị giống ConfigModal bản GAS.
export const TOKEN_DEFS: TokenDef[] = [
  { key: "DOT", label: ".", kind: "separator", literal: "." },
  { key: "SLASH", label: "/", kind: "separator", literal: "/" },
  { key: "UNDERSCORE", label: "_", kind: "separator", literal: "_" },
  { key: "HYPHEN", label: "-", kind: "separator", literal: "-" },
  { key: "LEFT_BRACKET", label: "[", kind: "separator", literal: "[" },
  { key: "RIGHT_BRACKET", label: "]", kind: "separator", literal: "]" },
  { key: "COMPANY", label: "Công ty", kind: "company" },
  {
    key: "CUSTOM_TEXT",
    label: "Cụm tự định nghĩa",
    kind: "custom",
  },
  { key: "DD", label: "DD", kind: "date" },
  { key: "MM", label: "MM", kind: "date" },
  { key: "YY", label: "YY", kind: "date" },
  { key: "YYYY", label: "YYYY", kind: "date" },
  { key: "SERIAL", label: "STT", kind: "serial", requiresConfig: true },
  {
    key: "FIXED_TEXT",
    label: "Cụm từ cố định",
    kind: "fixed",
    requiresConfig: true,
  },
];

export const TOKEN_BY_KEY = new Map(TOKEN_DEFS.map((t) => [t.key, t]));

export const DOCUMENT_CONDITIONS = [
  "HC giữ 01 bản chính",
  "Hồ sơ cần thời gian scan lưu trữ",
  "Không yêu cầu lưu",
];

export const DOCUMENT_CYCLES = ["Theo ngày", "Theo tháng", "Theo năm", "Theo giới hạn"];

export const DOCUMENT_DECLARATIONS = [
  { key: "partner", label: "Đối tác" },
  { key: "period", label: "Thời gian" },
  { key: "detail", label: "Chi tiết" },
] as const;

export type FormatToken = { type: string; value?: string };

// Ngày mẫu cố định cho xem trước (tránh dùng Date trong render — vi phạm purity lint).
const SAMPLE = { DD: "01", MM: "04", YY: "26", YYYY: "2026" } as const;

function padSerial(startIndex: number, mask: string): string {
  const width = (mask.match(/#/g) || []).length || 1;
  const n = Number.isFinite(startIndex) && startIndex > 0 ? startIndex : 1;
  return String(n).padStart(width, "0");
}

// Render 1 token ra chuỗi xem trước.
export function renderToken(
  token: FormatToken,
  startIndex: number,
  companyShort: string,
  customText: string,
): string {
  const def = TOKEN_BY_KEY.get(token.type);
  if (!def) return "";
  switch (def.kind) {
    case "separator":
      return def.literal ?? "";
    case "company":
      return companyShort || "CTY";
    case "custom":
      return customText || "DT";
    case "date":
      return SAMPLE[def.key as keyof typeof SAMPLE] ?? "";
    case "serial":
      return padSerial(startIndex, token.value || "###");
    case "fixed":
      return (token.value || "").trim();
    default:
      return "";
  }
}

export function renderPreview(
  tokens: FormatToken[],
  startIndex: number,
  companyShort = "NTV",
  customText = "DT",
): string {
  return tokens
    .map((t) => renderToken(t, startIndex, companyShort, customText))
    .join("");
}
