import "dotenv/config";

import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const now = () => new Date();

// ---------------------------------------------------------------------------
// Foundation (auth/config) groups + modules + permissions. KEEP IN SYNC with
// src/lib/auth/permissions.ts. These existed before the legacy module catalog.
// ---------------------------------------------------------------------------

const foundationGroups = [
  {
    collectionKey: "system-admin",
    collectionTitle: "Quản trị hệ thống",
    description: "Công cụ nhạy cảm chỉ dành cho Super Admin.",
    key: "super-admin-tools",
    sortOrder: 10,
    title: "Super Admin",
  },
  {
    collectionKey: "admin-hanh-chinh",
    collectionTitle: "Admin Hành chính",
    description: "Danh mục, cấu hình, nhân viên, công ty và quy tắc nền.",
    key: "admin-config",
    sortOrder: 20,
    title: "Cấu hình Hành chính",
  },
  {
    collectionKey: "admin-hanh-chinh",
    collectionTitle: "Admin Hành chính",
    description: "Hàng đợi yêu cầu, xử lý, cập nhật trạng thái và lịch sử.",
    key: "admin-execution",
    sortOrder: 30,
    title: "Thực thi Hành chính",
  },
  {
    collectionKey: "bod",
    collectionTitle: "Ban điều hành",
    description: "Tổng quan, phê duyệt và lịch sử cho lãnh đạo.",
    key: "bod-review",
    sortOrder: 40,
    title: "BOD",
  },
  {
    collectionKey: "nguoi-thuan-viet",
    collectionTitle: "Người Thuần Việt",
    description: "Theo dõi toàn bộ yêu cầu hành chính của người dùng.",
    key: "employee-default",
    sortOrder: 50,
    title: "Quản lý đơn",
  },
  {
    collectionKey: "accounting",
    collectionTitle: "Kế toán",
    description: "Cấu hình báo cáo kế toán, nguồn dữ liệu và hợp nhất.",
    key: "accounting-admin",
    sortOrder: 60,
    title: "Kế toán",
  },
];

const foundationModules = [
  {
    description: "Quản lý vai trò, quyền và gán quyền người dùng.",
    groupKey: "super-admin-tools",
    icon: "shield",
    key: "permissions",
    label: "Phân quyền",
    sortOrder: 10,
  },
  {
    description: "Xem lịch sử đăng nhập và thao tác nhạy cảm.",
    groupKey: "super-admin-tools",
    icon: "history",
    key: "audit-logs",
    label: "Lịch sử hệ thống",
    sortOrder: 20,
  },
  {
    description: "Cấu hình hệ thống, workflow và quy tắc chung.",
    groupKey: "admin-config",
    icon: "settings",
    key: "system-settings",
    label: "Cấu hình hệ thống",
    sortOrder: 10,
  },
  {
    description: "Danh sách nhân viên và trạng thái tài khoản.",
    groupKey: "admin-config",
    icon: "users",
    key: "employees",
    label: "Nhân viên",
    sortOrder: 20,
  },
  {
    description: "Danh sách công ty, pháp nhân và đối tác liên quan.",
    groupKey: "admin-config",
    icon: "building",
    key: "companies",
    label: "Công ty",
    sortOrder: 30,
  },
  {
    description: "Tài khoản đăng nhập, liên kết nhân viên và vai trò.",
    groupKey: "admin-config",
    icon: "user-cog",
    key: "accounts",
    label: "Tài khoản",
    sortOrder: 40,
  },
  {
    description: "Nhận và xử lý yêu cầu hành chính hằng ngày.",
    groupKey: "admin-execution",
    icon: "inbox",
    key: "admin-requests",
    label: "Yêu cầu Hành chính",
    sortOrder: 10,
  },
  {
    description: "Tổng quan số liệu và việc cần chú ý.",
    groupKey: "bod-review",
    icon: "layout-dashboard",
    key: "overview",
    label: "Tổng quan",
    sortOrder: 10,
  },
  {
    description: "Danh sách việc cần lãnh đạo phê duyệt.",
    groupKey: "bod-review",
    icon: "check-circle",
    key: "approvals",
    label: "Phê duyệt",
    sortOrder: 20,
  },
  {
    description: "Tra cứu lịch sử xử lý và quyết định.",
    groupKey: "bod-review",
    icon: "clock",
    key: "history",
    label: "Lịch sử",
    sortOrder: 30,
  },
  {
    description: "Theo dõi trạng thái, hạn xử lý, tệp và lịch sử đơn đã gửi.",
    groupKey: "employee-default",
    icon: "inbox",
    key: "my-requests",
    label: "Đơn hàng của tôi",
    sortOrder: 10,
  },
  {
    description: "Kênh gửi câu hỏi và hỗ trợ nội bộ.",
    groupKey: "hanh-chinh-nv",
    icon: "life-buoy",
    key: "support-request",
    label: "Yêu cầu hỗ trợ",
    sortOrder: 50,
  },
  {
    description: "Cấu hình tài khoản, mẫu báo cáo, dữ liệu đầu vào và hợp nhất.",
    groupKey: "accounting-admin",
    icon: "bar-chart-3",
    key: "accounting-config",
    label: "Cấu hình báo cáo kế toán",
    sortOrder: 10,
  },
];

