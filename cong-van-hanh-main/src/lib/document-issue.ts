// Core cấp số văn bản dùng chung (Sổ văn bản, Đóng dấu và Biểu mẫu).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { type FormatToken } from "@/lib/document-numbering";
import {
  buildCycleKey,
  buildPoolKey,
  effectiveDocumentStartIndex,
  maxSerial,
  nextDocumentSerial,
  renderNumber,
} from "@/lib/document-registry";

export type IssueParams = {
  companyId: string;
  createdById?: string | null;
  createdByName?: string | null;
  documentTypeId: string;
  note?: string | null;
  partnerAbbr?: string | null;
  partnerName?: string | null;
  quantity?: number;
  sealTypes?: string[];
  signDate: Date;
};

export type IssueResult =
  | { documentNumber: string; id: string; ok: true; serial: number }
  | { error: string; ok: false };

export type IssuePreviewResult =
  | {
      companyShort: string;
      documentNumber: string;
      ok: true;
      serial: number;
      startIndex: number;
    }
  | { error: string; ok: false };

function tokensOf(value: unknown): FormatToken[] {
  return Array.isArray(value)
    ? value.map((token) => {
        const source = token as { type?: unknown; value?: unknown };
        return {
          type: String(source.type ?? ""),
          ...(source.value != null ? { value: String(source.value) } : {}),
        };
      })
    : [];
}

async function loadNumberingContext(db: PrismaClient, params: IssueParams) {
  const [company, documentType, companyRule] = await Promise.all([
    db.company.findUnique({ where: { id: params.companyId } }),
    db.documentType.findUnique({ where: { id: params.documentTypeId } }),
    db.documentTypeCompanyNumbering.findUnique({
      where: {
        documentTypeId_companyId: {
          companyId: params.companyId,
          documentTypeId: params.documentTypeId,
        },
      },
    }),
  ]);
  if (!company) return { error: "Không tìm thấy pháp nhân.", ok: false as const };
  if (!documentType) {
    return { error: "Không tìm thấy loại hồ sơ.", ok: false as const };
  }
  if (!documentType.takesNumber) {
    return { error: "Loại hồ sơ này không lấy số.", ok: false as const };
  }
  if (documentType.status !== "ACTIVE") {
    return { error: "Loại hồ sơ này đang tạm ngưng.", ok: false as const };
  }

  const companyShort =
    company.shortName || company.code || company.legalName;
  const cycleKey = buildCycleKey(documentType.cycle, params.signDate);
  const poolKey = buildPoolKey(documentType.id, companyShort, cycleKey);
  const start = effectiveDocumentStartIndex(
    documentType.startIndex,
    companyRule?.startIndex,
  );
  return {
    ceiling: maxSerial(start, documentType.cycleLimit),
    company,
    companyShort,
    cycleKey,
    documentType,
    ok: true as const,
    poolKey,
    start,
    tokens: tokensOf(documentType.formatTokens),
  };
}

function numberingHistoryWhere(
  context: Extract<Awaited<ReturnType<typeof loadNumberingContext>>, { ok: true }>,
): Prisma.DocumentRegistryWhereInput {
  return {
    AND: [
      {
        OR: [
          { documentTypeId: context.documentType.id },
          {
            documentTypeName: {
              equals: context.documentType.name,
              mode: "insensitive",
            },
          },
        ],
      },
      {
        OR: [
          { companyId: context.company.id },
          {
            companyShort: {
              equals: context.companyShort,
              mode: "insensitive",
            },
          },
        ],
      },
    ],
    cycleKey: context.cycleKey,
  };
}

export async function previewDocumentNumber(
  db: PrismaClient,
  params: IssueParams,
): Promise<IssuePreviewResult> {
  const context = await loadNumberingContext(db, params);
  if (!context.ok) return context;
  const slots = await db.documentRegistry.findMany({
    select: { serial: true, status: true },
    where: {
      ...numberingHistoryWhere(context),
      status: { in: ["ISSUED", "CANCELLED"] },
    },
  });
  const serial = nextDocumentSerial(context.start, context.ceiling, slots);
  if (serial == null) {
    return {
      error: "Đã hết số khả dụng trong vòng lặp hiện tại (chạm giới hạn).",
      ok: false,
    };
  }
  return {
    companyShort: context.companyShort,
    documentNumber: renderNumber(
      context.tokens,
      serial,
      context.companyShort,
      params.signDate,
      params.partnerAbbr || "",
    ),
    ok: true,
    serial,
    startIndex: context.start,
  };
}

export async function issueDocumentNumber(
  db: PrismaClient,
  params: IssueParams,
): Promise<IssueResult> {
  const context = await loadNumberingContext(db, params);
  if (!context.ok) return context;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slots = await db.documentRegistry.findMany({
      select: { serial: true, status: true },
      where: {
        ...numberingHistoryWhere(context),
        status: { in: ["ISSUED", "CANCELLED"] },
      },
    });
    const serial = nextDocumentSerial(context.start, context.ceiling, slots);
    if (serial == null) {
      return {
        error: "Đã hết số khả dụng trong vòng lặp hiện tại (chạm giới hạn).",
        ok: false,
      };
    }
    const documentNumber = renderNumber(
      context.tokens,
      serial,
      context.companyShort,
      params.signDate,
      params.partnerAbbr || "",
    );
    try {
      // Chỉ tái sử dụng slot được đánh dấu CANCELLED; không tự lấp khoảng trống
      // lịch sử vì đó có thể là số đã phát hành trước khi dữ liệu được migrate.
      const reusable = await db.documentRegistry.findFirst({
        select: { id: true },
        where: {
          ...numberingHistoryWhere(context),
          serial,
          status: "CANCELLED",
        },
      });
      if (reusable) {
        const claimed = await db.documentRegistry.updateMany({
          data: {
            companyId: context.company.id,
            companyShort: context.companyShort,
            condition: context.documentType.condition,
            createdById: params.createdById ?? null,
            createdByName: params.createdByName ?? null,
            cycleKey: context.cycleKey,
            documentNumber,
            documentTypeId: context.documentType.id,
            documentTypeName: context.documentType.name,
            note: params.note ?? null,
            partnerAbbr: params.partnerAbbr ?? null,
            partnerName: params.partnerName ?? null,
            poolKey: context.poolKey,
            quantity:
              params.quantity && params.quantity > 0 ? params.quantity : 1,
            sealTypes: params.sealTypes ?? [],
            signDate: params.signDate,
            status: "ISSUED",
          },
          where: { id: reusable.id, status: "CANCELLED" },
        });
        if (claimed.count === 1) {
          return { documentNumber, id: reusable.id, ok: true, serial };
        }
        continue;
      }
      const record = await db.documentRegistry.create({
        data: {
          companyId: context.company.id,
          companyShort: context.companyShort,
          condition: context.documentType.condition,
          createdById: params.createdById ?? null,
          createdByName: params.createdByName ?? null,
          cycleKey: context.cycleKey,
          documentNumber,
          documentTypeId: context.documentType.id,
          documentTypeName: context.documentType.name,
          note: params.note ?? null,
          partnerAbbr: params.partnerAbbr ?? null,
          partnerName: params.partnerName ?? null,
          poolKey: context.poolKey,
          quantity:
            params.quantity && params.quantity > 0 ? params.quantity : 1,
          sealTypes: params.sealTypes ?? [],
          serial,
          signDate: params.signDate,
        },
      });
      return { documentNumber, id: record.id, ok: true, serial };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      return { error: "Không cấp được số văn bản.", ok: false };
    }
  }
  return { error: "Hệ thống đang bận, vui lòng thử lại.", ok: false };
}
