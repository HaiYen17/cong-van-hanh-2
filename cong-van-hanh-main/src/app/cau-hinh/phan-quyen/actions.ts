"use server";

import { revalidatePath } from "next/cache";

import type { Prisma } from "@/generated/prisma/client";
import {
  getPasswordStrengthError,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { VISIBLE_PORTAL_MODULE_KEYS } from "@/lib/legacy-portal-catalog";

import type {
  PermissionAction,
  PermissionActionMap,
  PermissionMutation,
  PermissionMutationResult,
} from "./types";

const PATH = "/cau-hinh/phan-quyen";
const VALID_ACTIONS = new Set<PermissionAction>(["view", "edit", "delete"]);
const DEFAULT_EMPLOYEE_COLLECTION = "nguoi-thuan-viet";

class PermissionError extends Error {}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeActionMap(
  source: PermissionActionMap,
  validModuleKeys: Set<string>,
) {
  const normalized: PermissionActionMap = {};

  for (const [moduleKey, sourceActions] of Object.entries(source ?? {})) {
    if (!validModuleKeys.has(moduleKey) || !Array.isArray(sourceActions)) {
      continue;
    }

    const actions = new Set<PermissionAction>();
    for (const action of sourceActions) {
      if (VALID_ACTIONS.has(action)) {
        actions.add(action);
      }
    }
    if (actions.has("edit") || actions.has("delete")) {
      actions.add("view");
    }
    if (actions.size) {
      normalized[moduleKey] = [...actions].sort(
        (left, right) =>
          ["view", "edit", "delete"].indexOf(left) -
          ["view", "edit", "delete"].indexOf(right),
      );
    }
  }

  return normalized;
}

async function authenticateSuperAdmin(actorPassword: string) {
  const session = await requireCurrentSession();
  if (!session.fullAccess || !session.roles.includes("super-admin")) {
    throw new PermissionError("Chỉ Super Admin mới được quản lý phân quyền.");
  }

  const db = getDb();
  const actor = await db.user.findUnique({
    include: {
      userRoles: {
        include: { role: true },
      },
    },
    where: { id: session.userId },
  });

  const isActiveSuperAdmin =
    actor?.status === "ACTIVE" &&
    actor.userRoles.some(
      ({ role }) => role.key === "super-admin" && role.status === "ACTIVE",
    );

  if (!actor || !isActiveSuperAdmin || !actor.passwordHash) {
    throw new PermissionError(
      "Tài khoản Super Admin chưa có mật khẩu bảo mật hợp lệ.",
    );
  }

  if (
    !normalizeText(actorPassword) ||
    !(await verifyPassword(actorPassword, actor.passwordHash))
  ) {
    throw new PermissionError("Mật khẩu Super Admin không đúng.");
  }

  // Dữ liệu seed cũ có thể còn cờ false dù đã có mật khẩu. Sau lần xác thực
  // thành công đầu tiên, đưa cờ này về đúng hợp đồng bảo mật của hệ thống cũ.
  if (!actor.requiresPassword) {
    await db.user.update({
      data: { requiresPassword: true },
      where: { id: actor.id },
    });
  }

  return { actorId: actor.id, db };
}

async function assertNotLastSuperAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const targetIsSuperAdmin = await tx.userRole.count({
    where: {
      role: { key: "super-admin", status: "ACTIVE" },
      userId,
    },
  });
  if (!targetIsSuperAdmin) {
    return;
  }

  const activeSuperAdminCount = await tx.userRole.count({
    where: {
      role: { key: "super-admin", status: "ACTIVE" },
      user: { status: "ACTIVE" },
    },
  });
  if (activeSuperAdminCount <= 1) {
    throw new PermissionError(
      "Không thể gỡ hoặc hạ quyền Super Admin cuối cùng của hệ thống.",
    );
  }
}

function shouldGrantSpecializedPermission(
  action: string,
  grantedActions: PermissionAction[],
) {
  if (action === "read" || action === "view") {
    return grantedActions.includes("view");
  }
  if (action === "archive" || action === "delete") {
    return grantedActions.includes("delete");
  }
  if (action === "manage") {
    return (
      grantedActions.includes("edit") || grantedActions.includes("delete")
    );
  }
  return grantedActions.includes("edit");
}

