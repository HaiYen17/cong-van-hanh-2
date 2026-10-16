import type { RequestStatus } from "@/generated/prisma/enums";

export type RequestServiceDef = {
  code: string;
  description: string;
  label: string;
};

// Các loại yêu cầu đi qua hệ thống Request chung. Đây là phần "cấu hình" của
// module Thực thi; bổ sung loại mới chỉ cần thêm vào đây.
export const requestServices: RequestServiceDef[] = [
  {
    code: "document-seal",
    description: "Đề nghị đóng dấu, cấp số văn bản hoặc ký số PDF.",
    label: "Đóng dấu & Ký số",
  },
  {
    code: "authorization-letter",
    description: "Cấp giấy uỷ quyền / giới thiệu (có cấp số).",
    label: "Cấp giấy uỷ quyền / giới thiệu",
  },
  {
    code: "document-archive",
    description: "Trích lục hoặc lưu trữ hồ sơ.",
    label: "Trích lục / lưu trữ hồ sơ",
  },
  {
    code: "support-request",
    description: "Gửi câu hỏi hoặc yêu cầu hỗ trợ nội bộ.",
    label: "Hỗ trợ nội bộ",
  },
  {
    code: "business-trip",
    description: "Đăng ký đi công tác.",
    label: "Đăng ký công tác",
  },
  {
    code: "repair-request",
    description: "Báo hỏng và yêu cầu sửa chữa.",
    label: "Yêu cầu sửa chữa",
  },
  {
    code: "asset-allocation",
    description: "Đề xuất cấp phát tài sản / văn phòng phẩm.",
    label: "Đề xuất cấp phát",
  },
  {
    code: "review-contract",
    description: "Gửi hồ sơ để rà soát và ghi nhận góp ý.",
    label: "Review hồ sơ",
  },
  {
    code: "todo-assignment",
    description: "Giao việc rõ đầu ra, người phụ trách và thời hạn.",
    label: "Giao việc",
  },
  {
    code: "template-output",
    description: "Tạo dữ liệu đầu ra từ biểu mẫu đã cấu hình.",
    label: "Biểu mẫu",
  },
];

const serviceByCode = new Map(requestServices.map((service) => [service.code, service]));

export function isValidServiceCode(code: string) {
  return serviceByCode.has(code);
}

export function serviceLabel(code: string) {
  return serviceByCode.get(code)?.label ?? code;
}

// Dịch vụ cần cấp số văn bản (dùng chung luồng đóng dấu + engine Sổ văn bản).
export const NUMBERING_SERVICES = ["document-seal", "authorization-letter"];
export function isNumberingService(code: string) {
  return NUMBERING_SERVICES.includes(code);
}

// Field khai báo theo từng dịch vụ (cho dịch vụ KHÔNG cấp số) — form tự render từ đây.
export type ServiceFieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox";
export type ServiceField = {
  label: string;
  name: string;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  type: ServiceFieldType;
};

export const serviceFields: Record<string, ServiceField[]> = {
  "asset-allocation": [
    { label: "Danh mục", name: "category", type: "select", options: ["Tài sản", "Văn phòng phẩm", "Đồng phục"] },
    { label: "Tên hàng hoá", name: "itemName", required: true, type: "text" },
    { label: "Mô tả / quy cách", name: "description", type: "text" },
    { label: "Số lượng", name: "quantity", required: true, type: "number" },
    { label: "Người được cấp", name: "assignee", type: "text" },
  ],
  "business-trip": [
    { label: "Nơi đến", name: "destination", required: true, type: "text" },
    { label: "Từ ngày", name: "fromDate", required: true, type: "date" },
    { label: "Đến ngày", name: "toDate", required: true, type: "date" },
    { label: "Mục đích", name: "purpose", type: "textarea" },
  ],
  "document-archive": [
    { label: "Hình thức", name: "mode", required: true, type: "select", options: ["Trích lục", "Lưu trữ"] },
    { label: "Tên hồ sơ", name: "recordName", required: true, type: "text" },
    { label: "Định dạng yêu cầu", name: "format", type: "select", options: ["Bản gốc", "Bản scan", "Sao y công ty", "Sao y công chứng"] },
    { label: "Số lượng", name: "copies", type: "number" },
    { label: "Lý do / nội dung", name: "reason", type: "textarea" },
  ],
  "repair-request": [
    { label: "Tên CCDC / thiết bị", name: "itemName", required: true, type: "text" },
    { label: "Mã CCDC", name: "itemCode", type: "text" },
    { label: "Mô tả hư hỏng", name: "damage", required: true, type: "textarea" },
    { label: "Khẩn cấp", name: "urgent", type: "checkbox" },
  ],
  "support-request": [
    { label: "Loại hỗ trợ", name: "supportType", required: true, type: "select", options: ["Tư vấn", "Trao đổi", "Phối hợp"] },
    { label: "Thời gian ước lượng (giờ)", name: "estimatedHours", type: "number" },
    { label: "Khẩn cấp", name: "urgent", type: "checkbox" },
  ],
};

export function getServiceFields(code: string): ServiceField[] {
  return serviceFields[code] ?? [];
}

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export const requestStatusMeta: Record<
  RequestStatus,
  { label: string; tone: StatusTone }
> = {
  SUBMITTED: { label: "Mới gửi", tone: "info" },
  IN_PROGRESS: { label: "Đang xử lý", tone: "warning" },
  NEEDS_INFO: { label: "Cần bổ sung", tone: "warning" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Từ chối", tone: "danger" },
  COMPLETED: { label: "Hoàn tất", tone: "success" },
  CANCELLED: { label: "Đã hủy", tone: "neutral" },
};

export const requestStatusOrder: RequestStatus[] = [
  "SUBMITTED",
  "IN_PROGRESS",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
];

export function isValidStatus(value: string): value is RequestStatus {
  return (requestStatusOrder as string[]).includes(value);
}

export const requestEventLabels: Record<string, string> = {
  SUBMITTED: "Gửi yêu cầu",
  PROCESSING: "Bắt đầu xử lý",
  NEEDS_INFO: "Yêu cầu bổ sung",
  APPROVED: "Phê duyệt",
  REJECTED: "Từ chối",
  COMPLETED: "Hoàn tất",
  CANCELLED: "Hủy",
  COMMENT: "Ghi chú",
};
