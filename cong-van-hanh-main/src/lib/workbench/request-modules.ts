import type { AppSession } from "@/lib/auth/session";
import type { WorkbenchStageOption } from "./types";

export type WorkbenchRequestModuleDefinition = {
  aliases: string[];
  href: string;
  icon: string;
  label: string;
  moduleKey: string;
  serviceCode: string;
  sortOrder: number;
  stepOptions?: Array<{ code: string; label: string }>;
};

const BASE_STAGE_LABELS = [
  "Chờ duyệt",
  "Tiếp nhận",
  "Xử lý",
  "Bổ sung hồ sơ",
  "Hoàn thành một phần",
  "Hoàn thành",
  "Hủy đơn",
];

export function workbenchStageFilterKey(label: string) {
  return `stage:${label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

export function workbenchStepFilterKey(code: string) {
  return `step:${code.trim().toUpperCase()}`;
}

export const WORKBENCH_REQUEST_MODULES: WorkbenchRequestModuleDefinition[] = [
  {
    aliases: ["expense-advance", "03HOAN_UNG_CHI_PHI"],
    href: "/nguoi-thuan-viet/don-hang/danh-sach",
    icon: "wallet-cards",
    label: "Hoàn ứng chi phí",
    moduleKey: "expense-advance",
    serviceCode: "03HOAN_UNG_CHI_PHI",
    sortOrder: 10,
  },
  {
    aliases: ["asset-allocation", "05DE_XUAT_CAP_PHAT"],
    href: "/nguoi-thuan-viet/yeu-cau/cap-phat",
    icon: "package",
    label: "Đề xuất Cấp phát",
    moduleKey: "asset-allocation",
    serviceCode: "05DE_XUAT_CAP_PHAT",
    sortOrder: 20,
    stepOptions: [
      { code: "ORDERING", label: "Hàng hóa đang được Order" },
      { code: "IN_STOCK", label: "Hàng hóa đã cập nhật vào Kho" },
      { code: "PACKED", label: "Hàng hóa đã đóng gói và gửi đi" },
    ],
  },
  {
    aliases: ["repair-request", "06YEU_CAU_SUA_CHUA_BAO_TRI"],
    href: "/nguoi-thuan-viet/yeu-cau/sua-chua",
    icon: "wrench",
    label: "Yêu cầu sửa chữa",
    moduleKey: "repair-request",
    serviceCode: "06YEU_CAU_SUA_CHUA_BAO_TRI",
    sortOrder: 30,
    stepOptions: [
      { code: "CONTACTED", label: "Đã liên hệ Dịch vụ sửa chữa" },
      { code: "REPAIRING", label: "Đang được sửa chữa" },
    ],
  },
  {
    aliases: ["document-seal", "07DE_NGHI_DONG_DAU_VA_CAP_SO_VAN_BAN"],
    href: "/thuc-thi/dong-dau",
    icon: "stamp",
    label: "Đóng dấu & Ký số",
    moduleKey: "document-seal",
    serviceCode: "07DE_NGHI_DONG_DAU_VA_CAP_SO_VAN_BAN",
    sortOrder: 40,
  },
  {
    aliases: ["document-archive", "08TRICH_LUC_VA_LUU_TRU_HO_SO"],
    href: "/thuc-thi/trich-luc",
    icon: "archive",
    label: "Trích lục / lưu trữ hồ sơ",
    moduleKey: "document-archive",
    serviceCode: "08TRICH_LUC_VA_LUU_TRU_HO_SO",
    sortOrder: 50,
    stepOptions: [
      { code: "SCHEDULE_COPY", label: "Hồ sơ đang được lên lịch sao y" },
      { code: "DRAFT_DONE", label: "Hồ sơ đã soạn xong" },
    ],
  },
  {
    aliases: ["authorization-letter", "09CAP_GIAY_UY_QUYEN_GIOI_THIEU"],
    href: "/thuc-thi/cap-giay",
    icon: "document-badge",
    label: "Cấp giấy Ủy quyền / Giới thiệu",
    moduleKey: "authorization-letter",
    serviceCode: "09CAP_GIAY_UY_QUYEN_GIOI_THIEU",
    sortOrder: 60,
    stepOptions: [
      { code: "WAIT_HARDCOPY", label: "Đang chờ Người dùng nộp bản cứng" },
      { code: "BOD_SIGN", label: "Đang lấy chữ ký BOD" },
    ],
  },
  {
    aliases: ["business-trip", "10DANG_KY_CONG_TAC"],
    href: "/nguoi-thuan-viet/cong-tac",
    icon: "route",
    label: "Đăng ký công tác",
    moduleKey: "business-trip",
    serviceCode: "10DANG_KY_CONG_TAC",
    sortOrder: 70,
    stepOptions: [
      { code: "CONTACT_SERVICES", label: "Liên hệ các dịch vụ" },
    ],
  },
  {
    aliases: ["support-request", "11YEU_CAU_HO_TRO", "11_YEU_CAU_HO_TRO"],
    href: "/nguoi-thuan-viet/yeu-cau/ho-tro",
    icon: "lifebuoy",
    label: "Yêu cầu hỗ trợ",
    moduleKey: "support-request",
    serviceCode: "11YEU_CAU_HO_TRO",
    sortOrder: 80,
  },
  {
    aliases: ["review-contract", "12REVIEW_HOP_DONG"],
    href: "/nguoi-thuan-viet/review-ho-so",
    icon: "document-badge",
    label: "Review hồ sơ",
    moduleKey: "review-contract",
    serviceCode: "12REVIEW_HOP_DONG",
    sortOrder: 90,
  },
  {
    aliases: ["send-mail", "13GUI_THU_VIETTEL_POST"],
    href: "/thuc-thi/gui-thu",
    icon: "package",
    label: "Gửi thư",
    moduleKey: "send-mail",
    serviceCode: "13GUI_THU_VIETTEL_POST",
    sortOrder: 100,
  },
  {
    aliases: ["workshop-plan", "17KE_HOACH_XUONG_DA_DUYET"],
    href: "/phan-xuong/phan-bo-thu-cong",
    icon: "split",
    label: "Kế hoạch xưởng đã duyệt",
    moduleKey: "workshop-plan",
    serviceCode: "17KE_HOACH_XUONG_DA_DUYET",
    sortOrder: 110,
  },
  {
    aliases: ["workshop-order", "18DAT_HANG_XUONG"],
    href: "/phan-xuong/dat-hang",
    icon: "shopping-cart",
    label: "Đặt hàng Xưởng",
    moduleKey: "workshop-order",
    serviceCode: "18DAT_HANG_XUONG",
    sortOrder: 120,
  },
];

function normalizedCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

const REQUEST_MODULE_BY_ALIAS = new Map(
  WORKBENCH_REQUEST_MODULES.flatMap((definition) =>
    [definition.serviceCode, definition.moduleKey, ...definition.aliases].map(
      (alias) => [normalizedCode(alias), definition] as const,
    ),
  ),
);

export function workbenchRequestModule(serviceCode: string) {
  return REQUEST_MODULE_BY_ALIAS.get(normalizedCode(serviceCode));
}

export function workbenchRequestStageOptions(
  serviceCode: string,
): WorkbenchStageOption[] {
  const definition = workbenchRequestModule(serviceCode);
  return [
    ...BASE_STAGE_LABELS.map(
      (label): WorkbenchStageOption => ({
        kind: "stage",
        label,
        value: workbenchStageFilterKey(label),
      }),
    ),
    ...(definition?.stepOptions || []).map(
      (step): WorkbenchStageOption => ({
        kind: "step",
        label: step.label,
        value: workbenchStepFilterKey(step.code),
      }),
    ),
  ];
}

export function canonicalWorkbenchRequestServiceCode(serviceCode: string) {
  return workbenchRequestModule(serviceCode)?.serviceCode || serviceCode.trim();
}

export function workbenchRequestHref(serviceCode: string, requestCode = "") {
  const definition = workbenchRequestModule(serviceCode);
  const pathname =
    definition?.href || "/nguoi-thuan-viet/don-hang/danh-sach";
  const params = new URLSearchParams({ from: "workbench" });
  if (requestCode.trim()) params.set("workbenchRequest", requestCode.trim());
  return `${pathname}?${params.toString()}`;
}

export function availableWorkbenchRequestModules(session: AppSession) {
  return WORKBENCH_REQUEST_MODULES.filter(
    (definition) =>
      definition.moduleKey !== "expense-advance" &&
      (session.fullAccess || session.modules.includes(definition.moduleKey)),
  );
}