async function saveAssignment(
  mutation: Extract<PermissionMutation, { type: "assignment-save" }>,
  actorId: string,
) {
  const db = getDb();
  const employeeId = normalizeText(mutation.employeeId);
  const roleId = normalizeText(mutation.roleId);
  if (!employeeId || !roleId) {
    throw new PermissionError("Vui lòng chọn nhân sự và quyền được phân.");
  }

  const [employee, role] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId } }),
    db.role.findUnique({ where: { id: roleId } }),
  ]);
  if (!employee || employee.status !== "ACTIVE") {
    throw new PermissionError("Không tìm thấy nhân sự đang hoạt động.");
  }
  if (!role || role.status !== "ACTIVE") {
    throw new PermissionError("Quyền được chọn không còn hoạt động.");
  }

  await db.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { employeeId } });
    let requiresPassword = true;
    if (user) {
      const currentlySuperAdmin = await tx.userRole.count({
        where: {
          role: { key: "super-admin" },
          userId: user.id,
        },
      });
      if (currentlySuperAdmin && role.key !== "super-admin") {
        await assertNotLastSuperAdmin(tx, user.id);
      }

      user = await tx.user.update({
        data: {
          displayName: employee.fullName,
          requiresPassword,
          status: "ACTIVE",
        },
        where: { id: user.id },
      });
    } else {
      const username = employee.employeeCode.trim().toLowerCase();
      const matchingAccount = await tx.user.findFirst({
        where: {
          OR: [
            { username },
            { email: `${username}@cong-van-hanh.local` },
            ...(employee.email ? [{ email: employee.email.toLowerCase() }] : []),
          ],
        },
      });

      if (matchingAccount?.employeeId && matchingAccount.employeeId !== employee.id) {
        throw new PermissionError(
          "Mã nhân sự hoặc email này đã gắn với một tài khoản khác.",
        );
      }

      user = matchingAccount
        ? await tx.user.update({
            data: {
              activationStatus: matchingAccount.passwordHash
                ? "APPROVED"
                : "NOT_REQUESTED",
              displayName: employee.fullName,
              employeeId: employee.id,
              requiresPassword: true,
              status: "ACTIVE",
            },
            where: { id: matchingAccount.id },
          })
        : await tx.user.create({
            data: {
              activationStatus: "NOT_REQUESTED",
              displayName: employee.fullName,
              email: `${username}@cong-van-hanh.local`,
              employeeId: employee.id,
              passwordHash: "",
              requiresPassword: true,
              status: "ACTIVE",
              username,
            },
          });
      requiresPassword = user.requiresPassword;
    }

    await tx.userRole.deleteMany({ where: { userId: user.id } });
    await tx.userRole.create({
      data: {
        assignedById: actorId,
        roleId: role.id,
        userId: user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "PERMISSION_CHANGE",
        actorId,
        metadata: {
          employeeCode: employee.employeeCode,
          requiresPassword,
          roleKey: role.key,
        },
        summary: `Gán quyền ${role.name} cho ${employee.fullName}.`,
        targetId: user.id,
        targetType: "User",
      },
    });
  });

  return `Đã lưu phân quyền cho ${employee.fullName}.`;
}

async function deleteAssignment(
  mutation: Extract<PermissionMutation, { type: "assignment-delete" }>,
  actorId: string,
) {
  const db = getDb();
  const userId = normalizeText(mutation.userId);
  const target = await db.user.findUnique({
    include: { employee: true },
    where: { id: userId },
  });
  if (!target) {
    throw new PermissionError("Không tìm thấy phân quyền cần xóa.");
  }

  await db.$transaction(async (tx) => {
    await assertNotLastSuperAdmin(tx, target.id);
    await tx.userRole.deleteMany({ where: { userId: target.id } });
    await tx.user.update({
      data: { requiresPassword: false },
      where: { id: target.id },
    });
    await tx.auditLog.create({
      data: {
        action: "PERMISSION_CHANGE",
        actorId,
        summary: `Xóa phân quyền của ${target.displayName}.`,
        targetId: target.id,
        targetType: "User",
      },
    });
  });

  return `Đã xóa phân quyền của ${target.employee?.fullName ?? target.displayName}.`;
}

