import type { AppSession } from "@/lib/auth/session";

export type LegacyTone = "amber" | "coral" | "emerald" | "teal";

export type LegacyModuleCard = {
  availability?: "coming-soon" | "maintenance";
  badgeCount?: number;
  href: string | null;
  icon: string;
  key: string;
  label: string;
};

export type LegacyFeatureGroup = {
  collectionKey?: string;
  collectionTitle?: string;
  collectionTone?: LegacyTone;
  items: LegacyModuleCard[];
  key: string;
  title: string;
  tone: LegacyTone;
};

type CatalogItem = {
  icon: string;
  key: string;
  label: string;
  sourceKey?: string;
};

type CatalogGroup = Omit<LegacyFeatureGroup, "items"> & {
  items: CatalogItem[];
};

const MODULE_ROUTES: Record<string, string> = {
  "accounting-config": "/cau-hinh/bao-cao-ke-toan",
  "air-conditioner-control": "/nguoi-thuan-viet/dieu-khien-may-lanh",
  "admin-tools": "/thuc-thi/hieu-dinh",
  "app-setup": "/cau-hinh/setup-ung-dung",
  "asset-allocation": "/nguoi-thuan-viet/yeu-cau/cap-phat",
  "asset-setup": "/cau-hinh/setup-tai-san",
  "authorization-letter": "/thuc-thi/cap-giay",
  "business-trip": "/nguoi-thuan-viet/cong-tac",
  "candidate-assessment": "/tuyen-dung/danh-gia",
  "candidate-management": "/tuyen-dung/ung-vien",
  "candidate-results": "/tuyen-dung/ket-qua",
  config: "/cau-hinh",
  "document-archive": "/thuc-thi/trich-luc",
  "document-seal": "/thuc-thi/dong-dau",
  evaluation: "/danh-gia",
  "evaluation-config": "/cau-hinh/danh-gia",
  "global-config": "/cau-hinh/tong",
  "legal-info": "/nguoi-thuan-viet/thong-tin",
  "location-map": "/nguoi-thuan-viet/ban-do",
  "meeting-config": "/cau-hinh/lich-hop",
  meetings: "/nguoi-thuan-viet/lich-hop",
  "my-orders": "/nguoi-thuan-viet/don-hang",
  "order-management": "/thuc-thi/quan-ly-don",
  approvals: "/thuc-thi/ky-so-phe-duyet",
  permissions: "/cau-hinh/phan-quyen",
  reconciliation: "/thuc-thi/doi-soat",
  "repair-request": "/nguoi-thuan-viet/yeu-cau/sua-chua",
  "review-config": "/cau-hinh/nguyen-tac-ai",
  "review-contract": "/nguoi-thuan-viet/review-ho-so",
  "send-mail": "/thuc-thi/gui-thu",
  "support-request": "/nguoi-thuan-viet/yeu-cau/ho-tro",
  "support-tools": "/nguoi-thuan-viet/cong-cu",
  "template-management": "/cau-hinh/bieu-mau",
  templates: "/nguoi-thuan-viet/bieu-mau",
  todo: "/nguoi-thuan-viet/giao-viec",
  "warehouse-config": "/kho-van/cau-hinh",
  "warehouse-shelf-config": "/kho-van/cau-hinh-ke",
  "warehouse-info": "/kho-van/thong-tin",
  "warehouse-inventory": "/kho-van/kiem-ke",
  "workshop-allocation": "/phan-xuong/ke-hoach",
  "workshop-config": "/phan-xuong/cau-hinh",
  "workshop-inventory": "/phan-xuong/kiem-ke",
  "workshop-order": "/phan-xuong/dat-hang",
  "workshop-plan": "/phan-xuong/phan-bo-thu-cong",
  "workshop-plan-approval": "/phan-xuong/duyet-ke-hoach",
  "workshop-proposal": "/phan-xuong/de-xuat",
  "workshop-report": "/phan-xuong/bao-cao",
  "workbench-config": "/cau-hinh/ban-lam-viec",
};

