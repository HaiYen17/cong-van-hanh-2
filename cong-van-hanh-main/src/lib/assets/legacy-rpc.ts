import "server-only";

import type { AppSession } from "@/lib/auth/session";
import { getModuleConfigSecret } from "@/lib/config/global-config";
import { sealConfigSecret } from "@/lib/config/secret-vault";
import { getDb } from "@/lib/db";
import { asRecord, booleanValue, numberValue, text } from "@/lib/operations/json";

import {
  analyzeAssetInvoice,
  archiveAssetRecord,
  assertAssetSetupAccess,
  getAssetSetupSnapshot,
  retryAssetBackgroundJob,
  runAssetBackgroundQueue,
  saveAssetCatalogItem,
  saveAssetOption,
  saveStationeryItem,
  saveUniformItem,
} from "./setup-runtime";
import type {
  AssetDraftInput,
  AssetOptionKind,
  AssetSetupSnapshot,
  StationeryDraftInput,
  UniformDraftInput,
} from "./setup-types";

type JsonRecord = Record<string, unknown>;

export class AssetLegacyRpcError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AssetLegacyRpcError";
    this.status = status;
  }
}

function fileFromPayload(value: unknown, label: string) {
  const payload = asRecord(value);
  const dataUrl = text(
    payload.dataUrl ||
      payload.base64Data ||
      payload.base64 ||
      payload.contentBase64,
  );
  const match = dataUrl.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  const base64 = match ? match[2] : dataUrl.replace(/\s+/g, "");
  if (!base64) {
    throw new AssetLegacyRpcError(`Vui lòng đính kèm ${label}.`);
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw new AssetLegacyRpcError(`Không đọc được ${label}.`);
  }
  if (!buffer.length) {
    throw new AssetLegacyRpcError(`Không đọc được ${label}.`);
  }
  const mimeType =
    text(payload.mimeType) || match?.[1] || "application/octet-stream";
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  return new File(
    [bytes.buffer],
    text(payload.name || payload.fileName) || "tep",
    { type: mimeType },
  );
}

function itemLabel(itemType: string) {
  if (itemType === "stationery") return "văn phòng phẩm";
  if (itemType === "uniform") return "đồng phục";
  return "CCDC/tài sản";
}

async function sourceRowMap() {
  const rows = await getDb().configurationRecord.findMany({
    select: { id: true, sourceRow: true },
    where: {
      recordType: {
        in: ["asset-setup", "asset-catalog", "stationery", "uniform"],
      },
    },
  });
  return new Map(rows.map((row) => [row.id, row.sourceRow]));
}

