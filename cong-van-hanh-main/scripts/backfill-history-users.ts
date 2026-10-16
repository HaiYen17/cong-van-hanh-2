import "dotenv/config";

import { getDb } from "@/lib/db";

type CreatorRow = {
  creatorDepartment: string;
  creatorName: string;
  employeeCode: string;
  requestCount: number;
};

function options() {
  return new Map(
    process.argv.slice(2).map((argument) => {
      const value = argument.replace(/^--/, "");
      const separator = value.indexOf("=");
      return separator < 0
        ? [value, "true"]
        : [value.slice(0, separator), value.slice(separator + 1)];
    }),
  );
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function main() {
  const args = options();
  const mode = text(args.get("mode") || "preview").toLowerCase();
  const runId = text(args.get("run-id"));
  if (!runId) throw new Error("Thiếu --run-id=<MigrationRun ID>.");
  if (!["apply", "preview"].includes(mode)) {
    throw new Error("--mode chỉ nhận preview hoặc apply.");
  }
  if (
    mode === "apply" &&
    args.get("confirm-apply") !== "history-users"
  ) {
    throw new Error(
      "Lệnh ghi cần --confirm-apply=history-users sau khi đã kiểm tra preview.",
    );
  }

  const db = getDb();
  try {
    const run = await db.migrationRun.findUnique({
      select: {
        id: true,
        records: {
          select: { normalizedData: true },
        },
        source: { select: { key: true } },
      },
      where: { id: runId },
    });
    if (!run || run.source.key !== "google-sheet-98-inbox") {
      throw new Error("Run không thuộc nguồn 98_Inbox.");
    }

    const creatorsByCode = new Map<string, CreatorRow>();
    for (const record of run.records) {
      const normalized =
        record.normalizedData &&
        typeof record.normalizedData === "object" &&
        !Array.isArray(record.normalizedData)
          ? (record.normalizedData as Record<string, unknown>)
          : {};
      const employeeCode = text(normalized.creatorEmployeeCode);
      if (!employeeCode) continue;
      const current = creatorsByCode.get(employeeCode);
      creatorsByCode.set(employeeCode, {
        creatorDepartment:
          text(normalized.creatorDepartment) ||
          current?.creatorDepartment ||
          "",
        creatorName:
          text(normalized.creatorName) ||
          current?.creatorName ||
          employeeCode,
        employeeCode,
        requestCount: (current?.requestCount || 0) + 1,
      });
    }

    const creators = [...creatorsByCode.values()];
    const existingEmployees = await db.employee.findMany({
      include: { user: true },
      where: {
        employeeCode: { in: creators.map((row) => row.employeeCode) },
      },
    });
    const employeesByCode = new Map(
      existingEmployees.map((employee) => [employee.employeeCode, employee]),
    );
    const plan = creators
      .map((creator) => {
        const employee = employeesByCode.get(creator.employeeCode);
        return {
          ...creator,
          action: employee?.user
            ? "SKIP_USER_EXISTS"
            : employee
              ? "CREATE_USER"
              : "CREATE_ARCHIVED_EMPLOYEE_AND_USER",
          employeeStatus: employee?.status || "INACTIVE",
        };
      })
      .filter((row) => row.action !== "SKIP_USER_EXISTS");

    if (mode === "preview") {
      return {
        plan,
        runId,
        summary: {
          createArchivedEmployeeAndUser: plan.filter(
            (row) => row.action === "CREATE_ARCHIVED_EMPLOYEE_AND_USER",
          ).length,
          createUser: plan.filter((row) => row.action === "CREATE_USER")
            .length,
          skippedExistingUsers: creators.length - plan.length,
          totalCreators: creators.length,
        },
      };
    }

    const employeeRole = await db.role.findFirst({
      select: { id: true },
      where: { key: "employee", status: "ACTIVE" },
    });
    if (!employeeRole) {
      throw new Error("Hệ thống chưa có vai trò employee đang hoạt động.");
    }

    const result = {
      createdArchivedEmployees: 0,
      createdUsers: 0,
      skippedExistingUsers: creators.length - plan.length,
    };
    for (const creator of plan) {
      await db.$transaction(async (tx) => {
        let employee = await tx.employee.findUnique({
          include: { user: true },
          where: { employeeCode: creator.employeeCode },
        });
        if (employee?.user) {
          result.skippedExistingUsers += 1;
          return;
        }
        if (!employee) {
          employee = await tx.employee.create({
            data: {
              department: creator.creatorDepartment || null,
              employeeCode: creator.employeeCode,
              fullName: creator.creatorName || creator.employeeCode,
              status: "INACTIVE",
            },
            include: { user: true },
          });
          result.createdArchivedEmployees += 1;
        }

        const username = creator.employeeCode.toLocaleLowerCase("vi");
        const email = `${username}@cong-van-hanh.local`;
        const collision = await tx.user.findFirst({
          select: { employeeId: true, id: true },
          where: { OR: [{ email }, { username }] },
        });
        if (collision) {
          throw new Error(
            `Không thể tạo User cho MNV ${creator.employeeCode}: username/email đã thuộc Employee khác.`,
          );
        }
        await tx.user.create({
          data: {
            activationStatus: "NOT_REQUESTED",
            displayName: employee.fullName,
            email,
            employeeId: employee.id,
            passwordHash: "",
            requiresPassword: true,
            status: employee.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
            userRoles: { create: { roleId: employeeRole.id } },
            username,
          },
        });
        result.createdUsers += 1;
      });
    }

    await db.auditLog.create({
      data: {
        action: "SYNC",
        metadata: {
          ...result,
          sourceRunId: runId,
        },
        summary:
          `Khởi tạo ${result.createdUsers} tài khoản định danh để gắn đúng người tạo ` +
          `cho lịch sử 98_Inbox; thêm ${result.createdArchivedEmployees} hồ sơ nhân sự lịch sử.`,
        targetId: runId,
        targetType: "MigrationHistoryUsers",
      },
    });
    return { result, runId };
  } finally {
    await db.$disconnect();
  }
}

async function run() {
  try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

void run();
