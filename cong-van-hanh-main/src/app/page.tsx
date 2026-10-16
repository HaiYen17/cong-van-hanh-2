import { LegacyPortalDashboard } from "@/components/legacy-portal-dashboard";
import { requireCurrentSession } from "@/lib/auth/session";
import { sessionUserIds } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { getGreeting } from "@/lib/greeting";
import { buildLegacyFeatureGroups } from "@/lib/legacy-portal-catalog";
import { getActiveMotivations } from "@/lib/motivation";
import {
  isPendingEvaluationFor,
  type EvaluationBadgeContent,
} from "@/lib/evaluation/dashboard-badge";

const OPEN_REQUEST_STATUSES = [
  "SUBMITTED",
  "IN_PROGRESS",
  "NEEDS_INFO",
  "APPROVED",
] as const;

export default async function Home() {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const db = getDb();

  const [
    databaseModules,
    motivation,
    myRequestCount,
    adminRequestCount,
    user,
    evaluationInstances,
  ] = await Promise.all([
    db.appModule.findMany({
      include: { group: { select: { key: true } } },
      where: { isActive: true, group: { isActive: true } },
    }),
    getActiveMotivations(identityUserIds),
    db.request.count({
      where: {
        archivedAt: null,
        createdById: session.userId,
        status: { in: [...OPEN_REQUEST_STATUSES] },
      },
    }),
    db.request.count({
      where: {
        archivedAt: null,
        status: { in: [...OPEN_REQUEST_STATUSES] },
      },
    }),
    db.user.findUnique({
      select: { employee: { select: { employeeCode: true } } },
      where: { id: session.userId },
    }),
    db.evaluationRecord.findMany({
      select: { content: true },
      where: {
        recordType: "evaluation-instance",
        status: {
          notIn: ["completed", "finalized", "archived", "deleted", "inactive"],
        },
      },
    }),
  ]);

  const employeeCode = user?.employee?.employeeCode ?? "";
  const evaluationCount = evaluationInstances.filter((instance) =>
    isPendingEvaluationFor(
      instance.content as unknown as EvaluationBadgeContent,
      employeeCode,
    ),
  ).length;

  const featureGroups = buildLegacyFeatureGroups({
    badgeCounts: {
      evaluation: evaluationCount,
      "my-orders": myRequestCount,
      "order-management": adminRequestCount,
    },
    databaseModules,
    session,
  });

  return (
    <LegacyPortalDashboard
      canAdminNotify={
        session.fullAccess ||
        session.roles.includes("admin") ||
        session.roles.some((role) => role.startsWith("admin-"))
      }
      displayName={session.displayName}
      featureGroups={featureGroups}
      greeting={getGreeting()}
      motivation={motivation}
    />
  );
}