async function legacySnapshot(snapshot?: AssetSetupSnapshot) {
  const data = snapshot || (await getAssetSetupSnapshot());
  const rows = await sourceRowMap();
  const [workerSecret, geminiKey] = await Promise.all([
    getModuleConfigSecret("assetSetup.backgroundWorkerSecret"),
    getModuleConfigSecret("ai.geminiApiKey"),
  ]);
  const optionsByKind: Record<string, unknown[]> = {};
  for (const kind of data.optionKinds) optionsByKind[kind.key] = [];
  for (const option of data.options) {
    (optionsByKind[option.kind] ||= []).push({
      colorHex: option.colorHex,
      id: option.id,
      isActive: true,
      kind: option.kind,
      name: option.name,
      rowIndex: rows.get(option.id) || 0,
      status: option.status,
      updatedAt: option.updatedAt,
      updatedBy: option.updatedBy,
    });
  }
  const mapImage = (image: {
    fileId: string;
    legacyDriveId: string;
    name: string;
    url: string;
  }) => ({
    imageFileName: image.name,
    imageId: image.fileId || image.legacyDriveId,
    imageRawUrl: image.url,
    imageUrl: image.url,
  });
  return {
    assets: data.assets.map((asset) => ({
      ...asset,
      ...mapImage(asset.image),
      colors: asset.descriptorGroups.flatMap((group) => group.colors),
      isActive: true,
      rowIndex: rows.get(asset.id) || 0,
    })),
    backgroundJobs: data.backgroundJobs.map((job) => ({
      ...job,
      itemLabel: itemLabel(job.itemType),
      jobId: job.id,
      originalFileName: job.originalImage.name,
      originalImageUrl: job.originalImage.url,
      processedImageUrl: job.processedImage.url,
      rowIndex: rows.get(job.id) || 0,
    })),
    backgroundWorker: {
      enabled: data.environment.workerConfigured,
      secretConfigured: Boolean(workerSecret),
      urlConfigured: data.environment.workerConfigured,
    },
    environment: {
      gcsConfigured: data.environment.gcsConfigured,
      imageFolderConfigured: data.environment.imageFolderConfigured,
      rootFolderConfigured: data.environment.rootFolderConfigured,
      stationeryFolderConfigured:
        data.environment.stationeryFolderConfigured,
      uniformFolderConfigured: data.environment.uniformFolderConfigured,
    },
    gemini: {
      configured: Boolean(geminiKey),
      defaultModel: "gemini-2.5-flash",
      model: data.environment.geminiModel,
    },
    ok: true,
    optionKinds: data.optionKinds,
    optionsByKind,
    stationeryItems: data.stationeryItems.map((item) => ({
      ...item,
      ...mapImage(item.image),
      isActive: true,
      rowIndex: rows.get(item.id) || 0,
    })),
    uniformItems: data.uniformItems.map((item) => ({
      ...item,
      ...mapImage(item.image),
      isActive: true,
      rowIndex: rows.get(item.id) || 0,
    })),
    uniformSizeOptions: [...data.uniformSizeOptions],
  };
}

async function findRecordByRow(
  rowIndex: number,
  recordType: "asset-catalog" | "asset-setup" | "stationery" | "uniform",
) {
  const row = await getDb().configurationRecord.findFirst({
    select: { id: true },
    where: { recordType, sourceRow: rowIndex },
  });
  if (!row) {
    throw new AssetLegacyRpcError("Không tìm thấy bản ghi cần xóa.", 404);
  }
  return row;
}

async function saveSetting(
  session: AppSession,
  key: string,
  value: string | null,
  secret = false,
) {
  const stored = secret && value ? sealConfigSecret(value) : value;
  await getDb().$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      create: { key, updatedById: session.userId, value: stored },
      update: { updatedById: session.userId, value: stored },
      where: { key },
    });
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: { cleared: !stored, secret },
        summary: `Cập nhật cấu hình ${key}.`,
        targetId: key,
        targetType: "SystemSetting",
      },
    });
  });
}

