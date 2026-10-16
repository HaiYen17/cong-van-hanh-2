import {
  cleanText,
  isJsonObject,
  normalizeKey,
} from "@/lib/accounting/normalize";
import { readVersionRecords } from "@/lib/accounting/repository";
import { AccountingRpcError, type JsonObject } from "@/lib/accounting/types";
import {
  accountingWorkerConfig,
  callAccountingWorker,
} from "@/lib/accounting/worker-client";
import {
  loadAccountingTemplateSource,
  storeAccountingExport,
} from "@/lib/accounting/export-storage";
import { renderAccountingDisclosurePdfFromWorkbook } from "@/lib/accounting/disclosure-pdf";
import { renderAccountingDisclosureWorkbook } from "@/lib/accounting/disclosure-workbook";
import { renderAccountingReportPdf } from "@/lib/accounting/report-pdf";

function emptyRuntime(health: JsonObject = {}) {
  return {
    schemaVersion: "accounting-runtime.v3.5-misa-system-profile",
    config: accountingWorkerConfig(),
    health: {
      ok: false,
      configured: accountingWorkerConfig().configured,
      databaseConnected: false,
      schemaReady: false,
      databaseName: "",
      schema: "accounting_runtime",
      autoRunEnabled: false,
      ...health,
    },
    schemaReady: false,
    sources: [],
    runs: [],
    changes: [],
    activeSnapshots: [],
    snapshotHistory: [],
    dataControls: [],
    reportResultSnapshots: [],
    summary: {
      unreviewed: 0,
      added: 0,
      updated: 0,
      deleted: 0,
    },
  };
}

function runtimeFilters(payload: JsonObject) {
  const limit = Number(payload.limit || 80);
  return {
    sourceKey: cleanText(payload.sourceKey),
    companyKey: cleanText(payload.companyKey),
    dataSpaceKey: cleanText(payload.dataSpaceKey),
    period: cleanText(payload.period),
    reviewStatus: cleanText(payload.reviewStatus),
    changeType: cleanText(payload.changeType),
    limit: Math.max(1, Math.min(500, Number.isFinite(limit) ? limit : 80)),
  };
}

export async function getAccountingDataRuntime(payload: JsonObject) {
  const config = accountingWorkerConfig();
  if (!config.configured) {
    return emptyRuntime({
      message:
        "Worker Kế toán chưa được cấu hình bằng Secret Manager của Google Cloud.",
    });
  }
  try {
    const [health, bootstrap] = await Promise.all([
      callAccountingWorker("/health", {}, { method: "GET", timeoutMs: 20_000 }),
      callAccountingWorker("/control/bootstrap", runtimeFilters(payload), {
        timeoutMs: 30_000,
      }),
    ]);
    return {
      schemaVersion: cleanText(
        bootstrap.schemaVersion || health.schemaVersion,
      ) || "accounting-runtime.v3.5-misa-system-profile",
      config,
      health: { configured: true, ...health },
      schemaReady: Boolean(health.schemaReady && bootstrap.schemaReady),
      sources: Array.isArray(bootstrap.sources) ? bootstrap.sources : [],
      runs: Array.isArray(bootstrap.runs) ? bootstrap.runs : [],
      changes: Array.isArray(bootstrap.changes) ? bootstrap.changes : [],
      activeSnapshots: Array.isArray(bootstrap.activeSnapshots)
        ? bootstrap.activeSnapshots
        : [],
      snapshotHistory: Array.isArray(bootstrap.snapshotHistory)
        ? bootstrap.snapshotHistory
        : [],
      dataControls: Array.isArray(bootstrap.dataControls)
        ? bootstrap.dataControls
        : [],
      summary: isJsonObject(bootstrap.summary) ? bootstrap.summary : {},
    };
  } catch (error) {
    return emptyRuntime({
      configured: true,
      message:
        error instanceof Error
          ? error.message
          : "Worker Kế toán chưa sẵn sàng.",
    });
  }
}

export async function saveAccountingDataWorkerConfig(payload: JsonObject) {
  const response = await callAccountingWorker(
    "/health",
    {},
    {
      method: "GET",
      secret: cleanText(payload.workerSecret),
      timeoutMs: 20_000,
      url: cleanText(payload.workerUrl),
    },
  );
  return {
    ok: true,
    health: response,
    runtime: await getAccountingDataRuntime({}),
    message:
      "Kết nối đã được kiểm tra. Cấu hình production tiếp tục được bảo vệ bằng Google Cloud Secret Manager.",
  };
}