const foundationPermissions = [
  { action: "read", appModuleKey: "permissions", description: "View roles, permissions, and module access.", key: "system.permissions.read", module: "system.permissions" },
  { action: "manage", appModuleKey: "permissions", description: "Manage roles, permissions, and module access.", key: "system.permissions.manage", module: "system.permissions" },
  { action: "read", appModuleKey: "system-settings", description: "View system configuration.", key: "system.settings.read", module: "system.settings" },
  { action: "manage", appModuleKey: "system-settings", description: "Manage system configuration and workflow settings.", key: "system.settings.manage", module: "system.settings" },
  { action: "read", appModuleKey: "audit-logs", description: "View audit logs.", key: "audit_logs.read", module: "audit_logs" },
  { action: "read", appModuleKey: "employees", description: "View employees.", key: "employees.read", module: "employees" },
  { action: "manage", appModuleKey: "employees", description: "Create, update, archive, and reactivate employees.", key: "employees.manage", module: "employees" },
  { action: "read", appModuleKey: "companies", description: "View companies.", key: "companies.read", module: "companies" },
  { action: "manage", appModuleKey: "companies", description: "Create, update, archive, and reactivate companies.", key: "companies.manage", module: "companies" },
  { action: "read", appModuleKey: "accounts", description: "View user accounts and role assignment snapshots.", key: "users.read", module: "users" },
  { action: "manage", appModuleKey: "accounts", description: "Create, update, archive, and reactivate user accounts.", key: "users.manage", module: "users" },
  { action: "read", appModuleKey: "admin-requests", description: "View administrative requests.", key: "admin_requests.read", module: "admin_requests" },
  { action: "create", appModuleKey: "admin-requests", description: "Create administrative requests.", key: "admin_requests.create", module: "admin_requests" },
  { action: "process", appModuleKey: "admin-requests", description: "Process administrative requests.", key: "admin_requests.process", module: "admin_requests" },
  { action: "approve", appModuleKey: "admin-requests", description: "Approve administrative requests.", key: "admin_requests.approve", module: "admin_requests" },
  { action: "archive", appModuleKey: "admin-requests", description: "Archive or void administrative requests.", key: "admin_requests.archive", module: "admin_requests" },
  { action: "read", appModuleKey: "overview", description: "View leadership overview.", key: "overview.read", module: "overview" },
  { action: "read", appModuleKey: "approvals", description: "View approval queue.", key: "approvals.read", module: "approvals" },
  { action: "approve", appModuleKey: "approvals", description: "Approve assigned work.", key: "approvals.approve", module: "approvals" },
  { action: "read", appModuleKey: "history", description: "View history and status changes.", key: "history.read", module: "history" },
  { action: "read", appModuleKey: "my-requests", description: "View own requests.", key: "my_requests.read", module: "my_requests" },
  { action: "create", appModuleKey: "my-requests", description: "Create own administrative requests.", key: "my_requests.create", module: "my_requests" },
  { action: "read", appModuleKey: "support-request", description: "View own support requests.", key: "support_requests.read", module: "support_requests" },
  { action: "create", appModuleKey: "support-request", description: "Create support requests.", key: "support_requests.create", module: "support_requests" },
  { action: "read", appModuleKey: "global-config", description: "Xem cấu hình bản tin / thông báo.", key: "motivation.read", module: "motivation" },
  { action: "manage", appModuleKey: "global-config", description: "Quản lý bản tin / thông báo.", key: "motivation.manage", module: "motivation" },
  { action: "read", appModuleKey: "accounting-config", description: "Xem cấu hình báo cáo kế toán.", key: "accounting.config.read", module: "accounting.config" },
  { action: "edit", appModuleKey: "accounting-config", description: "Chỉnh sửa cấu hình báo cáo kế toán.", key: "accounting.config.edit", module: "accounting.config" },
  { action: "approve", appModuleKey: "accounting-config", description: "Duyệt và kích hoạt phiên bản cấu hình kế toán.", key: "accounting.config.approve", module: "accounting.config" },
  { action: "manage", appModuleKey: "accounting-config", description: "Quản lý luồng dữ liệu và báo cáo kế toán.", key: "accounting.runtime.manage", module: "accounting.runtime" },
  { action: "create", appModuleKey: "meetings", description: "Đặt phòng và tạo cuộc họp.", key: "meetings.create", module: "meetings" },
  { action: "manage", appModuleKey: "meetings", description: "Quản lý mọi cuộc họp và xử lý sự cố vận hành.", key: "meetings.manage", module: "meetings" },
  { action: "approve", appModuleKey: "meetings", description: "Duyệt biên bản và todo sinh từ cuộc họp.", key: "meetings.minutes.approve", module: "meetings.minutes" },
  { action: "manage", appModuleKey: "meeting-config", description: "Quản lý phòng họp, chính sách, Recall và Google Calendar.", key: "meeting_config.manage", module: "meeting_config" },
  { action: "manage", appModuleKey: "workbench-config", description: "Quản lý registry widget, bố cục gợi ý và nguồn công việc.", key: "workbench_config.manage", module: "workbench_config" },
  { action: "manage", appModuleKey: "warehouse-shelf-config", description: "Cập nhật các nhóm SKU được phép lưu trên từng kệ.", key: "warehouse_shelf_config.manage", module: "warehouse_shelf_config" },
];