const MODULE_AVAILABILITY: Record<string, "coming-soon" | "maintenance"> = {
  "asset-allocation": "coming-soon",
  "business-trip": "coming-soon",
  "repair-request": "coming-soon",
  "support-request": "coming-soon",
};

// Danh mục, nhãn, thứ tự và cách gom nhóm lấy nguyên từ APP_CONFIG.featureGroups
// của bản GAS. PostgreSQL chỉ quyết định card nào được phép hiện.
const LEGACY_CATALOG: CatalogGroup[] = [
  {
    collectionKey: "bod",
    collectionTitle: "BOD",
    collectionTone: "emerald",
    items: [
      {
        icon: "document-badge",
        key: "approvals",
        label: "Duyệt hồ sơ ký số",
      },
    ],
    key: "bod-review",
    title: "Phê duyệt",
    tone: "emerald",
  },
  {
    items: [
      { icon: "shield", key: "permissions", label: "Cấp quyền" },
      { icon: "settings", key: "global-config", label: "Cấu hình Tổng" },
    ],
    key: "super-admin",
    title: "Super admin",
    tone: "emerald",
  },
  {
    collectionKey: "admin-hanh-chinh",
    collectionTitle: "Admin",
    collectionTone: "amber",
    items: [
      {
        icon: "briefcase",
        key: "order-management",
        label: "Quản lý đơn hàng",
      },
    ],
    key: "admin-management",
    title: "Quản lý",
    tone: "amber",
  },
  {
    collectionKey: "admin-hanh-chinh",
    collectionTitle: "Admin",
    collectionTone: "amber",
    items: [
      { icon: "panel", key: "reconciliation", label: "Đối soát" },
      { icon: "toolbox", key: "admin-tools", label: "Hiệu đính hồ sơ" },
    ],
    key: "admin-execution",
    title: "Thực thi",
    tone: "coral",
  },
  {
    collectionKey: "admin-hanh-chinh",
    collectionTitle: "Admin",
    collectionTone: "amber",
    items: [
      { icon: "settings", key: "config", label: "Cấu hình" },
      { icon: "package", key: "asset-setup", label: "Setup tài sản" },
      { icon: "settings", key: "app-setup", label: "Setup ứng dụng" },
      {
        icon: "settings",
        key: "evaluation-config",
        label: "Cấu hình đánh giá",
      },
      {
        icon: "grid",
        key: "template-management",
        label: "Cấu hình Biểu mẫu",
      },
      { icon: "settings", key: "review-config", label: "Bộ nguyên tắc AI" },
      {
        icon: "grid",
        key: "accounting-config",
        label: "Cấu hình Báo cáo Kế toán",
      },
      {
        icon: "calendar-cog",
        key: "meeting-config",
        label: "Cấu hình Lịch họp",
      },
      {
        icon: "layout-grid",
        key: "workbench-config",
        label: "Cấu hình Bàn làm việc",
      },
    ],
    key: "admin-config",
    title: "Cấu hình",
    tone: "emerald",
  },
  {
    collectionKey: "recruitment",
    collectionTitle: "Tuyển dụng",
    collectionTone: "amber",
    items: [
      {
        icon: "briefcase",
        key: "candidate-management",
        label: "Quản lý Ứng viên",
      },
    ],
    key: "recruitment-management",
    title: "Quản lý Ứng viên",
    tone: "amber",
  },
  {
    collectionKey: "recruitment",
    collectionTitle: "Tuyển dụng",
    collectionTone: "amber",
    items: [
      {
        icon: "panel",
        key: "candidate-assessment",
        label: "Đánh giá Ứng viên",
      },
    ],
    key: "recruitment-assessment",
    title: "Đánh giá Ứng viên",
    tone: "coral",
  },
  {
    collectionKey: "recruitment",
    collectionTitle: "Tuyển dụng",
    collectionTone: "amber",
    items: [
      {
        icon: "document-badge",
        key: "candidate-results",
        label: "Xem kết quả đánh giá",
      },
    ],
    key: "recruitment-results",
    title: "Kết quả đánh giá",
    tone: "emerald",
  },
  {
    collectionKey: "nguoi-thuan-viet",
    collectionTitle: "Người Thuần Việt",
    collectionTone: "teal",
    items: [
      {
        icon: "inbox",
        key: "my-orders",
        label: "Bàn làm việc của tôi",
        sourceKey: "my-requests",
      },
    ],
    key: "nguoi-thuan-viet-orders",
    title: "Quản lý đơn",
    tone: "teal",
  },
  {
    collectionKey: "nguoi-thuan-viet",
    collectionTitle: "Người Thuần Việt",
    collectionTone: "teal",
    items: [
      { icon: "alert", key: "legal-info", label: "Thông tin" },
      {
        icon: "document-badge",
        key: "review-contract",
        label: "Review hồ sơ",
      },
      {
        icon: "stamp",
        key: "document-seal",
        label: "Đóng dấu và Ký số",
      },
      {
        icon: "archive",
        key: "document-archive",
        label: "Trích lục/ Lưu trữ hồ sơ",
      },
      {
        icon: "document-badge",
        key: "authorization-letter",
        label: "Cấp Giấy Ủy quyền/ Giới thiệu",
      },
    ],
    key: "nguoi-thuan-viet-legal",
    title: "Hồ sơ pháp lý",
    tone: "coral",
  },
  {
    collectionKey: "nguoi-thuan-viet",
    collectionTitle: "Người Thuần Việt",
    collectionTone: "teal",
    items: [
      {
        icon: "package",
        key: "asset-allocation",
        label: "Đề xuất Cấp phát",
      },
      {
        icon: "wrench",
        key: "repair-request",
        label: "Yêu cầu sửa chữa",
      },
    ],
    key: "nguoi-thuan-viet-asset",
    title: "Cấp phát và Sửa chữa",
    tone: "amber",
  },
  {
    collectionKey: "nguoi-thuan-viet",
    collectionTitle: "Người Thuần Việt",
    collectionTone: "teal",
    items: [
      { icon: "route", key: "business-trip", label: "Đăng ký công tác" },
      { icon: "panel", key: "evaluation", label: "Đánh giá nhân sự" },
      { icon: "package", key: "send-mail", label: "Gửi thư" },
      { icon: "grid", key: "templates", label: "Biểu mẫu" },
      {
        icon: "lifebuoy",
        key: "support-request",
        label: "Yêu cầu hỗ trợ",
      },
      { icon: "route", key: "location-map", label: "Bản đồ định vị" },
    ],
    key: "nguoi-thuan-viet-admin",
    title: "Hành chính",
    tone: "emerald",
  },
  {
    collectionKey: "nguoi-thuan-viet",
    collectionTitle: "Người Thuần Việt",
    collectionTone: "teal",
    items: [
      { icon: "panel", key: "todo", label: "Giao việc" },
      { icon: "calendar-days", key: "meetings", label: "Lịch họp & Đặt phòng" },
      { icon: "grid", key: "support-tools", label: "Công cụ hỗ trợ" },
      {
        icon: "lightbulb",
        key: "air-conditioner-control",
        label: "Quản lý hệ thống điện",
      },
    ],
    key: "nguoi-thuan-viet-utilities",
    title: "Tiện ích",
    tone: "teal",
  },
  {
    collectionKey: "admin-kho",
    collectionTitle: "Admin Kho",
    collectionTone: "emerald",
    items: [
      {
        icon: "warehouse",
        key: "warehouse-config",
        label: "Cấu hình Kho",
      },
      {
        icon: "tags",
        key: "warehouse-shelf-config",
        label: "Cấu hình kệ",
      },
      {
        icon: "scan-line",
        key: "warehouse-info",
        label: "Thông tin kho",
      },
      {
        icon: "boxes",
        key: "warehouse-inventory",
        label: "Kiểm kê Kho",
      },
    ],
    key: "warehouse",
    title: "Kho vận",
    tone: "emerald",
  },
  {
    collectionKey: "admin-xuong",
    collectionTitle: "Admin Xưởng",
    collectionTone: "coral",
    items: [
      { icon: "factory", key: "workshop-config", label: "Cấu hình Xưởng" },
      { icon: "shopping-cart", key: "workshop-order", label: "Đặt hàng Xưởng" },
      {
        icon: "calendar-range",
        key: "workshop-allocation",
        label: "Kế hoạch Xưởng",
      },
      { icon: "split", key: "workshop-plan", label: "Phân bổ thủ công" },
      {
        icon: "badge-check",
        key: "workshop-plan-approval",
        label: "Duyệt KH Xưởng",
      },
      { icon: "lightbulb", key: "workshop-proposal", label: "Đề xuất Xưởng" },
      { icon: "bar-chart-3", key: "workshop-report", label: "Báo cáo Xưởng" },
      { icon: "boxes", key: "workshop-inventory", label: "Kiểm kê Xưởng" },
    ],
    key: "workshop",
    title: "Phân xưởng",
    tone: "coral",
  },
];

