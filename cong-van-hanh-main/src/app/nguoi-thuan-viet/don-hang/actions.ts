"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  refreshWorkbenchActivity,
  resetWorkbenchLayout,
  saveWorkbenchLayout,
} from "@/lib/workbench/repository";
import type {
  SaveWorkbenchLayoutInput,
  WorkbenchActivityRefreshResult,
  WorkbenchMutationResult,
} from "@/lib/workbench/types";

const PATH = "/nguoi-thuan-viet/don-hang";

export async function refreshWorkbenchActivityAction(): Promise<WorkbenchActivityRefreshResult> {
  try {
    const session = await requireCurrentSession();
    const data = await refreshWorkbenchActivity(session);
    return {
      data,
      message: data.warnings.length
        ? "Dòng công việc đã làm mới, nhưng có nguồn cần kiểm tra."
        : "Dòng công việc đã được cập nhật.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Chưa thể làm mới Dòng công việc.",
      ok: false,
    };
  }
}

export async function saveWorkbenchLayoutAction(
  input: SaveWorkbenchLayoutInput,
): Promise<WorkbenchMutationResult> {
  try {
    const session = await requireCurrentSession();
    const widgets = await saveWorkbenchLayout(session, input);
    revalidatePath(PATH);
    return {
      success: "Đã lưu bố cục Bàn làm việc của bạn.",
      widgets,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Chưa thể lưu bố cục Bàn làm việc.",
    };
  }
}

export async function resetWorkbenchLayoutAction(): Promise<WorkbenchMutationResult> {
  try {
    const session = await requireCurrentSession();
    const widgets = await resetWorkbenchLayout(session);
    revalidatePath(PATH);
    return {
      success: "Đã khôi phục bố cục mặc định.",
      widgets,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Chưa thể khôi phục bố cục mặc định.",
    };
  }
}
