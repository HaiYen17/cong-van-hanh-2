"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import type { RequestEventType, RequestStatus } from "@/generated/prisma/enums";
import { can, canAny } from "@/lib/auth/authorization";
import type { PermissionKey } from "@/lib/auth/permissions";
import { requireCurrentSession } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { materializeLegalDossiers } from "@/lib/admin-tools/legal-dossier";
import { buildAllocationCatalog } from "@/lib/assets/allocation-catalog";
import { validateAllocationRequestPayload } from "@/lib/assets/allocation-request-validation";
import { getAssetSetupSnapshot } from "@/lib/assets/setup-runtime";
import { getDb } from "@/lib/db";
import { readCompanySignatureRouting } from "@/lib/config/company-signature-config";
import { issueDocumentNumber } from "@/lib/document-issue";
import { storeRequestAttachments } from "@/lib/requests/attachments";
import {
  assertElectronicSignatureCompletionReady,
  renameElectronicSignatureInputsForProcessing,
} from "@/lib/requests/electronic-signature";
import { processReviewRequest } from "@/lib/requests/review-processing";
import { isNumberingService, isValidServiceCode } from "@/lib/requests/services";
import { cleanSignatureSubmission, signatureSubmission } from "@/lib/requests/digital-signature-policy";

const PATH = "/thuc-thi";

export type RequestActionState = {
  error?: string;
  requestCode?: string;
  submittedAt?: string;
  success?: string;
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function optionalText(formData: FormData, name: string) {
  const value = text(formData, name);
  return value ? value : null;
}

function objectOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function canCreateRequest(session: AppSession) {
  return canAny(session, [
    "my_requests.create",
    "admin_requests.create",
    "support_requests.create",
  ]);
}

function makeRequestCode() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `YC-${stamp}-${random}`;
}