async function saveUserPassword(
  mutation: Extract<PermissionMutation, { type: "password-save" }>,
  actorId: string,
) {
  const db = getDb();
  const userId = normalizeText(mutation.userId);
  const newPassword = String(mutation.newPassword ?? "");
  const confirmPassword = String(mutation.confirmPassword ?? "");
  const target = await db.user.findUnique({
    include: {
      employee: true,
      userRoles: { include: { role: true } },
    },
    where: { id: userId },
  });
  if (!target || !target.userRoles.length) {
    throw new PermissionError("Không tìm thấy phân quyền cần đổi mật khẩu.");
  }
  if (!target.requiresPassword) {
    throw new PermissionError(
      "Hãy bật yêu cầu mật khẩu trong phân quyền trước khi tạo mật khẩu.",
    );
  }
  const strengthError = getPasswordStrengthError(newPassword);
  if (strengthError) {
    throw new PermissionError(strengthError);
  }
  if (newPassword !== confirmPassword) {
    throw new PermissionError("Mật khẩu nhập lại không khớp.");
  }

  const passwordHash = await hashPassword(newPassword);
  const reviewedAt = new Date();
  await db.$transaction([
    db.user.update({
      data: {
        activationReviewedAt: reviewedAt,
        activationStatus: "APPROVED",
        passwordHash,
        requiresPassword: true,
      },
      where: { id: target.id },
    }),
    db.auditLog.create({
      data: {
        action: "PERMISSION_CHANGE",
        actorId,
        metadata: { passwordChanged: true },
        summary: `Đổi mật khẩu phân quyền cho ${target.displayName}.`,
        targetId: target.id,
        targetType: "User",
      },
    }),
  ]);

  return `Đã tạo mật khẩu mới cho ${target.employee?.fullName ?? target.displayName}.`;
}

async function reviewAccountActivation(
  mutation: Extract<PermissionMutation, { type: "activation-review" }>,
  actorId: string,
) {
  const db = getDb();
  const userId = normalizeText(mutation.userId);
  const target = await db.user.findUnique({
    include: { employee: true },
    where: { id: userId },
  });
  if (!target || !target.employee || target.employee.status !== "ACTIVE") {
    throw new PermissionError(
      "Không tìm thấy tài khoản nhân sự đang chờ kích hoạt.",
    );
  }
  if (target.status !== "ACTIVE") {
    throw new PermissionError(
      "Tài khoản đang bị khóa hoặc ngừng hoạt động nên không thể kích hoạt.",
    );
  }
  if (target.activationStatus !== "PENDING") {
    throw new PermissionError(
      "Yêu cầu kích hoạt này đã được xử lý hoặc không còn hợp lệ.",
    );
  }

  const approved = mutation.decision === "approve";
  const reviewedAt = new Date();
  await db.$transaction([
    db.user.update({
      data: {
        activationReviewedAt: reviewedAt,
        activationStatus: approved ? "APPROVED" : "REJECTED",
        requiresPassword: true,
      },
      where: { id: target.id },
    }),
    db.authSession.updateMany({
      data: { revokedAt: reviewedAt },
      where: { revokedAt: null, userId: target.id },
    }),
    db.auditLog.create({
      data: {
        action: approved ? "ACTIVATION_APPROVE" : "ACTIVATION_REJECT",
        actorId,
        metadata: {
          activationStatus: approved ? "APPROVED" : "REJECTED",
          employeeCode: target.employee.employeeCode,
        },
        summary: `${approved ? "Kích hoạt" : "Từ chối kích hoạt"} tài khoản ${target.employee.fullName}.`,
        targetId: target.id,
        targetType: "User",
      },
    }),
  ]);

  return approved
    ? `Đã kích hoạt tài khoản cho ${target.employee.fullName}. Nhân sự có thể tạo mật khẩu để đăng nhập.`
    : `Đã từ chối yêu cầu kích hoạt của ${target.employee.fullName}.`;
}

