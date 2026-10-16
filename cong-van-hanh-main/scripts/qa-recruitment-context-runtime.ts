import type { AppSession } from "@/lib/auth/session";
import {
  grantRecruitmentPanelContext,
  hasRecruitmentPanelAssignment,
  RECRUITMENT_PANEL_CONTEXT_PERMISSION,
  RECRUITMENT_PANEL_MODULE_KEY,
} from "@/lib/auth/recruitment-context-access";
import {
  mergeSessionAccess,
  resolveSessionAccess,
} from "@/lib/auth/session-access";
import { getDb } from "@/lib/db";
import { RecruitmentRuntimeError } from "@/lib/recruitment/errors";
import {
  getCandidateAssessmentQueue,
  openCandidateAssessment,
} from "@/lib/recruitment/runtime";

async function main() {
  const db = getDb();
  const [assignments, defaultEmployeeRole] = await Promise.all([
    db.recruitmentAssignment.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        reviewerEmployeeId: true,
        reviewerName: true,
        interview: { select: { status: true } },
      },
      take: 2000,
      where: {
        interview: { status: { not: "cancelled" } },
        reviewerEmployeeId: { not: null },
        status: { notIn: ["cancelled", "legacy_grouped"] },
      },
    }),
    db.role.findFirst({
      include: {
        roleModuleGroups: {
          include: {
            moduleGroup: {
              include: { modules: { where: { isActive: true } } },
            },
          },
        },
        roleModules: { include: { appModule: true } },
        rolePermissions: { include: { permission: true } },
      },
      where: { key: "employee", status: "ACTIVE" },
    }),
  ]);
  if (!defaultEmployeeRole) {
    throw new Error("Không tìm thấy vai trò Nhân viên để QA quyền nền.");
  }
  const defaultEmployeeAccess = resolveSessionAccess([defaultEmployeeRole]);
  const employeeIds = [
    ...new Set(assignments.map((row) => row.reviewerEmployeeId).filter(Boolean)),
  ] as string[];
  const employees = await db.employee.findMany({
    include: {
      user: {
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  roleModuleGroups: {
                    include: {
                      moduleGroup: {
                        include: { modules: { where: { isActive: true } } },
                      },
                    },
                  },
                  roleModules: { include: { appModule: true } },
                  rolePermissions: { include: { permission: true } },
                },
              },
            },
          },
        },
      },
    },
    where: { id: { in: employeeIds }, user: { isNot: null } },
  });
  const target = employees.find((employee) => {
    const roles = employee.user?.userRoles.map(({ role }) => role.key) || [];
    return (
      employee.user?.status === "ACTIVE" &&
      !roles.some((role) =>
        ["admin", "super-admin", "admin-tuyen-dung"].includes(role),
      )
    );
  });
  if (!target?.user) {
    throw new Error("Không tìm thấy người phỏng vấn thường để kiểm thử quyền ngữ cảnh.");
  }

  const activeRoles = target.user.userRoles
    .map(({ role }) => role)
    .filter((role) => role.status === "ACTIVE");
  let access = resolveSessionAccess(activeRoles);
  const hasPanelAssignment =
    !access.fullAccess &&
    (await hasRecruitmentPanelAssignment({
      employeeCode: target.employeeCode,
      employeeId: target.id,
      userId: target.user.id,
    }));
  if (hasPanelAssignment) {
    if (!activeRoles.some((role) => role.includeDefaultEmployeeAccess)) {
      access = mergeSessionAccess(
        access,
        defaultEmployeeAccess,
      );
    }
    access = grantRecruitmentPanelContext(access);
  }
  const session: AppSession = {
    displayName: target.user.displayName,
    fullAccess: access.fullAccess,
    moduleGroups: access.moduleGroups,
    modules: access.modules,
    permissions: access.permissions,
    roles: access.roleKeys,
    userId: target.user.id,
  };
  {
    const queue = await getCandidateAssessmentQueue(session, { limit: 100 });
    const entries = queue.entries as Array<{
      assignmentId: string;
      reviewerEmployeeId: string;
    }>;
    const reviewerIds = new Set([
      target.id,
      target.employeeCode,
      target.user.id,
    ]);
    const foreignEntries = entries.filter(
      (entry) => !reviewerIds.has(entry.reviewerEmployeeId),
    );
    const foreignAssignment = assignments.find(
      (assignment) =>
        assignment.reviewerEmployeeId &&
        !reviewerIds.has(assignment.reviewerEmployeeId),
    );
    let foreignOpenDenied = false;
    if (foreignAssignment) {
      try {
        await openCandidateAssessment(session, {
          assignmentId: foreignAssignment.id,
        });
      } catch (error) {
        foreignOpenDenied =
          error instanceof RecruitmentRuntimeError && error.status === 403;
      }
    }
    const legacyRole = await db.role.findUnique({
      include: { userRoles: true },
      where: { key: "hoi-ong-phong-van" },
    });
    const missingDefaultModules = defaultEmployeeAccess.modules.filter(
      (moduleKey) => !session.modules.includes(moduleKey),
    );
    const missingDefaultGroups = defaultEmployeeAccess.moduleGroups.filter(
      (groupKey) => !session.moduleGroups.includes(groupKey),
    );
    const ok =
      session.modules.includes(RECRUITMENT_PANEL_MODULE_KEY) &&
      missingDefaultModules.length === 0 &&
      missingDefaultGroups.length === 0 &&
      session.permissions.includes(RECRUITMENT_PANEL_CONTEXT_PERMISSION) &&
      entries.length > 0 &&
      foreignEntries.length === 0 &&
      Boolean(foreignAssignment) &&
      foreignOpenDenied &&
      legacyRole?.status === "ARCHIVED" &&
      legacyRole.userRoles.length === 0;

    console.log(
      JSON.stringify(
        {
          contextPermission: session.permissions.includes(
            RECRUITMENT_PANEL_CONTEXT_PERMISSION,
          ),
          foreignEntries: foreignEntries.length,
          foreignOpenDenied,
          legacyRole: legacyRole
            ? { assignedUsers: legacyRole.userRoles.length, status: legacyRole.status }
            : null,
          moduleVisible: session.modules.includes(RECRUITMENT_PANEL_MODULE_KEY),
          standardEmployeeAccess: {
            expectedGroups: defaultEmployeeAccess.moduleGroups.length,
            expectedModules: defaultEmployeeAccess.modules.length,
            missingGroups: missingDefaultGroups,
            missingModules: missingDefaultModules,
          },
          ok,
          ownQueueEntries: entries.length,
          target: {
            employeeCode: target.employeeCode,
            fullName: target.fullName,
            roles: session.roles,
          },
        },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
