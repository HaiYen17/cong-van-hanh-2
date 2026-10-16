import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { activationStatusLabel } from "@/lib/auth/account-activation";
import { getDb } from "@/lib/db";
import {
  portalModuleLabel,
  VISIBLE_PORTAL_MODULE_KEYS,
} from "@/lib/legacy-portal-catalog";

import { PermissionConsole } from "./permission-console";
import "./permission-console.css";
import type {
  PermissionAction,
  PermissionActionMap,
  PermissionConsoleData,
} from "./types";

export const metadata: Metadata = {
  title: "Phân quyền | Cổng vận hành",
};

const ACTION_ORDER: PermissionAction[] = ["view", "edit", "delete"];

function normalizeActionMap(
  role: {
    roleModuleGroups: Array<{
      moduleGroup: {
        modules: Array<{ key: string }>;
      };
    }>;
    roleModules: Array<{ appModule: { key: string } }>;
    rolePermissions: Array<{
      permission: { action: string; key: string };
    }>;
  },
) {
  const accessibleModuleKeys = new Set<string>();
  for (const { moduleGroup } of role.roleModuleGroups) {
    for (const appModule of moduleGroup.modules) {
      accessibleModuleKeys.add(appModule.key);
    }
  }
  for (const { appModule } of role.roleModules) {
    accessibleModuleKeys.add(appModule.key);
  }

  const configured: PermissionActionMap = {};
  for (const { permission } of role.rolePermissions) {
    if (!permission.key.startsWith("portal.")) {
      continue;
    }
    const parts = permission.key.split(".");
    const action = parts.at(-1) as PermissionAction;
    const moduleKey = parts.slice(1, -1).join(".");
    if (!ACTION_ORDER.includes(action) || !moduleKey) {
      continue;
    }
    configured[moduleKey] ??= [];
    if (!configured[moduleKey].includes(action)) {
      configured[moduleKey].push(action);
    }
  }

  const actionMap: PermissionActionMap = {};
  for (const moduleKey of accessibleModuleKeys) {
    actionMap[moduleKey] = configured[moduleKey] ?? ["view", "edit", "delete"];
    actionMap[moduleKey].sort(
      (left, right) =>
        ACTION_ORDER.indexOf(left) - ACTION_ORDER.indexOf(right),
    );
  }

  return {
    accessibleModuleKeys: [...accessibleModuleKeys],
    actionMap,
  };
}