async function saveRole(
  mutation: Extract<PermissionMutation, { type: "role-save" }>,
  actorId: string,
) {
  const db = getDb();
  const originalKey = normalizeText(mutation.originalKey);
  const name = normalizeText(mutation.name);
  const requestedKey = slugify(normalizeText(mutation.roleKey) || name);
  const roleKey = originalKey || requestedKey;

  if (!name) {
    throw new PermissionError("Vui lòng nhập tên quyền.");
  }
  if (!roleKey) {
    throw new PermissionError("Mã quyền không hợp lệ.");
  }

  const existing = originalKey
    ? await db.role.findUnique({ where: { key: originalKey } })
    : null;
  if (originalKey && !existing) {
    throw new PermissionError("Quyền cần cập nhật không còn tồn tại.");
  }
  if (existing?.key === "super-admin") {
    throw new PermissionError(
      "Super Admin đang được khóa để đảm bảo an toàn hệ thống.",
    );
  }
  if (!existing && (await db.role.findUnique({ where: { key: roleKey } }))) {
    throw new PermissionError(`Mã quyền "${roleKey}" đã tồn tại.`);
  }

  const [groups, modules] = await Promise.all([
    db.moduleGroup.findMany({
      include: {
        modules: {
          select: { id: true, key: true },
          where: {
            isActive: true,
            key: { in: [...VISIBLE_PORTAL_MODULE_KEYS] },
          },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
      where: {
        isActive: true,
        modules: {
          some: {
            isActive: true,
            key: { in: [...VISIBLE_PORTAL_MODULE_KEYS] },
          },
        },
      },
    }),
    db.appModule.findMany({
      include: {
        permissions: true,
      },
      orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
      where: {
        isActive: true,
        key: { in: [...VISIBLE_PORTAL_MODULE_KEYS] },
      },
    }),
  ]);

  const validGroupKeys = new Set(groups.map(({ key }) => key));
  const validModuleKeys = new Set(modules.map(({ key }) => key));
  const selectedGroupKeys = new Set(
    (mutation.groupKeys ?? []).filter((key) => validGroupKeys.has(key)),
  );
  const includeDefaultEmployeeAccess =
    roleKey === "employee"
      ? true
      : Boolean(mutation.includeDefaultEmployeeAccess);

  if (includeDefaultEmployeeAccess) {
    for (const group of groups) {
      if (group.collectionKey === DEFAULT_EMPLOYEE_COLLECTION) {
        selectedGroupKeys.add(group.key);
      }
    }
  }
  if (roleKey === "admin") {
    for (const group of groups) {
      if (group.key !== "super-admin-tools") {
        selectedGroupKeys.add(group.key);
      }
    }
  }

  const configuredActionMap = normalizeActionMap(
    mutation.moduleActionMap ?? {},
    validModuleKeys,
  );
  const explicitModuleKeys = Object.entries(configuredActionMap)
    .filter(([, actions]) => actions.includes("view"))
    .map(([moduleKey]) => moduleKey);

  if (
    !includeDefaultEmployeeAccess &&
    selectedGroupKeys.size === 0 &&
    explicitModuleKeys.length === 0
  ) {
    throw new PermissionError(
      "Vui lòng chọn ít nhất một nhóm hoặc module cho quyền này.",
    );
  }

  const accessibleModuleKeys = new Set(explicitModuleKeys);
  for (const group of groups) {
    if (selectedGroupKeys.has(group.key)) {
      for (const appModule of group.modules) {
        accessibleModuleKeys.add(appModule.key);
      }
    }
  }

  const effectiveActionMap: PermissionActionMap = {};
  for (const moduleKey of accessibleModuleKeys) {
    effectiveActionMap[moduleKey] = configuredActionMap[moduleKey] ?? [
      "view",
      "edit",
      "delete",
    ];
  }

  const rawRank = Number(mutation.rank);
  const rank = Number.isFinite(rawRank) ? Math.max(1, Math.trunc(rawRank)) : 50;
  const isCore = Boolean(existing?.isCore || existing?.isSystem);
  const isActive = isCore ? true : Boolean(mutation.isActive);

  await db.$transaction(async (tx) => {
    const role = existing
      ? await tx.role.update({
          data: {
            description: normalizeText(mutation.description) || null,
            includeDefaultEmployeeAccess,
            name,
            rank,
            status: isActive ? "ACTIVE" : "INACTIVE",
          },
          where: { id: existing.id },
        })
      : await tx.role.create({
          data: {
            description: normalizeText(mutation.description) || null,
            includeDefaultEmployeeAccess,
            isCore: false,
            isSystem: false,
            key: roleKey,
            name,
            rank,
            status: isActive ? "ACTIVE" : "INACTIVE",
          },
        });

    const configuredPermissionIds: string[] = [];
    for (const [moduleKey, actions] of Object.entries(effectiveActionMap)) {
      const appModule = modules.find(({ key }) => key === moduleKey);
      if (!appModule) {
        continue;
      }
      for (const action of actions) {
        const permission = await tx.permission.upsert({
          create: {
            action,
            appModuleId: appModule.id,
            description: `${action} module ${appModule.label}.`,
            key: `portal.${moduleKey}.${action}`,
            module: `portal.${moduleKey}`,
          },
          update: {
            appModuleId: appModule.id,
            description: `${action} module ${appModule.label}.`,
          },
          where: { key: `portal.${moduleKey}.${action}` },
        });
        configuredPermissionIds.push(permission.id);
      }
    }

    const specializedPermissionIds = modules.flatMap((appModule) => {
      const grantedActions = effectiveActionMap[appModule.key];
      if (!grantedActions) {
        return [];
      }
      return appModule.permissions
        .filter(
          (permission) =>
            !permission.key.startsWith("portal.") &&
            shouldGrantSpecializedPermission(
              permission.action,
              grantedActions,
            ),
        )
        .map(({ id }) => id);
    });
    const permissionIds = [
      ...new Set([...configuredPermissionIds, ...specializedPermissionIds]),
    ];
    const selectedGroups = groups.filter(({ key }) =>
      selectedGroupKeys.has(key),
    );
    const explicitModules = modules.filter(({ key }) =>
      explicitModuleKeys.includes(key),
    );

    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.roleModuleGroup.deleteMany({ where: { roleId: role.id } });
    await tx.roleAppModule.deleteMany({ where: { roleId: role.id } });

    if (permissionIds.length) {
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          permissionId,
          roleId: role.id,
        })),
        skipDuplicates: true,
      });
    }
    if (selectedGroups.length) {
      await tx.roleModuleGroup.createMany({
        data: selectedGroups.map(({ id: moduleGroupId }) => ({
          moduleGroupId,
          roleId: role.id,
        })),
        skipDuplicates: true,
      });
    }
    if (explicitModules.length) {
      await tx.roleAppModule.createMany({
        data: explicitModules.map(({ id: appModuleId }) => ({
          appModuleId,
          roleId: role.id,
        })),
        skipDuplicates: true,
      });
    }

    await tx.auditLog.create({
      data: {
        action: "PERMISSION_CHANGE",
        actorId,
        metadata: {
          groupKeys: [...selectedGroupKeys],
          includeDefaultEmployeeAccess,
          moduleActionMap: effectiveActionMap,
          roleKey,
        },
        summary: `${existing ? "Cập nhật" : "Tạo"} quyền ${name}.`,
        targetId: role.id,
        targetType: "Role",
      },
    });
  });

  return "Đã lưu quyền thành công.";
}