export async function testAccountingDataWorker(payload: JsonObject) {
  const health = await callAccountingWorker(
    "/health",
    {},
    {
      method: "GET",
      secret: cleanText(payload.workerSecret),
      timeoutMs: 20_000,
      url: cleanText(payload.workerUrl),
    },
  );
  return {
    ok: Boolean(health.ok),
    health,
    message: health.schemaReady
      ? "Worker và PostgreSQL Kế toán đã sẵn sàng."
      : "Worker đã kết nối PostgreSQL nhưng schema vận hành chưa sẵn sàng.",
  };
}

export async function initializeAccountingDataSchema() {
  const result = await callAccountingWorker("/schema/initialize");
  return {
    ok: true,
    result,
    runtime: await getAccountingDataRuntime({}),
    message: "Đã khởi tạo hoặc nâng cấp schema vận hành Kế toán.",
  };
}

export async function previewAccountingTestDataSpaceCleanup(
  payload: JsonObject,
) {
  return callAccountingWorker("/data-spaces/test-cleanup/preview", {
    targets: Array.isArray(payload.targets) ? payload.targets : [],
  });
}

export async function deleteAccountingTestDataSpaces(
  payload: JsonObject,
  actorEmail: string,
) {
  const result = await callAccountingWorker(
    "/data-spaces/test-cleanup/delete",
    {
      targets: Array.isArray(payload.targets) ? payload.targets : [],
      confirmation: cleanText(payload.confirmation),
      previewToken: cleanText(payload.previewToken),
      requestedBy: actorEmail,
    },
    { timeoutMs: 180_000 },
  );
  return {
    ...result,
    runtime: await getAccountingDataRuntime({}),
  };
}

function parseRequestBody(value: unknown) {
  if (isJsonObject(value)) {
    return value;
  }
  const text = cleanText(value);
  if (!text) {
    throw new AccountingRpcError(
      "Vui lòng dán nội dung yêu cầu mẫu của báo cáo MISA.",
    );
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isJsonObject(parsed)) {
      throw new Error("not-object");
    }
    return parsed;
  } catch {
    if (
      /^\s*\d+\.\s*[a-z_][\w-]*\s*:/im.test(text) ||
      /(?:^|\n)\s*(?:actionLoadReport|columns|parameters|reportList|report_id)\s*:/i.test(
        text,
      )
    ) {
      throw new AccountingRpcError(
        "Phần vừa dán là danh sách hiển thị của DevTools, không phải JSON đầy đủ. Kế toán hãy đóng phần kỹ thuật và dùng luồng Chọn công ty → dán Bearer → chọn khối MISA ở phía trên.",
      );
    }
    throw new AccountingRpcError(
      "Nội dung yêu cầu mẫu của MISA phải là một object JSON hợp lệ.",
    );
  }
}

async function configuredDataSource(versionId: string, sourceKey: string) {
  if (!versionId || !sourceKey) {
    throw new AccountingRpcError(
      "Thiếu phiên bản cấu hình hoặc nguồn dữ liệu MISA.",
    );
  }
  const records = await readVersionRecords(versionId);
  const source = records.find(
    (record) =>
      record.recordType === "DATA_SOURCE" &&
      normalizeKey(record.payload.sourceKey || record.entityKey) === sourceKey,
  );
  if (!source) {
    throw new AccountingRpcError(
      "Không tìm thấy nguồn MISA trong phiên bản cấu hình đã chọn.",
      404,
    );
  }
  return source.payload;
}