// ---------------------------------------------------------------------------
// Legacy module catalog inherited from the old Hanh chinh GAS app.
// ---------------------------------------------------------------------------

const legacyGroups = [
  { collectionKey: "recruitment", collectionTitle: "Tuyển dụng", description: "Tiếp nhận, theo dõi pipeline, chiến dịch và lịch tuyển dụng.", key: "recruitment-management", sortOrder: 60, title: "Quản lý Ứng viên" },
  { collectionKey: "recruitment", collectionTitle: "Tuyển dụng", description: "Phân công và thực hiện các phiếu đánh giá ứng viên.", key: "recruitment-assessment", sortOrder: 70, title: "Đánh giá Ứng viên" },
  { collectionKey: "recruitment", collectionTitle: "Tuyển dụng", description: "Tổng hợp, công bố và tra cứu kết quả đánh giá.", key: "recruitment-results", sortOrder: 80, title: "Kết quả đánh giá" },
  { collectionKey: "nguoi-thuan-viet", collectionTitle: "Người Thuần Việt", description: "Hồ sơ pháp lý: đóng dấu, trích lục, cấp giấy, review.", key: "legal", sortOrder: 90, title: "Hồ sơ pháp lý" },
  { collectionKey: "nguoi-thuan-viet", collectionTitle: "Người Thuần Việt", description: "Đề xuất cấp phát tài sản và yêu cầu sửa chữa.", key: "asset-repair", sortOrder: 100, title: "Cấp phát & Sửa chữa" },
  { collectionKey: "nguoi-thuan-viet", collectionTitle: "Người Thuần Việt", description: "Công tác, đánh giá, gửi thư và nghiệp vụ hành chính.", key: "hanh-chinh-nv", sortOrder: 110, title: "Hành chính" },
  { collectionKey: "nguoi-thuan-viet", collectionTitle: "Người Thuần Việt", description: "Nhắc việc và công cụ hỗ trợ nội bộ.", key: "tien-ich", sortOrder: 120, title: "Tiện ích" },
  { collectionKey: "admin-kho", collectionTitle: "Admin Kho", description: "Cấu hình kho, kiểm kê, RFID, báo cáo và lịch dữ liệu.", key: "warehouse", sortOrder: 130, title: "Kho vận" },
  { collectionKey: "admin-xuong", collectionTitle: "Admin Xưởng", description: "Kế hoạch, đặt hàng, phân bổ, duyệt và báo cáo xưởng.", key: "workshop", sortOrder: 140, title: "Phân xưởng" },
];

