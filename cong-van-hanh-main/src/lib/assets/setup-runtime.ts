import "server-only";

import {
  createHash,
  randomInt,
  randomUUID,
} from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getModuleConfigSecret } from "@/lib/config/global-config";
import { getDb } from "@/lib/db";
import { requestAttachmentStorage } from "@/lib/requests/attachments";
import {
  linkFileToEntity,
  registerFileMetadata,
} from "@/lib/storage";

import {
  ASSET_OPTION_KINDS,
  normalizeUniformSize,
  UNIFORM_SIZE_OPTIONS,
  type AssetBackgroundJobDto,
  type AssetBackgroundJobStatus,
  type AssetCatalogItemDto,
  type AssetColor,
  type AssetDescriptorGroup,
  type AssetDraftInput,
  type AssetImageDto,
  type AssetInvoiceSuggestion,
  type AssetOptionDto,
  type AssetOptionKind,
  type AssetSetupSnapshot,
  type StationeryDraftInput,
  type StationeryItemDto,
  type UniformDraftInput,
  type UniformItemDto,
} from "./setup-types";

const PATH = "/cau-hinh/setup-tai-san";
const NATIVE_SOURCE = "POSTGRESQL:setup-tai-san";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;
const ACTIVE_STATUS = "Kích hoạt";
const DELETED_STATUS = "Đã xóa";

const ENTITY_TYPE = {
  asset: "ASSET_CATALOG",
  backgroundJob: "ASSET_BACKGROUND_JOB",
  stationery: "STATIONERY_ITEM",
  uniform: "UNIFORM_ITEM",
} as const;

const RECORD_TYPE = {
  asset: "asset-catalog",
  stationery: "stationery",
  uniform: "uniform",
} as const;

type CatalogKind = keyof typeof RECORD_TYPE;
type JsonRecord = Record<string, unknown>;
type StoredImage = {
  bucket: string;
  fileId: string;
  mimeType: string;
  name: string;
  objectKey: string;
  url: string;
};

export class AssetSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetSetupError";
  }
}

export function canAccessAssetSetup(session: AppSession) {
  return (
    session.fullAccess ||
    session.modules.includes("asset-setup") ||
    session.roles.includes("admin")
  );
}

