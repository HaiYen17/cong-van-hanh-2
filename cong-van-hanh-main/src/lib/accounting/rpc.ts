import {
  applyAccountingAccountChange,
  previewAccountingAccountChange,
} from "@/lib/accounting/account-changes";
import {
  attachAccountingDisclosureTemplateSource,
  applyAccountingAccountsImport,
  applyAccountingDisclosureTemplateImport,
  applyAccountingReportTemplateImport,
  createAccountingReportConfigTemplate,
  exportAccountingConfiguredReportTemplate,
  previewAccountingAccountsImport,
  previewAccountingDisclosureTemplateImport,
  previewAccountingReportTemplateImport,
} from "@/lib/accounting/import-export";
import { isJsonObject } from "@/lib/accounting/normalize";
import { storeAccountingExport } from "@/lib/accounting/export-storage";
import {
  createAccountingConfigVersion,
  deleteAccountingConfigRecord,
  ensureAccountingDisclosureFormulaReport,
  getAccountingConfigData,
  saveAccountingConfigRecord,
  saveAccountingReportBuilderRecords,
} from "@/lib/accounting/repository";
import type { JsonObject } from "@/lib/accounting/types";
import { AccountingRpcError } from "@/lib/accounting/types";
import type { PermissionKey } from "@/lib/auth/permissions";
import { validateAccountingConfigVersion } from "@/lib/accounting/validation";
import {
  checkAccountingMisaCredentials,
  connectAccountingMisaDataSpace,
  deleteAccountingTestDataSpaces,
  discoverAccountingMisaDataSpaces,
  exportAccountingDataChanges,
  exportAccountingDisclosureOutput,
  exportAccountingReportOutput,
  generateAccountingReportOutput,
  generateAccountingDisclosureOutput,
  getAccountingDescriptionTemplate,
  getAccountingDataRuntime,
  initializeAccountingDataSchema,
  importAccountingDataFile,
  listAccountingReportAdjustments,
  previewAccountingDataFileImport,
  previewAccountingTestDataSpaceCleanup,
  refreshAccountingMisaBearer,
  reviewAccountingDataChanges,
  saveAccountingReportAdjustment,
  saveAccountingDataWorkerConfig,
  saveAccountingMisaSession,
  startAccountingDataSync,
  syncAccountingDescriptionTemplate,
  testAccountingDataWorker,
  voidAccountingReportAdjustment,
} from "@/lib/accounting/runtime";

export const ACCOUNTING_METHOD_PERMISSIONS = {
  getAccountingConfigData: "accounting.config.read",
  saveAccountingConfigRecord: "accounting.config.edit",
  saveAccountingReportBuilderRecords: "accounting.config.edit",
  ensureAccountingDisclosureFormulaReport: "accounting.config.edit",
  deleteAccountingConfigRecord: "accounting.config.edit",
  createAccountingConfigVersion: "accounting.config.edit",
  validateAccountingConfigVersion: "accounting.config.read",
  createAccountingReportConfigTemplate: "accounting.config.edit",
  exportAccountingConfiguredReportTemplate: "accounting.config.read",
  previewAccountingReportTemplateImport: "accounting.config.edit",
  applyAccountingReportTemplateImport: "accounting.config.edit",
  previewAccountingDisclosureTemplateImport: "accounting.config.edit",
  applyAccountingDisclosureTemplateImport: "accounting.config.edit",
  attachAccountingDisclosureTemplateSource: "accounting.config.edit",
  previewAccountingAccountsImport: "accounting.config.edit",
  applyAccountingAccountsImport: "accounting.config.edit",
  previewAccountingAccountChange: "accounting.config.edit",
  applyAccountingAccountChange: "accounting.config.edit",
  getAccountingDataRuntime: "accounting.config.read",
  saveAccountingDataWorkerConfig: "accounting.runtime.manage",
  testAccountingDataWorker: "accounting.runtime.manage",
  initializeAccountingDataSchema: "accounting.runtime.manage",
  previewAccountingDataFileImport: "accounting.runtime.manage",
  importAccountingDataFile: "accounting.runtime.manage",
  previewAccountingTestDataSpaceCleanup: "accounting.runtime.manage",
  deleteAccountingTestDataSpaces: "accounting.runtime.manage",
  saveAccountingMisaSession: "accounting.runtime.manage",
  refreshAccountingMisaBearer: "accounting.runtime.manage",
  checkAccountingMisaCredentials: "accounting.runtime.manage",
  discoverAccountingMisaDataSpaces: "accounting.runtime.manage",
  connectAccountingMisaDataSpace: "accounting.runtime.manage",
  startAccountingDataSync: "accounting.runtime.manage",
  reviewAccountingDataChanges: "accounting.runtime.manage",
  exportAccountingDataChanges: "accounting.runtime.manage",
  getAccountingDescriptionTemplate: "accounting.config.read",
  syncAccountingDescriptionTemplate: "accounting.runtime.manage",
  generateAccountingReportOutput: "accounting.config.read",
  generateAccountingDisclosureOutput: "accounting.config.read",
  listAccountingReportAdjustments: "accounting.config.read",
  saveAccountingReportAdjustment: "accounting.config.edit",
  voidAccountingReportAdjustment: "accounting.config.edit",
  exportAccountingDisclosureOutput: "accounting.config.read",
  exportAccountingReportOutput: "accounting.config.read",
} as const satisfies Record<string, PermissionKey>;

