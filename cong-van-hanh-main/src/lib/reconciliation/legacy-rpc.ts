import "server-only";

import type { AppSession } from "@/lib/auth/session";
import {
  cancelReconciliationPeriod,
  canCancelReconciliation,
  getReconciliationWorkspace,
} from "@/lib/reconciliation/service";
import type {
  ReconciliationRunResult,
  ReconciliationWorkspaceData,
} from "@/lib/reconciliation/types";

export class ReconciliationLegacyRpcError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReconciliationLegacyRpcError";
    this.status = status;
  }
}

export function toLegacyRegistry(
  workspace: ReconciliationWorkspaceData,
) {
  return {
    canCancel: workspace.canCancel,
    primary: workspace.primary
      ? {
          latestPeriod: workspace.primary.periodCode,
          link: workspace.primary.link,
          updatedLabel: workspace.primary.updatedLabel,
        }
      : {
          latestPeriod: "",
          link: "",
          updatedLabel: "",
        },
    primaryError: workspace.primaryError,
    secondary: workspace.secondary.map((item) => ({
      link: item.link,
      name: item.name,
      periodCode: item.periodCode,
      updatedLabel: item.updatedLabel,
    })),
    secondaryError: workspace.secondaryError,
    success: true,
  };
}

export function toLegacyRunResult(
  result: ReconciliationRunResult,
) {
  if (!result.ok) {
    return {
      message: result.message || "Tạo đối soát thất bại.",
      success: false,
    };
  }

  return {
    message: result.message,
    primaryOutput: result.primaryLink
      ? {
          existed: !result.primaryCreated,
          sheetUrl: result.primaryLink,
          spreadsheetUrl: result.primaryLink,
        }
      : null,
    secondaryOutput: result.secondaryLink
      ? {
          existed: !result.secondaryCreated,
          openUrl: result.secondaryLink,
          spreadsheetUrl: result.secondaryLink,
        }
      : null,
    success: true,
    summary: {
      accountResolvedCount: result.summary?.accountResolvedCount ?? 0,
      baseRewardRows: result.summary?.baseRewardRows ?? 0,
      createdPrimary: Boolean(result.primaryCreated),
      createdSecondary: Boolean(result.secondaryCreated),
      fallbackCompanyCount: result.summary?.fallbackCompanyCount ?? 0,
      matchedTransactions: result.summary?.matchedTransactions ?? 0,
      totalAmount: result.summary?.totalAmount ?? 0,
      urboxRowsInPeriod: result.summary?.rowsInPeriod ?? 0,
      voucherRowCounts: result.summary?.voucherRowCounts ?? {},
    },
  };
}

export async function dispatchReconciliationLegacyRpc(
  session: AppSession,
  method: string,
  payload: Record<string, unknown> = {},
) {
  if (method === "cancelReconciliationPeriod") {
    if (!canCancelReconciliation(session)) {
      throw new ReconciliationLegacyRpcError(
        "Tài khoản chưa có quyền hủy bảng kê Đối soát.",
        403,
      );
    }
    try {
      const result = await cancelReconciliationPeriod({
        month: Number(payload.month),
        session,
        year: Number(payload.year),
      });
      return {
        message: result.message,
        periodCode: result.periodCode,
        primaryDeleted: result.primaryDeleted,
        registry: result.workspace
          ? toLegacyRegistry(result.workspace)
          : undefined,
        secondaryDeleted: result.secondaryDeleted,
        success: result.ok,
      };
    } catch (error) {
      throw new ReconciliationLegacyRpcError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (method !== "getReconciliationInitialData" && method !== "getOutputRegistrySummary") {
    throw new ReconciliationLegacyRpcError(
      `Phương thức Đối soát chưa được hỗ trợ: ${method}`,
      404,
    );
  }

  const workspace = await getReconciliationWorkspace(session);
  const registry = toLegacyRegistry(workspace);
  if (method === "getOutputRegistrySummary") return registry;

  return {
    now: new Date().toISOString(),
    canCancel: workspace.canCancel,
    primaryTemplateConfigured: workspace.config.primaryConfigured,
    primaryTemplateSheetName: "T02.2026",
    registry,
    secondaryOutputFolderConfigured: workspace.config.secondaryConfigured,
    secondaryTemplateConfigured: workspace.config.secondaryConfigured,
    success: true,
  };
}