async function getPermissionConsoleData(): Promise<PermissionConsoleData> {
  const db = getDb();
  const visibleModuleKeys = [...VISIBLE_PORTAL_MODULE_KEYS];
  const [employees, roles, assignedUsers, groups, modules] = await Promise.all([
    db.employee.findMany({
      orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
      select: {
        department: true,
        employeeCode: true,
        fullName: true,
        id: true,
        title: true,
      },
      where: { status: "ACTIVE" },
    }),
    db.role.findMany({
      include: {
        _count: { select: { userRoles: true } },
        roleModuleGroups: {
          include: {
            moduleGroup: {
              include: {
                modules: {
                  select: { key: true },
                  where: {
                    isActive: true,
                    key: { in: visibleModuleKeys },
                  },
                },
              },
            },
          },
        },
        roleModules: {
          include: { appModule: true },
          where: {
            appModule: {
              isActive: true,
              key: { in: visibleModuleKeys },
            },
          },
        },
        rolePermissions: {
          include: { permission: true },
        },
      },
      orderBy: [{ rank: "asc" }, { name: "asc" }],
      where: {
        key: { not: "hoi-ong-phong-van" },
        status: { not: "ARCHIVED" },
      },
    }),
    db.user.findMany({
      include: {
        employee: true,
        userRoles: {
          include: {
            role: {
              include: {
                roleModuleGroups: {
                  include: { moduleGroup: true },
                },
              },
            },
          },
          orderBy: { role: { rank: "asc" } },
        },
      },
      orderBy: [{ displayName: "asc" }, { username: "asc" }],
      where: {
        employeeId: { not: null },
        userRoles: { some: {} },
      },
    }),
    db.moduleGroup.findMany({
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      where: {
        isActive: true,
        modules: {
          some: {
            isActive: true,
            key: { in: visibleModuleKeys },
          },
        },
      },
    }),
    db.appModule.findMany({
      include: { group: true },
      orderBy: [
        { group: { sortOrder: "asc" } },
        { sortOrder: "asc" },
        { label: "asc" },
      ],
      where: {
        isActive: true,
        key: { in: visibleModuleKeys },
      },
    }),
  ]);

  const visibleGroupKeys = new Set(groups.map((group) => group.key));

  const moduleLabelByKey = new Map(
    modules.map((appModule) => [
      appModule.key,
      portalModuleLabel(appModule.key, appModule.label),
    ]),
  );

  return {
    assignments: assignedUsers.map((user) => {
      const assignedRole = user.userRoles[0]?.role;
      const employeeName = user.employee?.fullName ?? user.displayName;
      const employeeTitle = user.employee?.title ?? "";
      const hasPassword = Boolean(user.passwordHash);
      return {
        activationRequestedAt: user.activationRequestedAt?.toISOString() ?? null,
        activationStatus: user.activationStatus,
        activationStatusLabel: activationStatusLabel(user.activationStatus),
        accessibleGroupLabels:
          assignedRole?.roleModuleGroups
            .filter(({ moduleGroup }) => visibleGroupKeys.has(moduleGroup.key))
            .map(({ moduleGroup }) => moduleGroup.title) ?? [],
        employeeCode: user.employee?.employeeCode ?? user.username,
        employeeDisplayName: employeeTitle
          ? `${employeeName} - ${employeeTitle}`
          : employeeName,
        employeeId: user.employee?.id ?? "",
        hasPassword,
        passwordStatusLabel: !user.requiresPassword
          ? "Không bắt buộc"
          : hasPassword
            ? "Bắt buộc - Đã tạo"
            : "Bắt buộc - Chờ tạo",
        requiresPassword: user.requiresPassword,
        roleId: assignedRole?.id ?? "",
        roleKey: assignedRole?.key ?? "",
        roleLabel: assignedRole?.name ?? "Chưa phân quyền",
        userId: user.id,
      };
    }),
    employees: employees.map((employee) => ({
      department: employee.department ?? "",
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      id: employee.id,
      title: employee.title ?? "",
    })),
    groups: groups.map((group) => ({
      collectionTitle: group.collectionTitle ?? "Khác",
      description: group.description ?? "",
      key: group.key,
      title: group.title,
    })),
    modules: modules.map((appModule) => ({
      description: appModule.description ?? "",
      groupKey: appModule.group.key,
      groupTitle: appModule.group.title,
      key: appModule.key,
      label: portalModuleLabel(appModule.key, appModule.label),
    })),
    roles: roles.map((role) => {
      const { accessibleModuleKeys, actionMap } = normalizeActionMap(role);
      const accessibleGroupKeys = role.roleModuleGroups
        .map(({ moduleGroup }) => moduleGroup.key)
        .filter((key) => visibleGroupKeys.has(key));
      return {
        accessibleGroupKeys,
        accessibleGroupLabels: role.roleModuleGroups
          .filter(({ moduleGroup }) => visibleGroupKeys.has(moduleGroup.key))
          .map(({ moduleGroup }) => moduleGroup.title),
        accessibleModuleKeys,
        accessibleModuleLabels: accessibleModuleKeys
          .map((key) => moduleLabelByKey.get(key) ?? key)
          .sort((left, right) => left.localeCompare(right, "vi")),
        description: role.description ?? "",
        id: role.id,
        includeDefaultEmployeeAccess: role.includeDefaultEmployeeAccess,
        isActive: role.status === "ACTIVE",
        isCore: role.isCore || role.isSystem,
        isEditable: role.key !== "super-admin",
        key: role.key,
        moduleActionMap: actionMap,
        name: role.name,
        rank: role.rank,
        status: role.status === "ACTIVE" ? "Kích hoạt" : "Vô hiệu",
        userCount: role._count.userRoles,
      };
    }),
    roleOptions: roles
      .filter((role) => role.status === "ACTIVE")
      .map((role) => ({ id: role.id, key: role.key, name: role.name })),
  };
}

export default async function PhanQuyenPage() {
  const session = await requireCurrentSession();
  const isSuperAdmin =
    session.fullAccess && session.roles.includes("super-admin");

  if (!isSuperAdmin) {
    return (
      <AppShell moduleKey="permissions" session={session}>
        <Panel title="Không có quyền">
          <p className="text-sm leading-6 text-muted">
            Chỉ Super Admin mới xem và thay đổi trang phân quyền.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const data = await getPermissionConsoleData();

  return (
    <AppShell moduleKey="permissions" session={session}>
      <PermissionConsole data={data} />
    </AppShell>
  );
}