export function accountingMethodPermission(method: string): PermissionKey {
  const permission =
    ACCOUNTING_METHOD_PERMISSIONS[
      method as keyof typeof ACCOUNTING_METHOD_PERMISSIONS
    ];
  if (!permission) {
    throw new AccountingRpcError(
      `Chức năng ${method} chưa được đăng ký trong cổng API Kế toán.`,
      400,
    );
  }
  return permission;
}

export function parseRpcBody(value: unknown) {
  if (!isJsonObject(value)) {
    throw new AccountingRpcError("Nội dung yêu cầu RPC không hợp lệ.");
  }
  const method = typeof value.method === "string" ? value.method.trim() : "";
  if (!method) {
    throw new AccountingRpcError("Thiếu tên chức năng kế toán.");
  }
  const payload = value.payload === undefined ? {} : value.payload;
  if (!isJsonObject(payload)) {
    throw new AccountingRpcError("Payload RPC phải là một object.");
  }
  return { method, payload };
}

export async function dispatchAccountingRpc(
  method: string,
  payload: JsonObject,
  actorEmail: string,
) {
  switch (method) {
    case "getAccountingConfigData":
      return getAccountingConfigData(payload, actorEmail);
    case "saveAccountingConfigRecord":
      return saveAccountingConfigRecord(payload, actorEmail);
    case "saveAccountingReportBuilderRecords":
      return saveAccountingReportBuilderRecords(payload, actorEmail);
    case "ensureAccountingDisclosureFormulaReport":
      return ensureAccountingDisclosureFormulaReport(payload, actorEmail);
    case "deleteAccountingConfigRecord":
      return deleteAccountingConfigRecord(payload, actorEmail);
    case "createAccountingConfigVersion":
      return createAccountingConfigVersion(payload, actorEmail);
    case "validateAccountingConfigVersion":
      return validateAccountingConfigVersion(payload, actorEmail);
    case "createAccountingReportConfigTemplate": {
      const generated = await createAccountingReportConfigTemplate(
        payload,
        actorEmail,
      );
      const file = await storeAccountingExport(generated, {
        actorEmail,
        fallbackName: "Mẫu nạp khuôn Báo cáo Kế toán.xlsx",
        purpose: "REPORT_TEMPLATE",
      });
      return {
        ...file,
        ok: true,
        templateVersion: generated.templateVersion,
        url: file.url,
        xlsxUrl: file.url,
        message:
          "Đã tạo tệp mẫu Excel riêng tư trên Google Cloud Storage.",
      };
    }
    case "exportAccountingConfiguredReportTemplate": {
      const exportMode = String(payload.exportMode || "TEMPLATE")
        .trim()
        .toUpperCase();
      const evidenceOutput = exportMode === "EVIDENCE"
        ? await generateAccountingReportOutput({
            ...payload,
            includeEvidence: true,
          })
        : undefined;
      const generated = await exportAccountingConfiguredReportTemplate(
        {
          ...payload,
          evidenceOutput,
          exportMode,
        },
        actorEmail,
      );
      const file = await storeAccountingExport(generated, {
        actorEmail,
        fallbackName: exportMode === "EVIDENCE"
          ? "Công thức kèm số liệu chứng minh.xlsx"
          : "Mẫu báo cáo kế toán kèm công thức.xlsx",
        purpose: exportMode === "EVIDENCE"
          ? "REPORT_FORMULA_EVIDENCE"
          : "REPORT_TEMPLATE",
      });
      return {
        ...file,
        formulaCellCount: generated.formulaCellCount,
        ok: true,
        reportName: generated.reportName,
        url: file.url,
        xlsxUrl: file.url,
        message: exportMode === "EVIDENCE"
          ? "Đã xuất báo cáo kèm công thức và số liệu chứng minh ngay trong từng ô số."
          : "Đã xuất mẫu báo cáo kèm công thức và nhóm tài khoản dễ đọc.",
      };
    }
    case "previewAccountingReportTemplateImport":
      return previewAccountingReportTemplateImport(payload, actorEmail);
    case "applyAccountingReportTemplateImport":
      return applyAccountingReportTemplateImport(payload, actorEmail);
    case "previewAccountingDisclosureTemplateImport":
      return previewAccountingDisclosureTemplateImport(payload, actorEmail);
    case "applyAccountingDisclosureTemplateImport":
      return applyAccountingDisclosureTemplateImport(payload, actorEmail);
    case "attachAccountingDisclosureTemplateSource":
      return attachAccountingDisclosureTemplateSource(payload, actorEmail);
    case "previewAccountingAccountsImport":
      return previewAccountingAccountsImport(payload, actorEmail);
    case "applyAccountingAccountsImport":
      return applyAccountingAccountsImport(payload, actorEmail);
    case "previewAccountingAccountChange":
      return previewAccountingAccountChange(payload);
    case "applyAccountingAccountChange":
      return applyAccountingAccountChange(payload, actorEmail);
    case "getAccountingDataRuntime":
      return getAccountingDataRuntime(payload);
    case "saveAccountingDataWorkerConfig":
      return saveAccountingDataWorkerConfig(payload);
    case "testAccountingDataWorker":
      return testAccountingDataWorker(payload);
    case "initializeAccountingDataSchema":
      return initializeAccountingDataSchema();
    case "previewAccountingDataFileImport":
      return previewAccountingDataFileImport(payload);
    case "importAccountingDataFile":
      return importAccountingDataFile(payload, actorEmail);
    case "previewAccountingTestDataSpaceCleanup":
      return previewAccountingTestDataSpaceCleanup(payload);
    case "deleteAccountingTestDataSpaces":
      return deleteAccountingTestDataSpaces(payload, actorEmail);
    case "saveAccountingMisaSession":
      return saveAccountingMisaSession(payload);
    case "refreshAccountingMisaBearer":
      return refreshAccountingMisaBearer(payload);
    case "checkAccountingMisaCredentials":
      return checkAccountingMisaCredentials(payload);
    case "discoverAccountingMisaDataSpaces":
      return discoverAccountingMisaDataSpaces(payload);
    case "connectAccountingMisaDataSpace":
      return connectAccountingMisaDataSpace(payload);
    case "startAccountingDataSync":
      return startAccountingDataSync(payload, actorEmail);
    case "reviewAccountingDataChanges":
      return reviewAccountingDataChanges(payload, actorEmail);
    case "exportAccountingDataChanges":
      return exportAccountingDataChanges(payload, actorEmail);
    case "getAccountingDescriptionTemplate":
      return getAccountingDescriptionTemplate(payload);
    case "syncAccountingDescriptionTemplate":
      return syncAccountingDescriptionTemplate(payload);
    case "generateAccountingReportOutput":
      return generateAccountingReportOutput(payload);
    case "generateAccountingDisclosureOutput":
      return generateAccountingDisclosureOutput(payload);
    case "listAccountingReportAdjustments":
      return listAccountingReportAdjustments(payload);
    case "saveAccountingReportAdjustment":
      return saveAccountingReportAdjustment(payload, actorEmail);
    case "voidAccountingReportAdjustment":
      return voidAccountingReportAdjustment(payload, actorEmail);
    case "exportAccountingDisclosureOutput":
      return exportAccountingDisclosureOutput(payload, actorEmail);
    case "exportAccountingReportOutput":
      return exportAccountingReportOutput(payload, actorEmail);
    default:
      throw new AccountingRpcError(
        `Chức năng ${method} chưa được đăng ký trong cổng API Kế toán.`,
        400,
      );
  }
}
