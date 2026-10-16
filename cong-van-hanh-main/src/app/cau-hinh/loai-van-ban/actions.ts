"use server";

import { revalidatePath } from "next/cache";

import { AuditAction, Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  DOCUMENT_CONDITIONS,
  DOCUMENT_CYCLES,
  DOCUMENT_DECLARATIONS,
  TOKEN_BY_KEY,
  type FormatToken,
} from "@/lib/document-numbering";
import { getDb } from "@/lib/db";

const PATH = "/cau-hinh/loai-van-ban";
const declarationKeys = new Set<string>(
  DOCUMENT_DECLARATIONS.map(({ key }) => key),
);

export type DocTypeActionState = {
  error?: string;
  success?: string;
  updatedCount?: number;
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function checked(formData: FormData, name: string) {
  return formData.get(name) != null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

function parseDeclarations(raw: string): string[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  return [
    ...new Set(
      parsed
        .map((value) => String(value || "").trim())
        .filter((value) => declarationKeys.has(value)),
    ),
  ];
}

function parseTokens(raw: string): FormatToken[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((token) => {
      const source = token as { type?: unknown; value?: unknown };
      const type = String(source.type ?? "");
      const definition = TOKEN_BY_KEY.get(type);
      if (!definition) return null;
      const value =
        source.value == null ? undefined : String(source.value).trim();
      if (definition.kind === "serial") {
        if (!value || !/^#+$/.test(value)) {
          throw new Error(
            "Quy cách STT chỉ được nhập bằng dấu #, ví dụ ##, ### hoặc ####.",
          );
        }
        return { type, value };
      }
      if (definition.kind === "fixed") {
        if (!value) {
          throw new Error("Vui lòng nhập cụm từ cố định.");
        }
        return { type, value: value.replaceAll(";", " ") };
      }
      return { type };
    })
    .filter((token): token is FormatToken => token !== null);
}

type CompanyStartInput = {
  companyId: string;
  startIndex: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseCompanyStarts(raw: string): CompanyStartInput[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  return parsed.map((value) => {
    const source = asRecord(value);
    const companyId = String(source.companyId || "").trim();
    const startIndex = Number(source.startIndex);
    if (!companyId) throw new Error("Có dòng pháp nhân chưa được chọn.");
    if (seen.has(companyId)) {
      throw new Error("Mỗi pháp nhân chỉ được cấu hình một điểm bắt đầu.");
    }
    if (!Number.isInteger(startIndex) || startIndex < 1) {
      throw new Error("Số bắt đầu theo pháp nhân phải là số nguyên lớn hơn 0.");
    }
    seen.add(companyId);
    return { companyId, startIndex };
  });
}

function templateNumberingDocumentTypeId(content: Record<string, unknown>) {
  return String(
    content["Mã loại hồ sơ đánh số"] ||
      content.numberingDocumentTypeId ||
      "",
  ).trim();
}

async function requireManagePermission() {
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) {
    throw new Error("Ông chưa có quyền cấu hình loại văn bản.");
  }
  return session;
}

export async function saveDocumentTypeAction(
  _state: DocTypeActionState,
  formData: FormData,
): Promise<DocTypeActionState> {
  let session;
  try {
    session = await requireManagePermission();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Ông chưa có quyền cấu hình loại văn bản.",
    };
  }

  const editId = text(formData, "editId");
  const name = text(formData, "name");
  if (!name) return { error: "Vui lòng nhập tên văn bản." };

  const takesNumber = checked(formData, "takesNumber");
  const declarations = parseDeclarations(text(formData, "declarationTypes"));
  if (!declarations.length) {
    return { error: "Vui lòng chọn ít nhất một loại khai báo." };
  }

  const startRaw = Number.parseInt(text(formData, "startIndex"), 10);
  const limitRaw = Number.parseInt(text(formData, "cycleLimit"), 10);
  const condition = text(formData, "condition") || null;
  const cycle = text(formData, "cycle") || null;
  let formatTokens: FormatToken[] = [];
  let companyStarts: CompanyStartInput[] = [];
  try {
    formatTokens = parseTokens(text(formData, "formatTokens"));
    companyStarts = parseCompanyStarts(
      text(formData, "companyStartIndexes"),
    );
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Quy cách đánh số chưa hợp lệ.",
    };
  }

  if (takesNumber) {
    if (!DOCUMENT_CONDITIONS.includes(condition || "")) {
      return { error: "Vui lòng chọn điều kiện lưu trữ." };
    }
    if (!DOCUMENT_CYCLES.includes(cycle || "")) {
      return { error: "Vui lòng chọn vòng lặp đánh số." };
    }
    if (!formatTokens.length) {
      return {
        error:
          "Kéo thả hoặc bấm ít nhất một thành phần để tạo quy cách đánh số.",
      };
    }
    if (
      cycle === "Theo giới hạn" &&
      (!Number.isFinite(limitRaw) || limitRaw < 1)
    ) {
      return { error: "Vui lòng nhập giới hạn vòng lặp lớn hơn 0." };
    }
  }

  const startIndex =
    takesNumber && Number.isFinite(startRaw) && startRaw > 0 ? startRaw : 1;
  if (!takesNumber) companyStarts = [];
  const db = getDb();
  if (companyStarts.length) {
    const companyCount = await db.company.count({
      where: {
        id: { in: companyStarts.map((item) => item.companyId) },
        status: "ACTIVE",
      },
    });
    if (companyCount !== companyStarts.length) {
      return { error: "Có pháp nhân không còn hoạt động hoặc không tồn tại." };
    }
  }
  const data = {
    condition: takesNumber ? condition : null,
    cycle: takesNumber ? cycle : null,
    cycleLimit:
      takesNumber &&
      cycle === "Theo giới hạn" &&
      Number.isFinite(limitRaw)
        ? limitRaw
        : null,
    declarationTypes: declarations,
    formatTokens: takesNumber ? formatTokens : [],
    name,
    startIndex,
    takesNumber,
  };

  try {
    const result = await db.$transaction(async (tx) => {
      const documentType = editId
        ? await tx.documentType.update({ data, where: { id: editId } })
        : await tx.documentType.create({
            data: { ...data, createdById: session.userId },
          });
      const registryUpdate = editId
        ? await tx.documentRegistry.updateMany({
            data: {
              condition: documentType.condition,
              documentTypeName: documentType.name,
            },
            where: { documentTypeId: documentType.id },
          })
        : { count: 0 };
      await tx.documentTypeCompanyNumbering.deleteMany({
        where: {
          documentTypeId: documentType.id,
          ...(companyStarts.length
            ? {
                companyId: {
                  notIn: companyStarts.map((item) => item.companyId),
                },
              }
            : {}),
        },
      });
      for (const companyStart of companyStarts) {
        await tx.documentTypeCompanyNumbering.upsert({
          create: {
            companyId: companyStart.companyId,
            createdById: session.userId,
            documentTypeId: documentType.id,
            startIndex: companyStart.startIndex,
          },
          update: { startIndex: companyStart.startIndex },
          where: {
            documentTypeId_companyId: {
              companyId: companyStart.companyId,
              documentTypeId: documentType.id,
            },
          },
        });
      }
      let templateRowsUpdated = 0;
      if (editId) {
        const templates = await tx.configurationRecord.findMany({
          where: { recordType: "template" },
        });
        for (const template of templates) {
          const content = asRecord(template.content);
          if (templateNumberingDocumentTypeId(content) !== documentType.id) {
            continue;
          }
          await tx.configurationRecord.update({
            data: {
              content: {
                ...content,
                "Loại hồ sơ đánh số": documentType.name,
              } as Prisma.InputJsonValue,
            },
            where: { id: template.id },
          });
          templateRowsUpdated += 1;
        }
      }
      await tx.auditLog.create({
        data: {
          action: editId ? AuditAction.UPDATE : AuditAction.CREATE,
          actorId: session.userId,
          metadata: {
            companyStartIndexes: companyStarts,
            declarationTypes: declarations,
            registryRowsUpdated: registryUpdate.count,
            templateRowsUpdated,
            takesNumber,
          },
          summary: editId
            ? `Cập nhật loại văn bản "${name}".`
            : `Tạo loại văn bản "${name}".`,
          targetId: documentType.id,
          targetType: "DocumentType",
        },
      });
      return registryUpdate.count;
    });
    revalidatePath(PATH);
    revalidatePath("/thuc-thi/so-van-ban");
    return {
      success: editId
        ? `Đã cập nhật loại văn bản và đồng bộ ${result} hồ sơ.`
        : "Đã thêm loại văn bản.",
      updatedCount: result,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: `Tên văn bản "${name}" đã tồn tại trong cấu hình.` };
    }
    return { error: "Không lưu được cấu hình loại văn bản." };
  }
}

