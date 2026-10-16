"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  getReconciliationWorkspace,
  runReconciliation,
} from "@/lib/reconciliation/service";
import type {
  ReconciliationRunResult,
  ReconciliationWorkspaceData,
} from "@/lib/reconciliation/types";

const PATH = "/thuc-thi/doi-soat";

export async function refreshReconciliationAction(): Promise<{
  data?: ReconciliationWorkspaceData;
  error?: string;
}> {
  try {
    const session = await requireCurrentSession();
    return { data: await getReconciliationWorkspace(session) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runReconciliationAction(
  formData: FormData,
): Promise<ReconciliationRunResult> {
  try {
    const session = await requireCurrentSession();
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File && item.size > 0);
    const month = Number(formData.get("month"));
    const year = Number(formData.get("year"));
    const result = await runReconciliation({ files, month, session, year });
    revalidatePath(PATH);
    return result;
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
}