export async function submitRequestAction(
  _state: RequestActionState,
  formData: FormData,
): Promise<RequestActionState> {
  const session = await requireCurrentSession();

  if (!canCreateRequest(session)) {
    return { error: "Ông chưa có quyền tạo yêu cầu." };
  }

  const serviceCode = text(formData, "serviceCode");
  const title = text(formData, "title");
  const note = optionalText(formData, "note");
  const priority = optionalText(formData, "priority");
  let companyId = optionalText(formData, "companyId");

  if (!serviceCode || !isValidServiceCode(serviceCode)) {
    return { error: "Chọn loại yêu cầu hợp lệ." };
  }

  if (
    (serviceCode === "document-seal" ||
      serviceCode === "authorization-letter") &&
    !session.fullAccess &&
    !session.modules.includes(serviceCode)
  ) {
    return {
      error:
        serviceCode === "authorization-letter"
          ? "Tài khoản chưa được cấp quyền Cấp giấy Ủy quyền/Giới thiệu."
          : "Tài khoản chưa được cấp quyền Đóng dấu và Ký số.",
    };
  }

  if (!title) {
    return { error: "Nhập tiêu đề yêu cầu." };
  }

  // Field theo dịch vụ gửi kèm dạng JSON ở "payload".
  let payload: Prisma.InputJsonValue = {};
  const payloadRaw = text(formData, "payload");
  if (payloadRaw) {
    try {
      const parsed = JSON.parse(payloadRaw);
      if (parsed && typeof parsed === "object") payload = parsed as Prisma.InputJsonValue;
    } catch {
      payload = {};
    }
  }
  if (serviceCode === "asset-allocation") {
    try {
      const assetSetup = await getAssetSetupSnapshot();
      const validation = validateAllocationRequestPayload(
        payload,
        buildAllocationCatalog(assetSetup),
      );
      if (!validation.ok) return { error: validation.error };
      payload = validation.payload as Prisma.InputJsonValue;
    } catch {
      return {
        error:
          "Chưa kiểm tra được danh mục cấp phát trong PostgreSQL. Vui lòng thử lại.",
      };
    }
  }
  // Dịch vụ cấp số (đóng dấu / cấp giấy): gắn công ty (pháp nhân ký) vào yêu cầu.
  if (isNumberingService(serviceCode)) {
    const p = payload as {
      companyId?: unknown;
      documentTypeId?: unknown;
      items?: { companyId?: unknown; documentTypeId?: unknown; signDate?: unknown }[];
      signDate?: unknown;
    };
    if (Array.isArray(p.items) && p.items.length > 0) {
      // Đơn nhiều mục (giỏ): mỗi mục phải đủ pháp nhân + ngày ký; loại VB có thể trống (mục "Khác" không cấp số).
      const bad = p.items.some((it) => !it.companyId || !it.signDate);
      if (bad) return { error: "Mỗi mục cần pháp nhân ký và ngày ký." };
      companyId = String(p.items[0].companyId);
    } else {
      if (!p.companyId || !p.documentTypeId || !p.signDate) {
        return { error: "Chọn pháp nhân ký, loại văn bản và ngày ký." };
      }
      companyId = String(p.companyId);
    }
  }

  const db = getDb();

  let digitalSubmission: ReturnType<typeof signatureSubmission> = null;
  if (serviceCode === "document-seal") {
    try {
      payload = cleanSignatureSubmission(payload) as Prisma.InputJsonValue;
      digitalSubmission = signatureSubmission(payload);
      if (digitalSubmission && !await db.company.findFirst({ where: { id: digitalSubmission.companyId, status: "ACTIVE" } })) {
        return { error: "Pháp nhân ký không còn hoạt động." };
      }
      if (digitalSubmission) {
        const route = (await readCompanySignatureRouting())[digitalSubmission.companyId];
        if (!route?.certAlias || !route.bodUserIds.length) {
          return {
            error:
              "Pháp nhân chưa được cấu hình chứng thư và BOD ký số trong Cấu hình Tổng.",
          };
        }
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Hồ sơ ký số không hợp lệ." };
    }
  }

  try {
    const request = await db.$transaction(async (tx) => {
      const created = await tx.request.create({
        data: {
          code: makeRequestCode(),
          companyId: companyId ?? undefined,
          createdById: session.userId,
          note,
          payload,
          priority,
          serviceCode,
          status: "SUBMITTED",
          title,
        },
      });

      if (digitalSubmission) {
        await tx.digitalSignatureWorkflow.create({ data: {
          requestId: created.id,
          companyId: digitalSubmission.companyId,
          placements: digitalSubmission.placements as Prisma.InputJsonValue,
        } });
      }

      await tx.requestEvent.create({
        data: {
          actorId: session.userId,
          note,
          requestId: created.id,
          toStatus: "SUBMITTED",
          type: "SUBMITTED",
        },
      });

      await tx.auditLog.create({
        data: {
          action: "CREATE",
          actorId: session.userId,
          metadata: { serviceCode },
          summary: `Created request ${created.code}.`,
          targetId: created.id,
          targetType: "Request",
        },
      });

      return created;
    });

    let completionNotice = "";
    if (serviceCode === "document-seal" || serviceCode === "document-archive") {
      try {
        await materializeLegalDossiers();
      } catch (error) {
        await db.requestEvent.create({
          data: {
            actorId: session.userId,
            note:
              error instanceof Error
                ? `Chưa thể đưa hồ sơ vào hàng đợi xử lý ngay: ${error.message}`
                : "Chưa thể đưa hồ sơ vào hàng đợi xử lý ngay.",
            requestId: request.id,
            type: "COMMENT",
          },
        });
        completionNotice =
          " Đơn đã được ghi nhận; hàng đợi xử lý đang tự đồng bộ lại.";
      }
    }

    const attachments = formData
      .getAll("attachments")
      .filter((item): item is File => item instanceof File && item.size > 0);
    if (attachments.length) {
      try {
        await storeRequestAttachments(db, {
          files: attachments,
          requestCode: request.code,
          requestId: request.id,
          userId: session.userId,
        });

        if (serviceCode === "review-contract") {
          const review = await processReviewRequest(db, {
            actorId: session.userId,
            file: attachments[0],
            requestId: request.id,
          });
          completionNotice = review.ok
            ? ` ${review.message}`
            : ` Hồ sơ đã được lưu; AI chưa chạy: ${review.error}`;
        }
      } catch (error) {
        await db.requestEvent.create({
          data: {
            actorId: session.userId,
            note:
              error instanceof Error
                ? `Không tải đủ tệp đính kèm: ${error.message}`
                : "Không tải đủ tệp đính kèm.",
            requestId: request.id,
            type: "COMMENT",
          },
        });
        revalidatePath(PATH);
        return {
          error:
            error instanceof Error
              ? `${request.code} đã được tạo nhưng tệp chưa tải đủ: ${error.message}`
              : `${request.code} đã được tạo nhưng tệp chưa tải đủ.`,
        };
      }
    }

    revalidatePath(PATH);
    revalidatePath("/nguoi-thuan-viet");
    revalidatePath("/nguoi-thuan-viet/don-hang");
    revalidatePath("/nguoi-thuan-viet/review-ho-so");
    return {
      requestCode: request.code,
      submittedAt: request.createdAt.toISOString(),
      success: `Đã gửi yêu cầu ${request.code}.${completionNotice}`,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { error: "Trùng mã yêu cầu, vui lòng thử lại." };
    }

    return { error: "Không gửi được yêu cầu." };
  }
}

type TransitionOptions = {
  allowCreator?: boolean;
  from: RequestStatus[];
  required: PermissionKey | null;
  setCompleted?: boolean;
  to: RequestStatus;
  type: RequestEventType;
};

async function transition(
  requestId: string,
  options: TransitionOptions,
): Promise<void> {
  const session = await requireCurrentSession();
  const db = getDb();

  const request = await db.request.findUnique({ where: { id: requestId } });

  if (!request || request.archivedAt) {
    return;
  }

  const digitalSignatureWorkflow =
    await db.digitalSignatureWorkflow.findUnique({ where: { requestId } });
  if (digitalSignatureWorkflow) {
    if (options.to !== "CANCELLED") return;
    if (
      ["SIGN_QUEUED", "SIGN_PENDING", "SIGN_UNKNOWN", "SIGNED"].includes(
        digitalSignatureWorkflow.state,
      )
    ) {
      return;
    }
  }

  const isCreator = sessionOwnsUserId(session, request.createdById);
  const allowed =
    (options.required !== null && can(session, options.required)) ||
    (Boolean(options.allowCreator) && isCreator);

  if (!allowed) {
    return;
  }

  if (!options.from.includes(request.status)) {
    return;
  }

  if (
    request.serviceCode === "document-seal" &&
    options.to === "IN_PROGRESS"
  ) {
    await renameElectronicSignatureInputsForProcessing(session, request.id);
  }
  if (
    request.serviceCode === "document-seal" &&
    options.to === "COMPLETED"
  ) {
    assertElectronicSignatureCompletionReady(
      objectOf(request.payload),
    );
  }

  await db.$transaction(async (tx) => {
    await tx.request.update({
      data: {
        assignedToId:
          options.type === "PROCESSING" ? session.userId : request.assignedToId,
        completedAt: options.setCompleted ? new Date() : request.completedAt,
        status: options.to,
      },
      where: { id: requestId },
    });

    if (digitalSignatureWorkflow && options.to === "CANCELLED") {
      await tx.digitalSignatureWorkflow.update({
        data: {
          error: "Hồ sơ đã được hủy trước khi gửi MISA eSign.",
          leaseExpiresAt: null,
          leaseToken: null,
          state: "CANCELLED",
          version: { increment: 1 },
        },
        where: { id: digitalSignatureWorkflow.id },
      });
    }

    if (
      options.to === "CANCELLED" &&
      request.serviceCode === "authorization-letter"
    ) {
      const payload = objectOf(request.payload);
      const items = Array.isArray(payload.items)
        ? payload.items.map(objectOf)
        : [payload];
      const registryIds = items
        .map((item) =>
          String(
            item.documentRegistryId ||
              objectOf(item.documentNumberMeta).documentRegistryId ||
              "",
          ).trim(),
        )
        .filter(Boolean);
      const documentNumbers = items
        .map((item) =>
          String(
            item.issuedNumber || item.soVanBan || item.documentNumber || "",
          ).trim(),
        )
        .filter(Boolean);
      if (registryIds.length || documentNumbers.length) {
        await tx.documentRegistry.updateMany({
          data: { status: "CANCELLED" },
          where: {
            OR: [
              ...(registryIds.length ? [{ id: { in: registryIds } }] : []),
              ...(documentNumbers.length
                ? [{ documentNumber: { in: documentNumbers } }]
                : []),
            ],
          },
        });
      }
    }

    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        fromStatus: request.status,
        requestId,
        toStatus: options.to,
        type: options.type,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        summary: `Request ${request.code}: ${request.status} -> ${options.to}.`,
        targetId: requestId,
        targetType: "Request",
      },
    });
  });

  revalidatePath(PATH);
}