// groupKey, key, label, icon. sortOrder is assigned per group automatically.
const legacyModuleDefs = [
  // Bổ sung Super Admin
  { groupKey: "super-admin-tools", key: "global-config", label: "Cấu hình Tổng", icon: "sliders" },
  // Bổ sung Cấu hình Hành chính
  { groupKey: "admin-config", key: "config", label: "Cấu hình", icon: "settings-2" },
  { groupKey: "admin-config", key: "template-management", label: "Định dạng biểu mẫu", icon: "file-text" },
  { groupKey: "admin-config", key: "asset-setup", label: "Setup tài sản", icon: "package" },
  { groupKey: "admin-config", key: "app-setup", label: "Setup ứng dụng", icon: "app-window" },
  { groupKey: "admin-config", key: "review-config", label: "Bộ nguyên tắc AI", icon: "scan-text" },
  { groupKey: "admin-config", key: "evaluation-config", label: "Cấu hình đánh giá", icon: "clipboard-list" },
  { groupKey: "admin-config", key: "meeting-config", label: "Cấu hình Lịch họp", icon: "calendar-cog" },
  { groupKey: "admin-config", key: "workbench-config", label: "Cấu hình Bàn làm việc", icon: "layout-grid" },
  // Tuyển dụng
  { groupKey: "recruitment-management", key: "candidate-management", label: "Quản lý Ứng viên", icon: "briefcase" },
  { groupKey: "recruitment-assessment", key: "candidate-assessment", label: "Đánh giá Ứng viên", icon: "clipboard-list" },
  { groupKey: "recruitment-results", key: "candidate-results", label: "Xem kết quả đánh giá", icon: "file-search" },
  // Bổ sung Thực thi Hành chính
  { groupKey: "admin-execution", key: "order-management", label: "Quản lý đơn hàng", icon: "clipboard-check" },
  { groupKey: "admin-execution", key: "admin-tools", label: "Hiệu đính hồ sơ", icon: "wrench" },
  { groupKey: "admin-execution", key: "reconciliation", label: "Đối soát", icon: "scale" },
  // Hồ sơ pháp lý
  { groupKey: "legal", key: "legal-info", label: "Thông tin pháp lý", icon: "info" },
  { groupKey: "legal", key: "document-seal", label: "Đóng dấu & Ký số", icon: "stamp" },
  { groupKey: "legal", key: "document-archive", label: "Trích lục / Lưu trữ hồ sơ", icon: "archive" },
  { groupKey: "legal", key: "authorization-letter", label: "Cấp giấy ủy quyền / giới thiệu", icon: "file-signature" },
  { groupKey: "legal", key: "review-contract", label: "Review hồ sơ", icon: "file-search" },
  // Cấp phát & Sửa chữa
  { groupKey: "asset-repair", key: "asset-allocation", label: "Đề xuất cấp phát", icon: "gift" },
  { groupKey: "asset-repair", key: "repair-request", label: "Yêu cầu sửa chữa", icon: "hammer" },
  // Hành chính (nhân viên)
  { groupKey: "hanh-chinh-nv", key: "business-trip", label: "Đăng ký công tác", icon: "plane" },
  { groupKey: "hanh-chinh-nv", key: "evaluation", label: "Đánh giá nhân sự", icon: "star" },
  { groupKey: "hanh-chinh-nv", key: "send-mail", label: "Gửi thư", icon: "mail" },
  { groupKey: "hanh-chinh-nv", key: "location-map", label: "Bản đồ định vị", icon: "map-pinned" },
  // Tiện ích
  { groupKey: "tien-ich", key: "todo", label: "Giao việc", icon: "list-todo" },
  { groupKey: "tien-ich", key: "support-tools", label: "Công cụ hỗ trợ", icon: "toolbox" },
  { groupKey: "tien-ich", key: "air-conditioner-control", label: "Quản lý hệ thống điện", icon: "lightbulb" },
  { groupKey: "tien-ich", key: "templates", label: "Biểu mẫu", icon: "file-text" },
  { groupKey: "tien-ich", key: "meetings", label: "Lịch họp & Đặt phòng", icon: "calendar-days" },
  // Kho vận
  { groupKey: "warehouse", key: "warehouse-config", label: "Cấu hình Kho", icon: "warehouse" },
  { groupKey: "warehouse", key: "warehouse-shelf-config", label: "Cấu hình kệ", icon: "tags" },
  { groupKey: "warehouse", key: "warehouse-info", label: "Thông tin kho", icon: "scan-line" },
  { groupKey: "warehouse", key: "warehouse-data-schedule", label: "Lịch dữ liệu Kho", icon: "calendar-clock" },
  { groupKey: "warehouse", key: "warehouse-inventory", label: "Kiểm kê Kho", icon: "boxes" },
  { groupKey: "warehouse", key: "warehouse-packing-mirror", label: "Phản chiếu đơn hàng", icon: "copy" },
  { groupKey: "warehouse", key: "warehouse-scan-log", label: "Nhật ký quét", icon: "scan-line" },
  { groupKey: "warehouse", key: "warehouse-report", label: "Báo cáo Kho", icon: "bar-chart" },
  // Phân xưởng
  { groupKey: "workshop", key: "workshop-config", label: "Cấu hình Xưởng", icon: "factory" },
  { groupKey: "workshop", key: "workshop-order", label: "Đặt hàng Xưởng", icon: "shopping-cart" },
  { groupKey: "workshop", key: "workshop-allocation", label: "Kế hoạch Xưởng", icon: "calendar-range" },
  { groupKey: "workshop", key: "workshop-plan", label: "Phân bổ thủ công", icon: "split" },
  { groupKey: "workshop", key: "workshop-plan-approval", label: "Duyệt KH Xưởng", icon: "badge-check" },
  { groupKey: "workshop", key: "workshop-proposal", label: "Đề xuất Xưởng", icon: "lightbulb" },
  { groupKey: "workshop", key: "workshop-report", label: "Báo cáo Xưởng", icon: "bar-chart-3" },
  { groupKey: "workshop", key: "workshop-inventory", label: "Kiểm kê Xưởng", icon: "boxes" },
];