export type PortalModuleInventoryItem = {
  collectionKey: string;
  collectionTitle: string;
  groupKey: string;
  groupTitle: string;
  href: string | null;
  icon: string;
  key: string;
  label: string;
  sourceKey: string;
};

// Danh mục triển khai chuẩn. Script kiểm tra trước build dùng chính danh sách
// này để phát hiện card bị mất, route bị đổi hoặc file page bị bỏ sót.
export const PORTAL_MODULE_INVENTORY: PortalModuleInventoryItem[] =
  LEGACY_CATALOG.flatMap((group) =>
    group.items.map((item) => ({
      collectionKey: group.collectionKey ?? group.key,
      collectionTitle: group.collectionTitle ?? group.title,
      groupKey: group.key,
      groupTitle: group.title,
      href: MODULE_ROUTES[item.key] ?? null,
      icon: item.icon,
      key: item.key,
      label: item.label,
      sourceKey: item.sourceKey ?? item.key,
    })),
  );

// Màn Services là nguồn sự thật của catalog người dùng đang vận hành. Màn
// phân quyền chỉ được phép hiển thị/lưu những AppModule thật sự có card ở đây;
// tránh kéo lại module chỉ còn tồn tại trong dữ liệu seed mà chưa có route.
export const VISIBLE_PORTAL_MODULE_KEYS = [
  ...new Set(PORTAL_MODULE_INVENTORY.map((item) => item.sourceKey)),
] as readonly string[];