export function assertAssetSetupAccess(session: AppSession) {
  if (!canAccessAssetSetup(session)) {
    throw new AssetSetupError("Ông chưa có quyền thao tác Setup tài sản.");
  }
}

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function normalizedKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueTexts(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : text(value)
        .split(/[,\n;|]+/)
        .map((item) => item.trim());
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of source) {
    const name =
      typeof item === "object" && item
        ? text((item as JsonRecord).name || (item as JsonRecord).label)
        : text(item);
    const key = normalizedKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function parseJson(value: unknown, fallback: unknown) {
  if (typeof value !== "string") return value ?? fallback;
  const raw = value.trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function numberText(value: unknown) {
  if (value == null || value === "") return "";
  return String(value).trim();
}

function activeStatus(value: unknown) {
  const key = normalizedKey(value);
  return !(
    key.includes("da xoa") ||
    key === "inactive" ||
    key.includes("vo hieu") ||
    key === "archived"
  );
}

function optionKind(value: unknown): AssetOptionKind | "" {
  const key = normalizedKey(value);
  if (key === "assettype" || key.includes("loai ccdc")) return "assetType";
  if (
    key === "functionarea" ||
    key.includes("cong nang") ||
    key.includes("khu vuc")
  ) {
    return "functionArea";
  }
  if (
    key === "shape" ||
    key.includes("dac diem") ||
    key.includes("hinh dang")
  ) {
    return "shape";
  }
  if (key === "fillerphrase" || key.includes("cum tu dem")) {
    return "fillerPhrase";
  }
  if (key === "material" || key.includes("chat lieu")) return "material";
  if (key === "color" || key.includes("mau sac")) return "color";
  return "";
}

function kindLabel(kind: AssetOptionKind) {
  return ASSET_OPTION_KINDS.find((item) => item.key === kind)?.label ?? kind;
}

function normalizeColors(value: unknown, fallbackHexes?: unknown): AssetColor[] {
  if (Array.isArray(value)) {
    const result: AssetColor[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const record = asRecord(item);
      const name = text(record.name || record.label || item);
      const key = normalizedKey(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      result.push({
        colorHex: text(record.colorHex || record.hex),
        name,
      });
    }
    return result;
  }
  const names = uniqueTexts(value);
  const hexes = uniqueTexts(fallbackHexes);
  return names.map((name, index) => ({
    colorHex: hexes[index] ?? "",
    name,
  }));
}

function normalizeDescriptorGroups(
  value: unknown,
  content?: JsonRecord,
): AssetDescriptorGroup[] {
  const parsedSource = parseJson(value, []);
  const source: unknown[] = Array.isArray(parsedSource) ? parsedSource : [];
  let groups: AssetDescriptorGroup[] = source
    .map((item: unknown) => {
      const group = asRecord(item);
      return {
        colors: normalizeColors(group.colors || group.color),
        fillerPhrases: uniqueTexts(
          group.fillerPhrases || group.fillerPhrase,
        ),
        materials: uniqueTexts(group.materials || group.material),
        shapes: uniqueTexts(
          group.shapes || group.shape || group.model || group.specification,
        ),
      };
    })
    .filter(
      (group: AssetDescriptorGroup) =>
        group.colors.length ||
        group.fillerPhrases.length ||
        group.materials.length ||
        group.shapes.length,
    );
  if (!groups.length && content) {
    const fallback = {
      colors: normalizeColors(content["Màu sắc"], content["Mã màu"]),
      fillerPhrases: uniqueTexts(content["Cụm từ đệm"]),
      materials: uniqueTexts(content["Chất liệu"]),
      shapes: uniqueTexts(content["Đặc điểm/ hình dạng"]),
    };
    if (
      fallback.colors.length ||
      fallback.fillerPhrases.length ||
      fallback.materials.length ||
      fallback.shapes.length
    ) {
      groups = [fallback];
    }
  }
  return groups;
}

function imageFromContent(
  content: JsonRecord,
  fallbackName = "",
): AssetImageDto {
  const fileId = text(
    content.imageFileId ||
      content.processedFileId ||
      content["FileObject ID"],
  );
  const legacyDriveId = text(
    content.imageDriveId || content["ID hình"] || content["Ảnh xử lý ID"],
  );
  const legacyUrl = text(
    content.imageUrl ||
      content.processedImageUrl ||
      content["URL hình"] ||
      content["Ảnh xử lý URL"],
  );
  return {
    fileId,
    legacyDriveId,
    name: text(
      content.imageName ||
        content.processedFileName ||
        content["Tên file hình"] ||
        content["Tên ảnh xử lý"] ||
        fallbackName,
    ),
    url: fileId
      ? `/api/assets/files/${encodeURIComponent(fileId)}`
      : legacyDriveId
        ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(
            legacyDriveId,
          )}&sz=w900`
        : legacyUrl,
  };
}

function originalImageFromContent(content: JsonRecord): AssetImageDto {
  const fileId = text(content.originalFileId);
  const legacyDriveId = text(content["Ảnh gốc ID"]);
  const legacyUrl = text(content["Ảnh gốc URL"]);
  return {
    fileId,
    legacyDriveId,
    name: text(content.originalFileName || content["Tên ảnh gốc"]),
    url: fileId
      ? `/api/assets/files/${encodeURIComponent(fileId)}`
      : legacyDriveId
        ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(
            legacyDriveId,
          )}&sz=w900`
        : legacyUrl,
  };
}

function recordUpdatedAt(row: {
  content: unknown;
  updatedAt: Date;
}) {
  const content = asRecord(row.content);
  return (
    text(content.updatedAt || content["Cập nhật lúc"]) ||
    row.updatedAt.toISOString()
  );
}

function toOption(
  row: {
    content: unknown;
    id: string;
    name: string | null;
    status: string | null;
    updatedAt: Date;
  },
): AssetOptionDto | null {
  const content = asRecord(row.content);
  const kind = optionKind(
    content.kind || content.group || content["Nhóm cấu hình"],
  );
  const name = text(row.name || content.name || content["Tên"]);
  if (!kind || !name || !activeStatus(row.status || content["Trạng thái"])) {
    return null;
  }
  return {
    colorHex: text(content.colorHex || content["Mã màu"]),
    id: row.id,
    kind,
    kindLabel: kindLabel(kind),
    name,
    status: text(row.status || content["Trạng thái"]) || ACTIVE_STATUS,
    updatedAt: recordUpdatedAt(row),
    updatedBy: text(content.updatedBy || content["Người cập nhật"]),
  };
}

function toAsset(
  row: {
    code: string | null;
    content: unknown;
    id: string;
    name: string | null;
    status: string | null;
    updatedAt: Date;
  },
): AssetCatalogItemDto | null {
  const content = asRecord(row.content);
  if (!activeStatus(row.status || content["Trạng thái"])) return null;
  const name = text(row.name || content.name || content["Tên tài sản"]);
  if (!name) return null;
  return {
    assetType: text(content.assetType || content["Loại CCDC"]),
    code: text(row.code || content["Asset ID"]),
    depreciationPeriod: numberText(
      content.depreciationPeriod || content["Thời gian khấu hao"],
    ),
    descriptorGroups: normalizeDescriptorGroups(
      content.descriptorGroups || content["Bộ mô tả"],
      content,
    ),
    functionAreas: uniqueTexts(
      content.functionAreas || content["Công năng/ Khu vực bố trí"],
    ),
    heightCm: numberText(content.heightCm || content["Chiều cao cm"]),
    id: row.id,
    image: imageFromContent(content, name),
    lengthCm: numberText(content.lengthCm || content["Chiều dài cm"]),
    name,
    note: text(content.note || content["Ghi chú"]),
    productValue: numberText(
      content.productValue || content["Giá trị sản phẩm"],
    ),
    status: text(row.status || content["Trạng thái"]) || ACTIVE_STATUS,
    updatedAt: recordUpdatedAt(row),
    updatedBy: text(content.updatedBy || content["Người cập nhật"]),
    warrantyPeriod: numberText(
      content.warrantyPeriod || content["Thời gian bảo hành"],
    ),
    widthCm: numberText(content.widthCm || content["Chiều rộng cm"]),
  };
}

function toStationery(
  row: {
    code: string | null;
    content: unknown;
    id: string;
    name: string | null;
    status: string | null;
    updatedAt: Date;
  },
): StationeryItemDto | null {
  const content = asRecord(row.content);
  if (!activeStatus(row.status || content["Trạng thái"])) return null;
  const name = text(row.name || content.name || content["Tên VPP"]);
  if (!name) return null;
  const packageQuantity = numberText(
    content.packageQuantity || content["Số lượng đóng gói"],
  );
  const packageUnit = text(content.packageUnit || content["Đơn vị tính"]);
  return {
    code: text(row.code || content["Stationery ID"]),
    color: text(content.color || content["Màu sắc"]),
    id: row.id,
    image: imageFromContent(content, name),
    name,
    note: text(content.note || content["Ghi chú"]),
    packageLabel:
      text(content.packageLabel || content["Quy cách đóng gói"]) ||
      [packageQuantity, packageUnit].filter(Boolean).join(" "),
    packageQuantity,
    packageUnit,
    status: text(row.status || content["Trạng thái"]) || ACTIVE_STATUS,
    thickness: text(content.thickness || content["Tính chất"]),
    updatedAt: recordUpdatedAt(row),
    updatedBy: text(content.updatedBy || content["Người cập nhật"]),
  };
}

function allowedUniformSizes(value: unknown) {
  return uniqueTexts(value)
    // Tương thích dữ liệu đã lưu trước khi XS/S được sửa từ nhãn cũ SX/X.
    .map(normalizeUniformSize)
    .filter(Boolean);
}

function toUniform(
  row: {
    code: string | null;
    content: unknown;
    id: string;
    name: string | null;
    status: string | null;
    updatedAt: Date;
  },
): UniformItemDto | null {
  const content = asRecord(row.content);
  if (!activeStatus(row.status || content["Trạng thái"])) return null;
  const name = text(row.name || content.name || content["Tên đồng phục"]);
  if (!name) return null;
  return {
    code: text(row.code || content["Uniform ID"]),
    femaleSizes: allowedUniformSizes(
      content.femaleSizes || content["Size nữ"],
    ),
    id: row.id,
    image: imageFromContent(content, name),
    maleSizes: allowedUniformSizes(content.maleSizes || content["Size nam"]),
    name,
    note: text(content.note || content["Ghi chú"]),
    status: text(row.status || content["Trạng thái"]) || ACTIVE_STATUS,
    updatedAt: recordUpdatedAt(row),
    updatedBy: text(content.updatedBy || content["Người cập nhật"]),
  };
}

function jobStatus(value: unknown): AssetBackgroundJobStatus {
  const key = normalizedKey(value);
  if (key === "processing" || key.includes("dang xu ly")) return "processing";
  if (
    key === "done" ||
    key.includes("da xu ly") ||
    key.includes("hoan tat")
  ) {
    return "done";
  }
  if (key === "failed" || key.includes("loi")) return "failed";
  return "queued";
}

function jobItemType(
  value: unknown,
): AssetBackgroundJobDto["itemType"] {
  const key = normalizedKey(value);
  if (key.includes("stationery") || key.includes("van phong")) {
    return "stationery";
  }
  if (key.includes("uniform") || key.includes("dong phuc")) return "uniform";
  return "asset";
}

function toBackgroundJob(
  row: {
    content: unknown;
    createdAt: Date;
    id: string;
    name: string | null;
    status: string | null;
    updatedAt: Date;
  },
): AssetBackgroundJobDto | null {
  const content = asRecord(row.content);
  const group = normalizedKey(
    content.group || content["Nhóm cấu hình"] || content.kind,
  );
  if (group !== "asset background job") return null;
  const status = jobStatus(
    content.jobStatus || content["Trạng thái tác vụ"] || row.status,
  );
  return {
    attempts: Number(content.attempts || content["Số lần thử"] || 0) || 0,
    completedAt: text(content.completedAt || content["Hoàn tất xử lý"]),
    createdAt:
      text(content.createdAt || content["Ngày tạo"]) ||
      row.createdAt.toISOString(),
    id: row.id,
    itemName: text(row.name || content.itemName || content["Tên"]),
    itemType: jobItemType(content.itemType || content["Loại tác vụ"]),
    message: text(content.message || content["Thông báo tác vụ"]),
    originalImage: originalImageFromContent(content),
    processedImage: imageFromContent(content),
    progress: Math.max(
      0,
      Math.min(100, Number(content.progress || content["Tiến trình"] || 0)),
    ),
    startedAt: text(content.startedAt || content["Bắt đầu xử lý"]),
    status,
    updatedAt: recordUpdatedAt(row),
  };
}

async function environmentSnapshot(db: PrismaClient) {
  const keys = [
    "assetSetup.backgroundWorkerUrl",
    "ai.geminiModel",
    "assetSetup.rootFolderId",
    "assetSetup.imageFolderId",
    "assetSetup.stationeryFolderId",
    "assetSetup.uniformFolderId",
  ];
  const rows = await db.systemSetting.findMany({
    select: { key: true, value: true },
    where: { key: { in: keys } },
  });
  const settings = new Map(rows.map((row) => [row.key, text(row.value)]));
  const geminiApiKey = await getModuleConfigSecret("ai.geminiApiKey");
  return {
    geminiConfigured: Boolean(geminiApiKey),
    geminiModel:
      settings.get("ai.geminiModel")?.replace(/^models\//i, "") ||
      "gemini-2.5-flash",
    gcsConfigured: Boolean(text(process.env.ACCOUNTING_EXPORT_BUCKET)),
    imageFolderConfigured: Boolean(
      settings.get("assetSetup.imageFolderId") ||
        "1AfisZ1aUBkf3aUhSlx5u8errWsiRf63x",
    ),
    rootFolderConfigured: Boolean(
      settings.get("assetSetup.rootFolderId") ||
        "1OofWQmQGQIFfFXs-tn1zEtX0SX_RCxiD",
    ),
    stationeryFolderConfigured: Boolean(
      settings.get("assetSetup.stationeryFolderId"),
    ),
    uniformFolderConfigured: Boolean(
      settings.get("assetSetup.uniformFolderId"),
    ),
    workerConfigured: Boolean(
      settings.get("assetSetup.backgroundWorkerUrl"),
    ),
  };
}

export async function getAssetSetupSnapshot(): Promise<AssetSetupSnapshot> {
  const db = getDb();
  const [rows, environment] = await Promise.all([
    db.configurationRecord.findMany({
      orderBy: [{ updatedAt: "desc" }, { sourceRow: "desc" }],
      where: {
        recordType: {
          in: [
            "asset-setup",
            RECORD_TYPE.asset,
            RECORD_TYPE.stationery,
            RECORD_TYPE.uniform,
          ],
        },
      },
    }),
    environmentSnapshot(db),
  ]);

  const options: AssetOptionDto[] = [];
  const assets: AssetCatalogItemDto[] = [];
  const stationeryItems: StationeryItemDto[] = [];
  const uniformItems: UniformItemDto[] = [];
  const backgroundJobs: AssetBackgroundJobDto[] = [];

  for (const row of rows) {
    if (row.recordType === "asset-setup") {
      const job = toBackgroundJob(row);
      if (job) {
        backgroundJobs.push(job);
        continue;
      }
      const option = toOption(row);
      if (option) options.push(option);
      continue;
    }
    if (row.recordType === RECORD_TYPE.asset) {
      const item = toAsset(row);
      if (item) assets.push(item);
    } else if (row.recordType === RECORD_TYPE.stationery) {
      const item = toStationery(row);
      if (item) stationeryItems.push(item);
    } else if (row.recordType === RECORD_TYPE.uniform) {
      const item = toUniform(row);
      if (item) uniformItems.push(item);
    }
  }

  const sortByName = <T extends { name: string }>(left: T, right: T) =>
    left.name.localeCompare(right.name, "vi");
  options.sort((left, right) => {
    const kindOrder =
      ASSET_OPTION_KINDS.findIndex((item) => item.key === left.kind) -
      ASSET_OPTION_KINDS.findIndex((item) => item.key === right.kind);
    return kindOrder || sortByName(left, right);
  });
  assets.sort(sortByName);
  stationeryItems.sort(sortByName);
  uniformItems.sort(sortByName);
  backgroundJobs.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );

  return {
    assets,
    backgroundJobs: backgroundJobs.slice(0, 40),
    environment,
    optionKinds: ASSET_OPTION_KINDS,
    options,
    stationeryItems,
    uniformItems,
    uniformSizeOptions: UNIFORM_SIZE_OPTIONS,
  };
}

async function createConfigurationRecord(
  db: PrismaClient,
  input: {
    code?: string;
    content: unknown;
    name: string;
    recordType: string;
    status?: string;
  },
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.configurationRecord.create({
        data: {
          code: input.code || randomUUID(),
          content: asJson(input.content),
          name: input.name,
          recordType: input.recordType,
          sourceRow: randomInt(1_000_000_000, 2_000_000_000),
          sourceSheet: NATIVE_SOURCE,
          status: input.status ?? ACTIVE_STATUS,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        attempt < 4
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new AssetSetupError("Không cấp được mã dòng PostgreSQL.");
}

async function writeAudit(
  db: PrismaClient,
  session: AppSession,
  input: {
    action: "ARCHIVE" | "CREATE" | "SYNC" | "UPDATE";
    metadata?: unknown;
    summary: string;
    targetId: string;
    targetType: string;
  },
) {
  await db.auditLog.create({
    data: {
      action: input.action,
      actorId: session.userId,
      metadata: asJson(input.metadata),
      summary: input.summary,
      targetId: input.targetId,
      targetType: input.targetType,
    },
  });
}

export async function saveAssetOption(
  session: AppSession,
  input: {
    colorHex?: string;
    kind: AssetOptionKind;
    name: string;
  },
) {
  assertAssetSetupAccess(session);
  if (!ASSET_OPTION_KINDS.some((item) => item.key === input.kind)) {
    throw new AssetSetupError("Nhóm tùy chọn không hợp lệ.");
  }
  const name = text(input.name);
  if (!name) throw new AssetSetupError("Vui lòng nhập tên tùy chọn.");
  const colorHex = text(input.colorHex).toUpperCase();
  if (input.kind === "color" && !/^#[0-9A-F]{6}$/.test(colorHex)) {
    throw new AssetSetupError("Mã màu phải đúng định dạng #RRGGBB.");
  }

  const snapshot = await getAssetSetupSnapshot();
  if (
    snapshot.options.some(
      (option) =>
        option.kind === input.kind &&
        normalizedKey(option.name) === normalizedKey(name),
    )
  ) {
    throw new AssetSetupError(
      `"${name}" đã có trong nhóm ${kindLabel(input.kind)}.`,
    );
  }

  const db = getDb();
  const now = new Date().toISOString();
  const record = await createConfigurationRecord(db, {
    content: {
      colorHex: input.kind === "color" ? colorHex : "",
      kind: input.kind,
      name,
      schemaVersion: 1,
      updatedAt: now,
      updatedBy: session.displayName,
      "Cập nhật lúc": now,
      "Mã màu": input.kind === "color" ? colorHex : "",
      "Người cập nhật": session.displayName,
      "Nhóm cấu hình": kindLabel(input.kind),
      "Tên": name,
      "Trạng thái": ACTIVE_STATUS,
    },
    name,
    recordType: "asset-setup",
  });
  await writeAudit(db, session, {
    action: "CREATE",
    metadata: { colorHex, kind: input.kind },
    summary: `Thêm tùy chọn Setup tài sản: ${kindLabel(input.kind)} · ${name}.`,
    targetId: record.id,
    targetType: "AssetSetupOption",
  });
  return record;
}

export async function archiveAssetRecord(
  session: AppSession,
  input: {
    id: string;
    recordType: "asset-catalog" | "asset-setup" | "stationery" | "uniform";
  },
) {
  assertAssetSetupAccess(session);
  const db = getDb();
  const row = await db.configurationRecord.findFirst({
    where: { id: input.id, recordType: input.recordType },
  });
  if (!row) throw new AssetSetupError("Không tìm thấy bản ghi cần xóa.");
  const content = asRecord(row.content);
  if (
    input.recordType === "asset-setup" &&
    normalizedKey(content["Nhóm cấu hình"]) === "asset background job"
  ) {
    throw new AssetSetupError("Không thể xóa lịch sử hàng đợi tại đây.");
  }
  const now = new Date().toISOString();
  await db.configurationRecord.update({
    data: {
      content: asJson({
        ...content,
        status: DELETED_STATUS,
        updatedAt: now,
        updatedBy: session.displayName,
        "Cập nhật lúc": now,
        "Người cập nhật": session.displayName,
        "Trạng thái": DELETED_STATUS,
      }),
      status: DELETED_STATUS,
    },
    where: { id: row.id },
  });
  await writeAudit(db, session, {
    action: "ARCHIVE",
    metadata: { recordType: input.recordType },
    summary: `Đánh dấu Đã xóa: ${row.name || row.code || row.id}.`,
    targetId: row.id,
    targetType: "ConfigurationRecord",
  });
}

function safeFileName(value: string) {
  return (
    value
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 170) || "hinh-tai-san"
  );
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}

function uploadBucket() {
  const bucket = text(process.env.ACCOUNTING_EXPORT_BUCKET);
  if (!bucket) {
    throw new AssetSetupError(
      "Kho GCS của Cổng vận hành chưa được cấu hình.",
    );
  }
  return bucket;
}

async function storeImageBuffer(
  db: PrismaClient,
  session: AppSession,
  input: {
    baseName: string;
    buffer: Buffer;
    entityId: string;
    entityType: string;
    itemType: string;
    mimeType: string;
    originalName: string;
    purpose?: string;
  },
): Promise<StoredImage> {
  if (!input.mimeType.toLocaleLowerCase().startsWith("image/")) {
    throw new AssetSetupError("Tệp đính kèm phải là hình ảnh.");
  }
  if (!input.buffer.length) {
    throw new AssetSetupError("Hình ảnh không có dữ liệu.");
  }
  if (input.buffer.length > MAX_IMAGE_BYTES) {
    throw new AssetSetupError("Hình ảnh không được vượt quá 8 MB.");
  }
  const bucket = uploadBucket();
  const now = new Date();
  const name = `${safeFileName(input.baseName)}${extensionForMime(
    input.mimeType,
  )}`;
  const objectKey = [
    "assets",
    input.itemType,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}-${name}`,
  ].join("/");
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const storage = requestAttachmentStorage();
  await storage.bucket(bucket).file(objectKey).save(input.buffer, {
    contentType: input.mimeType,
    metadata: {
      cacheControl: "private, no-store, max-age=0",
      metadata: {
        entityId: input.entityId,
        entityType: input.entityType,
        sha256,
        source: "ASSET_SETUP",
        uploadedById: session.userId,
      },
    },
    resumable: false,
    validation: "crc32c",
  });
  try {
    const fileObject = await registerFileMetadata(db, {
      metadata: {
        entityId: input.entityId,
        entityType: input.entityType,
        source: "ASSET_SETUP",
      },
      mimeType: input.mimeType,
      object: { bucket, objectKey, provider: "GCS" },
      originalName: name,
      ownerId: session.userId,
      sha256,
      sizeBytes: BigInt(input.buffer.length),
    });
    await linkFileToEntity(db, {
      entityId: input.entityId,
      entityType: input.entityType,
      fileObjectId: fileObject.id,
      metadata: { sourceName: safeFileName(input.originalName) },
      purpose: input.purpose ?? "IMAGE",
    });
    return {
      bucket,
      fileId: fileObject.id,
      mimeType: input.mimeType,
      name,
      objectKey,
      url: `/api/assets/files/${encodeURIComponent(fileObject.id)}`,
    };
  } catch (error) {
    await storage
      .bucket(bucket)
      .file(objectKey)
      .delete({ ignoreNotFound: true });
    throw error;
  }
}

async function cleanupStoredImage(
  db: PrismaClient,
  image: StoredImage | null,
) {
  if (!image) return;
  await Promise.allSettled([
    requestAttachmentStorage()
      .bucket(image.bucket)
      .file(image.objectKey)
      .delete({ ignoreNotFound: true }),
    db.fileObject.deleteMany({ where: { id: image.fileId } }),
  ]);
}

async function fileToBuffer(file: File) {
  if (!file || file.size <= 0) {
    throw new AssetSetupError("Vui lòng đính kèm hình ảnh.");
  }
  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    mimeType: text(file.type) || "application/octet-stream",
    originalName: file.name,
  };
}

function cleanDescriptorGroups(
  groups: AssetDescriptorGroup[],
): AssetDescriptorGroup[] {
  return normalizeDescriptorGroups(groups);
}

export function buildAssetCatalogName(input: AssetDraftInput) {
  const explicitName = text(input.assetNameOverride);
  if (explicitName) return explicitName;
  const parts: string[] = [];
  const dimensions: string[] = [];
  if (text(input.assetType)) parts.push(text(input.assetType));
  parts.push(...uniqueTexts(input.functionAreas));
  for (const group of cleanDescriptorGroups(input.descriptorGroups)) {
    parts.push(...group.shapes);
    parts.push(...group.fillerPhrases);
    parts.push(...group.materials);
    parts.push(...group.colors.map((color) => color.name));
  }
  for (const value of [input.lengthCm, input.widthCm, input.heightCm]) {
    if (text(value)) dimensions.push(text(value));
  }
  if (dimensions.length) parts.push(`(${dimensions.join(" x ")} cm)`);
  const raw = parts.filter(Boolean).join(" ").trim().toLocaleLowerCase("vi");
  return raw
    ? `${raw.charAt(0).toLocaleUpperCase("vi")}${raw.slice(1)}`
    : "";
}

function normalizeAssetDraft(input: AssetDraftInput): AssetDraftInput {
  const result = {
    assetNameOverride: text(input.assetNameOverride),
    assetType: text(input.assetType),
    depreciationPeriod: text(input.depreciationPeriod),
    descriptorGroups: cleanDescriptorGroups(input.descriptorGroups),
    functionAreas: uniqueTexts(input.functionAreas),
    heightCm: text(input.heightCm),
    lengthCm: text(input.lengthCm),
    note: text(input.note),
    productValue: text(input.productValue),
    warrantyPeriod: text(input.warrantyPeriod),
    widthCm: text(input.widthCm),
  };
  if (!result.assetType) {
    throw new AssetSetupError("Vui lòng chọn Loại CCDC/tài sản.");
  }
  if (!buildAssetCatalogName(result)) {
    throw new AssetSetupError("Chưa đủ thông tin để sinh tên tài sản.");
  }
  return result;
}

function assetContent(
  input: AssetDraftInput,
  image: StoredImage,
  session: AppSession,
  code: string,
) {
  const name = buildAssetCatalogName(input);
  const colors = input.descriptorGroups.flatMap((group) => group.colors);
  const shapes = input.descriptorGroups.flatMap((group) => group.shapes);
  const fillerPhrases = input.descriptorGroups.flatMap(
    (group) => group.fillerPhrases,
  );
  const materials = input.descriptorGroups.flatMap(
    (group) => group.materials,
  );
  const now = new Date().toISOString();
  return {
    ...input,
    imageFileId: image.fileId,
    imageName: image.name,
    imageUrl: image.url,
    name,
    schemaVersion: 1,
    updatedAt: now,
    updatedBy: session.displayName,
    "Asset ID": code,
    "Bộ mô tả": JSON.stringify(input.descriptorGroups),
    "Chất liệu": materials.join(", "),
    "Chiều cao cm": input.heightCm,
    "Chiều dài cm": input.lengthCm,
    "Chiều rộng cm": input.widthCm,
    "Công năng/ Khu vực bố trí": input.functionAreas.join(", "),
    "Cụm từ đệm": fillerPhrases.join(", "),
    "Cập nhật lúc": now,
    "Ghi chú": input.note,
    "Giá trị sản phẩm": input.productValue,
    "ID hình": "",
    "Màu sắc": colors.map((color) => color.name).join(", "),
    "Mã màu": colors.map((color) => color.colorHex).filter(Boolean).join(", "),
    "Người cập nhật": session.displayName,
    "Thời gian bảo hành": input.warrantyPeriod,
    "Thời gian khấu hao": input.depreciationPeriod,
    "Tên file hình": image.name,
    "Tên tài sản": name,
    "Trạng thái": ACTIVE_STATUS,
    "URL hình": image.url,
    "Đặc điểm/ hình dạng": shapes.join(", "),
  };
}

async function createAssetFromBuffer(
  session: AppSession,
  input: AssetDraftInput,
  imageInput: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
  },
) {
  const db = getDb();
  const normalized = normalizeAssetDraft(input);
  const name = buildAssetCatalogName(normalized);
  const code = randomUUID();
  const record = await createConfigurationRecord(db, {
    code,
    content: {
      schemaVersion: 1,
      updatedBy: session.displayName,
      "Trạng thái": "Đang lưu",
    },
    name,
    recordType: RECORD_TYPE.asset,
    status: "Đang lưu",
  });
  let image: StoredImage | null = null;
  try {
    image = await storeImageBuffer(db, session, {
      ...imageInput,
      baseName: name,
      entityId: record.id,
      entityType: ENTITY_TYPE.asset,
      itemType: "asset",
    });
    await db.configurationRecord.update({
      data: {
        content: asJson(assetContent(normalized, image, session, code)),
        status: ACTIVE_STATUS,
      },
      where: { id: record.id },
    });
    return { id: record.id, image, name };
  } catch (error) {
    await cleanupStoredImage(db, image);
    await db.configurationRecord.delete({ where: { id: record.id } });
    throw error;
  }
}

function normalizeStationeryDraft(
  input: StationeryDraftInput,
): StationeryDraftInput {
  const thicknessKey = normalizedKey(input.thickness);
  const thickness =
    thicknessKey === "day"
      ? "Dày"
      : thicknessKey === "mong"
        ? "Mỏng"
        : "";
  if (text(input.thickness) && !thickness) {
    throw new AssetSetupError(
      "Tính chất văn phòng phẩm chỉ chấp nhận Dày hoặc Mỏng.",
    );
  }
  const result = {
    color: text(input.color),
    name: text(input.name),
    note: text(input.note),
    packageQuantity: text(input.packageQuantity),
    packageUnit: text(input.packageUnit),
    thickness,
  };
  if (!result.name) {
    throw new AssetSetupError("Vui lòng nhập tên văn phòng phẩm.");
  }
  return result;
}

async function createStationeryFromBuffer(
  session: AppSession,
  input: StationeryDraftInput,
  imageInput: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
  },
) {
  const db = getDb();
  const normalized = normalizeStationeryDraft(input);
  const code = randomUUID();
  const record = await createConfigurationRecord(db, {
    code,
    content: { "Trạng thái": "Đang lưu" },
    name: normalized.name,
    recordType: RECORD_TYPE.stationery,
    status: "Đang lưu",
  });
  let image: StoredImage | null = null;
  try {
    image = await storeImageBuffer(db, session, {
      ...imageInput,
      baseName: normalized.name,
      entityId: record.id,
      entityType: ENTITY_TYPE.stationery,
      itemType: "stationery",
    });
    const now = new Date().toISOString();
    const packageLabel = [
      normalized.packageQuantity,
      normalized.packageUnit,
    ]
      .filter(Boolean)
      .join(" ");
    await db.configurationRecord.update({
      data: {
        content: asJson({
          ...normalized,
          imageFileId: image.fileId,
          imageName: image.name,
          imageUrl: image.url,
          packageLabel,
          schemaVersion: 1,
          updatedAt: now,
          updatedBy: session.displayName,
          "Cập nhật lúc": now,
          "Ghi chú": normalized.note,
          "ID hình": "",
          "Màu sắc": normalized.color,
          "Người cập nhật": session.displayName,
          "Quy cách đóng gói": packageLabel,
          "Số lượng đóng gói": normalized.packageQuantity,
          "Stationery ID": code,
          "Tên file hình": image.name,
          "Tên VPP": normalized.name,
          "Tính chất": normalized.thickness,
          "Trạng thái": ACTIVE_STATUS,
          "URL hình": image.url,
          "Đơn vị tính": normalized.packageUnit,
        }),
        status: ACTIVE_STATUS,
      },
      where: { id: record.id },
    });
    return { id: record.id, image, name: normalized.name };
  } catch (error) {
    await cleanupStoredImage(db, image);
    await db.configurationRecord.delete({ where: { id: record.id } });
    throw error;
  }
}

function normalizeUniformDraft(input: UniformDraftInput): UniformDraftInput {
  const result = {
    femaleSizes: allowedUniformSizes(input.femaleSizes),
    maleSizes: allowedUniformSizes(input.maleSizes),
    name: text(input.name),
    note: text(input.note),
  };
  if (!result.name) {
    throw new AssetSetupError("Vui lòng nhập tên đồng phục.");
  }
  return result;
}

async function createUniformFromBuffer(
  session: AppSession,
  input: UniformDraftInput,
  imageInput: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
  },
) {
  const db = getDb();
  const normalized = normalizeUniformDraft(input);
  const code = randomUUID();
  const record = await createConfigurationRecord(db, {
    code,
    content: { "Trạng thái": "Đang lưu" },
    name: normalized.name,
    recordType: RECORD_TYPE.uniform,
    status: "Đang lưu",
  });
  let image: StoredImage | null = null;
  try {
    image = await storeImageBuffer(db, session, {
      ...imageInput,
      baseName: normalized.name,
      entityId: record.id,
      entityType: ENTITY_TYPE.uniform,
      itemType: "uniform",
    });
    const now = new Date().toISOString();
    await db.configurationRecord.update({
      data: {
        content: asJson({
          ...normalized,
          imageFileId: image.fileId,
          imageName: image.name,
          imageUrl: image.url,
          schemaVersion: 1,
          updatedAt: now,
          updatedBy: session.displayName,
          "Cập nhật lúc": now,
          "Ghi chú": normalized.note,
          "ID hình": "",
          "Người cập nhật": session.displayName,
          "Size nam": normalized.maleSizes.join(", "),
          "Size nữ": normalized.femaleSizes.join(", "),
          "Tên file hình": image.name,
          "Tên đồng phục": normalized.name,
          "Trạng thái": ACTIVE_STATUS,
          "URL hình": image.url,
          "Uniform ID": code,
        }),
        status: ACTIVE_STATUS,
      },
      where: { id: record.id },
    });
    return { id: record.id, image, name: normalized.name };
  } catch (error) {
    await cleanupStoredImage(db, image);
    await db.configurationRecord.delete({ where: { id: record.id } });
    throw error;
  }
}

function catalogItemName(
  kind: CatalogKind,
  input: AssetDraftInput | StationeryDraftInput | UniformDraftInput,
) {
  return kind === "asset"
    ? buildAssetCatalogName(input as AssetDraftInput)
    : text((input as StationeryDraftInput | UniformDraftInput).name);
}

async function enqueueBackgroundJob(
  session: AppSession,
  kind: CatalogKind,
  input: AssetDraftInput | StationeryDraftInput | UniformDraftInput,
  file: File,
) {
  const db = getDb();
  const imageInput = await fileToBuffer(file);
  const name = catalogItemName(kind, input);
  const now = new Date().toISOString();
  const job = await createConfigurationRecord(db, {
    content: {
      attempts: 0,
      createdAt: now,
      group: "asset-background-job",
      itemType: kind,
      jobStatus: "queued",
      message: "Đã đưa vào hàng đợi xử lý nền.",
      payload: input,
      progress: 10,
      schemaVersion: 1,
      updatedAt: now,
      updatedBy: session.displayName,
      "Loại tác vụ": kind,
      "Ngày tạo": now,
      "Nhóm cấu hình": "asset-background-job",
      "Số lần thử": 0,
      "Thông báo tác vụ": "Đã đưa vào hàng đợi xử lý nền.",
      "Tiến trình": 10,
      "Trạng thái tác vụ": "queued",
    },
    name,
    recordType: "asset-setup",
    status: "Đang chờ xử lý nền",
  });
  let original: StoredImage | null = null;
  try {
    original = await storeImageBuffer(db, session, {
      ...imageInput,
      baseName: `${name} - original`,
      entityId: job.id,
      entityType: ENTITY_TYPE.backgroundJob,
      itemType: "background-original",
      purpose: "ORIGINAL_IMAGE",
    });
    const content = asRecord(job.content);
    await db.configurationRecord.update({
      data: {
        content: asJson({
          ...content,
          originalFileId: original.fileId,
          originalFileName: original.name,
          originalImageUrl: original.url,
          "Tên ảnh gốc": original.name,
          "Ảnh gốc ID": "",
          "Ảnh gốc URL": original.url,
        }),
      },
      where: { id: job.id },
    });
    await writeAudit(db, session, {
      action: "CREATE",
      metadata: { itemType: kind, removeBackground: true },
      summary: `Đưa ${name} vào hàng đợi xử lý nền.`,
      targetId: job.id,
      targetType: "AssetBackgroundJob",
    });
    return { id: job.id, name };
  } catch (error) {
    await cleanupStoredImage(db, original);
    await db.configurationRecord.delete({ where: { id: job.id } });
    throw error;
  }
}

export async function saveAssetCatalogItem(
  session: AppSession,
  input: AssetDraftInput,
  image: File,
  removeBackground: boolean,
) {
  assertAssetSetupAccess(session);
  const normalized = normalizeAssetDraft(input);
  if (removeBackground) {
    return {
      item: await enqueueBackgroundJob(
        session,
        "asset",
        normalized,
        image,
      ),
      queued: true,
    };
  }
  const result = await createAssetFromBuffer(
    session,
    normalized,
    await fileToBuffer(image),
  );
  await writeAudit(getDb(), session, {
    action: "CREATE",
    metadata: { itemType: "asset", removeBackground: false },
    summary: `Thêm CCDC/tài sản: ${result.name}.`,
    targetId: result.id,
    targetType: "AssetCatalog",
  });
  return { item: result, queued: false };
}

export async function saveStationeryItem(
  session: AppSession,
  input: StationeryDraftInput,
  image: File,
  removeBackground: boolean,
) {
  assertAssetSetupAccess(session);
  const normalized = normalizeStationeryDraft(input);
  if (removeBackground) {
    return {
      item: await enqueueBackgroundJob(
        session,
        "stationery",
        normalized,
        image,
      ),
      queued: true,
    };
  }
  const result = await createStationeryFromBuffer(
    session,
    normalized,
    await fileToBuffer(image),
  );
  await writeAudit(getDb(), session, {
    action: "CREATE",
    metadata: { itemType: "stationery", removeBackground: false },
    summary: `Thêm văn phòng phẩm: ${result.name}.`,
    targetId: result.id,
    targetType: "StationeryCatalog",
  });
  return { item: result, queued: false };
}

export async function saveUniformItem(
  session: AppSession,
  input: UniformDraftInput,
  image: File,
  removeBackground: boolean,
) {
  assertAssetSetupAccess(session);
  const normalized = normalizeUniformDraft(input);
  if (removeBackground) {
    return {
      item: await enqueueBackgroundJob(
        session,
        "uniform",
        normalized,
        image,
      ),
      queued: true,
    };
  }
  const result = await createUniformFromBuffer(
    session,
    normalized,
    await fileToBuffer(image),
  );
  await writeAudit(getDb(), session, {
    action: "CREATE",
    metadata: { itemType: "uniform", removeBackground: false },
    summary: `Thêm đồng phục: ${result.name}.`,
    targetId: result.id,
    targetType: "UniformCatalog",
  });
  return { item: result, queued: false };
}

function workerResultBase64(value: unknown) {
  const raw = text(value);
  return raw.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
}

async function processBackgroundJob(
  session: AppSession,
  jobId: string,
) {
  const db = getDb();
  const job = await db.configurationRecord.findFirst({
    where: { id: jobId, recordType: "asset-setup" },
  });
  if (!job) throw new AssetSetupError("Không tìm thấy tác vụ xử lý nền.");
  const originalContent = asRecord(job.content);
  if (
    normalizedKey(
      originalContent.group || originalContent["Nhóm cấu hình"],
    ) !== "asset background job"
  ) {
    throw new AssetSetupError("Bản ghi không phải tác vụ xử lý nền.");
  }
  const originalFileId = text(originalContent.originalFileId);
  if (!originalFileId) {
    throw new AssetSetupError(
      "Tác vụ cũ chưa có ảnh gốc trong GCS nên không thể chạy lại.",
    );
  }
  const fileObject = await db.fileObject.findUnique({
    where: { id: originalFileId },
  });
  if (
    !fileObject ||
    fileObject.provider !== "GCS" ||
    !fileObject.bucket
  ) {
    throw new AssetSetupError("Không tìm thấy ảnh gốc trong GCS.");
  }
  const workerUrl = text(
    (
      await db.systemSetting.findUnique({
        select: { value: true },
        where: { key: "assetSetup.backgroundWorkerUrl" },
      })
    )?.value,
  );
  const secret = await getModuleConfigSecret(
    "assetSetup.backgroundWorkerSecret",
  );
  if (!workerUrl) {
    throw new AssetSetupError(
      "Chưa cấu hình URL worker Python trong Cấu hình Tổng.",
    );
  }
  const attempts = Number(originalContent.attempts || 0) + 1;
  const startedAt = new Date().toISOString();
  await db.configurationRecord.update({
    data: {
      content: asJson({
        ...originalContent,
        attempts,
        jobStatus: "processing",
        message: "Python worker đang xử lý nền ảnh.",
        progress: 30,
        startedAt,
        updatedAt: startedAt,
        "Bắt đầu xử lý": startedAt,
        "Số lần thử": attempts,
        "Thông báo tác vụ": "Python worker đang xử lý nền ảnh.",
        "Tiến trình": 30,
        "Trạng thái tác vụ": "processing",
      }),
      status: "Đang xử lý nền",
    },
    where: { id: job.id },
  });

  try {
    const [buffer] = await requestAttachmentStorage()
      .bucket(fileObject.bucket)
      .file(fileObject.objectKey)
      .download();
    const itemType = jobItemType(
      originalContent.itemType || originalContent["Loại tác vụ"],
    );
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    };
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
      headers["X-Asset-Worker-Secret"] = secret;
    }
    const response = await fetch(workerUrl, {
      body: JSON.stringify({
        fileName: fileObject.originalName,
        imageBase64: buffer.toString("base64"),
        itemType,
        jobId: job.id,
        mimeType: fileObject.mimeType || "image/png",
        options: {
          alphaMatting: true,
          alphaMattingBackgroundThreshold: 10,
          alphaMattingErodeSize: 10,
          alphaMattingForegroundThreshold: 240,
          outputMimeType: "image/png",
          postProcessMask: true,
          transparent: true,
        },
      }),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(90_000),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Worker Python trả về HTTP ${response.status}: ${responseText.slice(
          0,
          240,
        )}`,
      );
    }
    let payload: JsonRecord;
    try {
      payload = asRecord(responseText ? JSON.parse(responseText) : {});
    } catch {
      throw new Error("Worker Python trả về JSON không hợp lệ.");
    }
    if (payload.ok === false) {
      throw new Error(
        text(payload.message || payload.error) ||
          "Worker Python xử lý nền thất bại.",
      );
    }
    const base64 = workerResultBase64(
      payload.dataUrl ||
        payload.imageDataUrl ||
        payload.imageBase64 ||
        payload.base64 ||
        payload.contentBase64,
    );
    if (!base64) {
      throw new Error("Worker Python chưa trả về ảnh đã xử lý.");
    }
    const outputMimeType = text(
      payload.mimeType || payload.outputMimeType || "image/png",
    );
    const imageInput = {
      buffer: Buffer.from(base64, "base64"),
      mimeType: outputMimeType.startsWith("image/")
        ? outputMimeType
        : "image/png",
      originalName:
        text(payload.fileName || payload.name) ||
        `${job.name || "tai-san"} - no-bg.png`,
    };
    const stored =
      itemType === "asset"
        ? await createAssetFromBuffer(
            session,
            normalizeAssetDraft(
              asRecord(originalContent.payload) as unknown as AssetDraftInput,
            ),
            imageInput,
          )
        : itemType === "stationery"
          ? await createStationeryFromBuffer(
              session,
              normalizeStationeryDraft(
                asRecord(
                  originalContent.payload,
                ) as unknown as StationeryDraftInput,
              ),
              imageInput,
            )
          : await createUniformFromBuffer(
              session,
              normalizeUniformDraft(
                asRecord(
                  originalContent.payload,
                ) as unknown as UniformDraftInput,
              ),
              imageInput,
            );
    const completedAt = new Date().toISOString();
    const current = asRecord(
      (
        await db.configurationRecord.findUnique({
          select: { content: true },
          where: { id: job.id },
        })
      )?.content,
    );
    await db.configurationRecord.update({
      data: {
        content: asJson({
          ...current,
          completedAt,
          jobStatus: "done",
          message: "Đã xử lý nền và lưu vào danh mục.",
          processedFileId: stored.image.fileId,
          processedFileName: stored.image.name,
          processedImageUrl: stored.image.url,
          progress: 100,
          workerResponse: {
            detail: text(payload.message || payload.detail),
            fileName: imageInput.originalName,
            mimeType: imageInput.mimeType,
            ok: true,
          },
          "Hoàn tất xử lý": completedAt,
          "Tên ảnh xử lý": stored.image.name,
          "Thông báo tác vụ": "Đã xử lý nền và lưu vào danh mục.",
          "Tiến trình": 100,
          "Trạng thái tác vụ": "done",
          "Ảnh xử lý ID": "",
          "Ảnh xử lý URL": stored.image.url,
        }),
        status: "Đã xử lý nền",
      },
      where: { id: job.id },
    });
    await writeAudit(db, session, {
      action: "SYNC",
      metadata: { catalogId: stored.id, itemType },
      summary: `Hoàn tất xử lý nền: ${job.name || job.id}.`,
      targetId: job.id,
      targetType: "AssetBackgroundJob",
    });
    return { jobId: job.id, ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Không xử lý nền được.";
    const completedAt = new Date().toISOString();
    const current = asRecord(
      (
        await db.configurationRecord.findUnique({
          select: { content: true },
          where: { id: job.id },
        })
      )?.content,
    );
    await db.configurationRecord.update({
      data: {
        content: asJson({
          ...current,
          completedAt,
          jobStatus: "failed",
          message: `${message} Hình gốc vẫn được giữ để thử lại.`,
          progress: 100,
          "Hoàn tất xử lý": completedAt,
          "Thông báo tác vụ": `${message} Hình gốc vẫn được giữ để thử lại.`,
          "Tiến trình": 100,
          "Trạng thái tác vụ": "failed",
        }),
        status: "Lỗi xử lý nền",
      },
      where: { id: job.id },
    });
    throw new AssetSetupError(message);
  }
}

export async function runAssetBackgroundQueue(session: AppSession) {
  assertAssetSetupAccess(session);
  const db = getDb();
  const rows = await db.configurationRecord.findMany({
    orderBy: { createdAt: "asc" },
    take: 20,
    where: {
      recordType: "asset-setup",
      sourceSheet: NATIVE_SOURCE,
    },
  });
  const queued = rows.find((row) => {
    const content = asRecord(row.content);
    return (
      normalizedKey(content.group || content["Nhóm cấu hình"]) ===
        "asset background job" &&
      jobStatus(content.jobStatus || content["Trạng thái tác vụ"]) ===
        "queued"
    );
  });
  if (!queued) return { processed: 0 };
  await processBackgroundJob(session, queued.id);
  return { processed: 1 };
}

export async function retryAssetBackgroundJob(
  session: AppSession,
  jobId: string,
) {
  assertAssetSetupAccess(session);
  const db = getDb();
  const row = await db.configurationRecord.findFirst({
    where: {
      id: jobId,
      recordType: "asset-setup",
      sourceSheet: NATIVE_SOURCE,
    },
  });
  if (!row) {
    throw new AssetSetupError(
      "Không tìm thấy tác vụ PostgreSQL cần chạy lại.",
    );
  }
  const content = asRecord(row.content);
  if (!text(content.originalFileId)) {
    throw new AssetSetupError(
      "Tác vụ không còn ảnh gốc trong GCS để chạy lại.",
    );
  }
  const now = new Date().toISOString();
  await db.configurationRecord.update({
    data: {
      content: asJson({
        ...content,
        completedAt: "",
        jobStatus: "queued",
        message: "Đã đưa lại vào hàng đợi xử lý nền.",
        progress: 10,
        startedAt: "",
        updatedAt: now,
        "Bắt đầu xử lý": "",
        "Hoàn tất xử lý": "",
        "Thông báo tác vụ": "Đã đưa lại vào hàng đợi xử lý nền.",
        "Tiến trình": 10,
        "Trạng thái tác vụ": "queued",
      }),
      status: "Đang chờ xử lý nền",
    },
    where: { id: row.id },
  });
  await writeAudit(db, session, {
    action: "UPDATE",
    summary: `Chạy lại tác vụ xử lý nền: ${row.name || row.id}.`,
    targetId: row.id,
    targetType: "AssetBackgroundJob",
  });
}

function invoicePrompt(options: AssetOptionDto[]) {
  const optionHint = Object.fromEntries(
    ASSET_OPTION_KINDS.map((kind) => [
      kind.key,
      options
        .filter((option) => option.kind === kind.key)
        .map((option) => option.name)
        .slice(0, 80),
    ]),
  );
  return [
    "Bạn là trợ lý hành chính nội bộ, chuyên đọc hóa đơn đầu vào tiếng Việt để tạo nháp CCDC/tài sản.",
    "Hãy trích xuất các mặt hàng có thể là CCDC/tài sản và ánh xạ vào schema JSON.",
    "Mỗi loại tài sản/mặt hàng chỉ xuất hiện một object duy nhất, không tạo object theo từng đơn vị số lượng.",
    "Nếu nhiều dòng giống cùng một tài sản, hãy gộp số lượng và ghi chú nguồn dòng.",
    "Bỏ qua thuế, phí vận chuyển, chiết khấu, dịch vụ và các dòng tổng cộng.",
    "Tên sản phẩm dùng để lưu phải nằm ở productName, ưu tiên đúng tên hàng hóa trên hóa đơn, giữ thương hiệu/model/dung lượng/quy cách.",
    "Nếu tên OCR có mã dòng/SKU rõ ràng nối bằng dấu gạch dưới ở cuối, hãy bỏ mã đó khỏi productName nhưng vẫn giữ nguyên dòng gốc trong invoiceItemName/sourceLines.",
    "Quà tặng/khuyến mãi vẫn có khả năng là CCDC thì giữ lại nhưng đặt lowSignificance=true.",
    `Cấu hình hiện có: ${JSON.stringify(optionHint)}`,
    "Chỉ trả về JSON hợp lệ, không markdown, không giải thích.",
    `Schema: ${JSON.stringify({
      items: [
        {
          amount: "",
          assetType: "",
          depreciationPeriod: "",
          descriptorGroups: [
            {
              colors: [{ colorHex: "", name: "" }],
              fillerPhrases: [""],
              materials: [""],
              shapes: [""],
            },
          ],
          functionAreas: [""],
          heightCm: "",
          invoiceItemName: "",
          lengthCm: "",
          lowSignificance: false,
          note: "",
          productName: "",
          productValue: "",
          quantity: "",
          sourceLines: [""],
          unit: "",
          unitPrice: "",
          warrantyPeriod: "",
          widthCm: "",
        },
      ],
    })}`,
  ].join("\n");
}

function geminiText(response: JsonRecord) {
  const candidates = Array.isArray(response.candidates)
    ? response.candidates
    : [];
  const candidate = asRecord(candidates[0]);
  const content = asRecord(candidate.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return parts.map((part) => text(asRecord(part).text)).filter(Boolean).join("\n");
}

function parseGeminiJson(value: string) {
  const raw = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const candidates = [raw];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return asRecord(JSON.parse(candidate));
    } catch {
      try {
        return asRecord(
          JSON.parse(
            candidate
              .replace(/\uFEFF/g, "")
              .replace(/,\s*([}\]])/g, "$1")
              .replace(/}\s*{/g, "},{"),
          ),
        );
      } catch {
        // Thử candidate tiếp theo.
      }
    }
  }
  throw new AssetSetupError(
    "Gemini trả về JSON chưa hợp lệ. Vui lòng thử phân tích lại.",
  );
}

