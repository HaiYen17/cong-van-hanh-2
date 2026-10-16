"use server";

import {
  getPasswordStrengthError,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export type AccountActionState = {
  error?: string;
  success?: string;
};

export async function changePasswordAction(
  _state: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const session = await requireCurrentSession();
  const currentPassword = String(formData.get("currentPassword") || "");
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  const db = getDb();
  const authenticatedUserId = session.authenticatedUserId || session.userId;
  const user = await db.user.findUnique({
    select: { passwordHash: true },
    where: { id: authenticatedUserId },
  });

  if (user?.passwordHash) {
    if (!currentPassword) {
      return { error: "Vui lòng nhập mật khẩu hiện tại." };
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return { error: "Mật khẩu hiện tại chưa đúng." };
    }
  }

  const strengthError = getPasswordStrengthError(password);
  if (strengthError) {
    return { error: strengthError };
  }
  if (password !== confirm) {
    return { error: "Mật khẩu nhập lại không khớp." };
  }

  await db.user.update({
    data: { passwordHash: await hashPassword(password) },
    where: { id: authenticatedUserId },
  });

  await db.auditLog.create({
    data: {
      action: "UPDATE",
      actorId: authenticatedUserId,
      summary: "Người dùng tự đổi mật khẩu.",
      targetId: authenticatedUserId,
      targetType: "User",
    },
  });

  return { success: "Đã đổi mật khẩu." };
}
