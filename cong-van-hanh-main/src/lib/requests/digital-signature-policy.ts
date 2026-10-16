import {
  digitalSignaturePlacements,
  isElectronicSignatureItem,
  payloadItems,
  type DigitalSignaturePlacement,
} from "./electronic-signature-payload";

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function signatureSubmission(payload: unknown) {
  const rows = payloadItems(objectValue(payload));
  if (!rows.some(isElectronicSignatureItem)) return null;
  if (rows.length !== 1) throw new Error("Mỗi lần tạo Ký số chỉ được nộp 01 hồ sơ.");
  const row = rows[0];
  const stamps = row.sealTypes ?? row.stamps;
  if (!Array.isArray(stamps) || stamps.length !== 1 ||
      !["Ký số", "Ký điện tử"].includes(String(stamps[0]))) {
    throw new Error("Ký số không được chọn chung với loại dấu khác.");
  }
  if (Number(row.quantity ?? row.qty) !== 1) throw new Error("Hồ sơ ký số có số lượng 01.");
  if (!String(row.companyId || "").trim()) throw new Error("Chọn pháp nhân ký số.");
  if (!String(row.signatureClientFileName || "").toLowerCase().endsWith(".pdf")) {
    throw new Error("Ký số cần đính kèm 01 file PDF.");
  }
  const rawPlacements = Array.isArray(row.signaturePlacements)
    ? row.signaturePlacements
    : [];
  const placements = digitalSignaturePlacements(row);
  if (!placements.length || placements.length > 30 ||
      placements.length !== rawPlacements.length) {
    throw new Error("Vẽ từ 01 đến 30 vùng ký hợp lệ trên PDF.");
  }
  return { companyId: String(row.companyId), placements };
}

// Chỉ nhận dữ liệu khai báo. Client không thể tự gửi tóm tắt, trạng thái duyệt hoặc file đã ký.
export function cleanSignatureSubmission(payload: unknown) {
  const input = objectValue(payload);
  const result = signatureSubmission(input);
  if (!result) return input;
  const row = { ...payloadItems(input)[0] };
  for (const key of Object.keys(row)) {
    if (/^(signature|ai|bod|digital|electronic|result|output|input|approved|signed)/i.test(key) ||
        ["status", "stage", "files", "attachments"].includes(key)) delete row[key];
  }
  Object.assign(row, {
    digitalSignature: true, electronicSignature: true,
    sealTypes: ["Ký số"], stamps: ["Ký số"], dau: ["Ký số"],
    signaturePlacements: result.placements,
    signatureClientFileName: payloadItems(input)[0].signatureClientFileName,
    signatureStatus: "awaiting_upload", quantity: 1, qty: 1,
  });
  const root = { ...input };
  for (const key of Object.keys(root)) {
    if (/^(signature|ai|bod|digital|electronic|result|output|input|approved|signed)/i.test(key) ||
        ["status", "stage", "payload", "payload0", "rows", "files", "attachments"].includes(key)) delete root[key];
  }
  return { ...root, items: [row] };
}

export function validatePlacementsAgainstPages(
  placements: DigitalSignaturePlacement[],
  pages: { width: number; height: number; rotation: number }[],
) {
  for (const p of placements) {
    const page = pages[p.page - 1];
    if (!page) throw new Error(`Vùng ký trỏ tới trang ${p.page} không tồn tại.`);
    if (page.rotation % 360 !== 0) {
      throw new Error(`Trang ${p.page} có góc xoay PDF. Hãy xuất lại PDF với trang thẳng trước khi vẽ vùng ký.`);
    }
    if (Math.abs(p.pageWidth - page.width) > 1 || Math.abs(p.pageHeight - page.height) > 1) {
      throw new Error(`Vùng ký trang ${p.page} không khớp kích thước PDF đã nộp.`);
    }
    if (p.width * page.width < 15 || p.height * page.height < 10) {
      throw new Error(`Vùng ký trang ${p.page} quá nhỏ. Hãy vẽ vùng lớn hơn.`);
    }
  }
}

export const signatureStateLabels: Record<string, string> = {
  AWAITING_UPLOAD: "Chờ nộp PDF", AI_QUEUED: "Chờ AI tóm tắt", AI_RUNNING: "AI đang đọc PDF",
  AI_FAILED: "AI cần thử lại", BOD_PENDING: "Chờ BOD duyệt", ADMIN_PENDING: "Chờ Admin duyệt ký",
  SIGN_QUEUED: "Đang chuẩn bị ký", SIGN_PENDING: "Chờ MISA xác nhận ký",
  SIGN_FAILED: "Ký chưa thành công", SIGN_UNKNOWN: "Cần đối chiếu giao dịch MISA",
  SIGNED: "Đã ký số", REJECTED: "BOD từ chối", CANCELLED: "Đã hủy",
};
