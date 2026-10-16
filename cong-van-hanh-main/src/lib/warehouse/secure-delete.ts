import "server-only";

import type { AppSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";

const MAX_DELETE_REASON_LENGTH = 1_200;

export async function assertWarehouseDeleteCredential(
  session: AppSession,
  input: { password: string; reason: string },
) {
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (!reason) {
    throw new Error("Vui lòng nhập lý do xóa.");
  }
  if (reason.length > MAX_DELETE_REASON_LENGTH) {
    throw new Error("Lý do xóa không được dài quá 1.200 ký tự.");
  }
  if (!input.password) {
    throw new Error("Vui lòng nhập mật khẩu của tài khoản đang đăng nhập.");
  }

  const user = await getDb().user.findUnique({
    select: { passwordHash: true },
    where: { id: session.userId },
  });
  if (!user?.passwordHash) {
    throw new Error(
      "Tài khoản hiện tại chưa có mật khẩu nên chưa thể thực hiện thao tác xóa.",
    );
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new Error("Mật khẩu xác nhận chưa đúng.");
  }

  return reason;
}
