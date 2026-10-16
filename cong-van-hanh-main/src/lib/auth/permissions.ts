export const corePermissions = [
  {
    action: "read",
    description: "View roles, permissions, and module access.",
    key: "system.permissions.read",
    module: "system.permissions",
  },
  {
    action: "manage",
    description: "Manage roles, permissions, and module access.",
    key: "system.permissions.manage",
    module: "system.permissions",
  },
  {
    action: "read",
    description: "View system configuration.",
    key: "system.settings.read",
    module: "system.settings",
  },
  {
    action: "manage",
    description: "Manage system configuration and workflow settings.",
    key: "system.settings.manage",
    module: "system.settings",
  },
  {
    action: "read",
    description: "View audit logs.",
    key: "audit_logs.read",
    module: "audit_logs",
  },
  {
    action: "read",
    description: "View employees.",
    key: "employees.read",
    module: "employees",
  },
  {
    action: "manage",
    description: "Create, update, archive, and reactivate employees.",
    key: "employees.manage",
    module: "employees",
  },
  {
    action: "read",
    description: "View companies.",
    key: "companies.read",
    module: "companies",
  },
  {
    action: "manage",
    description: "Create, update, archive, and reactivate companies.",
    key: "companies.manage",
    module: "companies",
  },
  {
    action: "read",
    description: "View user accounts and role assignment snapshots.",
    key: "users.read",
    module: "users",
  },
  {
    action: "manage",
    description: "Create, update, archive, and reactivate user accounts.",
    key: "users.manage",
    module: "users",
  },
  {
    action: "read",
    description: "View administrative requests.",
    key: "admin_requests.read",
    module: "admin_requests",
  },
  {
    action: "create",
    description: "Create administrative requests.",
    key: "admin_requests.create",
    module: "admin_requests",
  },
  {
    action: "process",
    description: "Process administrative requests.",
    key: "admin_requests.process",
    module: "admin_requests",
  },
  {
    action: "approve",
    description: "Approve administrative requests.",
    key: "admin_requests.approve",
    module: "admin_requests",
  },
  {
    action: "archive",
    description: "Archive or void administrative requests.",
    key: "admin_requests.archive",
    module: "admin_requests",
  },
  {
    action: "read",
    description: "View leadership overview.",
    key: "overview.read",
    module: "overview",
  },
  {
    action: "read",
    description: "View approval queue.",
    key: "approvals.read",
    module: "approvals",
  },
  {
    action: "approve",
    description: "Approve assigned work.",
    key: "approvals.approve",
    module: "approvals",
  },
  {
    action: "read",
    description: "View history and status changes.",
    key: "history.read",
    module: "history",
  },
  {
    action: "read",
    description: "View own requests.",
    key: "my_requests.read",
    module: "my_requests",
  },
  {
    action: "create",
    description: "Create own administrative requests.",
    key: "my_requests.create",
    module: "my_requests",
  },
  {
    action: "read",
    description: "View own support requests.",
    key: "support_requests.read",
    module: "support_requests",
  },
  {
    action: "create",
    description: "Create support requests.",
    key: "support_requests.create",
    module: "support_requests",
  },
  {
    action: "read",
    description: "Xem cấu hình bản tin / thông báo.",
    key: "motivation.read",
    module: "motivation",
  },
  {
    action: "manage",
    description: "Quản lý bản tin / thông báo (thêm, sửa, bật tắt).",
    key: "motivation.manage",
    module: "motivation",
  },
  {
    action: "read",
    description: "Xem sổ văn bản và loại văn bản.",
    key: "documents.read",
    module: "documents",
  },
  {
    action: "manage",
    description: "Cấp số văn bản, hủy số, cấu hình loại văn bản.",
    key: "documents.manage",
    module: "documents",
  },
  {
    action: "read",
    description: "Xem cấu hình và dữ liệu Báo cáo Kế toán.",
    key: "accounting.config.read",
    module: "accounting.config",
  },
  {
    action: "edit",
    description: "Tạo phiên bản và chỉnh sửa cấu hình Báo cáo Kế toán.",
    key: "accounting.config.edit",
    module: "accounting.config",
  },
  {
    action: "approve",
    description: "Duyệt và phát hành cấu hình Báo cáo Kế toán.",
    key: "accounting.config.approve",
    module: "accounting.config",
  },
  {
    action: "manage",
    description: "Quản lý kết nối và tiến trình dữ liệu kế toán.",
    key: "accounting.runtime.manage",
    module: "accounting.runtime",
  },
  {
    action: "read",
    description: "Xem lịch họp của bản thân và trạng thái bận của người khác.",
    key: "meetings.read",
    module: "meetings",
  },
  {
    action: "create",
    description: "Đặt phòng và tạo cuộc họp.",
    key: "meetings.create",
    module: "meetings",
  },
  {
    action: "manage",
    description: "Quản lý mọi cuộc họp và xử lý sự cố vận hành.",
    key: "meetings.manage",
    module: "meetings",
  },
  {
    action: "approve",
    description: "Duyệt biên bản và todo sinh từ cuộc họp.",
    key: "meetings.minutes.approve",
    module: "meetings.minutes",
  },
  {
    action: "read",
    description: "Xem danh mục phòng và cấu hình tích hợp lịch họp.",
    key: "meeting_config.read",
    module: "meeting_config",
  },
  {
    action: "manage",
    description: "Quản lý phòng họp, chính sách, Recall và Google Calendar.",
    key: "meeting_config.manage",
    module: "meeting_config",
  },
  {
    action: "read",
    description: "Xem registry widget, bố cục gợi ý và nguồn công việc.",
    key: "workbench_config.read",
    module: "workbench_config",
  },
  {
    action: "manage",
    description: "Quản lý registry widget, bố cục gợi ý và nguồn công việc.",
    key: "workbench_config.manage",
    module: "workbench_config",
  },
] as const;

export type PermissionKey = (typeof corePermissions)[number]["key"];

export const coreRoles = [
  {
    description: "Highest system owner. Can manage permission structure.",
    includeDefaultEmployeeAccess: true,
    isCore: true,
    key: "super-admin",
    name: "Super Admin",
    rank: 1,
  },
  {
    description: "Admin Hanh chinh or module owner.",
    includeDefaultEmployeeAccess: true,
    isCore: true,
    key: "admin",
    name: "Admin",
    rank: 20,
  },
  {
    description: "Leadership approval and overview.",
    includeDefaultEmployeeAccess: true,
    isCore: true,
    key: "bod",
    name: "BOD",
    rank: 40,
  },
  {
    description: "Internal employee request flow.",
    includeDefaultEmployeeAccess: true,
    isCore: true,
    key: "employee",
    name: "Nhan vien",
    rank: 100,
  },
] as const;

export type RoleKey = (typeof coreRoles)[number]["key"];

export function hasPermission(
  grantedPermissions: Iterable<string>,
  requiredPermission: PermissionKey,
) {
  return new Set(grantedPermissions).has(requiredPermission);
}