const permModuleName = (key) => key.replace(/-/g, "_");

const legacyGroupCursor = new Map();
const legacyModules = legacyModuleDefs.map((def) => {
  const next = (legacyGroupCursor.get(def.groupKey) ?? 0) + 10;
  legacyGroupCursor.set(def.groupKey, next);
  return {
    description: `${def.label}.`,
    groupKey: def.groupKey,
    icon: def.icon,
    key: def.key,
    label: def.label,
    sortOrder: next,
  };
});

const legacyPermissions = legacyModuleDefs.map((def) => ({
  action: "read",
  appModuleKey: def.key,
  description: `Xem module ${def.label}.`,
  key: `${permModuleName(def.key)}.read`,
  module: permModuleName(def.key),
}));

const legacyReadKeys = legacyPermissions.map((permission) => permission.key);
const legacyEmployeeGroupKeys = ["legal", "asset-repair", "hanh-chinh-nv", "tien-ich"];
const legacyEmployeeReadKeys = legacyModules
  .filter((appModule) => legacyEmployeeGroupKeys.includes(appModule.groupKey))
  .map((appModule) => `${permModuleName(appModule.key)}.read`);

// ---------------------------------------------------------------------------
// Combined catalog
// ---------------------------------------------------------------------------

const moduleGroups = [...foundationGroups, ...legacyGroups];
const appModules = [...foundationModules, ...legacyModules];
const permissions = [...foundationPermissions, ...legacyPermissions];

const roles = [
  { description: "Highest system owner. Can manage permission structure.", includeDefaultEmployeeAccess: true, isCore: true, isSystem: true, key: "super-admin", name: "Super Admin", rank: 1 },
  { description: "Admin Hanh chinh or module owner.", includeDefaultEmployeeAccess: true, isCore: true, isSystem: false, key: "admin", name: "Admin", rank: 20 },
  { description: "Chỉnh sửa cấu hình và vận hành báo cáo kế toán.", includeDefaultEmployeeAccess: true, isCore: false, isSystem: true, key: "admin-ke-toan-editor", name: "Admin Kế toán - Biên tập", rank: 25 },
  { description: "Duyệt, kích hoạt cấu hình và vận hành báo cáo kế toán.", includeDefaultEmployeeAccess: true, isCore: false, isSystem: true, key: "admin-ke-toan-approver", name: "Admin Kế toán - Phê duyệt", rank: 24 },
  { description: "Leadership approval and overview.", includeDefaultEmployeeAccess: true, isCore: true, isSystem: false, key: "bod", name: "BOD", rank: 40 },
  { description: "Internal employee request flow.", includeDefaultEmployeeAccess: true, isCore: true, isSystem: false, key: "employee", name: "Nhân viên", rank: 100 },
];