function invoiceSuggestion(value: unknown): AssetInvoiceSuggestion | null {
  const item = asRecord(value);
  const descriptorGroups = normalizeDescriptorGroups(
    item.descriptorGroups || item.descriptors,
    item,
  );
  const invoiceItemName = text(
    item.invoiceItemName || item.itemName || item.name,
  );
  const productName =
    text(item.productName || item.assetName || item.displayName) ||
    invoiceItemName;
  const assetType = text(item.assetType || item.type || item.category);
  if (!assetType) return null;
  const draft: AssetDraftInput = {
    assetNameOverride: productName,
    assetType,
    depreciationPeriod: text(
      item.depreciationPeriod || item.depreciation || item.khauHao,
    ),
    descriptorGroups,
    functionAreas: uniqueTexts(
      item.functionAreas || item.functionArea || item.usage,
    ),
    heightCm: text(item.heightCm || item.height || item.caoCm),
    lengthCm: text(item.lengthCm || item.length || item.daiCm),
    note: text(item.note || item.reason),
    productValue: text(
      item.productValue ||
        item.value ||
        item.assetValue ||
        item.amount ||
        item.total ||
        item.thanhTien ||
        item.unitPrice ||
        item.price,
    ),
    warrantyPeriod: text(
      item.warrantyPeriod || item.warranty || item.baoHanh,
    ),
    widthCm: text(item.widthCm || item.width || item.rongCm),
  };
  return {
    ...draft,
    amount: text(item.amount || item.total || item.thanhTien),
    generatedName: buildAssetCatalogName(draft),
    invoiceItemName,
    lowSignificance:
      item.lowSignificance === true ||
      ["true", "1", "yes"].includes(normalizedKey(item.lowSignificance)),
    quantity: text(item.quantity || item.qty || item.soLuong),
    sourceLines: uniqueTexts(
      item.sourceLines || item.sourceLine || invoiceItemName,
    ),
    unit: text(item.unit || item.donViTinh),
    unitPrice: text(item.unitPrice || item.price || item.donGia),
  };
}