export async function saveAccountingMisaSession(payload: JsonObject) {
  const versionId = cleanText(payload.versionId);
  const sourceKey = normalizeKey(payload.sourceKey);
  const source = await configuredDataSource(versionId, sourceKey);
  const endpointUrl = cleanText(
    source.endpointUrl || source.endpointRef || source.apiUrl || source.url,
  );
  if (!endpointUrl) {
    throw new AccountingRpcError(
      "Nguồn MISA chưa có Endpoint URL trong cấu hình dữ liệu.",
    );
  }
  const session = await callAccountingWorker("/sessions/misa", {
    sourceKey,
    sourceName: cleanText(source.sourceName || sourceKey),
    sourceType: cleanText(source.sourceType || "AMIS_SESSION"),
    companyKey: normalizeKey(payload.companyKey),
    dataSpaceName: cleanText(payload.dataSpaceName),
    datasetType: cleanText(source.datasetType || "TRIAL_BALANCE"),
    endpointUrl,
    reportId: cleanText(source.reportId),
    reportName: cleanText(payload.reportName || source.reportName),
    bearer: cleanText(payload.bearer),
    misaContext: payload.misaContext,
    device: cleanText(payload.device),
    cookie: cleanText(payload.cookie),
    origin: cleanText(source.origin || "https://actapp.misa.vn"),
    referer: cleanText(source.referer || "https://actapp.misa.vn/"),
    requestBody: parseRequestBody(payload.requestBody),
    pageSize: Number(payload.pageSize || source.pageSize || 100),
  });
  return {
    ok: true,
    session,
    message: cleanText(session.message) || "Đã lưu phiên MISA an toàn.",
  };
}

export async function refreshAccountingMisaBearer(payload: JsonObject) {
  return callAccountingWorker("/sessions/misa/bearer", {
    sourceKey: normalizeKey(payload.sourceKey),
    bearer: cleanText(payload.bearer),
  });
}

export async function checkAccountingMisaCredentials(payload: JsonObject = {}) {
  return callAccountingWorker(
    "/sessions/misa/check",
    {
      sourceKey: normalizeKey(payload.sourceKey),
      force: payload.force === true,
    },
    { timeoutMs: 120_000 },
  );
}

export async function discoverAccountingMisaDataSpaces(payload: JsonObject) {
  return callAccountingWorker("/sessions/misa/spaces", {
    sourceKey: normalizeKey(payload.sourceKey),
    profileKey: normalizeKey(payload.profileKey) || "TRIAL_BALANCE",
    companyKey: normalizeKey(payload.companyKey),
    bearer: cleanText(payload.bearer),
  });
}

export async function connectAccountingMisaDataSpace(payload: JsonObject) {
  return callAccountingWorker("/sessions/misa/spaces/connect", {
    referenceSourceKey: normalizeKey(payload.referenceSourceKey),
    profileKey: normalizeKey(payload.profileKey) || "TRIAL_BALANCE",
    companyKey: normalizeKey(payload.companyKey),
    databaseId: cleanText(payload.databaseId),
    bearer: cleanText(payload.bearer),
  });
}

export async function startAccountingDataSync(
  payload: JsonObject,
  actorEmail: string,
) {
  return callAccountingWorker("/jobs/start", {
    sourceKey: normalizeKey(payload.sourceKey),
    companyKey: normalizeKey(payload.companyKey),
    periodFrom: cleanText(payload.periodFrom),
    periodTo: cleanText(payload.periodTo),
    requestedBy: actorEmail,
    pageSize: Number(payload.pageSize || 100),
    note: cleanText(payload.note),
  });
}

export async function previewAccountingDataFileImport(payload: JsonObject) {
  return callAccountingWorker(
    "/imports/files/preview",
    {
      fileName: cleanText(payload.fileName),
      fileDataUrl: cleanText(payload.fileDataUrl),
      companyKey: normalizeKey(payload.companyKey),
      companyLabel: cleanText(payload.companyLabel),
      datasetType: normalizeKey(payload.datasetType) || "AUTO",
      versionId: cleanText(payload.versionId),
      reportKey: normalizeKey(payload.reportKey),
      sheetName: cleanText(payload.sheetName),
      headerRow: Math.max(0, Number(payload.headerRow || 0)),
    },
    { timeoutMs: 240_000 },
  );
}

export async function importAccountingDataFile(
  payload: JsonObject,
  actorEmail: string,
) {
  const result = await callAccountingWorker(
    "/imports/files",
    {
      fileName: cleanText(payload.fileName),
      fileDataUrl: cleanText(payload.fileDataUrl),
      companyKey: normalizeKey(payload.companyKey),
      companyLabel: cleanText(payload.companyLabel),
      datasetType: normalizeKey(payload.datasetType) || "AUTO",
      versionId: cleanText(payload.versionId),
      reportKey: normalizeKey(payload.reportKey),
      sheetName: cleanText(payload.sheetName),
      headerRow: Math.max(0, Number(payload.headerRow || 0)),
      periodFrom: cleanText(payload.periodFrom),
      periodTo: cleanText(payload.periodTo),
      dataSpaceName: cleanText(payload.dataSpaceName),
      targetDataSpaceKey: normalizeKey(payload.targetDataSpaceKey),
      requestedBy: actorEmail,
      note: cleanText(payload.note),
    },
    { timeoutMs: 600_000 },
  );
  return {
    ...result,
    runtime: await getAccountingDataRuntime({}),
  };
}

