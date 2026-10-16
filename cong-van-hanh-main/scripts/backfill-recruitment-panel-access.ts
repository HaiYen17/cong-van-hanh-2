import { createHash } from "node:crypto";

import { getDb } from "@/lib/db";

const APPLY = process.argv.includes("--apply");
const DEFAULT_EMPLOYEE_ROLE_KEY = "employee";
const LEGACY_ROLE_KEY = "hoi-ong-phong-van";

type EmployeeRow = {
  employeeCode: string;
  fullName: string;
  id: string;
  user: {
    id: string;
    status: string;
    userRoles: Array<{
      role: {
        includeDefaultEmployeeAccess: boolean;
        status: string;
      };
    }>;
  } | null;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableAssignmentId(sourceId: string, employeeId: string) {
  return `rec_assignment_ctx_${createHash("sha1")
    .update(`${sourceId}|${employeeId}`)
    .digest("hex")}`;
}

function uniqueByEmployee(rows: EmployeeRow[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function aliases(employee: EmployeeRow) {
  const name = normalize(employee.fullName);
  const parts = name.split(" ").filter(Boolean);
  return new Set([
    name,
    employee.employeeCode,
    parts.at(-1) || "",
    parts.slice(-2).join(" "),
  ]);
}

async function main() {
  const db = getDb();
  const [employees, assignments, legacyRole, defaultEmployeeRole] =
    await Promise.all([
      db.employee.findMany({
        select: {
          employeeCode: true,
          fullName: true,
          id: true,
          user: {
            select: {
              id: true,
              status: true,
              userRoles: {
                select: {
                  role: {
                    select: {
                      includeDefaultEmployeeAccess: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
        where: { status: "ACTIVE", user: { isNot: null } },
      }),
      db.recruitmentAssignment.findMany({
        include: {
          interview: { select: { status: true } },
          scorecards: { select: { id: true } },
        },
        orderBy: { createdAt: "asc" },
        where: {
          interview: { status: { not: "cancelled" } },
          status: { notIn: ["cancelled", "legacy_grouped"] },
        },
      }),
      db.role.findUnique({ where: { key: LEGACY_ROLE_KEY } }),
      db.role.findFirst({
        select: { id: true },
        where: { key: DEFAULT_EMPLOYEE_ROLE_KEY, status: "ACTIVE" },
      }),
    ]);

  const activeEmployees = employees.filter(
    (employee) => employee.user?.status === "ACTIVE",
  ) as EmployeeRow[];
  const byId = new Map(activeEmployees.map((employee) => [employee.id, employee]));
  const byCode = new Map(
    activeEmployees.map((employee) => [employee.employeeCode, employee]),
  );
  const byAnyEmployeeId = new Map(employees.map((employee) => [employee.id, employee]));
  const byAnyEmployeeCode = new Map(
    employees.map((employee) => [employee.employeeCode, employee]),
  );
  const exactName = new Map<string, EmployeeRow[]>();
  const aliasMap = new Map<string, EmployeeRow[]>();
  for (const employee of activeEmployees) {
    const nameKey = normalize(employee.fullName);
    exactName.set(nameKey, [...(exactName.get(nameKey) || []), employee]);
    for (const alias of aliases(employee)) {
      if (!alias) continue;
      aliasMap.set(alias, [...(aliasMap.get(alias) || []), employee]);
    }
  }

  // Dữ liệu mới/đã chuẩn hóa là nguồn tin cậy để khử mơ hồ tên ngắn ở dữ liệu cũ.
  const knownAliasMap = new Map<string, EmployeeRow[]>();
  for (const assignment of assignments) {
    const employee = assignment.reviewerEmployeeId
      ? byId.get(assignment.reviewerEmployeeId) ||
        byCode.get(assignment.reviewerEmployeeId)
      : undefined;
    if (!employee) continue;
    for (const alias of [
      normalize(assignment.reviewerName),
      normalize(employee.fullName).split(" ").at(-1) || "",
    ]) {
      if (!alias) continue;
      knownAliasMap.set(alias, [
        ...(knownAliasMap.get(alias) || []),
        employee,
      ]);
    }
  }

  const directRepairs: Array<{
    assignmentId: string;
    employee: EmployeeRow;
  }> = [];
  const splitCreates: Array<{
    employee: EmployeeRow;
    source: (typeof assignments)[number];
  }> = [];
  const unresolved = new Map<string, number>();
  const waitingForAccount = new Map<string, EmployeeRow>();
  const effectiveUsers = new Map<string, EmployeeRow>();

  for (const assignment of assignments) {
    const direct = assignment.reviewerEmployeeId
      ? byId.get(assignment.reviewerEmployeeId) ||
        byCode.get(assignment.reviewerEmployeeId)
      : undefined;
    if (direct) {
      effectiveUsers.set(direct.id, direct);
      if (assignment.reviewerEmployeeId !== direct.id) {
        directRepairs.push({ assignmentId: assignment.id, employee: direct });
      }
      continue;
    }
    const inactiveDirect = assignment.reviewerEmployeeId
      ? byAnyEmployeeId.get(assignment.reviewerEmployeeId) ||
        byAnyEmployeeCode.get(assignment.reviewerEmployeeId)
      : undefined;
    if (inactiveDirect) {
      waitingForAccount.set(inactiveDirect.id, inactiveDirect as EmployeeRow);
      continue;
    }

    const sourceParts = assignment.reviewerName
      .split(/[,;&/]+/)
      .map((part) => normalize(part))
      .filter(Boolean)
      .filter((part) => !["ko co", "khong co"].includes(part));
    const resolved = new Map<string, EmployeeRow>();
    for (const part of sourceParts) {
      const knownCandidates = uniqueByEmployee(knownAliasMap.get(part) || []);
      const exactCandidates = uniqueByEmployee(exactName.get(part) || []);
      const aliasCandidates = uniqueByEmployee(aliasMap.get(part) || []);
      const candidates =
        knownCandidates.length === 1
          ? knownCandidates
          : exactCandidates.length === 1
            ? exactCandidates
            : aliasCandidates;
      if (candidates.length === 1) {
        resolved.set(candidates[0].id, candidates[0]);
      } else {
        unresolved.set(part, (unresolved.get(part) || 0) + 1);
      }
    }
    for (const employee of resolved.values()) {
      effectiveUsers.set(employee.id, employee);
      splitCreates.push({ employee, source: assignment });
    }
  }

  const baseAccessRepairs = [...effectiveUsers.values()].filter(
    (employee) =>
      employee.user &&
      !employee.user.userRoles.some(
        ({ role }) =>
          role.status === "ACTIVE" && role.includeDefaultEmployeeAccess,
      ),
  );

  if (APPLY) {
    if (!defaultEmployeeRole) {
      throw new Error(
        "Không tìm thấy vai trò Nhân viên đang hoạt động để bù quyền nền.",
      );
    }
    const groupedSourceIds = [...new Set(splitCreates.map((item) => item.source.id))];
    const sourceSplitCounts = new Map<string, number>();
    for (const item of splitCreates) {
      sourceSplitCounts.set(
        item.source.id,
        (sourceSplitCounts.get(item.source.id) || 0) + 1,
      );
    }
    await db.$transaction(async (tx) => {
      if (baseAccessRepairs.length) {
        await tx.userRole.createMany({
          data: baseAccessRepairs.map((employee) => ({
            roleId: defaultEmployeeRole.id,
            userId: employee.user!.id,
          })),
          skipDuplicates: true,
        });
      }
      for (const repair of directRepairs) {
        await tx.recruitmentAssignment.update({
          data: {
            reviewerEmployeeId: repair.employee.id,
            reviewerName: repair.employee.fullName,
          },
          where: { id: repair.assignmentId },
        });
      }
      for (const item of splitCreates) {
        const id = stableAssignmentId(item.source.id, item.employee.id);
        const scorecard = item.source.scorecards[0];
        await tx.recruitmentAssignment.upsert({
          create: {
            applicationId: item.source.applicationId,
            id,
            interviewId: item.source.interviewId,
            reviewerEmployeeId: item.employee.id,
            reviewerName: item.employee.fullName,
            roleKey: item.source.roleKey,
            roleLabel: item.source.roleLabel,
            roundKey: item.source.roundKey,
            status: item.source.status,
          },
          update: {
            reviewerEmployeeId: item.employee.id,
            reviewerName: item.employee.fullName,
            status: item.source.status,
          },
          where: { id },
        });
        // Một dòng cũ chỉ có một người và đã có phiếu: chuyển phiếu sang phân công chuẩn.
        if (scorecard && sourceSplitCounts.get(item.source.id) === 1) {
          await tx.recruitmentScorecard.update({
            data: {
              assignmentId: id,
              reviewerEmployeeId: item.employee.id,
              reviewerName: item.employee.fullName,
            },
            where: { id: scorecard.id },
          });
        }
      }
      if (groupedSourceIds.length) {
        await tx.recruitmentAssignment.updateMany({
          data: { status: "legacy_grouped" },
          where: { id: { in: groupedSourceIds } },
        });
      }
      if (legacyRole) {
        await tx.userRole.deleteMany({ where: { roleId: legacyRole.id } });
        await tx.role.update({
          data: {
            description:
              "Đã thay bằng quyền tự động theo phân công phỏng vấn; không gán thủ công.",
            status: "ARCHIVED",
          },
          where: { id: legacyRole.id },
        });
      }
      await tx.auditLog.create({
        data: {
          action: "PERMISSION_CHANGE",
          metadata: {
            baseAccessRepairs: baseAccessRepairs.length,
            directRepairs: directRepairs.length,
            effectiveUsers: effectiveUsers.size,
            source: "recruitment-assignment-context-backfill",
            splitAssignments: splitCreates.length,
          },
          summary:
            "Backfill quyền Hội đồng phỏng vấn theo từng phân công và khóa vai trò gán tay cũ.",
          targetId: LEGACY_ROLE_KEY,
          targetType: "RecruitmentContextAccess",
        },
      });
    }, { timeout: 60_000 });
  }

  console.log(
    JSON.stringify(
      {
        applied: APPLY,
        baseAccessRepairs: baseAccessRepairs
          .map((employee) => ({
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
          }))
          .sort((left, right) => left.fullName.localeCompare(right.fullName, "vi")),
        baseAccessRepairsCount: baseAccessRepairs.length,
        defaultEmployeeRoleReady: Boolean(defaultEmployeeRole),
        directRepairs: directRepairs.length,
        effectiveUsers: [...effectiveUsers.values()]
          .map((employee) => ({
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
          }))
          .sort((left, right) => left.fullName.localeCompare(right.fullName, "vi")),
        effectiveUsersCount: effectiveUsers.size,
        legacyRoleArchived: Boolean(APPLY && legacyRole),
        sourceAssignments: assignments.length,
        splitAssignments: splitCreates.length,
        unresolvedAliases: [...unresolved.entries()]
          .map(([alias, count]) => ({ alias, count }))
          .sort((left, right) => right.count - left.count),
        waitingForAccount: [...waitingForAccount.values()]
          .map((employee) => ({
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
          }))
          .sort((left, right) => left.fullName.localeCompare(right.fullName, "vi")),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