export async function deleteDocumentTypeAction(
  _state: DocTypeActionState,
  formData: FormData,
): Promise<DocTypeActionState> {
  let session;
  try {
    session = await requireManagePermission();
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Ông chưa có quyền xóa.",
    };
  }
  const sourceId = text(formData, "sourceId");
  const replacementId = text(formData, "replacementId");
  if (!sourceId || !replacementId || sourceId === replacementId) {
    return { error: "Vui lòng chọn đúng loại hồ sơ thay thế." };
  }

  const db = getDb();
  try {
    const result = await db.$transaction(async (tx) => {
      const [source, replacement] = await Promise.all([
        tx.documentType.findUnique({ where: { id: sourceId } }),
        tx.documentType.findUnique({ where: { id: replacementId } }),
      ]);
      if (!source) throw new Error("Không tìm thấy loại văn bản cần xóa.");
      if (!replacement) {
        throw new Error("Không tìm thấy loại hồ sơ thay thế.");
      }
      const updated = await tx.documentRegistry.updateMany({
        data: {
          condition: replacement.condition,
          documentTypeId: replacement.id,
          documentTypeName: replacement.name,
        },
        where: { documentTypeId: source.id },
      });
      let updatedTemplateCount = 0;
      const templates = await tx.configurationRecord.findMany({
        where: { recordType: "template" },
      });
      for (const template of templates) {
        const content = asRecord(template.content);
        if (templateNumberingDocumentTypeId(content) !== source.id) continue;
        await tx.configurationRecord.update({
          data: {
            content: {
              ...content,
              "Loại hồ sơ đánh số": replacement.name,
              "Mã loại hồ sơ đánh số": replacement.id,
            } as Prisma.InputJsonValue,
          },
          where: { id: template.id },
        });
        updatedTemplateCount += 1;
      }
      await tx.documentType.delete({ where: { id: source.id } });
      await tx.auditLog.create({
        data: {
          action: AuditAction.DELETE,
          actorId: session.userId,
          metadata: {
            replacementDocumentTypeId: replacement.id,
            replacementDocumentTypeName: replacement.name,
            updatedRegistryCount: updated.count,
            updatedTemplateCount,
          },
          summary: `Xóa "${source.name}" và chuyển ${updated.count} hồ sơ sang "${replacement.name}".`,
          targetId: source.id,
          targetType: "DocumentType",
        },
      });
      return {
        replacementName: replacement.name,
        sourceName: source.name,
        updatedCount: updated.count,
      };
    });
    revalidatePath(PATH);
    revalidatePath("/thuc-thi/so-van-ban");
    return {
      success: `Đã xóa "${result.sourceName}" và chuyển ${result.updatedCount} hồ sơ sang "${result.replacementName}".`,
      updatedCount: result.updatedCount,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Không xóa được loại văn bản.",
    };
  }
}