export async function reviewAccountingDataChanges(
  payload: JsonObject,
  actorEmail: string,
) {
  return callAccountingWorker("/changes/review", {
    changeIds: Array.isArray(payload.changeIds) ? payload.changeIds : [],
    reviewStatus: normalizeKey(payload.reviewStatus),
    note: cleanText(payload.note),
    reviewedBy: actorEmail,
  });
}

export async function getAccountingDescriptionTemplate(payload: JsonObject) {
  return callAccountingWorker("/notes/catalog", {
    sourceKeys: Array.isArray(payload.sourceKeys) ? payload.sourceKeys : [],
    subAccountingSystem: Number(payload.subAccountingSystem || 99),
    ensureFresh: payload.ensureFresh !== false,
    includeHidden: payload.includeHidden === true,
    search: cleanText(payload.search),
    limit: Math.max(1, Math.min(5_000, Number(payload.limit || 2_000))),
  });
}

export async function syncAccountingDescriptionTemplate(payload: JsonObject) {
  return callAccountingWorker("/notes/sync", {
    sourceKey: normalizeKey(payload.sourceKey),
    subAccountingSystem: Number(payload.subAccountingSystem || 99),
    force: payload.force === true,
  });
}

export async function exportAccountingDataChanges(
  payload: JsonObject,
  actorEmail: string,
) {
  const result = await callAccountingWorker("/changes/export", {
    ...runtimeFilters(payload),
    limit: Math.max(
      1,
      Math.min(50_000, Number(payload.limit || 10_000) || 10_000),
    ),
  });
  const file = await storeAccountingExport(result, {
    actorEmail,
    fallbackName: "Lịch sử điều chỉnh số liệu.csv",
    purpose: "CHANGE_HISTORY",
  });
  return {
    ...file,
    rowCount: Number(result.rowCount || 0),
  };
}

export async function generateAccountingReportOutput(payload: JsonObject) {
  return callAccountingWorker("/report/output", payload, {
    timeoutMs: 180_000,
    retryTransient: true,
  });
}

export async function generateAccountingDisclosureOutput(payload: JsonObject) {
  return callAccountingWorker(
    "/disclosure/output",
    { ...payload, reportKey: "B09_DN_TT99", includeEvidence: true },
    { timeoutMs: 180_000, retryTransient: true },
  );
}

export async function listAccountingReportAdjustments(payload: JsonObject) {
  return callAccountingWorker("/report/adjustments/list", {
    versionId: cleanText(payload.versionId),
    reportKey: normalizeKey(payload.reportKey),
    companyKey: normalizeKey(payload.companyKey),
    dataSpaceKey: normalizeKey(payload.dataSpaceKey),
    periodFrom: cleanText(payload.periodFrom),
    periodTo: cleanText(payload.periodTo),
    includeVoided: payload.includeVoided === true,
  });
}

export async function saveAccountingReportAdjustment(
  payload: JsonObject,
  actorEmail: string,
) {
  return callAccountingWorker("/report/adjustments", {
    externalKey: normalizeKey(payload.externalKey),
    versionId: cleanText(payload.versionId),
    reportKey: normalizeKey(payload.reportKey),
    rowCode: cleanText(payload.rowCode),
    columnKey: normalizeKey(payload.columnKey),
    companyKey: normalizeKey(payload.companyKey),
    dataSpaceKey: normalizeKey(payload.dataSpaceKey),
    dataSpaceName: cleanText(payload.dataSpaceName),
    periodFrom: cleanText(payload.periodFrom),
    periodTo: cleanText(payload.periodTo),
    amount: Number(payload.amount || 0),
    reason: cleanText(payload.reason) || "Bút toán điều chỉnh khi xuất báo cáo",
    sourceReference: cleanText(payload.sourceReference) || "Kế toán nhập tại bước xuất báo cáo",
    supportingData: isJsonObject(payload.supportingData)
      ? payload.supportingData
      : {},
    requestedBy: actorEmail,
    status: "APPROVED",
  });
}

