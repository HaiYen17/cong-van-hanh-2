import "server-only";

import { getDb } from "@/lib/db";
import {
  mergeSessionAccess,
  type SessionAccess,
} from "@/lib/auth/session-access";

export const RECRUITMENT_PANEL_MODULE_KEY = "candidate-assessment";
export const RECRUITMENT_PANEL_CONTEXT_PERMISSION =
  "context.recruitment-panel.assigned";

export function grantRecruitmentPanelContext(
  access: SessionAccess,
  defaultEmployeeAccess?: SessionAccess,
): SessionAccess {
  return mergeSessionAccess(
    access,
    ...(defaultEmployeeAccess ? [defaultEmployeeAccess] : []),
    {
      fullAccess: false,
      moduleGroups: [],
      modules: [RECRUITMENT_PANEL_MODULE_KEY],
      permissions: [RECRUITMENT_PANEL_CONTEXT_PERMISSION],
      roleKeys: [],
    },
  );
}

export async function hasRecruitmentPanelAssignment({
  employeeCode,
  employeeCodes = [],
  employeeId,
  employeeIds = [],
  userId,
  userIds = [],
}: {
  employeeCode?: string | null;
  employeeCodes?: string[];
  employeeId?: string | null;
  employeeIds?: string[];
  userId?: string | null;
  userIds?: string[];
}) {
  const reviewerIds = [
    ...new Set(
      [
        employeeId,
        employeeCode,
        userId,
        ...employeeIds,
        ...employeeCodes,
        ...userIds,
      ].filter(Boolean),
    ),
  ] as string[];
  if (!reviewerIds.length) return false;

  const assignment = await getDb().recruitmentAssignment.findFirst({
    select: { id: true },
    where: {
      interview: { status: { not: "cancelled" } },
      reviewerEmployeeId: { in: reviewerIds },
      status: { notIn: ["cancelled", "legacy_grouped"] },
    },
  });

  return Boolean(assignment);
}