export async function resyncDocumentRegistryAction(
  _state: DocTypeActionState,
  _formData: FormData,
): Promise<DocTypeActionState> {
  void _state;
  void _formData;
  let session;
  try {
    session = await requireManagePermission();
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Ông chưa có quyền quét lại hồ sơ.",
    };
  }

  const db = getDb();
  try {
    const updatedCount = await db.$transaction(async (tx) => {
      const documentTypes = await tx.documentType.findMany();
      let count = 0;
      for (const documentType of documentTypes) {
        const updated = await tx.documentRegistry.updateMany({
          data: {
            condition: documentType.condition,
            documentTypeName: documentType.name,
          },
          where: { documentTypeId: documentType.id },
        });
        count += updated.count;
      }
      await tx.auditLog.create({
        data: {
          action: AuditAction.SYNC,
          actorId: session.userId,
          metadata: {
            documentTypeCount: documentTypes.length,
            updatedRegistryCount: count,
          },
          summary: `Quét lại ${count} hồ sơ theo cấu hình loại văn bản hiện tại.`,
          targetType: "DocumentRegistry",
        },
      });
      return count;
    });
    revalidatePath(PATH);
    revalidatePath("/thuc-thi/so-van-ban");
    return {
      success: `Đã quét lại cấu hình và cập nhật ${updatedCount} hồ sơ.`,
      updatedCount,
    };
  } catch {
    return {
      error: "Không quét lại được hồ sơ theo cấu hình loại văn bản.",
    };
  }
}

export async function setDocumentTypeStatusAction(
  id: string,
  status: string,
): Promise<void> {
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) return;
  await getDb().documentType.update({
    data: { status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE" },
    where: { id },
  });
  revalidatePath(PATH);
}