const roleAccess = {
  "super-admin": {
    groupKeys: moduleGroups.map((group) => group.key),
    moduleKeys: appModules.map((appModule) => appModule.key),
    permissionKeys: permissions.map((permission) => permission.key),
  },
  admin: {
    groupKeys: [
      "admin-config",
      "admin-execution",
      "employee-default",
      "legal",
      "asset-repair",
      "hanh-chinh-nv",
      "tien-ich",
      "warehouse",
      "workshop",
      "recruitment-management",
      "recruitment-assessment",
      "recruitment-results",
    ],
    moduleKeys: [],
    permissionKeys: [
      "system.settings.read",
      "system.settings.manage",
      "employees.read",
      "employees.manage",
      "companies.read",
      "companies.manage",
      "users.read",
      "admin_requests.read",
      "admin_requests.create",
      "admin_requests.process",
      "admin_requests.archive",
      "my_requests.read",
      "my_requests.create",
      "support_requests.read",
      "support_requests.create",
      "motivation.read",
      "motivation.manage",
      "meetings.create",
      "meetings.manage",
      "meetings.minutes.approve",
      "meeting_config.manage",
      "workbench_config.manage",
      ...legacyReadKeys,
    ],
  },
  "admin-ke-toan-editor": {
    groupKeys: ["accounting-admin", "employee-default", ...legacyEmployeeGroupKeys],
    moduleKeys: ["accounting-config"],
    permissionKeys: [
      "accounting.config.read",
      "accounting.config.edit",
      "accounting.runtime.manage",
      "my_requests.read",
      "my_requests.create",
      "support_requests.read",
      "support_requests.create",
    ],
  },
  "admin-ke-toan-approver": {
    groupKeys: ["accounting-admin", "employee-default", ...legacyEmployeeGroupKeys],
    moduleKeys: ["accounting-config"],
    permissionKeys: [
      "accounting.config.read",
      "accounting.config.edit",
      "accounting.config.approve",
      "accounting.runtime.manage",
      "my_requests.read",
      "my_requests.create",
      "support_requests.read",
      "support_requests.create",
    ],
  },
  bod: {
    groupKeys: ["bod-review", "employee-default", ...legacyEmployeeGroupKeys],
    moduleKeys: ["admin-requests", "meetings"],
    permissionKeys: [
      "overview.read",
      "approvals.read",
      "approvals.approve",
      "history.read",
      "admin_requests.read",
      "admin_requests.approve",
      "my_requests.read",
      "my_requests.create",
      "support_requests.read",
      "support_requests.create",
      "legal_info.read",
      "document_seal.read",
      "document_archive.read",
      "authorization_letter.read",
      "review_contract.read",
      "meetings.read",
      "meetings.create",
      "meetings.minutes.approve",
    ],
  },
  employee: {
    groupKeys: ["employee-default", ...legacyEmployeeGroupKeys],
    moduleKeys: [],
    permissionKeys: [
      "my_requests.read",
      "my_requests.create",
      "support_requests.read",
      "support_requests.create",
      "meetings.create",
      ...legacyEmployeeReadKeys,
    ],
  },
};

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function generatedId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

async function upsertModuleGroup(client, group) {
  const result = await client.query(
    `
      INSERT INTO "ModuleGroup" (
        "id", "key", "title", "collectionKey", "collectionTitle",
        "description", "sortOrder", "isActive", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
      ON CONFLICT ("key") DO UPDATE SET
        "title" = EXCLUDED."title",
        "collectionKey" = EXCLUDED."collectionKey",
        "collectionTitle" = EXCLUDED."collectionTitle",
        "description" = EXCLUDED."description",
        "sortOrder" = EXCLUDED."sortOrder",
        "isActive" = true,
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "id"
    `,
    [
      generatedId("mg"),
      group.key,
      group.title,
      group.collectionKey,
      group.collectionTitle,
      group.description,
      group.sortOrder,
      now(),
    ],
  );

  return result.rows[0].id;
}