async function deleteRole(
  mutation: Extract<PermissionMutation, { type: "role-delete" }>,
  actorId: string,
) {
  const db = getDb();
  const roleKey = normalizeText(mutation.roleKey);
  const role = await db.role.findUnique({
    include: {
      _count: { select: { userRoles: true } },
    },
    where: { key: roleKey },
  });
  if (!role) {
    throw new PermissionError("Không tìm thấy quyền cần xóa.");
  }
  if (role.key === "super-admin" || role.isCore || role.isSystem) {
    throw new PermissionError("Quyền lõi của hệ thống không thể xóa.");
  }
  if (role._count.userRoles > 0) {
    throw new PermissionError(
      "Quyền này đang được gán cho nhân sự nên chưa thể xóa.",
    );
  }

  await db.$transaction([
    db.auditLog.create({
      data: {
        action: "PERMISSION_CHANGE",
        actorId,
        metadata: { deletedRoleKey: role.key },
        summary: `Xóa quyền ${role.name}.`,
        targetId: role.id,
        targetType: "Role",
      },
    }),
    db.role.delete({ where: { id: role.id } }),
  ]);

  return "Đã xóa quyền thành công.";
}

function resultFromError(error: unknown): PermissionMutationResult {
  if (error instanceof PermissionError) {
    return { error: error.message };
  }
  console.error("Permission mutation failed", error);
  return {
    error: "Không thể hoàn tất thao tác phân quyền. Vui lòng thử lại.",
  };
}

export async function performPermissionMutation(
  mutation: PermissionMutation,
): Promise<PermissionMutationResult> {
  try {
    const { actorId } = await authenticateSuperAdmin(mutation.actorPassword);
    let success = "";

    switch (mutation.type) {
      case "activation-review":
        success = await reviewAccountActivation(mutation, actorId);
        break;
      case "assignment-save":
        success = await saveAssignment(mutation, actorId);
        break;
      case "assignment-delete":
        success = await deleteAssignment(mutation, actorId);
        break;
      case "password-save":
        success = await saveUserPassword(mutation, actorId);
        break;
      case "role-save":
        success = await saveRole(mutation, actorId);
        break;
      case "role-delete":
        success = await deleteRole(mutation, actorId);
        break;
      default:
        throw new PermissionError("Thao tác phân quyền không hợp lệ.");
    }

    revalidatePath(PATH);
    revalidatePath("/");
    return { success };
  } catch (error) {
    return resultFromError(error);
  }
}