async function saveWorkerConfig(session: AppSession, payload: JsonRecord) {
  assertAssetSetupAccess(session);
  if (booleanValue(payload.clearBackgroundWorker)) {
    await Promise.all([
      saveSetting(session, "assetSetup.backgroundWorkerUrl", null),
      saveSetting(session, "assetSetup.backgroundWorkerSecret", null, true),
    ]);
  } else {
    const workerUrl = text(payload.workerUrl || payload.url);
    if (!workerUrl) {
      throw new AssetLegacyRpcError(
        "Vui lòng nhập URL endpoint Python xử lý nền.",
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(workerUrl);
    } catch {
      throw new AssetLegacyRpcError("URL worker Python không hợp lệ.");
    }
    if (
      process.env.NODE_ENV === "production" &&
      parsed.protocol !== "https:"
    ) {
      throw new AssetLegacyRpcError(
        "URL worker Python phải dùng HTTPS trên production.",
      );
    }
    await saveSetting(
      session,
      "assetSetup.backgroundWorkerUrl",
      parsed.toString().replace(/\/$/, ""),
    );
    const secret = text(payload.workerSecret || payload.secret);
    if (secret) {
      await saveSetting(
        session,
        "assetSetup.backgroundWorkerSecret",
        secret,
        true,
      );
    }
  }
  return {
    backgroundWorker: (await legacySnapshot()).backgroundWorker,
    ok: true,
  };
}

async function testWorkerConnection(session: AppSession, payload: JsonRecord) {
  assertAssetSetupAccess(session);
  const configuredUrl = await getDb().systemSetting.findUnique({
    select: { value: true },
    where: { key: "assetSetup.backgroundWorkerUrl" },
  });
  const workerUrl = text(
    payload.workerUrl || payload.url || configuredUrl?.value,
  ).replace(/\/$/, "");
  const workerSecret =
    text(payload.workerSecret || payload.secret) ||
    (await getModuleConfigSecret("assetSetup.backgroundWorkerSecret"));
  if (!workerUrl) {
    throw new AssetLegacyRpcError("Chưa có URL worker Python để kiểm tra.");
  }
  const healthUrl = /\/remove-background$/i.test(workerUrl)
    ? workerUrl.replace(/\/remove-background$/i, "/health")
    : `${workerUrl}/health`;
  try {
    const headers: Record<string, string> = {
      "ngrok-skip-browser-warning": "true",
    };
    if (workerSecret) {
      headers.Authorization = `Bearer ${workerSecret}`;
      headers["X-Asset-Worker-Secret"] = workerSecret;
    }
    const response = await fetch(healthUrl, {
      cache: "no-store",
      headers,
    });
    const responseText = (await response.text()).slice(0, 500);
    return {
      healthUrl,
      message: response.ok
        ? "Worker Python đang online."
        : `Worker Python chưa online. HTTP ${response.status}: ${responseText.slice(0, 240)}`,
      ok: response.ok,
      responseText,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      healthUrl,
      message:
        error instanceof Error
          ? error.message
          : "Không gọi được worker Python.",
      ok: false,
      responseText: "",
      statusCode: 0,
    };
  }
}

async function saveGeminiConfig(session: AppSession, payload: JsonRecord) {
  assertAssetSetupAccess(session);
  const model =
    text(payload.geminiModel || payload.model).replace(/^models\//i, "") ||
    "gemini-2.5-flash";
  await saveSetting(session, "ai.geminiModel", model);
  if (booleanValue(payload.clearGeminiApiKey)) {
    await saveSetting(session, "ai.geminiApiKey", null, true);
  } else {
    const key = text(payload.geminiApiKey || payload.apiKey);
    if (key) await saveSetting(session, "ai.geminiApiKey", key, true);
  }
  return {
    gemini: (await legacySnapshot()).gemini,
    ok: true,
  };
}

async function saveEnvironment(session: AppSession, payload: JsonRecord) {
  assertAssetSetupAccess(session);
  await Promise.all(
    [
      ["assetSetup.rootFolderId", text(payload.rootFolderId)],
      ["assetSetup.imageFolderId", text(payload.imageFolderId)],
      ["assetSetup.stationeryFolderId", text(payload.stationeryFolderId)],
      ["assetSetup.uniformFolderId", text(payload.uniformFolderId)],
    ].map(([key, value]) => saveSetting(session, key, value || null)),
  );
  return legacySnapshot();
}

async function saveCatalog(
  session: AppSession,
  itemType: "asset" | "stationery" | "uniform",
  payload: JsonRecord,
  removeBackground: boolean,
) {
  const image = fileFromPayload(payload.imageFile, "hình ảnh");
  if (itemType === "stationery") {
    const result = await saveStationeryItem(
      session,
      payload as StationeryDraftInput,
      image,
      removeBackground,
    );
    return result;
  }
  if (itemType === "uniform") {
    return saveUniformItem(
      session,
      payload as UniformDraftInput,
      image,
      removeBackground,
    );
  }
  return saveAssetCatalogItem(
    session,
    payload as AssetDraftInput,
    image,
    removeBackground,
  );
}

async function saveCatalogAndSnapshot(
  session: AppSession,
  itemType: "asset" | "stationery" | "uniform",
  payload: JsonRecord,
) {
  await saveCatalog(session, itemType, payload, false);
  return legacySnapshot();
}

async function enqueueCatalog(
  session: AppSession,
  payload: JsonRecord,
) {
  const itemType =
    text(payload.itemType) === "stationery"
      ? "stationery"
      : text(payload.itemType) === "uniform"
        ? "uniform"
        : "asset";
  const result = await saveCatalog(session, itemType, payload, true);
  const item = result.item;
  const snapshot = await legacySnapshot();
  const job = snapshot.backgroundJobs.find((entry) => entry.id === item.id);
  return {
    job: job || { id: item.id, itemName: item.name, status: "queued" },
    jobId: item.id,
    message: `Đã đưa ${itemLabel(itemType)} vào hàng đợi xử lý nền.`,
    ok: true,
  };
}

export async function dispatchAssetLegacyRpc(
  session: AppSession,
  method: string,
  payload: JsonRecord,
) {
  assertAssetSetupAccess(session);
  switch (method) {
    case "getAssetSetupConfig":
      return legacySnapshot();
    case "saveAssetSetupOption":
      await saveAssetOption(session, {
        colorHex: text(payload.colorHex),
        kind: text(payload.kind) as AssetOptionKind,
        name: text(payload.name),
      });
      return legacySnapshot();
    case "deleteAssetSetupOption": {
      const row = await findRecordByRow(
        numberValue(payload.rowIndex),
        "asset-setup",
      );
      await archiveAssetRecord(session, {
        id: row.id,
        recordType: "asset-setup",
      });
      return legacySnapshot();
    }
    case "saveAssetSetupEnvironment":
      return saveEnvironment(session, payload);
    case "saveAssetSetupBackgroundWorkerConfig":
      return saveWorkerConfig(session, payload);
    case "testAssetSetupBackgroundWorkerConnection":
      return testWorkerConnection(session, payload);
    case "saveAssetSetupGeminiConfig":
      return saveGeminiConfig(session, payload);
    case "analyzeAssetSetupInvoiceWithGemini":
      return analyzeAssetInvoice(
        session,
        fileFromPayload(payload.invoiceFile, "hóa đơn"),
      );
    case "saveAssetCatalogItem":
      return saveCatalogAndSnapshot(session, "asset", payload);
    case "saveAssetStationeryItem":
      return saveCatalogAndSnapshot(session, "stationery", payload);
    case "saveAssetUniformItem":
      return saveCatalogAndSnapshot(session, "uniform", payload);
    case "enqueueAssetSetupBackgroundJob":
      return enqueueCatalog(session, payload);
    case "getAssetSetupBackgroundJobStatus": {
      const snapshot = await legacySnapshot();
      const requested = Array.isArray(payload.jobIds)
        ? new Set(payload.jobIds.map(text).filter(Boolean))
        : new Set([text(payload.jobId)].filter(Boolean));
      return {
        jobs: requested.size
          ? snapshot.backgroundJobs.filter((job) => requested.has(job.id))
          : snapshot.backgroundJobs,
        ok: true,
        worker: snapshot.backgroundWorker,
      };
    }
    case "runAssetSetupBackgroundQueueNow": {
      await runAssetBackgroundQueue(session);
      const snapshot = await legacySnapshot();
      return {
        jobs: snapshot.backgroundJobs,
        ok: true,
        worker: snapshot.backgroundWorker,
      };
    }
    case "retryAssetSetupBackgroundJob": {
      await retryAssetBackgroundJob(session, text(payload.jobId));
      const snapshot = await legacySnapshot();
      return {
        job: snapshot.backgroundJobs.find(
          (job) => job.id === text(payload.jobId),
        ),
        jobs: snapshot.backgroundJobs,
        ok: true,
        worker: snapshot.backgroundWorker,
      };
    }
    case "deleteAssetCatalogItem":
    case "deleteAssetStationeryItem":
    case "deleteAssetUniformItem": {
      const recordType =
        method === "deleteAssetCatalogItem"
          ? "asset-catalog"
          : method === "deleteAssetStationeryItem"
            ? "stationery"
            : "uniform";
      const row = await findRecordByRow(
        numberValue(payload.rowIndex),
        recordType,
      );
      await archiveAssetRecord(session, { id: row.id, recordType });
      return legacySnapshot();
    }
    default:
      throw new AssetLegacyRpcError(
        `Phương thức “${method}” chưa được hỗ trợ.`,
        404,
      );
  }
}