async function upsertAppModule(client, appModule, groupId) {
  const result = await client.query(
    `
      INSERT INTO "AppModule" (
        "id", "key", "label", "description", "icon",
        "groupId", "sortOrder", "isActive", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
      ON CONFLICT ("key") DO UPDATE SET
        "label" = EXCLUDED."label",
        "description" = EXCLUDED."description",
        "icon" = EXCLUDED."icon",
        "groupId" = EXCLUDED."groupId",
        "sortOrder" = EXCLUDED."sortOrder",
        "isActive" = true,
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "id"
    `,
    [
      generatedId("mod"),
      appModule.key,
      appModule.label,
      appModule.description,
      appModule.icon,
      groupId,
      appModule.sortOrder,
      now(),
    ],
  );

  return result.rows[0].id;
}

async function upsertPermission(client, permission, appModuleId) {
  const result = await client.query(
    `
      INSERT INTO "Permission" (
        "id", "key", "module", "action", "description", "appModuleId"
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT ("key") DO UPDATE SET
        "module" = EXCLUDED."module",
        "action" = EXCLUDED."action",
        "description" = EXCLUDED."description",
        "appModuleId" = EXCLUDED."appModuleId"
      RETURNING "id"
    `,
    [
      generatedId("perm"),
      permission.key,
      permission.module,
      permission.action,
      permission.description,
      appModuleId,
    ],
  );

  return result.rows[0].id;
}

async function upsertRole(client, role) {
  const result = await client.query(
    `
      INSERT INTO "Role" (
        "id", "key", "name", "description", "rank", "status",
        "isSystem", "isCore", "includeDefaultEmployeeAccess", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE'::"RoleStatus", $6, $7, $8, $9)
      ON CONFLICT ("key") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "rank" = EXCLUDED."rank",
        "status" = 'ACTIVE'::"RoleStatus",
        "isSystem" = EXCLUDED."isSystem",
        "isCore" = EXCLUDED."isCore",
        "includeDefaultEmployeeAccess" = EXCLUDED."includeDefaultEmployeeAccess",
        "updatedAt" = EXCLUDED."updatedAt",
        "archivedAt" = NULL
      RETURNING "id"
    `,
    [
      generatedId("role"),
      role.key,
      role.name,
      role.description,
      role.rank,
      role.isSystem,
      role.isCore,
      role.includeDefaultEmployeeAccess,
      now(),
    ],
  );

  return result.rows[0].id;
}