export async function voidAccountingReportAdjustment(
  payload: JsonObject,
  actorEmail: string,
) {
  return callAccountingWorker("/report/adjustments/status", {
    adjustmentId: cleanText(payload.adjustmentId),
    status: "VOIDED",
    actor: actorEmail,
    note: cleanText(payload.note) || "Xóa khỏi danh sách bút toán điều chỉnh khi xuất báo cáo",
  });
}

export async function exportAccountingReportOutput(
  payload: JsonObject,
  actorEmail: string,
) {
  // Dựng/đọc cache trước rồi mới render XLSX. Chạy song song hai endpoint cũ
  // khiến cùng một báo cáo nặng bị tính hai lần và dễ chạm giới hạn Cloud Run.
  const output = await generateAccountingReportOutput(payload);
  const xlsxResult = await callAccountingWorker(
    "/report/export",
    { ...payload, format: "XLSX" },
    { timeoutMs: 180_000, retryTransient: true },
  );
  const pdfResult = await renderAccountingReportPdf(output);
  const [xlsx, pdf] = await Promise.all([
    storeAccountingExport(xlsxResult, {
      actorEmail,
      fallbackName: "Báo cáo kế toán.xlsx",
      purpose: "REPORT_OUTPUT",
    }),
    storeAccountingExport(pdfResult, {
      actorEmail,
      fallbackName: "Báo cáo kế toán.pdf",
      purpose: "REPORT_OUTPUT",
    }),
  ]);
  return {
    ok: true,
    sheetUrl: "",
    xlsxUrl: xlsx.url,
    pdfUrl: pdf.url,
    xlsxFileId: xlsx.fileId,
    pdfFileId: pdf.fileId,
    rowCount: Number(xlsxResult.rowCount || 0),
    warningCount: Number(
      xlsxResult.warningCount ||
        (Array.isArray(output.warnings) ? output.warnings.length : 0),
    ),
    message: "Đã tạo file Excel và PDF riêng tư trên Google Cloud Storage.",
  };
}

export async function exportAccountingDisclosureOutput(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  if (!versionId) {
    throw new AccountingRpcError("Thiếu phiên bản cấu hình để xuất B09.");
  }
  const [records, output] = await Promise.all([
    readVersionRecords(versionId),
    generateAccountingDisclosureOutput(payload),
  ]);
  const templateRecord = records.find((record) => {
    if (record.recordType !== "DISCLOSURE_TEMPLATE") return false;
    return normalizeKey(record.payload.templateKey || record.entityKey) === "B09_DN_TT99";
  });
  const templateSourceFileId = cleanText(
    templateRecord?.payload.templateSourceFileId,
  );
  if (!templateSourceFileId) {
    throw new AccountingRpcError(
      "B09 hiện chỉ có cấu trúc phân tích, chưa lưu file Excel gốc làm khuôn xuất. Hãy mở Mẫu B09, chọn lại file Excel gốc và lưu nền một lần.",
      409,
    );
  }
  const source = await loadAccountingTemplateSource(templateSourceFileId);
  const xlsxResult = await renderAccountingDisclosureWorkbook({
    output,
    records,
    source: source.content,
    sourceFileName: source.fileName,
  });
  const pdfResult = await renderAccountingDisclosurePdfFromWorkbook(xlsxResult);
  const [xlsx, pdf] = await Promise.all([
    storeAccountingExport(xlsxResult, {
      actorEmail,
      fallbackName: "B09-DN - Bản thuyết minh Báo cáo tài chính.xlsx",
      purpose: "REPORT_OUTPUT",
    }),
    storeAccountingExport(pdfResult, {
      actorEmail,
      fallbackName: "B09-DN - Bản thuyết minh Báo cáo tài chính.pdf",
      purpose: "REPORT_OUTPUT",
    }),
  ]);
  return {
    ok: true,
    sheetUrl: "",
    xlsxUrl: xlsx.url,
    pdfUrl: pdf.url,
    xlsxFileId: xlsx.fileId,
    pdfFileId: pdf.fileId,
    rowCount: Number(xlsxResult.rowCount || 0),
    warningCount: Number(
      xlsxResult.warningCount ||
        (Array.isArray(output.warnings) ? output.warnings.length : 0),
    ),
    placedCellCount: Number(xlsxResult.placedCellCount || 0),
    message:
      "Đã tạo Excel và PDF B09-DN từ đúng khuôn gốc; số mẫu đã được xóa, số vận hành được điền vào các ô ghép chắc chắn và dấu vết nằm ở sheet Đối chiếu số liệu.",
  };
}
