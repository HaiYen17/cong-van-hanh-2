import "server-only";

import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export type OperationActor = {
  canManageEvaluation?: boolean;
  displayName: string;
  employeeCode: string;
  employeeId: string;
  fullAccess: boolean;
  isAdmin: boolean;
  isBod: boolean;
  modules: string[];
  permissions: string[];
  roles: string[];
  userId: string;
};

export async function resolveOperationActor(
  session: AppSession,
): Promise<OperationActor> {
  const user = await getDb().user.findUnique({
    select: {
      displayName: true,
      employee: {
        select: {
          employeeCode: true,
          id: true,
        },
      },
    },
    where: { id: session.userId },
  });

  return {
    canManageEvaluation:
      session.fullAccess ||
      session.roles.includes("admin") ||
      session.roles.includes("super-admin") ||
      session.permissions.includes("portal.evaluation-config.edit") ||
      session.permissions.includes("portal.evaluation-config.delete") ||
      session.permissions.includes("evaluation_config.manage"),
    displayName: user?.displayName || session.displayName,
    employeeCode: user?.employee?.employeeCode || "",
    employeeId: user?.employee?.id || "",
    fullAccess: session.fullAccess,
    isAdmin:
      session.fullAccess ||
      session.roles.includes("admin") ||
      session.roles.includes("super-admin"),
    isBod: session.roles.includes("bod"),
    modules: session.modules,
    permissions: session.permissions,
    roles: session.roles,
    userId: session.userId,
  };
}