async function replaceRoleLinks(client, roleId, access, ids) {
  await client.query('DELETE FROM "RolePermission" WHERE "roleId" = $1', [
    roleId,
  ]);
  await client.query('DELETE FROM "RoleModuleGroup" WHERE "roleId" = $1', [
    roleId,
  ]);
  await client.query('DELETE FROM "RoleAppModule" WHERE "roleId" = $1', [
    roleId,
  ]);

  for (const permissionKey of access.permissionKeys) {
    await client.query(
      `
        INSERT INTO "RolePermission" ("roleId", "permissionId")
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [roleId, ids.permissions.get(permissionKey)],
    );
  }

  for (const groupKey of access.groupKeys) {
    await client.query(
      `
        INSERT INTO "RoleModuleGroup" ("roleId", "moduleGroupId")
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [roleId, ids.moduleGroups.get(groupKey)],
    );
  }

  for (const moduleKey of access.moduleKeys) {
    await client.query(
      `
        INSERT INTO "RoleAppModule" ("roleId", "appModuleId")
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [roleId, ids.appModules.get(moduleKey)],
    );
  }
}

async function ensureSuperAdminUser(client, superAdminRoleId) {
  const username = (
    process.env.SEED_SUPER_ADMIN_USERNAME || "superadmin"
  ).trim();
  const email = (
    process.env.SEED_SUPER_ADMIN_EMAIL || "superadmin@cong-van-hanh.local"
  )
    .trim()
    .toLowerCase();
  const displayName = (
    process.env.SEED_SUPER_ADMIN_NAME || "Super Admin"
  ).trim();
  const shouldResetPassword =
    process.env.SEED_SUPER_ADMIN_RESET_PASSWORD === "true";
  const providedPassword = process.env.SEED_SUPER_ADMIN_PASSWORD?.trim();
  const generatedPassword = providedPassword || randomBytes(18).toString("base64url");

  const existing = await client.query(
    `
      SELECT "id", "username", "email"
      FROM "User"
      WHERE "username" = $1 OR "email" = $2
      LIMIT 1
    `,
    [username, email],
  );

  if (existing.rowCount === 0) {
    const userId = generatedId("usr");
    const passwordHash = await bcrypt.hash(generatedPassword, 12);

    await client.query(
      `
        INSERT INTO "User" (
          "id", "email", "username", "passwordHash", "displayName",
          "requiresPassword", "activationStatus", "activationReviewedAt",
          "status", "updatedAt"
        )
        VALUES (
          $1, $2, $3, $4, $5, TRUE,
          'APPROVED'::"UserActivationStatus", $6,
          'ACTIVE'::"UserStatus", $6
        )
      `,
      [userId, email, username, passwordHash, displayName, now()],
    );

    await client.query(
      `
        INSERT INTO "UserRole" ("userId", "roleId", "assignedById")
        VALUES ($1, $2, NULL)
        ON CONFLICT DO NOTHING
      `,
      [userId, superAdminRoleId],
    );

    await client.query(
      `
        INSERT INTO "AuditLog" (
          "id", "actorId", "action", "targetType", "targetId",
          "summary", "metadata"
        )
        VALUES ($1, NULL, 'CREATE'::"AuditAction", 'User', $2, $3, $4)
      `,
      [
        generatedId("audit"),
        userId,
        "Seeded first Super Admin user.",
        {
          roleKey: "super-admin",
          username,
        },
      ],
    );

    return {
      created: true,
      displayName,
      email,
      generatedPassword: providedPassword ? null : generatedPassword,
      username,
    };
  }

  const user = existing.rows[0];

  const updateValues = [displayName, email, username, now(), user.id];
  let passwordSql = "";

  if (shouldResetPassword || (providedPassword && shouldResetPassword)) {
    const passwordHash = await bcrypt.hash(generatedPassword, 12);
    updateValues.splice(4, 0, passwordHash);
    passwordSql = ', "passwordHash" = $5';
  }

  await client.query(
    `
      UPDATE "User"
      SET
        "displayName" = $1,
        "email" = $2,
        "username" = $3,
        "requiresPassword" = TRUE,
        "activationStatus" = 'APPROVED'::"UserActivationStatus",
        "activationReviewedAt" = $4,
        "status" = 'ACTIVE'::"UserStatus",
        "updatedAt" = $4,
        "archivedAt" = NULL
        ${passwordSql}
      WHERE "id" = ${passwordSql ? "$6" : "$5"}
    `,
    updateValues,
  );

  await client.query(
    `
      INSERT INTO "UserRole" ("userId", "roleId", "assignedById")
      VALUES ($1, $2, NULL)
      ON CONFLICT DO NOTHING
    `,
    [user.id, superAdminRoleId],
  );

  return {
    created: false,
    displayName,
    email,
    generatedPassword: shouldResetPassword && !providedPassword ? generatedPassword : null,
    username,
  };
}

async function main() {
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const ids = {
      appModules: new Map(),
      moduleGroups: new Map(),
      permissions: new Map(),
      roles: new Map(),
    };

    for (const group of moduleGroups) {
      ids.moduleGroups.set(group.key, await upsertModuleGroup(client, group));
    }

    for (const appModule of appModules) {
      ids.appModules.set(
        appModule.key,
        await upsertAppModule(
          client,
          appModule,
          ids.moduleGroups.get(appModule.groupKey),
        ),
      );
    }

    for (const permission of permissions) {
      ids.permissions.set(
        permission.key,
        await upsertPermission(
          client,
          permission,
          ids.appModules.get(permission.appModuleKey),
        ),
      );
    }

    for (const role of roles) {
      ids.roles.set(role.key, await upsertRole(client, role));
    }

    for (const role of roles) {
      await replaceRoleLinks(
        client,
        ids.roles.get(role.key),
        roleAccess[role.key],
        ids,
      );
    }

    const superAdmin = await ensureSuperAdminUser(
      client,
      ids.roles.get("super-admin"),
    );

    await client.query("COMMIT");

    console.log("Seed completed.");
    console.log(`Module groups: ${moduleGroups.length}`);
    console.log(`Modules: ${appModules.length}`);
    console.log(`Permissions: ${permissions.length}`);
    console.log(`Roles: ${roles.length}`);
    console.log(
      `Super Admin: ${superAdmin.created ? "created" : "already existed"} (${superAdmin.username})`,
    );

    if (superAdmin.generatedPassword) {
      console.log(`Temporary password: ${superAdmin.generatedPassword}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
