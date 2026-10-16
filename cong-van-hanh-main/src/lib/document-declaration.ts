import { normalizeCompare } from "@/lib/document-registry";

const PARTNER_DOCUMENT_HINTS = [
  "hopdong",
  "hdld",
  "phuluchopdong",
  "thoathuan",
];

/**
 * Hồ sơ hợp đồng luôn cần xác định bên ký (đối tác hoặc nhân sự), kể cả khi
 * cấu hình cũ chỉ lưu chế độ "period". Hàm này giữ nguyên các chế độ đã cấu
 * hình và chỉ bổ sung "partner" cho nhóm hợp đồng/thỏa thuận.
 */
export function effectiveSealDeclarationModes<T extends string>(
  documentTypeName: string,
  modes: T[],
): (T | "partner")[] {
  const normalizedName = normalizeCompare(documentTypeName).replace(/đ/g, "d");
  const needsPartner = PARTNER_DOCUMENT_HINTS.some((hint) =>
    normalizedName.includes(hint),
  );
  return needsPartner && !modes.includes("partner" as T)
    ? (["partner", ...modes] as (T | "partner")[])
    : [...modes];
}