export async function processRequestAction(requestId: string): Promise<void> {
  await transition(requestId, {
    from: ["SUBMITTED", "NEEDS_INFO"],
    required: "admin_requests.process",
    to: "IN_PROGRESS",
    type: "PROCESSING",
  });
}

export async function needsInfoRequestAction(requestId: string): Promise<void> {
  await transition(requestId, {
    from: ["SUBMITTED", "IN_PROGRESS"],
    required: "admin_requests.process",
    to: "NEEDS_INFO",
    type: "NEEDS_INFO",
  });
}

export async function approveRequestAction(requestId: string): Promise<void> {
  await transition(requestId, {
    from: ["SUBMITTED", "IN_PROGRESS"],
    required: "admin_requests.approve",
    to: "APPROVED",
    type: "APPROVED",
  });
}

export async function rejectRequestAction(requestId: string): Promise<void> {
  await transition(requestId, {
    from: ["SUBMITTED", "IN_PROGRESS", "NEEDS_INFO"],
    required: "admin_requests.approve",
    to: "REJECTED",
    type: "REJECTED",
  });
}

export async function completeRequestAction(requestId: string): Promise<void> {
  await transition(requestId, {
    from: ["IN_PROGRESS", "APPROVED"],
    required: "admin_requests.process",
    setCompleted: true,
    to: "COMPLETED",
    type: "COMPLETED",
  });
}