export async function analyzeAssetInvoice(
  session: AppSession,
  file: File,
) {
  assertAssetSetupAccess(session);
  if (!file || file.size <= 0) {
    throw new AssetSetupError(
      "Vui lòng nạp hóa đơn đầu vào trước khi phân tích.",
    );
  }
  const mimeType = text(file.type) || "application/pdf";
  if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) {
    throw new AssetSetupError("Hóa đơn chỉ hỗ trợ PDF hoặc hình ảnh.");
  }
  if (file.size > MAX_INVOICE_BYTES) {
    throw new AssetSetupError("Hóa đơn không được vượt quá 10 MB.");
  }
  const apiKey = await getModuleConfigSecret("ai.geminiApiKey");
  if (!apiKey) {
    throw new AssetSetupError(
      "Chưa lưu API key Gemini trong Cấu hình Tổng, tag AI.",
    );
  }
  const db = getDb();
  const model =
    text(
      (
        await db.systemSetting.findUnique({
          select: { value: true },
          where: { key: "ai.geminiModel" },
        })
      )?.value,
    ).replace(/^models\//i, "") || "gemini-2.5-flash";
  const snapshot = await getAssetSetupSnapshot();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent`,
    {
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: invoicePrompt(snapshot.options) },
              {
                inline_data: {
                  data: Buffer.from(await file.arrayBuffer()).toString("base64"),
                  mime_type: mimeType,
                },
              },
            ],
            role: "user",
          },
        ],
        generationConfig: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      method: "POST",
      signal: AbortSignal.timeout(120_000),
    },
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new AssetSetupError(
      `Gemini API trả về HTTP ${response.status}: ${responseText.slice(
        0,
        240,
      )}`,
    );
  }
  const parsedResponse = asRecord(JSON.parse(responseText));
  const parsed = parseGeminiJson(geminiText(parsedResponse));
  const source = Array.isArray(parsed.items)
    ? parsed.items
    : Array.isArray(parsed.assets)
      ? parsed.assets
      : [];
  const seen = new Set<string>();
  const suggestions: AssetInvoiceSuggestion[] = [];
  for (const item of source) {
    const suggestion = invoiceSuggestion(item);
    if (!suggestion) continue;
    const key = normalizedKey(
      [
        suggestion.assetType,
        suggestion.assetNameOverride,
        suggestion.functionAreas.join("|"),
        JSON.stringify(suggestion.descriptorGroups),
      ].join("||"),
    );
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(suggestion);
  }
  await writeAudit(db, session, {
    action: "SYNC",
    metadata: {
      count: suggestions.length,
      fileName: safeFileName(file.name),
      model,
    },
    summary: `Phân tích hóa đơn tài sản: ${safeFileName(file.name)}.`,
    targetId: safeFileName(file.name),
    targetType: "AssetInvoiceAnalysis",
  });
  return { fileName: file.name, model, suggestions };
}

export const assetSetupPath = PATH;
