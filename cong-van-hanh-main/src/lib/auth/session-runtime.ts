import "server-only";

import type { AppSession } from "@/lib/auth/session";
import {
  EVALUATION_CONTEXT_MODULE_KEY,
  grantEvaluationContext,
  hasEvaluationAssignment,
} from "@/lib/auth/evaluation-context-access";
import {
  grantRecruitmentPanelContext,
  hasRecruitmentPanelAssignment,
} from "@/lib/auth/recruitment-context-access";
import {
  mergeSessionAccess,
  resolveSessionAccess,
} from "@/lib/auth/session-access";
import { resolveSessionIdentity } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";

const accessUserInclude = {
  userRoles: {
    include: {
      role: {
        include: {
          roleModuleGroups: {
            include: {
              moduleGroup: {
                include: {
                  modules: { where: { isActive: true } },
                },
              },
            },
          },
          roleModules: { include: { appModule: true } },
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  },
} as const;

/**
 * Dựng session nghiệp vụ từ tài khoản đã xác thực. Khi nhân sự nằm trong một
 * nhóm liên kết, quyền và User ID ghi dữ liệu lấy từ tài khoản chính, còn toàn
 * bộ User/MNV trong nhóm được giữ làm phạm vi đọc dữ liệu lịch sử.
 */
export async function buildAppSessionForUserId(
  authenticatedUserId: string,
): Promise<AppSession | null> {
  const db = getDb();
  const authenticatedUser = await db.user.findUnique({
    include: {
      employee: {
        select: {
          employeeCode: true,
          id: true,
          personnelIdentityMemberships: {
            select: {
              link: {
                select: {
                  members: {
                    select: {
                      employee: {
                        select: {
                          employeeCode: true,
                          id: true,
                          user: { select: { id: true, status: true } },
                        },
                      },
                    },
                  },
                  primaryEmployeeId: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
    where: { id: authenticatedUserId },
  });
  if (
    !authenticatedUser ||
    authenticatedUser.status !== "ACTIVE" ||
    authenticatedUser.activationStatus !== "APPROVED"
  ) {
    return null;
  }

  const identityLink = authenticatedUser.employee?.personnelIdentityMemberships
    .map((membership) => membership.link)
    .find((link) => link.status === "ACTIVE");
  let identity = resolveSessionIdentity({
    authenticatedEmployeeCode: authenticatedUser.employee?.employeeCode,
    authenticatedEmployeeId: authenticatedUser.employee?.id,
    authenticatedUserId,
    link: identityLink
      ? {
          members: identityLink.members.map(({ employee }) => ({
            employeeCode: employee.employeeCode,
            employeeId: employee.id,
            userId: employee.user?.id,
            userStatus: employee.user?.status,
          })),
          primaryEmployeeId: identityLink.primaryEmployeeId,
          status: identityLink.status,
        }
      : null,
  });

  let accessUser = await db.user.findUnique({
    include: accessUserInclude,
    where: { id: identity.userId },
  });
  if (
    !accessUser ||
    accessUser.status !== "ACTIVE" ||
    accessUser.activationStatus !== "APPROVED"
  ) {
    identity = resolveSessionIdentity({
      authenticatedEmployeeCode: authenticatedUser.employee?.employeeCode,
      authenticatedEmployeeId: authenticatedUser.employee?.id,
      authenticatedUserId,
    });
    accessUser = await db.user.findUnique({
      include: accessUserInclude,
      where: { id: identity.userId },
    });
  }
  if (
    !accessUser ||
    accessUser.status !== "ACTIVE" ||
    accessUser.activationStatus !== "APPROVED"
  ) {
    return null;
  }

  const activeRoles = accessUser.userRoles
    .map((userRole) => userRole.role)
    .filter((role) => role.status === "ACTIVE");
  let access = resolveSessionAccess(activeRoles);
  const hasPanelAssignment =
    !access.fullAccess &&
    (await hasRecruitmentPanelAssignment({
      employeeCodes: identity.linkedEmployeeCodes,
      employeeId: identity.employeeId,
      employeeIds: identity.linkedEmployeeIds,
      userId: identity.userId,
      userIds: identity.linkedUserIds,
    }));
  if (hasPanelAssignment) {
    if (!activeRoles.some((role) => role.includeDefaultEmployeeAccess)) {
      const defaultEmployeeRole = await db.role.findFirst({
        include: {
          roleModuleGroups: {
            include: {
              moduleGroup: {
                include: {
                  modules: { where: { isActive: true } },
                },
              },
            },
          },
          roleModules: { include: { appModule: true } },
          rolePermissions: { include: { permission: true } },
        },
        where: {
          includeDefaultEmployeeAccess: true,
          key: "employee",
          status: "ACTIVE",
        },
      });
      if (defaultEmployeeRole) {
        access = mergeSessionAccess(
          access,
          resolveSessionAccess([defaultEmployeeRole]),
        );
      }
    }
    access = grantRecruitmentPanelContext(access);
  }
  if (
    !access.fullAccess &&
    !access.modules.includes(EVALUATION_CONTEXT_MODULE_KEY) &&
    (await hasEvaluationAssignment(identity.linkedEmployeeCodes))
  ) {
    access = grantEvaluationContext(access);
  }

  return {
    ...identity,
    displayName: accessUser.displayName,
    fullAccess: access.fullAccess,
    moduleGroups: access.moduleGroups,
    modules: access.modules,
    permissions: access.permissions,
    roles: access.roleKeys,
  };
}
