import "dotenv/config";

import type { AppSession } from "../src/lib/auth/session";
import { getDb } from "../src/lib/db";
import { dispatchInboxRpc } from "../src/lib/requests/inbox-runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function buildSession(userId: string): Promise<AppSession> {
  const user = await getDb().user.findUniqueOrThrow({
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              roleModuleGroups: { include: { moduleGroup: true } },
              roleModules: { include: { appModule: true } },
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      },
    },
    where: { id: userId },
  });
  const roles = user.userRoles
    .map(({ role }) => role)
    .filter((role) => role.status === "ACTIVE");
  return {
    displayName: user.displayName,
    fullAccess: roles.some((role) => role.key === "super-admin"),
    moduleGroups: [
      ...new Set(
        roles.flatMap((role) =>
          role.roleModuleGroups.map(({ moduleGroup }) => moduleGroup.key),
        ),
      ),
    ],
    modules: [
      ...new Set(
        roles.flatMap((role) =>
          role.roleModules.map(({ appModule }) => appModule.key),
        ),
      ),
    ],
    permissions: [
      ...new Set(
        roles.flatMap((role) =>
          role.rolePermissions.map(({ permission }) => permission.key),
        ),
      ),
    ],
    roles: roles.map((role) => role.key),
    userId,
  };
}

async function main() {
  const db = getDb();
  const admin = await db.user.findFirstOrThrow({
    orderBy: { displayName: "asc" },
    where: {
      status: "ACTIVE",
      userRoles: {
        some: {
          role: {
            OR: [
              { key: "super-admin" },
              {
                rolePermissions: {
                  some: {
                    permission: {
                      key: "admin_requests.process",
                    },
                  },
                },
              },
            ],
            status: "ACTIVE",
          },
        },
      },
    },
  });
  const ownerGroup = await db.request.groupBy({
    _count: { _all: true },
    by: ["createdById"],
    orderBy: { _count: { createdById: "desc" } },
    take: 1,
    where: { archivedAt: null },
  });
  assert(ownerGroup[0], "Không tìm thấy người tạo đơn để kiểm thử.");
  const passwordlessAdmin = await db.user.findFirst({
    orderBy: { displayName: "asc" },
    select: {
      displayName: true,
      employee: { select: { fullName: true } },
    },
    where: {
      passwordHash: "",
      requiresPassword: false,
      status: "ACTIVE",
      userRoles: {
        some: {
          role: {
            key: { not: "super-admin" },
            rolePermissions: {
              some: { permission: { key: "admin_requests.process" } },
            },
            status: "ACTIVE",
          },
        },
      },
    },
  });
  const passwordlessOwner = await db.user.findFirst({
    orderBy: { displayName: "asc" },
    select: {
      displayName: true,
      employee: { select: { fullName: true } },
    },
    where: {
      passwordHash: "",
      requestsCreated: { some: { archivedAt: null } },
      requiresPassword: false,
      status: "ACTIVE",
    },
  });
  const ownerLogin = await db.user.findUnique({
    select: {
      displayName: true,
      passwordHash: true,
      requiresPassword: true,
    },
    where: { id: ownerGroup[0].createdById },
  });

  const adminSession = await buildSession(admin.id);
  const ownerSession = await buildSession(ownerGroup[0].createdById);
  const adminBootstrap = (await dispatchInboxRpc(
    adminSession,
    "getInboxAdminBootstrapData",
    [{}],
  )) as {
    tickets: Array<Record<string, unknown>>;
  };
  const myBootstrap = (await dispatchInboxRpc(
    ownerSession,
    "getInboxMeBootstrapData",
    [{}],
  )) as {
    tickets: Array<Record<string, unknown>>;
    user: Record<string, unknown>;
  };

  assert(adminBootstrap.tickets.length > 0, "Admin Inbox không có đơn.");
  assert(myBootstrap.tickets.length > 0, "My Inbox không nhận diện được đơn.");
  for (const ticket of [
    adminBootstrap.tickets[0],
    myBootstrap.tickets[0],
  ]) {
    assert(ticket.maDonDv, "Ticket thiếu mã đơn.");
    assert(ticket.maHeThong, "Ticket thiếu mã hệ thống.");
    assert(ticket.trangThai, "Ticket thiếu trạng thái.");
    assert(ticket.json && typeof ticket.json === "object", "Ticket thiếu JSON.");
  }

  const pendingSeal = adminBootstrap.tickets.find((ticket) => {
    const code = String(ticket.maHeThong || "");
    const status = String(ticket.trangThai || "");
    return code.startsWith("07") && status !== "Hoàn thành" && status !== "Hủy Đơn";
  });
  let previewCount = 0;
  if (pendingSeal) {
    const preview = (await dispatchInboxRpc(
      adminSession,
      "getAdminDocumentRegistryIssuePreview",
      [{ requestId: pendingSeal.maDonDv }],
    )) as { items?: unknown[] };
    previewCount = preview.items?.length || 0;
  }
  const authorization = adminBootstrap.tickets.find((ticket) =>
    String(ticket.maHeThong || "").startsWith("09"),
  );
  let authorizationPrintItems = 0;
  if (authorization) {
    const printData = (await dispatchInboxRpc(
      adminSession,
      "getCapGiayPrintData",
      [{ requestId: authorization.maDonDv }],
    )) as { items?: unknown[] };
    authorizationPrintItems = printData.items?.length || 0;
  }
  const workshop = adminBootstrap.tickets.find((ticket) => {
    const serviceCode = String(ticket.maHeThong || "");
    return serviceCode.startsWith("17") || serviceCode.startsWith("18");
  });
  let workshopPrintReady = false;
  if (workshop) {
    const printData = (await dispatchInboxRpc(
      adminSession,
      "previewWorkshopPlanMaterialPrintHtml",
      [{ dayIndex: 0, requestId: workshop.maDonDv }],
    )) as { html?: string; ok?: boolean };
    workshopPrintReady =
      printData.ok === true && String(printData.html || "").includes("<!doctype html>");
  }

  console.log(
    JSON.stringify(
      {
        admin: admin.displayName,
        adminTickets: adminBootstrap.tickets.length,
        authorizationPrintItems,
        myTickets: myBootstrap.tickets.length,
        owner: myBootstrap.user.name,
        ownerCanLoginWithoutPassword:
          ownerLogin !== null &&
          !ownerLogin.requiresPassword &&
          !ownerLogin.passwordHash,
        passwordlessAdmin: passwordlessAdmin?.displayName || "",
        passwordlessOwner: passwordlessOwner?.displayName || "",
        pendingSealPreviewItems: previewCount,
        sampleAdminRequest: adminBootstrap.tickets[0].maDonDv,
        sampleMyRequest: myBootstrap.tickets[0].maDonDv,
        workshopPrintReady,
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
