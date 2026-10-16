import { canUsePortalModule } from "@/lib/auth/module-authorization";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getRecruitmentManagementWorkspace } from "@/lib/recruitment/management-runtime";
import {
  getCandidateAssessmentQueue,
  getCandidateResultsCenter,
  getRecruitmentScoringConfig,
} from "@/lib/recruitment/runtime";

const ROLE_KEY = "admin-tuyen-dung";
const TARGET_EMPLOYEE_CODE = "2501305";
const MODULE_KEYS = [
  "candidate-management",
  "candidate-assessment",
  "candidate-results",
] as const;
const ACTIONS = ["view", "edit", "delete"] as const;

async function loadRole() {
  return getDb().role.findUnique({
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
      userRoles: {
        include: { user: { include: { employee: true } } },
      },
    },
    where: { key: ROLE_KEY },
  });
}

async function applyRepair(roleId: string) {
  const db = getDb();
  const modules = await db.appModule.findMany({
    where: { key: { in: [...MODULE_KEYS] }, isActive: true },
  });
  if (modules.length !== MODULE_KEYS.length) {
    throw new Error("Không tìm đủ 3 Module Tuyển dụng đang hoạt động.");
  }

  await db.$transaction(async (tx) => {
    const permissionIds: string[] = [];
    for (const appModule of modules) {
      for (const action of ACTIONS) {
        const permission = await tx.permission.upsert({
          create: {
            action,
            appModuleId: appModule.id,
            description: `${action} module ${appModule.label}.`,
            key: `portal.${appModule.key}.${action}`,
            module: `portal.${appModule.key}`,
          },
          update: { appModuleId: appModule.id },
          where: { key: `portal.${appModule.key}.${action}` },
        });
        permissionIds.push(permission.id);
      }
    }
    await tx.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ permissionId, roleId })),
      skipDuplicates: true,
    });
    await tx.auditLog.create({
      data: {
        action: "PERMISSION_CHANGE",
        metadata: {
          actions: [...ACTIONS],
          modules: [...MODULE_KEYS],
          repair: "admin-recruitment-portal-actions",
        },
        summary:
          "Đồng bộ quyền thao tác 3 Module Tuyển dụng cho vai trò Admin Tuyển dụng.",
        targetId: roleId,
        targetType: "Role",
      },
    });
  });
}

async function main() {
  let role = await loadRole();
  if (!role) throw new Error(`Không tìm thấy vai trò ${ROLE_KEY}.`);

  if (process.argv.includes("--apply")) {
    await applyRepair(role.id);
    role = await loadRole();
    if (!role) throw new Error(`Không tải lại được vai trò ${ROLE_KEY}.`);
  }

  const modules = new Set(role.roleModules.map(({ appModule }) => appModule.key));
  for (const { moduleGroup } of role.roleModuleGroups) {
    for (const appModule of moduleGroup.modules) modules.add(appModule.key);
  }
  const permissions = role.rolePermissions.map(({ permission }) => permission.key);
  const subject = {
    fullAccess: false,
    modules: [...modules],
    permissions,
    roles: [role.key],
  };
  const target = role.userRoles.find(
    ({ user }) => user.employee?.employeeCode === TARGET_EMPLOYEE_CODE,
  );
  const access = Object.fromEntries(
    MODULE_KEYS.map((moduleKey) => [
      moduleKey,
      Object.fromEntries(
        ACTIONS.map((action) => [
          action,
          canUsePortalModule(subject, moduleKey, action),
        ]),
      ),
    ]),
  );
  const ok =
    Boolean(target) &&
    MODULE_KEYS.every((moduleKey) =>
      ACTIONS.every((action) => canUsePortalModule(subject, moduleKey, action)),
    );
  let runtimeChecks: Record<string, boolean> = {};
  if (target) {
    const targetSession: AppSession = {
      displayName: target.user.displayName,
      fullAccess: false,
      moduleGroups: role.roleModuleGroups.map(
        ({ moduleGroup }) => moduleGroup.key,
      ),
      modules: [...modules],
      permissions,
      roles: [role.key],
      userId: target.user.id,
    };
    await getRecruitmentManagementWorkspace(targetSession, { limit: 40 });
    await getRecruitmentScoringConfig(targetSession);
    const assessmentQueue = await getCandidateAssessmentQueue(targetSession, {
      limit: 40,
      round: "all",
    });
    await getCandidateResultsCenter(targetSession, { query: "" });
    if (!assessmentQueue.actor.isAdmin) {
      throw new Error(
        "Admin Tuyển dụng chưa được nhận phạm vi xem toàn bộ hàng chờ đánh giá.",
      );
    }
    const targetReviewerIds = new Set(
      [
        target.user.id,
        target.user.employee?.id,
        target.user.employee?.employeeCode,
      ].filter(Boolean),
    );
    const seesOtherReviewer = assessmentQueue.entries.some(
      (entry) =>
        entry.reviewerEmployeeId &&
        !targetReviewerIds.has(entry.reviewerEmployeeId),
    );
    if (!seesOtherReviewer) {
      throw new Error(
        "Admin Tuyển dụng vẫn chưa thấy phiếu được phân công cho người khác.",
      );
    }
    runtimeChecks = {
      candidateAssessmentAllData: seesOtherReviewer,
      candidateAssessmentWorkspace: assessmentQueue.entries.length > 0,
      candidateManagementWorkspace: true,
      candidateResultsWorkspace: true,
    };
  }

  console.log(
    JSON.stringify(
      {
        access,
        ok,
        role: role.key,
        runtimeChecks,
        targetEmployee: target
          ? {
              employeeCode: target.user.employee?.employeeCode,
              fullName: target.user.employee?.fullName,
              userId: target.user.id,
            }
          : null,
        users: role.userRoles.map(({ user }) => ({
          employeeCode: user.employee?.employeeCode || user.username,
          fullName: user.employee?.fullName || user.displayName,
        })),
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
