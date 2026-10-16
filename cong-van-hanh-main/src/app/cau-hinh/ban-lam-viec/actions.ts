"use server";

import { revalidatePath } from "next/cache";

import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  getWorkbenchAdminSnapshot,
  saveWorkbenchAdminConfig,
} from "@/lib/workbench/admin";
import { refreshWorkbenchActivity } from "@/lib/workbench/repository";
import type {
  SaveWorkbenchAdminConfigInput,
  WorkbenchAdminMutationResult,
} from "@/lib/workbench/types";

const CONFIG_PATH = "/cau-hinh/ban-lam-viec";
const WORKBENCH_PATH = "/nguoi-thuan-viet/don-hang";

async function requireWorkbenchConfigAdmin() {
  const session = await requireCurrentSession();
  if (!session.fullAccess && !can(session, "workbench_config.manage")) {
    throw new Error("Ông chưa có quyền quản lý cấu hình Bàn làm việc.");
  }
  return session;
}

export async function saveWorkbenchAdminConfigAction(
  input: SaveWorkbenchAdminConfigInput,
): Promise<WorkbenchAdminMutationResult> {
  try {
    const session = await requireWorkbenchConfigAdmin();
    const data = await saveWorkbenchAdminConfig(session, input);
    revalidatePath(CONFIG_PATH);
    revalidatePath(WORKBENCH_PATH);
    return { data, message: "Đã lưu cấu hình và bố cục gợi ý.", ok: true };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không lưu được cấu hình Bàn làm việc.",
      ok: false,
    };
  }
}

export async function refreshWorkbenchIndexAdminAction(): Promise<WorkbenchAdminMutationResult> {
  try {
    const session = await requireWorkbenchConfigAdmin();
    const result = await refreshWorkbenchActivity(session);
    const data = await getWorkbenchAdminSnapshot();
    revalidatePath(CONFIG_PATH);
    revalidatePath(WORKBENCH_PATH);
    return {
      data,
      message: result.warnings.length
        ? `Đã làm mới chỉ mục; ${result.warnings.length} nguồn cần kiểm tra.`
        : "Đã làm mới chỉ mục công việc của tài khoản hiện tại.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không làm mới được chỉ mục công việc.",
      ok: false,
    };
  }
}
