"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
import { createAuthSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export type LoginFormState = {
  employeeId?: string;
  error?: string;
  success?: string;
};

class ActivationRequestError extends Error {}

async function requestAccountActivation(input: {
  employee: {
    email: string | null;
    employeeCode: string;
    fullName: string;
    id: string;
  };
  ipAddress?: string;
  userAgent?: string;
}): Promise<LoginFormState> {
  const db = getDb();
  const employeeRole = await db.role.findFirst({
    where: { key: "employee", status: "ACTIVE" },
  });
  if (!employeeRole) {
    return {
      employeeId: input.employee.id,
      error: "Hệ thống chưa có vai trò Nhân viên. Vui lòng liên hệ quản trị viên.",
    };
  }

  try {
    const outcome = await db.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        include: { userRoles: true },
        where: { employeeId: input.employee.id },
      });

      if (!user) {
        const username = input.employee.employeeCode.trim().toLowerCase();
        const localEmail = `${username}@cong-van-hanh.local`;
        const matchingAccount = await tx.user.findFirst({
          include: { userRoles: true },
          where: {
            OR: [
              { username },
              { email: localEmail },
              ...(input.employee.email
                ? [{ email: input.employee.email.toLowerCase() }]
                : []),
            ],
          },
        });

        if (
          matchingAccount?.employeeId &&
          matchingAccount.employeeId !== input.employee.id
        ) {
          throw new ActivationRequestError(
            "Mã nhân sự hoặc email này đang gắn với một tài khoản khác. Vui lòng liên hệ quản trị viên.",
          );
        }

        user = matchingAccount
          ? await tx.user.update({
              data: {
                activationRequestedAt: null,
                activationReviewedAt: null,
                activationStatus: "NOT_REQUESTED",
                displayName: input.employee.fullName,
                employeeId: input.employee.id,
                requiresPassword: true,
              },
              include: { userRoles: true },
              where: { id: matchingAccount.id },
            })
          : await tx.user.create({
              data: {
                activationStatus: "NOT_REQUESTED",
                displayName: input.employee.fullName,
                email: localEmail,
                employeeId: input.employee.id,
                passwordHash: "",
                requiresPassword: true,
                status: "ACTIVE",
                username,
                userRoles: {
                  create: { roleId: employeeRole.id },
                },
              },
              include: { userRoles: true },
            });
      }

      if (user.status !== "ACTIVE") {
        throw new ActivationRequestError(ACCOUNT_DISABLED_MESSAGE);
      }
      if (user.activationStatus === "APPROVED") {
        throw new ActivationRequestError(
          "Tài khoản đã được kích hoạt. Vui lòng tải lại trang để đăng nhập.",
        );
      }
      if (user.activationStatus === "PENDING") {
        return { alreadyPending: true, userId: user.id };
      }

      if (!user.userRoles.length) {
        await tx.userRole.create({
          data: { roleId: employeeRole.id, userId: user.id },
        });
      }

      const requestedAt = new Date();
      await tx.user.update({
        data: {
          activationRequestedAt: requestedAt,
          activationReviewedAt: null,
          activationStatus: "PENDING",
          requiresPassword: true,
        },
        where: { id: user.id },
      });
      await tx.authSession.updateMany({
        data: { revokedAt: requestedAt },
        where: { revokedAt: null, userId: user.id },
      });
      await tx.auditLog.create({
        data: {
          action: "ACTIVATION_REQUEST",
          actorId: user.id,
          ipAddress: input.ipAddress,
          metadata: { employeeCode: input.employee.employeeCode },
          summary: `Yêu cầu kích hoạt tài khoản: ${input.employee.fullName}.`,
          targetId: user.id,
          targetType: "User",
          userAgent: input.userAgent,
        },
      });

      return { alreadyPending: false, userId: user.id };
    });

    return {
      employeeId: input.employee.id,
      success: outcome.alreadyPending
        ? ACCOUNT_ACTIVATION_PENDING_MESSAGE
        : "Đã gửi yêu cầu kích hoạt. Quản trị viên sẽ xác minh và kích hoạt tài khoản của bạn trong thời gian sớm nhất.",
    };
  } catch (error) {
    if (error instanceof ActivationRequestError) {
      return { employeeId: input.employee.id, error: error.message };
    }
    console.error("Account activation request failed", error);
    return {
      employeeId: input.employee.id,
      error: "Chưa gửi được yêu cầu kích hoạt. Vui lòng thử lại.",
    };
  }
}

export async function loginAction(
  _state: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const employeeId = String(formData.get("employeeId") || "").trim();
  const intent = String(formData.get("intent") || "login");
  const password = String(formData.get("password") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!employeeId) {
    return { error: "Vui lòng chọn đúng nhân sự trong danh sách." };
  }

  const db = getDb();
  const employee = await db.employee.findUnique({
    include: {
      user: {
        include: {
          userRoles: {
            include: {
              role: true,
            },
          },
        },
      },
    },
    where: { id: employeeId },
  });

  if (!employee || employee.status !== "ACTIVE") {
    return {
      employeeId,
      error: "Nhân viên không hợp lệ hoặc đã nghỉ.",
    };
  }

  const headerStore = await headers();
  if (intent === "request-activation") {
    return requestAccountActivation({
      employee,
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: headerStore.get("user-agent") || undefined,
    });
  }

  const user = employee.user;
  if (!user) {
    return { employeeId, error: ACCOUNT_ACTIVATION_REQUIRED_MESSAGE };
  }
  if (user.status !== "ACTIVE") {
    return { employeeId, error: ACCOUNT_DISABLED_MESSAGE };
  }
  if (user.activationStatus !== "APPROVED") {
    return {
      employeeId,
      error:
        user.activationStatus === "PENDING"
          ? ACCOUNT_ACTIVATION_PENDING_MESSAGE
          : ACCOUNT_ACTIVATION_REQUIRED_MESSAGE,
    };
  }

  const isSuperAdmin = user.userRoles.some(
    ({ role }) => role.key === "super-admin" && role.status === "ACTIVE",
  );
  const requiresPassword = Boolean(
    user.employeeId || user.requiresPassword || isSuperAdmin || !user.passwordHash,
  );
  let initializedPasswordHash: string | undefined;

  if (requiresPassword) {
    if (user.passwordHash) {
      if (!password) {
        return {
          employeeId,
          error: "Vui lòng nhập mật khẩu để đăng nhập.",
        };
      }

      if (!(await verifyPassword(password, user.passwordHash))) {
        return {
          employeeId,
          error: "Mật khẩu chưa đúng. Vui lòng kiểm tra lại.",
        };
      }
    } else {
      if (!newPassword || !confirmPassword) {
        return {
          employeeId,
          error: "Tài khoản đã được kích hoạt. Vui lòng tạo mật khẩu để đăng nhập.",
        };
      }

      const strengthError = getPasswordStrengthError(newPassword);
      if (strengthError) {
        return { employeeId, error: strengthError };
      }

      if (newPassword !== confirmPassword) {
        return { employeeId, error: "Mật khẩu nhập lại chưa khớp." };
      }

      initializedPasswordHash = await hashPassword(newPassword);
    }
  }

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

  await createAuthSession(user.id);

  await db.auditLog.create({
    data: {
      action: "LOGIN",
      actorId: user.id,
      ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim(),
      metadata: { employeeCode: employee.employeeCode },
      summary: `Đăng nhập: ${employee.fullName}.`,
      targetId: user.id,
      targetType: "User",
      userAgent: headerStore.get("user-agent"),
    },
  });

  redirect("/");
}
