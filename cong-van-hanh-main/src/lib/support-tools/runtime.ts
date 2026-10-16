import "server-only";

import { createHash, randomUUID } from "node:crypto";

import JSZip from "jszip";

import { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { asRecord, booleanValue, numberValue, stringList, text } from "@/lib/operations/json";
import { requestAttachmentStorage } from "@/lib/requests/attachments";
import { linkFileToEntity, registerFileMetadata } from "@/lib/storage";
import { RFID_SCANNER_SUPPORT_APP_ID } from "@/lib/support-tools/rfid-mobile-release";

const SOURCE_SHEET = "POSTGRESQL:app-setup";
const APP_RECORD_TYPE = "app-definition";
const TAG_RECORD_TYPE = "shared-tag";
const ACTIVE_STATUS = "Kích hoạt";
const INACTIVE_STATUS = "Vô hiệu";
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;
type SupportToolVersion = {
  commandText: string;
  createdAt: string;
  downloadType: "copy" | "download";
  downloadTypeLabel: string;
  downloadUrl: string;
  fileId: string;
  fileName: string;
  fileUrl: string;
  folderId: string;
  folderUrl: string;
  updatedAt: string;
  versionId: string;
  versionName: string;
};

export class SupportToolRuntimeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SupportToolRuntimeError";
    this.status = status;
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueList(value: unknown) {
  const values = Array.isArray(value) ? value.map(text) : stringList(value);
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = normalized(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function first(source: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value !== null && value !== undefined && text(value)) return value;
  }
  return "";
}

function parseList(source: JsonRecord, ...keys: string[]) {
  return uniqueList(first(source, ...keys));
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!text(value)) return [];
  try {
    const parsed = JSON.parse(text(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isActiveStatus(value: unknown) {
  const key = normalized(value);
  return ![
    "vo hieu",
    "inactive",
    "archived",
    "disabled",
    "da xoa",
  ].includes(key);
}

function normalizeDownloadType(value: unknown): "copy" | "download" {
  const key = normalized(value);
  return key === "copy" || key.includes("sao chep") ? "copy" : "download";
}

function fileUrl(fileId: string) {
  return fileId
    ? `/api/support-tools/files/${encodeURIComponent(fileId)}`
    : "";
}

function safeFileName(value: unknown) {
  return (
    text(value)
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 180) || "tep"
  );
}

function normalizeVersion(
  value: unknown,
  index: number,
  existing?: SupportToolVersion,
): SupportToolVersion {
  const source = asRecord(value);
  const downloadType = normalizeDownloadType(
    first(source, "downloadType", "Loại tải") ||
      existing?.downloadType ||
      "download",
  );
  const fileId = text(first(source, "fileId", "ID file") || existing?.fileId);
  const versionId =
    text(first(source, "versionId", "id") || existing?.versionId) ||
    randomUUID();
  const now = new Date().toISOString();
  return {
    commandText:
      downloadType === "copy"
        ? text(
            first(source, "commandText", "Nội dung sao chép") ||
              existing?.commandText,
          )
        : "",
    createdAt:
      text(first(source, "createdAt", "Ngày tạo") || existing?.createdAt) ||
      now,
    downloadType,
    downloadTypeLabel:
      downloadType === "copy" ? "Sao chép lệnh" : "Download file",
    downloadUrl:
      downloadType === "download"
        ? fileId
          ? fileUrl(fileId)
          : text(
              first(source, "downloadUrl", "URL tải") ||
                existing?.downloadUrl,
            )
        : "",
    fileId,
    fileName: text(
      first(source, "fileName", "Tên file") || existing?.fileName,
    ),
    fileUrl:
      downloadType === "download"
        ? fileId
          ? fileUrl(fileId)
          : text(first(source, "fileUrl", "URL file") || existing?.fileUrl)
        : "",
    folderId: text(first(source, "folderId") || existing?.folderId),
    folderUrl: text(first(source, "folderUrl") || existing?.folderUrl),
    updatedAt: now,
    versionId,
    versionName:
      text(
        first(source, "versionName", "Phiên bản") || existing?.versionName,
      ) || `ver ${index + 1}.0`,
  };
}

function versionsFromContent(content: JsonRecord) {
  const values = parseJsonArray(
    first(content, "versions", "versionJson", "Phiên bản JSON"),
  );
  return values.map((value, index) => normalizeVersion(value, index));
}

function tagDto(row: {
  code: string | null;
  createdAt: Date;
  id: string;
  name: string | null;
  sourceRow: number;
  status: string | null;
  updatedAt: Date;
  content: unknown;
}) {
  const content = asRecord(row.content);
  const status = row.status || text(first(content, "status", "Trạng thái")) || ACTIVE_STATUS;
  return {
    createdAt: row.createdAt.toISOString(),
    isActive: isActiveStatus(status),
    name: row.name || text(first(content, "name", "Tên tag")),
    rowIndex: row.sourceRow,
    status,
    tagId: row.code || row.id,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: text(first(content, "updatedBy", "Cập nhật bởi")),
  };
}

function appDto(row: {
  code: string | null;
  content: unknown;
  createdAt: Date;
  id: string;
  name: string | null;
  sourceRow: number;
  status: string | null;
  updatedAt: Date;
}) {
  const content = asRecord(row.content);
  const versions = versionsFromContent(content);
  const status =
    row.status || text(first(content, "status", "Trạng thái")) || ACTIVE_STATUS;
  const logoId = text(first(content, "logoId", "Logo ID"));
  const guideImageIds = parseList(
    content,
    "guideImageIds",
    "ID hình hướng dẫn",
  );
  const storedGuideUrls = parseList(
    content,
    "guideImageUrls",
    "URL hình hướng dẫn",
  );
  return {
    appId:
      row.code ||
      text(first(content, "appId", "Ứng dụng ID")) ||
      row.id,
    createdAt: row.createdAt.toISOString(),
    departments: parseList(content, "departments", "Phòng ban"),
    description: text(first(content, "description", "Mô tả ứng dụng")),
    downloadType: versions[0]?.downloadType || normalizeDownloadType(
      first(content, "downloadType", "Loại tải mặc định"),
    ),
    downloadTypeLabel:
      versions[0]?.downloadTypeLabel || "Download file",
    folderId: text(first(content, "folderId", "Folder ID")),
    folderUrl: text(first(content, "folderUrl", "Folder URL")),
    functionTags: parseList(content, "functionTags", "Chức năng"),
    guideImageIds,
    guideImageUrls: guideImageIds.map(
      (id, index) => fileUrl(id) || storedGuideUrls[index] || "",
    ),
    guideText: text(first(content, "guideText", "Hướng dẫn sử dụng")),
    isActive: isActiveStatus(status),
    latestVersion: versions[0] || null,
    logoId,
    logoUrl:
      (logoId && fileUrl(logoId)) ||
      text(first(content, "logoUrl", "Logo URL")),
    name: row.name || text(first(content, "name", "Tên ứng dụng")),
    note: text(first(content, "note", "Ghi chú")),
    rowIndex: row.sourceRow,
    status,
    tagNames: parseList(content, "tagNames", "tags", "Tag ứng dụng"),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: text(first(content, "updatedBy", "Cập nhật bởi")),
    userTypes: parseList(content, "userTypes", "Loại người dùng"),
    versions,
  };
}

export function canAccessAppSetup(session: AppSession) {
  return (
    session.fullAccess ||
    session.modules.includes("app-setup") ||
    session.roles.includes("admin")
  );
}

export function canAccessSupportTools(session: AppSession) {
  return (
    session.fullAccess ||
    session.moduleGroups.includes("tien-ich") ||
    session.modules.includes("support-tools") ||
    session.roles.includes("admin")
  );
}

function assertAppSetupAccess(session: AppSession) {
  if (!canAccessAppSetup(session)) {
    throw new SupportToolRuntimeError(
      "Ông chưa có quyền thao tác Setup ứng dụng.",
      403,
    );
  }
}

function assertSupportToolsAccess(session: AppSession) {
  if (!canAccessSupportTools(session)) {
    throw new SupportToolRuntimeError(
      "Ông chưa có quyền mở Công cụ hỗ trợ.",
      403,
    );
  }
}

async function nextSourceRow(recordType: string) {
  const result = await getDb().configurationRecord.aggregate({
    _max: { sourceRow: true },
    where: { recordType },
  });
  return Math.max(result._max.sourceRow || 1, 1) + 1;
}

async function environment() {
  const setting = await getDb().systemSetting.findUnique({
    where: { key: "appSetup.supportToolDriveFolderId" },
  });
  return {
    folder: {
      id: setting?.value || "GCS",
      name: "Kho ứng dụng PostgreSQL/GCS",
      url: "",
    },
    appSheetName: "PostgreSQL · app-definition",
    tagSheetName: "PostgreSQL · shared-tag",
  };
}

async function getConfig(includeInactive: boolean) {
  const db = getDb();
  const [tags, apps, env] = await Promise.all([
    db.configurationRecord.findMany({
      orderBy: [{ sourceRow: "asc" }],
      where: { recordType: TAG_RECORD_TYPE },
    }),
    db.configurationRecord.findMany({
      orderBy: [{ sourceRow: "asc" }],
      where: { recordType: APP_RECORD_TYPE },
    }),
    environment(),
  ]);
  const tagItems = tags.map(tagDto);
  const appItems = apps.map(appDto).filter((item) => item.name);
  return {
    apps: includeInactive
      ? appItems
      : appItems.filter((item) => item.isActive),
    environment: env,
    ok: true,
    tags: includeInactive
      ? tagItems
      : tagItems.filter((item) => item.isActive),
  };
}

async function getSupportToolSetupConfig(session: AppSession) {
  assertAppSetupAccess(session);
  return getConfig(true);
}

async function getSupportToolPortal(session: AppSession) {
  assertSupportToolsAccess(session);
  return getConfig(false);
}

async function saveSupportToolEnvironment(
  session: AppSession,
  payload: JsonRecord,
) {
  assertAppSetupAccess(session);
  const folderId = text(payload.folderId) || "GCS";
  await getDb().systemSetting.upsert({
    create: {
      key: "appSetup.supportToolDriveFolderId",
      updatedById: session.userId,
      value: folderId,
    },
    update: {
      updatedById: session.userId,
      value: folderId,
    },
    where: { key: "appSetup.supportToolDriveFolderId" },
  });
  return getConfig(true);
}

async function saveSupportToolTag(
  session: AppSession,
  payload: JsonRecord,
) {
  assertAppSetupAccess(session);
  const name = text(payload.name);
  if (!name) {
    throw new SupportToolRuntimeError("Vui lòng nhập tên tag.");
  }
  const rowIndex = numberValue(payload.rowIndex);
  const db = getDb();
  const existing = rowIndex > 1
    ? await db.configurationRecord.findFirst({
        where: { recordType: TAG_RECORD_TYPE, sourceRow: rowIndex },
      })
    : null;
  if (rowIndex > 1 && !existing) {
    throw new SupportToolRuntimeError("Không tìm thấy tag cần cập nhật.", 404);
  }
  const duplicate = await db.configurationRecord.findFirst({
    where: {
      id: existing ? { not: existing.id } : undefined,
      name: { equals: name, mode: "insensitive" },
      recordType: TAG_RECORD_TYPE,
      status: { notIn: [INACTIVE_STATUS, "INACTIVE", "ARCHIVED"] },
    },
  });
  if (duplicate) {
    throw new SupportToolRuntimeError(`Tag “${name}” đã tồn tại.`);
  }

  const oldName = existing?.name || "";
  const content = {
    ...asRecord(existing?.content),
    "Cập nhật bởi": session.displayName,
    "Tên tag": name,
    "Trạng thái": ACTIVE_STATUS,
    name,
    status: ACTIVE_STATUS,
    updatedBy: session.displayName,
  };
  if (existing) {
    await db.configurationRecord.update({
      data: { content: json(content), name, status: ACTIVE_STATUS },
      where: { id: existing.id },
    });
  } else {
    await db.configurationRecord.create({
      data: {
        code: randomUUID(),
        content: json(content),
        name,
        recordType: TAG_RECORD_TYPE,
        sourceRow: await nextSourceRow(TAG_RECORD_TYPE),
        sourceSheet: SOURCE_SHEET,
        status: ACTIVE_STATUS,
      },
    });
  }

  if (oldName && normalized(oldName) !== normalized(name)) {
    const apps = await db.configurationRecord.findMany({
      where: { recordType: APP_RECORD_TYPE },
    });
    for (const app of apps) {
      const appContent = asRecord(app.content);
      const tagNames = parseList(
        appContent,
        "tagNames",
        "tags",
        "Tag ứng dụng",
      ).map((tag) => (normalized(tag) === normalized(oldName) ? name : tag));
      await db.configurationRecord.update({
        data: {
          content: json({
            ...appContent,
            "Tag ứng dụng": tagNames,
            tagNames,
          }),
        },
        where: { id: app.id },
      });
    }
  }
  return getConfig(true);
}

async function deleteSupportToolTag(
  session: AppSession,
  payload: JsonRecord,
) {
  assertAppSetupAccess(session);
  const rowIndex = numberValue(payload.rowIndex);
  const row = await getDb().configurationRecord.findFirst({
    where: { recordType: TAG_RECORD_TYPE, sourceRow: rowIndex },
  });
  if (!row) {
    throw new SupportToolRuntimeError("Không tìm thấy tag cần xóa.", 404);
  }
  await getDb().configurationRecord.update({
    data: {
      content: json({
        ...asRecord(row.content),
        "Cập nhật bởi": session.displayName,
        "Trạng thái": INACTIVE_STATUS,
        status: INACTIVE_STATUS,
        updatedBy: session.displayName,
      }),
      status: INACTIVE_STATUS,
    },
    where: { id: row.id },
  });
  return getConfig(true);
}

async function prepareSupportToolAppUpload(
  session: AppSession,
  payload: JsonRecord,
) {
  assertAppSetupAccess(session);
  const name = text(payload.name);
  if (!name) {
    throw new SupportToolRuntimeError("Vui lòng nhập tên ứng dụng.");
  }
  const appId = text(payload.appId) || randomUUID();
  const versions = Array.isArray(payload.versions) ? payload.versions : [];
  return {
    appFolderId: `support:${appId}:app`,
    appFolderUrl: "",
    appId,
    guideFolderId: `support:${appId}:guide`,
    guideFolderUrl: "",
    ok: true,
    token: "v3-gcs",
    versions: versions.map((value, index) => {
      const version = asRecord(value);
      const versionId = text(version.versionId) || randomUUID();
      return {
        folderId: `support:${appId}:version:${versionId}`,
        folderUrl: "",
        index,
        versionId,
        versionName: text(version.versionName) || "1.0",
      };
    }),
  };
}

async function resolveFileName(fileId: string, fallback: string) {
  if (!fileId) return fallback;
  const file = await getDb().fileObject.findUnique({
    select: { originalName: true },
    where: { id: fileId },
  });
  return file?.originalName || fallback;
}

async function saveSupportToolApp(
  session: AppSession,
  payload: JsonRecord,
) {
  assertAppSetupAccess(session);
  const name = text(payload.name);
  if (!name) {
    throw new SupportToolRuntimeError("Vui lòng nhập tên ứng dụng.");
  }
  const rowIndex = numberValue(payload.rowIndex);
  const db = getDb();
  const existing = rowIndex > 1
    ? await db.configurationRecord.findFirst({
        where: { recordType: APP_RECORD_TYPE, sourceRow: rowIndex },
      })
    : null;
  if (rowIndex > 1 && !existing) {
    throw new SupportToolRuntimeError(
      "Không tìm thấy ứng dụng cần cập nhật.",
      404,
    );
  }
  const previous = existing ? appDto(existing) : null;
  const appId = text(payload.appId) || previous?.appId || randomUUID();
  const logoId =
    text(payload.logoFileId || payload.logoId) || previous?.logoId || "";
  if (!logoId) {
    throw new SupportToolRuntimeError(
      "Vui lòng chọn logo ứng dụng để lưu vào kho.",
    );
  }
  const incomingVersions =
    Array.isArray(payload.versions) && payload.versions.length
      ? payload.versions
      : [];
  if (!incomingVersions.length) {
    throw new SupportToolRuntimeError(
      "Vui lòng tạo ít nhất một phiên bản ứng dụng.",
    );
  }
  const previousById = new Map(
    (previous?.versions || []).map((version) => [version.versionId, version]),
  );
  const versions: SupportToolVersion[] = [];
  for (const [index, value] of incomingVersions.entries()) {
    const source = asRecord(value);
    const candidate = normalizeVersion(
      source,
      index,
      previousById.get(text(source.versionId)),
    );
    if (candidate.downloadType === "copy" && !candidate.commandText) {
      throw new SupportToolRuntimeError(
        `Phiên bản “${candidate.versionName}” chưa có nội dung sao chép.`,
      );
    }
    if (candidate.downloadType === "download" && !candidate.fileId) {
      throw new SupportToolRuntimeError(
        `Phiên bản “${candidate.versionName}” chưa có file tải lên.`,
      );
    }
    if (candidate.fileId) {
      candidate.fileName = await resolveFileName(
        candidate.fileId,
        candidate.fileName,
      );
      candidate.fileUrl = fileUrl(candidate.fileId);
      candidate.downloadUrl = fileUrl(candidate.fileId);
    }
    versions.push(candidate);
  }

  const guideImages = Array.isArray(payload.guideImages)
    ? payload.guideImages.map(asRecord)
    : [];
  const guideImageIds = guideImages.length
    ? guideImages.map((item) => text(item.id)).filter(Boolean)
    : previous?.guideImageIds || [];
  const guideImageUrls = guideImageIds.map(fileUrl);
  const status = text(payload.status) || previous?.status || ACTIVE_STATUS;
  const tagNames = uniqueList(payload.tagNames);
  const functionTags = uniqueList(payload.functionTags);
  const content = {
    ...asRecord(existing?.content),
    "Cập nhật bởi": session.displayName,
    "Chức năng": functionTags,
    "Folder ID": text(payload.preparedAppFolderId) || previous?.folderId || `support:${appId}:app`,
    "Folder URL": "",
    "Hướng dẫn sử dụng": text(payload.guideText),
    "ID hình hướng dẫn": guideImageIds,
    "Loại tải mặc định": versions[0]?.downloadTypeLabel || "Download file",
    "Logo ID": logoId,
    "Logo URL": fileUrl(logoId),
    "Mô tả ứng dụng": text(payload.description),
    "Phiên bản JSON": versions,
    "Phòng ban": uniqueList(payload.departments),
    "Tag ứng dụng": tagNames,
    "Tên ứng dụng": name,
    "Trạng thái": status,
    "URL hình hướng dẫn": guideImageUrls,
    "Ứng dụng ID": appId,
    "Loại người dùng": uniqueList(payload.userTypes),
    appId,
    departments: uniqueList(payload.departments),
    description: text(payload.description),
    downloadType: versions[0]?.downloadType || "download",
    folderId: text(payload.preparedAppFolderId) || previous?.folderId || `support:${appId}:app`,
    folderUrl: "",
    functionTags,
    guideImageIds,
    guideImageUrls,
    guideText: text(payload.guideText),
    logoId,
    logoUrl: fileUrl(logoId),
    name,
    note: text(payload.note),
    status,
    tagNames,
    updatedBy: session.displayName,
    userTypes: uniqueList(payload.userTypes),
    versions,
  };
  const saved = existing
    ? await db.configurationRecord.update({
        data: {
          code: appId,
          content: json(content),
          name,
          status,
        },
        where: { id: existing.id },
      })
    : await db.configurationRecord.create({
        data: {
          code: appId,
          content: json(content),
          name,
          recordType: APP_RECORD_TYPE,
          sourceRow: await nextSourceRow(APP_RECORD_TYPE),
          sourceSheet: SOURCE_SHEET,
          status,
        },
      });

  const linkedIds = new Set([
    logoId,
    ...guideImageIds,
    ...versions.map((version) => version.fileId).filter(Boolean),
  ]);
  let sortOrder = 0;
  for (const fileObjectId of linkedIds) {
    const file = await db.fileObject.findUnique({
      select: { id: true },
      where: { id: fileObjectId },
    });
    if (!file) continue;
    await linkFileToEntity(db, {
      entityId: appId,
      entityType: "SUPPORT_TOOL_APP",
      fileObjectId,
      purpose:
        fileObjectId === logoId
          ? "LOGO"
          : guideImageIds.includes(fileObjectId)
            ? `GUIDE_${guideImageIds.indexOf(fileObjectId) + 1}`
            : `VERSION_${sortOrder + 1}`,
      sortOrder,
    });
    sortOrder += 1;
  }

  if (!saved) {
    throw new SupportToolRuntimeError("Không lưu được ứng dụng.", 500);
  }
  return getConfig(true);
}

async function setAppStatus(
  session: AppSession,
  payload: JsonRecord,
  deleted: boolean,
) {
  assertAppSetupAccess(session);
  const rowIndex = numberValue(payload.rowIndex);
  const row = await getDb().configurationRecord.findFirst({
    where: { recordType: APP_RECORD_TYPE, sourceRow: rowIndex },
  });
  if (!row) {
    throw new SupportToolRuntimeError("Không tìm thấy ứng dụng.", 404);
  }
  const status = deleted
    ? INACTIVE_STATUS
    : booleanValue(payload.isActive, !isActiveStatus(row.status))
      ? ACTIVE_STATUS
      : INACTIVE_STATUS;
  await getDb().configurationRecord.update({
    data: {
      content: json({
        ...asRecord(row.content),
        "Cập nhật bởi": session.displayName,
        "Ghi chú": deleted
          ? `Đã xóa bởi ${session.displayName}.`
          : text(first(asRecord(row.content), "note", "Ghi chú")),
        "Trạng thái": status,
        note: deleted
          ? `Đã xóa bởi ${session.displayName}.`
          : text(first(asRecord(row.content), "note", "Ghi chú")),
        status,
        updatedBy: session.displayName,
      }),
      status,
    },
    where: { id: row.id },
  });
  return getConfig(true);
}

async function fileBuffer(fileId: string) {
  const file = await getDb().fileObject.findUnique({ where: { id: fileId } });
  if (!file || file.provider !== "GCS" || !file.bucket) {
    throw new SupportToolRuntimeError(
      "File cũ chưa được chuyển vào GCS. Vui lòng nạp lại file tại Setup ứng dụng.",
    );
  }
  const [buffer] = await requestAttachmentStorage()
    .bucket(file.bucket)
    .file(file.objectKey)
    .download();
  return { buffer, file };
}

async function createSupportToolDownload(
  session: AppSession,
  payload: JsonRecord,
) {
  assertSupportToolsAccess(session);
  const selections = Array.isArray(payload.selections)
    ? payload.selections.map(asRecord)
    : [];
  if (!selections.length) {
    throw new SupportToolRuntimeError(
      "Vui lòng chọn ít nhất một ứng dụng để tải.",
    );
  }
  const config = await getConfig(false);
  const apps = new Map(config.apps.map((app) => [app.appId, app]));
  if (selections.length === 1) {
    const selection = selections[0];
    const app = apps.get(text(selection.appId));
    const version = app?.versions.find(
      (item) =>
        !text(selection.versionId) ||
        item.versionId === text(selection.versionId),
    ) || app?.latestVersion;
    if (
      app?.appId === RFID_SCANNER_SUPPORT_APP_ID &&
      version?.fileId &&
      version.fileName.toLocaleLowerCase("vi").endsWith(".apk")
    ) {
      return {
        commandText: "",
        downloadUrl: version.fileUrl,
        fileId: version.fileId,
        fileName: version.fileName,
        fileUrl: version.fileUrl,
        launchUrl: "rfidscanner://update",
        ok: true,
      };
    }
  }
  const zip = new JSZip();
  const commands: string[] = [];

  for (const selection of selections) {
    const app = apps.get(text(selection.appId));
    if (!app) continue;
    const version =
      app.versions.find(
        (item) => !text(selection.versionId) || item.versionId === text(selection.versionId),
      ) ||
      app.latestVersion;
    if (!version) continue;
    const prefix = safeFileName(`${app.name} - ${version.versionName}`);
    if (version.downloadType === "copy") {
      commands.push(`${app.name} ${version.versionName}\n${version.commandText}`);
      zip.file(`${prefix}.txt`, version.commandText);
      continue;
    }
    if (!version.fileId) {
      throw new SupportToolRuntimeError(
        `Ứng dụng “${app.name}” chưa có file để tải.`,
      );
    }
    const stored = await fileBuffer(version.fileId);
    zip.file(
      `${prefix} - ${safeFileName(version.fileName || stored.file.originalName)}`,
      stored.buffer,
    );
  }
  if (!Object.keys(zip.files).length) {
    throw new SupportToolRuntimeError(
      "Không có file hoặc lệnh nào để đóng gói.",
    );
  }
  const output = await zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    type: "nodebuffer",
  });
  const now = new Date();
  const zipName = safeFileName(
    `${session.displayName || "Người dùng"} - Kho ứng dụng - ${now
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 12)}.zip`,
  );
  const bucket = text(process.env.ACCOUNTING_EXPORT_BUCKET);
  if (!bucket) {
    throw new SupportToolRuntimeError(
      "Kho file GCS của Cổng vận hành chưa được cấu hình.",
      500,
    );
  }
  const objectKey = `support-tools/downloads/${now.getUTCFullYear()}/${randomUUID()}-${zipName}`;
  await requestAttachmentStorage().bucket(bucket).file(objectKey).save(output, {
    contentType: "application/zip",
    metadata: { cacheControl: "private, no-store, max-age=0" },
    resumable: false,
    validation: "crc32c",
  });
  const file = await registerFileMetadata(getDb(), {
    metadata: { source: "SUPPORT_TOOL_DOWNLOAD" },
    mimeType: "application/zip",
    object: { bucket, objectKey, provider: "GCS" },
    originalName: zipName,
    ownerId: session.userId,
    sha256: createHash("sha256").update(output).digest("hex"),
    sizeBytes: BigInt(output.length),
  });
  await linkFileToEntity(getDb(), {
    entityId: session.userId,
    entityType: "SUPPORT_TOOL_DOWNLOAD",
    fileObjectId: file.id,
    purpose: "ZIP",
  });
  return {
    commandText: commands.join("\n\n---\n\n"),
    downloadUrl: fileUrl(file.id),
    expiresNote:
      "Gói tải được lưu riêng tư trong GCS và chỉ người tạo hoặc quản trị viên được mở.",
    fileId: file.id,
    fileName: zipName,
    fileUrl: fileUrl(file.id),
    ok: true,
  };
}

export async function storeSupportToolUpload(
  session: AppSession,
  input: {
    file: File;
    fileName?: string;
    folderId?: string;
  },
) {
  assertAppSetupAccess(session);
  if (!input.file || input.file.size <= 0) {
    throw new SupportToolRuntimeError("Chưa có file để tải lên.");
  }
  if (input.file.size > MAX_UPLOAD_BYTES) {
    throw new SupportToolRuntimeError(
      `File “${input.file.name}” vượt giới hạn 30 MB.`,
      413,
    );
  }
  const bucket = text(process.env.ACCOUNTING_EXPORT_BUCKET);
  if (!bucket) {
    throw new SupportToolRuntimeError(
      "Kho file GCS của Cổng vận hành chưa được cấu hình.",
      500,
    );
  }
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const name = safeFileName(input.fileName || input.file.name);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const now = new Date();
  const objectKey = [
    "support-tools",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}-${name}`,
  ].join("/");
  await requestAttachmentStorage().bucket(bucket).file(objectKey).save(buffer, {
    contentType: input.file.type || "application/octet-stream",
    metadata: {
      cacheControl: "private, no-store, max-age=0",
      metadata: {
        folderId: text(input.folderId),
        sha256,
        uploadedById: session.userId,
      },
    },
    resumable: false,
    validation: "crc32c",
  });
  const file = await registerFileMetadata(getDb(), {
    metadata: {
      folderId: text(input.folderId),
      source: "SUPPORT_TOOL_UPLOAD",
    },
    mimeType: input.file.type || "application/octet-stream",
    object: { bucket, objectKey, provider: "GCS" },
    originalName: name,
    ownerId: session.userId,
    sha256,
    sizeBytes: BigInt(buffer.length),
  });
  const folderParts = text(input.folderId).split(":");
  const appId = folderParts[0] === "support" ? folderParts[1] : "";
  if (appId) {
    await linkFileToEntity(getDb(), {
      entityId: appId,
      entityType: "SUPPORT_TOOL_APP",
      fileObjectId: file.id,
      purpose: `STAGED_${folderParts.slice(2).join("_").toUpperCase() || "FILE"}`,
    });
  }
  const url = fileUrl(file.id);
  return {
    id: file.id,
    mimeType: input.file.type || "application/octet-stream",
    name,
    webContentLink: url,
    webViewLink: url,
  };
}

export async function dispatchSupportToolRpc(
  session: AppSession,
  method: string,
  payload: JsonRecord,
) {
  switch (method) {
    case "getSupportToolSetupConfig":
      return getSupportToolSetupConfig(session);
    case "getSupportToolPortal":
      return getSupportToolPortal(session);
    case "saveSupportToolEnvironment":
      return saveSupportToolEnvironment(session, payload);
    case "saveSupportToolTag":
      return saveSupportToolTag(session, payload);
    case "deleteSupportToolTag":
      return deleteSupportToolTag(session, payload);
    case "prepareSupportToolAppUpload":
      return prepareSupportToolAppUpload(session, payload);
    case "saveSupportToolApp":
      return saveSupportToolApp(session, payload);
    case "toggleSupportToolAppStatus":
      return setAppStatus(session, payload, false);
    case "deleteSupportToolApp":
      return setAppStatus(session, payload, true);
    case "createSupportToolDownload":
      return createSupportToolDownload(session, payload);
    default:
      throw new SupportToolRuntimeError(
        `Phương thức “${method}” chưa được hỗ trợ.`,
        404,
      );
  }
}