const PORTAL_MODULE_LABELS = new Map(
  PORTAL_MODULE_INVENTORY.map((item) => [item.sourceKey, item.label]),
);

export function portalModuleLabel(moduleKey: string, fallback: string) {
  return PORTAL_MODULE_LABELS.get(moduleKey) ?? fallback;
}

type DatabaseModule = {
  group: { key: string };
  icon: string | null;
  key: string;
};

function canSeeModule(
  session: AppSession,
  appModule: DatabaseModule | undefined,
) {
  if (session.fullAccess) return true;
  if (!appModule) return false;
  return (
    session.modules.includes(appModule.key) ||
    session.moduleGroups.includes(appModule.group.key)
  );
}

export function buildLegacyFeatureGroups({
  badgeCounts,
  databaseModules,
  session,
}: {
  badgeCounts: Record<string, number>;
  databaseModules: DatabaseModule[];
  session: AppSession;
}) {
  const moduleMap = new Map(databaseModules.map((item) => [item.key, item]));

  return LEGACY_CATALOG.map((group) => {
    const items = group.items.flatMap((item) => {
      const sourceKey = item.sourceKey ?? item.key;
      const databaseModule = moduleMap.get(sourceKey);
      if (!canSeeModule(session, databaseModule)) return [];

      const availability =
        MODULE_AVAILABILITY[item.key] && !session.fullAccess
          ? MODULE_AVAILABILITY[item.key]
          : undefined;

      return [
        {
          availability,
          badgeCount: badgeCounts[item.key] ?? 0,
          href: MODULE_ROUTES[item.key] ?? null,
          icon: item.icon,
          key: item.key,
          label: item.label,
        } satisfies LegacyModuleCard,
      ];
    });

    return { ...group, items };
  }).filter((group) => group.items.length > 0);
}
