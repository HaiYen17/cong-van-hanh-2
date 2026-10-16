import "server-only";

import {
  ACCOUNT_ACTIVATION_PENDING_MESSAGE,
  ACCOUNT_ACTIVATION_REQUIRED_MESSAGE,
  ACCOUNT_DISABLED_MESSAGE,
} from "@/lib/auth/account-activation";
import {
  getPasswordStrengthError,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import {
  createTokenAuthSession,
  getAuthSessionFromToken,
  revokeTokenAuthSession,
  type AppSession,
} from "@/lib/auth/session";
import { getDb } from "@/lib/db";

type UnknownRecord = Record<string, unknown>;

export class MobileAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MobileAuthError";
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function bearerToken(request: Request) {
  return String(request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

export async function listMobileLoginEmployees() {
  const employees = await getDb().employee.findMany({
    include: {
      company: { select: { code: true, shortName: true } },
      user: {
        select: {
          activationStatus: true,
          passwordHash: true,
          requiresPassword: true,
          status: true,
          userRoles: {
            select: {
              role: { select: { key: true, status: true } },
            },
          },
        },
      },
    },
    orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
    where: { status: "ACTIVE" },
  });
  return employees.map((employee) => {
    return {
      companyCode: employee.company?.code || "",
      companyName: employee.company?.shortName || "",
      department: employee.department || "",
      employeeCode: employee.employeeCode,
      employeeId: employee.id,
      fullName: employee.fullName,
      hasPassword: Boolean(employee.user?.passwordHash),
      accountStatus: employee.user?.status || null,
      activationStatus:
        employee.user?.activationStatus || "NOT_REQUESTED",
      requiresPassword: Boolean(employee.user),
      title: employee.title || "",
    };
  });
}

async function mobileProfile(userId: string, session: AppSession) {
  const user = await getDb().user.findUnique({
    include: {
      employee: {
        include: {
          company: { select: { code: true, shortName: true } },
        },
      },
    },
    where: { id: userId },
  });
  if (
    !user ||
    user.status !== "ACTIVE" ||
    user.activationStatus !== "APPROVED"
  ) {
    throw new MobileAuthError(
      "Tài khoản không còn hoạt động.",
      "ACCOUNT_DISABLED",
      403,
    );
  }
  return {
    company: {
      code: user.employee?.company?.code || "",
      name: user.employee?.company?.shortName || "",
    },
    department: user.employee?.department || "",
    displayName: user.displayName,
    employeeCode: user.employee?.employeeCode || user.username,
    employeeId: user.employee?.id || "",
    fullAccess: session.fullAccess,
    moduleGroups: session.moduleGroups,
    modules: session.modules,
    permissions: session.permissions,
    roles: session.roles,
    title: user.employee?.title || "",
    userId: user.id,
  };
}

export async function authenticateMobileEmployee(
  payload: unknown,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  const source = record(payload);
  const employeeId = text(source.employeeId);
  const employeeCode = text(source.employeeCode);
  const password = String(source.password ?? "");
  const newPassword = String(source.newPassword ?? "");
  const confirmPassword = String(source.confirmPassword ?? "");
  if (!employeeId && !employeeCode) {
    throw new MobileAuthError(
      "Cần employeeId hoặc employeeCode.",
      "EMPLOYEE_REQUIRED",
      400,
    );
  }
  const db = getDb();
  const employee = await db.employee.findFirst({
    include: {
      user: {
        include: {
          userRoles: { include: { role: true } },
        },
      },
    },
    where: {
      ...(employeeId
        ? { id: employeeId }
        : { employeeCode: { equals: employeeCode, mode: "insensitive" } }),
    },
  });
  if (!employee || employee.status !== "ACTIVE") {
    throw new MobileAuthError(
      "Nhân viên không hợp lệ hoặc đã nghỉ.",
      "EMPLOYEE_INVALID",
      401,
    );
  }

  const user = employee.user;
  if (!user) {
    throw new MobileAuthError(
      ACCOUNT_ACTIVATION_REQUIRED_MESSAGE,
      "ACTIVATION_REQUIRED",
      403,
    );
  }
  if (user.status !== "ACTIVE") {
    throw new MobileAuthError(ACCOUNT_DISABLED_MESSAGE, "ACCOUNT_DISABLED", 403);
  }
  if (user.activationStatus !== "APPROVED") {
    throw new MobileAuthError(
      user.activationStatus === "PENDING"
        ? ACCOUNT_ACTIVATION_PENDING_MESSAGE
        : ACCOUNT_ACTIVATION_REQUIRED_MESSAGE,
      user.activationStatus === "PENDING"
        ? "ACTIVATION_PENDING"
        : "ACTIVATION_REQUIRED",
      403,
    );
  }
  const isSuperAdmin = Boolean(
    user?.userRoles.some(
      ({ role }) => role.key === "super-admin" && role.status === "ACTIVE",
    ),
  );
  const requiresPassword = Boolean(
    user.employeeId || user.requiresPassword || isSuperAdmin || !user.passwordHash,
  );
  let initializedPasswordHash: string | undefined;

  if (requiresPassword) {
    if (user.passwordHash) {
      if (!password || !(await verifyPassword(password, user.passwordHash))) {
        throw new MobileAuthError(
          "Mật khẩu chưa đúng.",
          "INVALID_CREDENTIALS",
          401,
        );
      }
    } else {
      if (!newPassword || !confirmPassword) {
        throw new MobileAuthError(
          "Tài khoản cần tạo mật khẩu cho lần đăng nhập đầu tiên.",
          "PASSWORD_SETUP_REQUIRED",
          428,
        );
      }
      const strengthError = getPasswordStrengthError(newPassword);
      if (strengthError) {
        throw new MobileAuthError(strengthError, "WEAK_PASSWORD", 400);
      }
      if (newPassword !== confirmPassword) {
        throw new MobileAuthError(
          "Mật khẩu nhập lại chưa khớp.",
          "PASSWORD_CONFIRMATION_MISMATCH",
          400,
        );
      }
      initializedPasswordHash = await hashPassword(newPassword);
    }
  }

  const userId = user.id;
  if (initializedPasswordHash || (isSuperAdmin && !user.requiresPassword)) {
    await db.user.update({
      data: {
        ...(initializedPasswordHash
          ? { passwordHash: initializedPasswordHash }
          : {}),
        requiresPassword: true,
      },
      where: { id: user.id },
    });
  }
  const { expiresAt, token } = await createTokenAuthSession(userId, metadata);
  const session = await getAuthSessionFromToken(token);
  if (!session) {
    throw new MobileAuthError(
      "Không thể khởi tạo phiên đăng nhập.",
      "SESSION_INITIALIZATION_FAILED",
      500,
    );
  }
  await db.auditLog.create({
    data: {
      action: "LOGIN",
      actorId: userId,
      ipAddress: metadata.ipAddress,
      metadata: {
        client: "mobile-app",
        employeeCode: employee.employeeCode,
      },
      summary: `Đăng nhập ứng dụng: ${employee.fullName}.`,
      targetId: userId,
      targetType: "User",
      userAgent: metadata.userAgent,
    },
  });
  return {
    accessToken: token,
    expiresAt: expiresAt.toISOString(),
    profile: await mobileProfile(session.userId, session),
    tokenType: "Bearer",
  };
}

export async function getMobileProfileFromRequest(request: Request) {
  const token = bearerToken(request);
  const session = await getAuthSessionFromToken(token);
  if (!session) {
    throw new MobileAuthError(
      "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
      "INVALID_SESSION",
      401,
    );
  }
  return mobileProfile(session.userId, session);
}

export async function logoutMobileRequest(request: Request) {
  const token = bearerToken(request);
  const session = await getAuthSessionFromToken(token);
  if (!session) {
    throw new MobileAuthError(
      "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
      "INVALID_SESSION",
      401,
    );
  }
  await revokeTokenAuthSession(token);
  const authenticatedUserId = session.authenticatedUserId || session.userId;
  await getDb().auditLog.create({
    data: {
      action: "LOGOUT",
      actorId: authenticatedUserId,
      summary: `Đăng xuất ứng dụng: ${session.displayName}.`,
      targetId: authenticatedUserId,
      targetType: "User",
    },
  });
}