export async function cancelRequestAction(requestId: string): Promise<void> {
  await transition(requestId, {
    allowCreator: true,
    from: ["SUBMITTED", "IN_PROGRESS", "NEEDS_INFO"],
    required: "admin_requests.archive",
    to: "CANCELLED",
    type: "CANCELLED",
  });
}

// Nhánh đóng dấu vật lý: admin cấp số văn bản qua engine Sổ văn bản rồi hoàn tất yêu cầu.
export async function issueAndCompleteRequestAction(requestId: string): Promise<void> {
  const session = await requireCurrentSession();
  if (!can(session, "admin_requests.process") || !can(session, "documents.manage")) {
    return;
  }

  const db = getDb();
  const request = await db.request.findUnique({ where: { id: requestId } });
  if (!request || request.archivedAt) return;
  if (await db.digitalSignatureWorkflow.findUnique({ where: { requestId } })) return;
  if (!isNumberingService(request.serviceCode)) return;
  if (request.status !== "IN_PROGRESS" && request.status !== "APPROVED") return;
  assertElectronicSignatureCompletionReady(objectOf(request.payload));

  type SealItem = {
    companyId?: string;
    documentTypeId?: string;
    issuedNumber?: string;
    partnerAbbr?: string;
    partnerName?: string;
    quantity?: number;
    sealTypes?: string[];
    signDate?: string;
    typeLabel?: string;
  };
  const p = (request.payload ?? {}) as SealItem & { items?: SealItem[]; issuedNumber?: string };
  // Chuẩn hoá thành danh sách mục: đơn nhiều mục (giỏ) hoặc 1 mục cũ.
  const items: SealItem[] = Array.isArray(p.items) && p.items.length > 0 ? p.items : [p];
  const numbers: string[] = [];
  const issuedItems: SealItem[] = [];

  for (const it of items) {
    // Mục đã có số / không có loại VB (mục "Khác") → giữ nguyên, không cấp.
    if (it.issuedNumber) {
      numbers.push(it.issuedNumber);
      issuedItems.push(it);
      continue;
    }
    if (!it.documentTypeId || !it.companyId || !it.signDate) {
      issuedItems.push(it);
      continue;
    }
    const signDate = new Date(it.signDate);
    if (Number.isNaN(signDate.getTime())) {
      issuedItems.push(it);
      continue;
    }
    const result = await issueDocumentNumber(db, {
      companyId: it.companyId,
      createdById: session.userId,
      createdByName: session.displayName,
      documentTypeId: it.documentTypeId,
      note: it.partnerName ?? request.title,
      partnerAbbr: it.partnerAbbr ?? null,
      partnerName: it.partnerName ?? null,
      quantity: it.quantity,
      sealTypes: it.sealTypes ?? [],
      signDate,
    });
    if (!result.ok) {
      await db.requestEvent.create({
        data: { actorId: session.userId, note: `Cấp số thất bại: ${result.error}`, requestId, type: "COMMENT" },
      });
      revalidatePath(PATH);
      return;
    }
    numbers.push(result.documentNumber);
    issuedItems.push({ ...it, issuedNumber: result.documentNumber });
  }

  if (numbers.length === 0) {
    await db.requestEvent.create({
      data: { actorId: session.userId, note: "Không có mục nào cần cấp số (thiếu loại văn bản).", requestId, type: "COMMENT" },
    });
    revalidatePath(PATH);
    return;
  }

  const newPayload: Prisma.InputJsonValue = Array.isArray(p.items)
    ? ({ ...p, items: issuedItems } as Prisma.InputJsonValue)
    : ({ ...issuedItems[0], issuedNumber: numbers[0] } as Prisma.InputJsonValue);

  await db.$transaction(async (tx) => {
    await tx.request.update({
      data: { completedAt: new Date(), payload: newPayload, status: "COMPLETED" },
      where: { id: requestId },
    });
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        fromStatus: request.status,
        note: `Đã cấp số: ${numbers.join(", ")}`,
        requestId,
        toStatus: "COMPLETED",
        type: "COMPLETED",
      },
    });
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: { documentNumber: numbers.join(", ") },
        summary: `Request ${request.code}: cấp số ${numbers.join(", ")} & hoàn tất.`,
        targetId: requestId,
        targetType: "Request",
      },
    });
  });

  revalidatePath(PATH);
}
